import {
  isKubectlAlreadyExists,
  kubectlArgs,
  runKubectlCommand,
  type KubectlRunner,
} from "../../kubernetes/api/kubectl.ts"
import type {
  McpTemplateInput,
  McpTemplateSummary,
} from "../types.ts"
import { buildMcpTemplateSecret } from "../lib/kubernetesTemplate.ts"

const TEMPLATE_NAMESPACE = "mcp-hub"
const TEMPLATE_PREFIX = "mcp-template-"
const TEMPLATE_RESOURCE_LABEL = "mcp.idthw.dev/resource=mcp-template"

export class McpTemplateConflictError extends Error {}

export async function createMcpTemplate(
  input: McpTemplateInput,
  runKubectl: KubectlRunner = runKubectlCommand,
) {
  const resourceName = `${TEMPLATE_PREFIX}${input.templateKey}`
  const existing = await runKubectl(kubectlArgs([
    "get",
    `secret/${resourceName}`,
    "--namespace",
    TEMPLATE_NAMESPACE,
    "--ignore-not-found",
    "-o",
    "name",
  ]))
  if (existing.stdout.trim()) throw new McpTemplateConflictError("An MCP template with this key already exists")

  const manifest = JSON.stringify(buildMcpTemplateSecret(input))
  try {
    await runKubectl(kubectlArgs(["create", "--dry-run=server", "-f", "-"]), manifest)
    await runKubectl(kubectlArgs(["create", "-f", "-"]), manifest)
  } catch (error) {
    if (isKubectlAlreadyExists(error)) {
      throw new McpTemplateConflictError("An MCP template with this key already exists")
    }
    throw error
  }
}

export async function listMcpTemplates(
  project: string,
  runKubectl: KubectlRunner = runKubectlCommand,
): Promise<McpTemplateSummary[]> {
  const result = await runKubectl(kubectlArgs([
    "get",
    "secrets",
    "--namespace",
    TEMPLATE_NAMESPACE,
    "--selector",
    `${TEMPLATE_RESOURCE_LABEL},mcp.idthw.dev/project=${project}`,
    "-o",
    "jsonpath={range .items[*]}{.metadata.labels.mcp\\.idthw\\.dev/template-key}{\"\\t\"}{.metadata.annotations.mcp\\.idthw\\.dev/template-name}{\"\\n\"}{end}",
  ]))

  return result.stdout
    .split("\n")
    .map((line) => line.split("\t"))
    .filter((fields) => fields.length === 2 && fields[0] && fields[1])
    .map(([key, name]) => ({ key, name, project, visibility: "Project" as const }))
    .sort((left, right) => left.name.localeCompare(right.name))
}
