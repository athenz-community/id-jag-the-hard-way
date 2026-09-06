import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
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
import { buildMcpTemplatePatch, buildMcpTemplateSecret } from "../lib/kubernetesTemplate.ts"
import { validateMcpTemplate } from "../lib/templateInput.ts"
import { normalizeMcpIconId } from "../../mcp-servers/lib/mcpIcons.ts"

const TEMPLATE_NAMESPACE = "mcp-hub"
const TEMPLATE_PREFIX = "mcp-template-"
const TEMPLATE_RESOURCE_LABEL = "mcp.idthw.dev/resource=mcp-template"

export class McpTemplateConflictError extends Error {}
export class McpTemplateNotFoundError extends Error {}

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

export async function updateMcpTemplate(
  input: McpTemplateInput,
  runKubectl: KubectlRunner = runKubectlCommand,
) {
  const resourceName = `${TEMPLATE_PREFIX}${input.templateKey}`
  await getMcpTemplate(input.project, input.templateKey, runKubectl)

  const manifest = JSON.stringify(buildMcpTemplatePatch(input))
  const patchDirectory = await mkdtemp(join(tmpdir(), "idthw-mcp-template-patch-"))
  const patchPath = join(patchDirectory, "patch.json")
  try {
    await writeFile(patchPath, manifest, { encoding: "utf8", mode: 0o600 })
    const patchArgs = [
      "patch",
      `secret/${resourceName}`,
      "--namespace",
      TEMPLATE_NAMESPACE,
      "--type=merge",
      "--patch-file",
      patchPath,
    ]
    await runKubectl(kubectlArgs([...patchArgs, "--dry-run=server"]))
    await runKubectl(kubectlArgs(patchArgs))
  } finally {
    await rm(patchDirectory, { recursive: true, force: true })
  }
}

export async function deleteMcpTemplate(
  project: string,
  templateKey: string,
  runKubectl: KubectlRunner = runKubectlCommand,
) {
  await getMcpTemplate(project, templateKey, runKubectl)
  const resourceName = `${TEMPLATE_PREFIX}${templateKey}`
  const deleteArgs = [
    "delete",
    `secret/${resourceName}`,
    "--namespace",
    TEMPLATE_NAMESPACE,
    "--ignore-not-found",
    "--wait=true",
  ]
  await runKubectl(kubectlArgs([...deleteArgs, "--dry-run=server"]))
  await runKubectl(kubectlArgs(deleteArgs))
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
    "jsonpath={range .items[*]}{.metadata.labels.mcp\\.idthw\\.dev/template-key}{\"\\t\"}{.metadata.annotations.mcp\\.idthw\\.dev/template-name}{\"\\t\"}{.metadata.annotations.mcp\\.idthw\\.dev/icon}{\"\\n\"}{end}",
  ]))

  return result.stdout
    .split("\n")
    .map((line) => line.split("\t"))
    .filter((fields) => fields.length === 3 && fields[0] && fields[1])
    .map(([key, name, iconId]) => ({
      iconId: normalizeMcpIconId(iconId),
      key,
      name,
      project,
      visibility: "Project" as const,
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

export async function getMcpTemplate(
  project: string,
  templateKey: string,
  runKubectl: KubectlRunner = runKubectlCommand,
): Promise<McpTemplateInput> {
  const result = await runKubectl(kubectlArgs([
    "get",
    `secret/${TEMPLATE_PREFIX}${templateKey}`,
    "--namespace",
    TEMPLATE_NAMESPACE,
    "--ignore-not-found",
    "-o",
    "jsonpath={.metadata.labels.mcp\\.idthw\\.dev/resource}{\"\\t\"}{.metadata.labels.mcp\\.idthw\\.dev/project}{\"\\t\"}{.metadata.labels.mcp\\.idthw\\.dev/template-key}{\"\\t\"}{.data.template\\.json}",
  ]))
  if (!result.stdout.trim()) throw new McpTemplateNotFoundError("MCP template not found")

  const [resourceType, ownerProject, storedTemplateKey, encodedTemplate, ...unexpectedFields] = result.stdout.split("\t")
  if (resourceType !== "mcp-template" || ownerProject !== project || storedTemplateKey !== templateKey) {
    throw new McpTemplateNotFoundError("MCP template not found")
  }
  if (!encodedTemplate || unexpectedFields.length > 0) throw new Error("MCP template data is missing")

  let payload: unknown
  try {
    payload = JSON.parse(Buffer.from(encodedTemplate, "base64").toString("utf8"))
  } catch {
    throw new Error("MCP template data is invalid")
  }

  const validation = validateMcpTemplate(payload)
  if (!validation.ok) throw new Error(`MCP template data is invalid: ${validation.error}`)
  if (validation.input.project !== project || validation.input.templateKey !== templateKey) {
    throw new Error("MCP template identity does not match its Kubernetes metadata")
  }
  return validation.input
}
