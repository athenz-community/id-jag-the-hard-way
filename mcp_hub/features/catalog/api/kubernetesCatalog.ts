import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import https from "node:https"
import { promisify } from "node:util"
import type { McpServer } from "../types/catalog"

const execFileAsync = promisify(execFile)

const LABEL_SELECTOR = process.env.MCP_HUB_K8S_LABEL_SELECTOR ?? "app.kubernetes.io/part-of=mcp-hub"

const ANNOTATION_DESCRIPTION = "mcp.idthw.dev/description"
const ANNOTATION_ID = "mcp.idthw.dev/id"
const ANNOTATION_ICON = "mcp.idthw.dev/icon"
const ANNOTATION_PROJECT = "mcp.idthw.dev/project"
const ANNOTATION_ALIAS = "mcp.idthw.dev/alias"
const ANNOTATION_ACCESS_SCOPE = "mcp.idthw.dev/access-scope"
const ANNOTATION_PUBLIC_URL = "mcp.idthw.dev/public-url"
const LEGACY_ANNOTATION_SERVER = "mcp.idthw.dev/server"
const LABEL_PROJECT = "mcp.idthw.dev/project"
const LABEL_ALIAS = "mcp.idthw.dev/alias"
const LEGACY_LABEL_SERVER = "mcp.idthw.dev/server"

type KubernetesList<T> = {
  items?: T[]
}

type Deployment = {
  metadata?: {
    name?: string
    namespace?: string
    labels?: Record<string, string>
    annotations?: Record<string, string>
  }
}

export async function listMcpServersFromKubernetes(): Promise<McpServer[]> {
  const deployments = await readDeployments()
  const servers = deployments
    .map(deploymentToMcpServer)
    .filter((server): server is McpServer => server !== null)
    .sort((a, b) => a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name))
  assertUniqueRouteIds(servers)
  return servers
}

async function readDeployments(): Promise<Deployment[]> {
  if (process.env.KUBERNETES_SERVICE_HOST) {
    return readDeploymentsFromInClusterApi()
  }

  return readDeploymentsFromKubectl()
}

async function readDeploymentsFromInClusterApi(): Promise<Deployment[]> {
  const host = process.env.KUBERNETES_SERVICE_HOST
  if (!host) throw new Error("KUBERNETES_SERVICE_HOST is not set")

  const port = process.env.KUBERNETES_SERVICE_PORT_HTTPS ?? process.env.KUBERNETES_SERVICE_PORT ?? "443"
  const token = await readFile("/var/run/secrets/kubernetes.io/serviceaccount/token", "utf8")
  const ca = await readFile("/var/run/secrets/kubernetes.io/serviceaccount/ca.crt")
  const path = `/apis/apps/v1/deployments?labelSelector=${encodeURIComponent(LABEL_SELECTOR)}`

  const response = await httpsGetJson<KubernetesList<Deployment>>({
    host,
    port,
    path,
    token,
    ca,
  })

  return response.items ?? []
}

async function readDeploymentsFromKubectl(): Promise<Deployment[]> {
  const kubectlArgs = ["get", "deployments", "--all-namespaces", "-l", LABEL_SELECTOR, "-o", "json"]
  const server = process.env.MCP_HUB_KUBECTL_SERVER
  const tlsServerName = process.env.MCP_HUB_KUBECTL_TLS_SERVER_NAME

  if (server) kubectlArgs.unshift("--server", server)
  if (tlsServerName) kubectlArgs.unshift("--tls-server-name", tlsServerName)

  const { stdout } = await execFileAsync(
    "kubectl",
    kubectlArgs,
    { timeout: 5000 },
  )
  const response = JSON.parse(stdout) as KubernetesList<Deployment>
  return response.items ?? []
}

function deploymentToMcpServer(deployment: Deployment): McpServer | null {
  const metadata = deployment.metadata ?? {}
  const labels = metadata.labels ?? {}
  const annotations = metadata.annotations ?? {}
  const name = metadata.name ?? "unknown"
  const namespace = metadata.namespace ?? "default"
  const alias = annotations[ANNOTATION_ALIAS] ?? labels[LABEL_ALIAS] ?? annotations[LEGACY_ANNOTATION_SERVER] ?? labels[LEGACY_LABEL_SERVER]
  const displayName = alias ?? name
  const project = annotations[ANNOTATION_PROJECT] ?? labels[LABEL_PROJECT]
  if (!project) return null
  const routeId = annotations[ANNOTATION_ID] ?? name
  if (!isValidRouteId(routeId)) return null

  return {
    id: `${namespace}:${name}`,
    routeId,
    name,
    namespace,
    alias,
    description: annotations[ANNOTATION_DESCRIPTION] ?? `The MCP server for ${displayName}`,
    project,
    publicUrl: annotations[ANNOTATION_PUBLIC_URL],
    gatewayUrl: publicGatewayUrl(routeId),
    proxyUrl: coreProxyUrl(routeId),
    accessScope: annotations[ANNOTATION_ACCESS_SCOPE]?.trim() || undefined,
    totalToolCalls: "N/A",
    iconSrc: annotations[ANNOTATION_ICON] ?? iconForServer(displayName),
    logoText: initialsFor(displayName),
    logoBg: "#ffffff",
    logoFg: "#111111",
  }
}

function coreProxyUrl(routeId: string) {
  const baseUrl = (process.env.MCP_HUB_CORE_PROXY_URL ?? "http://core-mcp-proxy.mcp-hub:8080").replace(/\/+$/, "")
  return `${baseUrl}/mcp/${encodeURIComponent(routeId)}`
}

function publicGatewayUrl(routeId: string) {
  const baseUrl = process.env.MCP_HUB_MCP_GATEWAY_URL?.trim().replace(/\/+$/, "")
  return baseUrl ? `${baseUrl}/mcp/${encodeURIComponent(routeId)}` : undefined
}

function isValidRouteId(routeId: string) {
  return /^[a-z0-9](?:[a-z0-9._-]{0,251}[a-z0-9])?$/i.test(routeId)
}

function assertUniqueRouteIds(servers: McpServer[]) {
  const seen = new Map<string, McpServer>()
  for (const server of servers) {
    const existing = seen.get(server.routeId)
    if (existing) {
      throw new Error(
        `Duplicate MCP route id ${server.routeId}: ${existing.namespace}/${existing.name} and ${server.namespace}/${server.name}`,
      )
    }
    seen.set(server.routeId, server)
  }
}

function initialsFor(name: string): string {
  return name
    .split(/[-_\s]+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
}

function iconForServer(name: string): string | undefined {
  const normalizedName = name.toLowerCase()
  if (normalizedName.includes("confluence")) return "/icons/confluence.png"
  if (normalizedName.includes("athenz")) return "/icons/athenz.png"
  return undefined
}

function httpsGetJson<T>({
  host,
  port,
  path,
  token,
  ca,
}: {
  host: string
  port: string
  path: string
  token: string
  ca: Buffer
}): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        host,
        port,
        path,
        method: "GET",
        ca,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      },
      (response) => {
        let body = ""
        response.setEncoding("utf8")
        response.on("data", (chunk) => {
          body += chunk
        })
        response.on("end", () => {
          if (!response.statusCode || response.statusCode >= 400) {
            reject(new Error(`Kubernetes API returned ${response.statusCode ?? "unknown"}: ${body}`))
            return
          }

          try {
            resolve(JSON.parse(body) as T)
          } catch (error) {
            reject(error)
          }
        })
      },
    )

    request.on("error", reject)
    request.end()
  })
}
