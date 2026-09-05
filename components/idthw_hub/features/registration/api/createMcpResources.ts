import { spawn } from "node:child_process"
import { stringify } from "yaml"
import {
  buildMcpKubernetesResources,
  type McpKubernetesManifestInput,
} from "../lib/kubernetesManifest.ts"

const KUBECTL_TIMEOUT_MS = 15_000
const MAX_COMMAND_OUTPUT_BYTES = 32_768

type KubectlResult = {
  stdout: string
  stderr: string
}

export type KubectlRunner = (args: string[], stdin?: string) => Promise<KubectlResult>

export class McpResourceConflictError extends Error {}

export async function createMcpResources(
  input: McpKubernetesManifestInput,
  runKubectl: KubectlRunner = runKubectlCommand,
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
      if (!isAlreadyExists(error)) throw error
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

  const resources = buildMcpKubernetesResources(input, { includeSecretValues: true }).slice(1)
  const manifest = resources
    .map((resource) => stringify(resource, { lineWidth: 0 }).trimEnd())
    .join("\n---\n")

  try {
    await runKubectl(kubectlArgs(["create", "--dry-run=server", "-f", "-"]), manifest)
    await runKubectl(kubectlArgs(["create", "-f", "-"]), manifest)
  } catch (error) {
    if (isAlreadyExists(error)) {
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

function kubectlArgs(args: string[]) {
  const connectionArgs: string[] = []
  const server = process.env.MCP_HUB_KUBECTL_SERVER
  const tlsServerName = process.env.MCP_HUB_KUBECTL_TLS_SERVER_NAME
  if (server) connectionArgs.push("--server", server)
  if (tlsServerName) connectionArgs.push("--tls-server-name", tlsServerName)
  return [...connectionArgs, ...args]
}

function runKubectlCommand(args: string[], stdin?: string): Promise<KubectlResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("kubectl", args, {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: KUBECTL_TIMEOUT_MS,
    })
    let stdout = ""
    let stderr = ""
    let outputExceeded = false

    const appendOutput = (current: string, chunk: Buffer) => {
      const next = current + chunk.toString("utf8")
      if (Buffer.byteLength(next) > MAX_COMMAND_OUTPUT_BYTES) {
        outputExceeded = true
        child.kill()
        return current
      }
      return next
    }

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = appendOutput(stdout, chunk)
    })
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = appendOutput(stderr, chunk)
    })
    child.on("error", (error) => reject(error))
    child.on("close", (code, signal) => {
      if (outputExceeded) {
        reject(new KubectlCommandError("kubectl output exceeded the limit", stderr))
      } else if (code === 0) {
        resolve({ stdout, stderr })
      } else {
        reject(new KubectlCommandError(
          `kubectl exited with code ${code ?? "unknown"}${signal ? ` (${signal})` : ""}`,
          stderr,
        ))
      }
    })

    child.stdin.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "EPIPE") reject(error)
    })
    child.stdin.end(stdin)
  })
}

class KubectlCommandError extends Error {
  readonly stderr: string

  constructor(message: string, stderr: string) {
    super(message)
    this.stderr = stderr
  }
}

function isAlreadyExists(error: unknown) {
  return error instanceof KubectlCommandError && /alreadyexists|already exists/i.test(error.stderr)
}
