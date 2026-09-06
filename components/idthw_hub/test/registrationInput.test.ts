import assert from "node:assert/strict"
import test from "node:test"
import { validateMcpRegistration, validateMcpUpdate } from "../features/registration/lib/registrationInput.ts"
import { TEMPLATE_MCP_IAM_MEMBER } from "../features/permissions/lib/toolPermissionDraft.ts"

const validPayload = {
  accessManagement: "hub",
  arguments: ["--transport", "streamable-http"],
  command: "",
  environmentVariables: [
    { key: "API_TOKEN", secret: true, value: "test-value" },
    { key: "UPSTREAM_URL", secret: false, value: "https://example.test" },
  ],
  iconId: "google-drive.png",
  image: "ghcr.io/example/mcp:latest",
  mcpKeyName: "docs-mcp",
  path: "/mcp",
  port: "8080",
  project: "k8s-docs-server",
  serverName: "Docs MCP",
  serviceAccount: "mcp-hub.mcps.k8s-docs-server.runtime",
}

const toolPermissions = {
  version: 1,
  tools: {
    get_k8s_docs: {
      requirements: [{
        includeExchangeHelpers: true,
        label: "Signed-in user can read documentation",
        member: "<signed_in_user>",
        role: "api:role.docs-getter",
      }],
    },
  },
}

test("accepts a valid MCP registration", () => {
  const result = validateMcpRegistration(validPayload)
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.input.mcpKeyName, "docs-mcp")
    assert.equal(result.input.iconId, "google-drive.png")
    assert.deepEqual(result.input.arguments, ["--transport", "streamable-http"])
  }
})

test("allows initials and rejects unsafe MCP icon IDs", () => {
  const initials = validateMcpRegistration({ ...validPayload, iconId: "" })
  assert.equal(initials.ok, true)

  assert.deepEqual(validateMcpRegistration({ ...validPayload, iconId: "../secret.png" }), {
    ok: false,
    error: "MCP icon ID is invalid",
  })
  assert.deepEqual(validateMcpRegistration({ ...validPayload, iconId: "notes.svg" }), {
    ok: false,
    error: "MCP icon ID is invalid",
  })
})

test("accepts a legacy singular container argument", () => {
  const result = validateMcpRegistration({
    ...validPayload,
    argument: "--port=8080",
    arguments: undefined,
  })
  assert.equal(result.ok, true)
  if (result.ok) assert.deepEqual(result.input.arguments, ["--port=8080"])
})

test("trims container arguments and ignores blank lines", () => {
  const result = validateMcpRegistration({
    ...validPayload,
    arguments: ["  --transport", "   ", "streamable-http  "],
  })
  assert.equal(result.ok, true)
  if (result.ok) assert.deepEqual(result.input.arguments, ["--transport", "streamable-http"])
})

test("rejects invalid Kubernetes names and ports", () => {
  assert.deepEqual(validateMcpRegistration({ ...validPayload, project: "Bad Project" }), {
    ok: false,
    error: "Project must be a lowercase Kubernetes DNS name",
  })
  assert.deepEqual(validateMcpRegistration({ ...validPayload, mcpKeyName: "Docs_MCP" }), {
    ok: false,
    error: "MCP key name must be a lowercase Kubernetes DNS name",
  })
  assert.deepEqual(validateMcpRegistration({ ...validPayload, port: "0" }), {
    ok: false,
    error: "Target port must be an integer from 1 to 65535",
  })
})

test("requires consistent environment fields", () => {
  assert.deepEqual(validateMcpRegistration({
    ...validPayload,
    environmentVariables: [{ key: "API_TOKEN", secret: true, value: "" }],
  }), {
    ok: false,
    error: "Environment variable 1 key and value must be provided together",
  })
})

test("rejects duplicate environment variable keys", () => {
  assert.deepEqual(validateMcpRegistration({
    ...validPayload,
    environmentVariables: [
      { key: "API_TOKEN", secret: true, value: "first" },
      { key: "API_TOKEN", secret: true, value: "second" },
    ],
  }), {
    ok: false,
    error: "Environment variable keys must be unique",
  })
})

test("requires a project-owned service account for Hub-managed access", () => {
  assert.deepEqual(validateMcpRegistration({ ...validPayload, serviceAccount: "" }), {
    ok: false,
    error: "Hub-managed access requires an IAM service account",
  })
  assert.deepEqual(validateMcpRegistration({
    ...validPayload,
    serviceAccount: "mcp-hub.mcps.other-project.runtime",
  }), {
    ok: false,
    error: "IAM service account must belong to mcp-hub.mcps.k8s-docs-server",
  })
})

test("allows server-managed access without a service account", () => {
  const result = validateMcpRegistration({
    ...validPayload,
    accessManagement: "server",
    serviceAccount: "",
  })
  assert.equal(result.ok, true)
})

test("accepts validated tool permissions for Hub-managed access", () => {
  const result = validateMcpRegistration({ ...validPayload, toolPermissions })
  assert.equal(result.ok, true)
  if (result.ok) assert.deepEqual(result.input.toolPermissions, toolPermissions)
})

test("rejects invalid tool permissions and Hub permissions on server-managed access", () => {
  const invalid = validateMcpRegistration({
    ...validPayload,
    toolPermissions: { version: 1, tools: { "": { requirements: [] } } },
  })
  assert.equal(invalid.ok, false)
  if (!invalid.ok) assert.match(invalid.error, /^Tool permissions are invalid:/)

  assert.deepEqual(validateMcpRegistration({
    ...validPayload,
    accessManagement: "server",
    serviceAccount: "",
    toolPermissions,
  }), {
    ok: false,
    error: "Tool permissions require Hub-managed access",
  })
})

test("rejects an unresolved template MCP IAM helper binding", () => {
  const unresolved = structuredClone(toolPermissions)
  unresolved.tools.get_k8s_docs.requirements[0].exchangeHelperRequirements = [{
    label: "MCP service helper",
    member: TEMPLATE_MCP_IAM_MEMBER,
    role: "api:role.docs-getter-exchanger",
  }]
  assert.deepEqual(validateMcpRegistration({ ...validPayload, toolPermissions: unresolved }), {
    ok: false,
    error: "Template MCP IAM account must be resolved during server creation",
  })
})

test("allows project visibility when creating from an MCP template", () => {
  const result = validateMcpRegistration({
    ...validPayload,
    creationMethod: "template",
    description: "Confluence tools",
    templateKey: "confluence-mcp",
    visibility: "project",
  })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.input.creationMethod, "template")
    assert.equal(result.input.templateKey, "confluence-mcp")
    assert.equal(result.input.visibility, "project")
  }
})

test("keeps project visibility unavailable for direct setup", () => {
  assert.deepEqual(validateMcpRegistration({
    ...validPayload,
    creationMethod: "direct",
    visibility: "project",
  }), {
    ok: false,
    error: "Direct setup visibility must be Personal",
  })
})

test("preserves an existing secret when an update leaves its value blank", () => {
  const existingResult = validateMcpRegistration(validPayload)
  assert.equal(existingResult.ok, true)
  if (!existingResult.ok) return

  const result = validateMcpUpdate({
    ...validPayload,
    serverName: "Updated Docs MCP",
    environmentVariables: [
      { key: "API_TOKEN", secret: true, value: "" },
      { key: "UPSTREAM_URL", secret: false, value: "https://example.test" },
    ],
  }, existingResult.input)
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.input.environmentVariables[0].value, "")
    assert.equal(result.input.environmentVariables[0].preserveExistingSecret, true)
  }
})

test("requires a value for a new secret during update", () => {
  const existingResult = validateMcpRegistration(validPayload)
  assert.equal(existingResult.ok, true)
  if (!existingResult.ok) return

  assert.deepEqual(validateMcpUpdate({
    ...validPayload,
    environmentVariables: [{ key: "NEW_TOKEN", secret: true, value: "" }],
  }, existingResult.input), {
    ok: false,
    error: "Environment variable 1 key and value must be provided together",
  })
})

test("rejects identity changes during update", () => {
  const existingResult = validateMcpRegistration(validPayload)
  assert.equal(existingResult.ok, true)
  if (!existingResult.ok) return

  assert.deepEqual(validateMcpUpdate({ ...validPayload, mcpKeyName: "other-mcp" }, existingResult.input), {
    ok: false,
    error: "MCP server identity and creation settings cannot be changed",
  })
})
