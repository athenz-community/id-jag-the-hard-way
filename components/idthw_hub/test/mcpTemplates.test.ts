import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import type { KubectlRunner } from "../features/kubernetes/api/kubectl.ts"
import {
  createMcpTemplate,
  deleteMcpTemplate,
  getMcpTemplate,
  listMcpTemplates,
  McpTemplateConflictError,
  McpTemplateNotFoundError,
  updateMcpTemplate,
} from "../features/mcp-templates/api/kubernetesTemplates.ts"
import {
  buildMcpTemplatePatch,
  buildMcpTemplateSecret,
  buildStoredMcpTemplate,
} from "../features/mcp-templates/lib/kubernetesTemplate.ts"
import { validateMcpTemplate } from "../features/mcp-templates/lib/templateInput.ts"
import { resolveMcpTemplateRegistration } from "../features/mcp-templates/lib/templateRegistration.ts"
import type { McpTemplateInput } from "../features/mcp-templates/types.ts"
import { TEMPLATE_MCP_IAM_MEMBER } from "../features/permissions/lib/toolPermissionDraft.ts"

const validPayload = {
  arguments: ["--transport", "streamable-http", "--stateless", "--host", "0.0.0.0", "--port", "9000"],
  command: "",
  description: "Atlassian tools",
  documentation: "https://example.test/docs",
  environmentVariables: [
    {
      key: "CONFLUENCE_URL",
      description: "Confluence base URL",
      required: true,
      secret: false,
      defaultValue: "https://example.atlassian.net/wiki",
    },
    {
      key: "CONFLUENCE_API_TOKEN",
      description: "Confluence API token",
      required: true,
      secret: true,
      defaultValue: "",
    },
  ],
  iconId: "confluence.png",
  image: "ghcr.io/sooperset/mcp-atlassian:latest",
  name: "Confluence MCP",
  path: "/mcp",
  port: "9000",
  project: "k8s-docs-server",
  templateKey: "confluence-mcp",
  transport: "streamable-http",
  visibility: "project",
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

function validInput() {
  const result = validateMcpTemplate(validPayload)
  assert.equal(result.ok, true)
  if (!result.ok) throw new Error(result.error)
  return result.input
}

test("accepts a legacy singular container argument", () => {
  const result = validateMcpTemplate({
    ...validPayload,
    argument: "--port=9000",
    arguments: undefined,
  })
  assert.equal(result.ok, true)
  if (result.ok) assert.deepEqual(result.input.arguments, ["--port=9000"])
})

test("trims container arguments and ignores blank lines", () => {
  const result = validateMcpTemplate({
    ...validPayload,
    arguments: ["  --transport", "\t", "streamable-http  "],
  })
  assert.equal(result.ok, true)
  if (result.ok) assert.deepEqual(result.input.arguments, ["--transport", "streamable-http"])
})

test("stores non-secret defaults but omits secret defaults", () => {
  const input = validInput()
  assert.equal(input.environmentVariables[0].defaultValue, "https://example.atlassian.net/wiki")
  assert.equal("defaultValue" in input.environmentVariables[1], false)

  const unsafeInput = {
    ...input,
    environmentVariables: input.environmentVariables.map((variable) => variable.secret
      ? { ...variable, defaultValue: "must-never-be-stored" }
      : variable),
  } as McpTemplateInput
  const resource = buildMcpTemplateSecret(unsafeInput) as {
    metadata: { annotations: Record<string, string>; name: string; namespace: string }
    stringData: { "template.json": string }
  }
  assert.equal(resource.metadata.name, "mcp-template-confluence-mcp")
  assert.equal(resource.metadata.namespace, "mcp-hub")
  assert.equal(resource.metadata.annotations["mcp.idthw.dev/icon"], "confluence.png")
  assert.doesNotMatch(resource.stringData["template.json"], /must-never-be-stored/)
  assert.match(resource.stringData["template.json"], /example\.atlassian\.net/)
  assert.deepEqual(JSON.parse(resource.stringData["template.json"]).arguments, validPayload.arguments)
})

test("validates and stores optional tool permission defaults", () => {
  const result = validateMcpTemplate({ ...validPayload, toolPermissions })
  assert.equal(result.ok, true)
  if (!result.ok) return

  const stored = buildStoredMcpTemplate(result.input)
  assert.deepEqual(stored.toolPermissions, toolPermissions)
  const resource = buildMcpTemplateSecret(result.input) as {
    stringData: { "template.json": string }
  }
  assert.deepEqual(
    JSON.parse(resource.stringData["template.json"]).toolPermissions,
    toolPermissions,
  )
})

test("rejects a default value for a secret template variable", () => {
  const result = validateMcpTemplate({
    ...validPayload,
    environmentVariables: [{
      ...validPayload.environmentVariables[1],
      defaultValue: "must-not-be-accepted",
    }],
  })
  assert.deepEqual(result, {
    ok: false,
    error: "Secret environment variable 1 cannot have a default value",
  })
})

test("accepts initials and rejects unsafe MCP icon IDs", () => {
  const initials = validateMcpTemplate({ ...validPayload, iconId: "" })
  assert.equal(initials.ok, true)

  assert.deepEqual(validateMcpTemplate({ ...validPayload, iconId: "../secret.png" }), {
    ok: false,
    error: "MCP icon ID is invalid",
  })
})

test("explicitly removes the template icon annotation in an update patch", () => {
  const patch = buildMcpTemplatePatch({ ...validInput(), iconId: "" })
  assert.equal(patch.metadata.annotations["mcp.idthw.dev/icon"], null)
})

test("creates the template Secret without overwriting an existing key", async () => {
  const calls: Array<{ args: string[]; stdin?: string }> = []
  const runner: KubectlRunner = async (args, stdin) => {
    calls.push({ args, stdin })
    return { stdout: "", stderr: "" }
  }
  await createMcpTemplate(validInput(), runner)
  const createCalls = calls.filter(({ args }) => args.includes("-f"))
  assert.equal(createCalls.length, 2)
  assert.match(createCalls[0].stdin ?? "", /mcp-template-confluence-mcp/)

  const collisionRunner: KubectlRunner = async () => ({
    stdout: "secret/mcp-template-confluence-mcp\n",
    stderr: "",
  })
  await assert.rejects(createMcpTemplate(validInput(), collisionRunner), McpTemplateConflictError)
})

test("updates an existing project template with a server-validated patch", async () => {
  const calls: Array<{ args: string[]; stdin?: string }> = []
  const input = { ...validInput(), name: "Updated Confluence MCP" }
  const runner: KubectlRunner = async (args, stdin) => {
    const patchFileFlag = args.indexOf("--patch-file")
    const patch = patchFileFlag >= 0 ? await readFile(args[patchFileFlag + 1], "utf8") : stdin
    calls.push({ args, stdin: patch })
    if (args.includes("get")) {
      return {
        stdout: [
          "mcp-template",
          input.project,
          input.templateKey,
          Buffer.from(JSON.stringify(buildStoredMcpTemplate(validInput()))).toString("base64"),
        ].join("\t"),
        stderr: "",
      }
    }
    return { stdout: "", stderr: "" }
  }

  await updateMcpTemplate(input, runner)

  const patchCalls = calls.filter(({ args }) => args.includes("patch"))
  assert.equal(patchCalls.length, 2)
  assert.equal(patchCalls[0].args.includes("--dry-run=server"), true)
  assert.equal(patchCalls[1].args.includes("--dry-run=server"), false)
  assert.equal(patchCalls.every(({ args }) => args.includes("--patch-file")), true)
  assert.match(patchCalls[1].stdin ?? "", /Updated Confluence MCP/)
})

test("deletes an existing template only after a server-side dry run", async () => {
  const calls: string[][] = []
  const input = validInput()
  const runner: KubectlRunner = async (args) => {
    calls.push(args)
    if (args.includes("get")) {
      return {
        stdout: [
          "mcp-template",
          input.project,
          input.templateKey,
          Buffer.from(JSON.stringify(buildStoredMcpTemplate(input))).toString("base64"),
        ].join("\t"),
        stderr: "",
      }
    }
    return { stdout: "", stderr: "" }
  }

  await deleteMcpTemplate(input.project, input.templateKey, runner)

  const deleteCalls = calls.filter((args) => args.includes("delete"))
  assert.equal(deleteCalls.length, 2)
  assert.equal(deleteCalls[0].includes("--dry-run=server"), true)
  assert.equal(deleteCalls[1].includes("--dry-run=server"), false)
  assert.equal(deleteCalls[1].includes("secret/mcp-template-confluence-mcp"), true)
})

test("lists template metadata without reading Secret data", async () => {
  const runner: KubectlRunner = async (args) => {
    assert.equal(args.some((arg) => arg.includes("template.json")), false)
    return {
      stdout: "confluence-mcp\tConfluence MCP\tconfluence.png\napi-mcp\tAPI MCP\t\n",
      stderr: "",
    }
  }
  assert.deepEqual(await listMcpTemplates("k8s-docs-server", runner), [
    { iconId: "", key: "api-mcp", name: "API MCP", project: "k8s-docs-server", visibility: "Project" },
    { iconId: "confluence.png", key: "confluence-mcp", name: "Confluence MCP", project: "k8s-docs-server", visibility: "Project" },
  ])
})

test("loads one project template from its Kubernetes Secret", async () => {
  const runner: KubectlRunner = async (args) => {
    assert.equal(args.includes("secret/mcp-template-confluence-mcp"), true)
    assert.equal(args.some((arg) => arg.includes(".data.template\\.json")), true)
    return {
      stdout: [
        "mcp-template",
        "k8s-docs-server",
        "confluence-mcp",
        Buffer.from(JSON.stringify(buildStoredMcpTemplate(validInput()))).toString("base64"),
      ].join("\t"),
      stderr: "",
    }
  }

  const template = await getMcpTemplate("k8s-docs-server", "confluence-mcp", runner)
  assert.equal(template.image, validPayload.image)
  assert.equal(template.iconId, "confluence.png")
  assert.deepEqual(template.arguments, validPayload.arguments)
  assert.equal(template.environmentVariables[1].secret, true)
  assert.equal("defaultValue" in template.environmentVariables[1], false)
})

test("does not load a template owned by another project", async () => {
  const runner: KubectlRunner = async () => ({
    stdout: [
      "mcp-template",
      "another-project",
      "confluence-mcp",
      Buffer.from(JSON.stringify(validPayload)).toString("base64"),
    ].join("\t"),
    stderr: "",
  })
  await assert.rejects(
    getMcpTemplate("k8s-docs-server", "confluence-mcp", runner),
    McpTemplateNotFoundError,
  )
})

test("resolves template runtime fields and secret flags from the Kubernetes template", () => {
  const result = resolveMcpTemplateRegistration({
    creationMethod: "template",
    environmentVariables: [
      { key: "CONFLUENCE_API_TOKEN", value: "runtime-token", secret: false },
    ],
    image: "client-controlled-image",
    project: "k8s-docs-server",
    templateKey: "confluence-mcp",
  }, validInput())
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.payload.image, validPayload.image)
  assert.equal(result.payload.iconId, "confluence.png")
  assert.deepEqual(result.payload.arguments, validPayload.arguments)
  assert.deepEqual(result.payload.environmentVariables, [
    { key: "CONFLUENCE_URL", value: "https://example.atlassian.net/wiki", secret: false },
    { key: "CONFLUENCE_API_TOKEN", value: "runtime-token", secret: true },
  ])
})

test("inherits template tool permissions and allows an instance to remove them", () => {
  const templateResult = validateMcpTemplate({ ...validPayload, toolPermissions })
  assert.equal(templateResult.ok, true)
  if (!templateResult.ok) return

  const inherited = resolveMcpTemplateRegistration({
    creationMethod: "template",
    environmentVariables: [
      { key: "CONFLUENCE_API_TOKEN", value: "runtime-token", secret: true },
    ],
    project: "k8s-docs-server",
    templateKey: "confluence-mcp",
  }, templateResult.input)
  assert.equal(inherited.ok, true)
  if (inherited.ok) assert.deepEqual(inherited.payload.toolPermissions, toolPermissions)

  const removed = resolveMcpTemplateRegistration({
    creationMethod: "template",
    environmentVariables: [
      { key: "CONFLUENCE_API_TOKEN", value: "runtime-token", secret: true },
    ],
    project: "k8s-docs-server",
    templateKey: "confluence-mcp",
    toolPermissions: null,
  }, templateResult.input)
  assert.equal(removed.ok, true)
  if (removed.ok) assert.equal(removed.payload.toolPermissions, undefined)
})

test("resolves an editable template MCP IAM helper to the selected service account", () => {
  const configuredToolPermissions = {
    version: 1,
    tools: {
      get_k8s_docs: {
        requirements: [{
          exchangeHelperRequirements: [{
            label: "MCP service can exchange into the downstream role",
            member: TEMPLATE_MCP_IAM_MEMBER,
            policies: [{
              action: "zts.token_target_exchange",
              effect: "ALLOW",
              resource: "api:mcp-hub.mcps.k8s-docs-server:role.docs-getter",
            }],
            role: "api:role.docs-getter-exchanger",
          }],
          includeExchangeHelpers: true,
          label: "Signed-in user can read documentation",
          member: "<signed_in_user>",
          role: "api:role.docs-getter",
        }],
      },
    },
  }
  const templateResult = validateMcpTemplate({
    ...validPayload,
    toolPermissions: configuredToolPermissions,
  })
  assert.equal(templateResult.ok, true)
  if (!templateResult.ok) return

  const result = resolveMcpTemplateRegistration({
    creationMethod: "template",
    environmentVariables: [
      { key: "CONFLUENCE_API_TOKEN", value: "runtime-token", secret: true },
    ],
    project: "k8s-docs-server",
    serviceAccount: "mcp-hub.mcps.k8s-docs-server.api-docs",
    templateKey: "confluence-mcp",
  }, templateResult.input)
  assert.equal(result.ok, true)
  if (!result.ok) return
  const resolved = result.payload.toolPermissions as typeof configuredToolPermissions
  assert.equal(
    resolved.tools.get_k8s_docs.requirements[0].exchangeHelperRequirements[0].member,
    "mcp-hub.mcps.k8s-docs-server.api-docs",
  )
})

test("requires template-defined values and rejects unknown keys", () => {
  assert.deepEqual(resolveMcpTemplateRegistration({
    environmentVariables: [],
  }, validInput()), {
    ok: false,
    error: "CONFLUENCE_API_TOKEN is required by the selected MCP template",
  })
  assert.deepEqual(resolveMcpTemplateRegistration({
    environmentVariables: [{ key: "UNKNOWN_KEY", value: "value" }],
  }, validInput()), {
    ok: false,
    error: "Template environment variables do not match the selected template",
  })
})
