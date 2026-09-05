import assert from "node:assert/strict"
import test from "node:test"
import type { KubectlRunner } from "../features/kubernetes/api/kubectl.ts"
import {
  createMcpTemplate,
  listMcpTemplates,
  McpTemplateConflictError,
} from "../features/mcp-templates/api/kubernetesTemplates.ts"
import { buildMcpTemplateSecret } from "../features/mcp-templates/lib/kubernetesTemplate.ts"
import { validateMcpTemplate } from "../features/mcp-templates/lib/templateInput.ts"
import type { McpTemplateInput } from "../features/mcp-templates/types.ts"

const validPayload = {
  argument: "",
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
