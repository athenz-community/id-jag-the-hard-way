import assert from "node:assert/strict"
import test from "node:test"
import { validateMcpRegistration } from "../features/registration/lib/registrationInput.ts"

const validPayload = {
  accessManagement: "hub",
  arguments: ["--transport", "streamable-http"],
  command: "",
  environmentVariables: [
    { key: "API_TOKEN", secret: true, value: "test-value" },
    { key: "UPSTREAM_URL", secret: false, value: "https://example.test" },
  ],
  image: "ghcr.io/example/mcp:latest",
  mcpKeyName: "docs-mcp",
  path: "/mcp",
  port: "8080",
  project: "k8s-docs-server",
  serverName: "Docs MCP",
  serviceAccount: "mcp-hub.mcps.k8s-docs-server.runtime",
}

test("accepts a valid MCP registration", () => {
  const result = validateMcpRegistration(validPayload)
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.input.mcpKeyName, "docs-mcp")
    assert.deepEqual(result.input.arguments, ["--transport", "streamable-http"])
  }
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
