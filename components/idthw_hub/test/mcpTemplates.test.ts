import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import type { KubectlRunner } from "../features/kubernetes/api/kubectl.ts"
import {
  createMcpTemplate,
  getMcpTemplate,
  listMcpTemplates,
  McpTemplateConflictError,
  McpTemplateNotFoundError,
  updateMcpTemplate,
} from "../features/mcp-templates/api/kubernetesTemplates.ts"
import {
  buildMcpTemplateSecret,
  buildStoredMcpTemplate,
} from "../features/mcp-templates/lib/kubernetesTemplate.ts"
import { validateMcpTemplate } from "../features/mcp-templates/lib/templateInput.ts"
import { resolveMcpTemplateRegistration } from "../features/mcp-templates/lib/templateRegistration.ts"
import type { McpTemplateInput } from "../features/mcp-templates/types.ts"

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
  image: "ghcr.io/sooperset/mcp-atlassian:latest",
  name: "Confluence MCP",
  path: "/mcp",
  port: "9000",
  project: "k8s-docs-server",
  templateKey: "confluence-mcp",
  transport: "streamable-http",
  visibility: "project",
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
    metadata: { name: string; namespace: string }
    stringData: { "template.json": string }
  }
  assert.equal(resource.metadata.name, "mcp-template-confluence-mcp")
  assert.equal(resource.metadata.namespace, "mcp-hub")
  assert.doesNotMatch(resource.stringData["template.json"], /must-never-be-stored/)
  assert.match(resource.stringData["template.json"], /example\.atlassian\.net/)
  assert.deepEqual(JSON.parse(resource.stringData["template.json"]).arguments, validPayload.arguments)
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

test("lists template metadata without reading Secret data", async () => {
  const runner: KubectlRunner = async (args) => {
    assert.equal(args.some((arg) => arg.includes("template.json")), false)
    return {
      stdout: "confluence-mcp\tConfluence MCP\napi-mcp\tAPI MCP\n",
      stderr: "",
    }
  }
  assert.deepEqual(await listMcpTemplates("k8s-docs-server", runner), [
    { key: "api-mcp", name: "API MCP", project: "k8s-docs-server", visibility: "Project" },
    { key: "confluence-mcp", name: "Confluence MCP", project: "k8s-docs-server", visibility: "Project" },
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
  assert.deepEqual(result.payload.arguments, validPayload.arguments)
  assert.deepEqual(result.payload.environmentVariables, [
    { key: "CONFLUENCE_URL", value: "https://example.atlassian.net/wiki", secret: false },
    { key: "CONFLUENCE_API_TOKEN", value: "runtime-token", secret: true },
  ])
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
