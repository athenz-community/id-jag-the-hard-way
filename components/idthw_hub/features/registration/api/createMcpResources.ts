import { stringify } from "yaml"
import {
  isKubectlAlreadyExists,
  kubectlArgs,
  runKubectlCommand,
  type KubectlRunner,
} from "../../kubernetes/api/kubectl.ts"
import {
  buildMcpKubernetesResources,
  type McpKubernetesManifestInput,
} from "../lib/kubernetesManifest.ts"
import { runtimeProxyResourceOptions } from "./mcpRuntimeProxy.ts"

export type { KubectlRunner } from "../../kubernetes/api/kubectl.ts"

export class McpResourceConflictError extends Error {}

type CreateMcpResourceOptions = {
  beforeCreate?: () => Promise<void>
}

export async function createMcpResources(
  input: McpKubernetesManifestInput,
  runKubectl: KubectlRunner = runKubectlCommand,
  options: CreateMcpResourceOptions = {},
) {
  const registeredRoutes = await runKubectl(kubectlArgs([
    "get",
    "deployments",
    "--all-namespaces",
    "--selector",
    "app.kubernetes.io/part-of=mcp-hub",
    "-o",
    "custom-columns=ROUTE_ID:.metadata.annotations.mcp\\.idthw\\.dev/id,NAME:.metadata.name,PROJECT_LABEL:.metadata.labels.mcp\\.idthw\\.dev/project,PROJECT_ANNOTATION:.metadata.annotations.mcp\\.idthw\\.dev/project",
    "--no-headers",
  ]))
  if (hasRouteId(registeredRoutes.stdout, input.mcpKeyName)) {
    throw new McpResourceConflictError("An MCP server with this key already exists")
  }

  const namespaceResult = await runKubectl(kubectlArgs([
    "get",
    "namespace",
    input.project,
    "--ignore-not-found",
    "-o",
    "name",
  ]))

  if (!namespaceResult.stdout.trim()) {
    try {
      await runKubectl(kubectlArgs(["create", "namespace", input.project]))
    } catch (error) {
      if (!isKubectlAlreadyExists(error)) throw error
    }
  }

  const collision = await runKubectl(kubectlArgs([
    "get",
    `deployment/${input.mcpKeyName}`,
    `service/${input.mcpKeyName}`,
    "--namespace",
    input.project,
    "--ignore-not-found",
    "-o",
    "name",
  ]))
  if (collision.stdout.trim()) {
    throw new McpResourceConflictError("An MCP server with this key already exists")
  }

  const resources = buildMcpKubernetesResources(input, {
    includeSecretValues: true,
    ...runtimeProxyResourceOptions(),
  }).slice(1)
  const manifest = resources
    .map((resource) => stringify(resource, { lineWidth: 0 }).trimEnd())
    .join("\n---\n")

  try {
    await runKubectl(kubectlArgs(["create", "--dry-run=server", "-f", "-"]), manifest)
    await options.beforeCreate?.()
    await runKubectl(kubectlArgs(["create", "-f", "-"]), manifest)
  } catch (error) {
    if (isKubectlAlreadyExists(error)) {
      throw new McpResourceConflictError("An MCP server with this key already exists")
    }
    throw error
  }
}

function hasRouteId(output: string, expectedRouteId: string) {
  return output.split("\n").some((line) => {
    const [configuredRouteId, deploymentName, projectLabel, projectAnnotation] = line.trim().split(/\s+/)
    if (!configuredRouteId || !deploymentName) return false
    if (projectLabel === "<none>" && projectAnnotation === "<none>") return false
    const routeId = configuredRouteId === "<none>" ? deploymentName : configuredRouteId
    return routeId === expectedRouteId
  })
}
