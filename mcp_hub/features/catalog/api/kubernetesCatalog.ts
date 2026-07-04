import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import https from "node:https"
import { promisify } from "node:util"
import type { McpServer } from "../types/catalog"

const execFileAsync = promisify(execFile)

const LABEL_SELECTOR = process.env.MCP_HUB_K8S_LABEL_SELECTOR ?? "app.kubernetes.io/part-of=mcp-hub"
const DEFAULT_NAMESPACE = process.env.MCP_HUB_K8S_NAMESPACE ?? "mcp-hub"

const ANNOTATION_DESCRIPTION = "mcp.idthw.dev/description"
const ANNOTATION_ICON = "mcp.idthw.dev/icon"
const ANNOTATION_PROJECT = "mcp.idthw.dev/project"
const ANNOTATION_ALIAS = "mcp.idthw.dev/alias"
const LEGACY_ANNOTATION_SERVER = "mcp.idthw.dev/server"
const ANNOTATION_TOOLS = "mcp.idthw.dev/tools"
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
  return deployments.map(deploymentToMcpServer).sort((a, b) => a.name.localeCompare(b.name))
}

async function readDeployments(): Promise<Deployment[]> {
  if (process.env.KUBERNETES_SERVICE_HOST) {
    return readDeploymentsFromInClusterApi()
  }

  return readDeploymentsFromKubectl()
}

async function readDeploymentsFromInClusterApi(): Promise<Deployment[]> {
  const namespace = await readNamespace()
  const host = process.env.KUBERNETES_SERVICE_HOST
  if (!host) throw new Error("KUBERNETES_SERVICE_HOST is not set")

  const port = process.env.KUBERNETES_SERVICE_PORT_HTTPS ?? process.env.KUBERNETES_SERVICE_PORT ?? "443"
  const token = await readFile("/var/run/secrets/kubernetes.io/serviceaccount/token", "utf8")
  const ca = await readFile("/var/run/secrets/kubernetes.io/serviceaccount/ca.crt")
  const path = `/apis/apps/v1/namespaces/${encodeURIComponent(namespace)}/deployments?labelSelector=${encodeURIComponent(LABEL_SELECTOR)}`

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
  const { stdout } = await execFileAsync(
    "kubectl",
    ["get", "deployments", "-n", DEFAULT_NAMESPACE, "-l", LABEL_SELECTOR, "-o", "json"],
    { timeout: 5000 },
  )
  const response = JSON.parse(stdout) as KubernetesList<Deployment>
  return response.items ?? []
}

async function readNamespace(): Promise<string> {
  if (process.env.MCP_HUB_K8S_NAMESPACE) return process.env.MCP_HUB_K8S_NAMESPACE

  try {
    return (await readFile("/var/run/secrets/kubernetes.io/serviceaccount/namespace", "utf8")).trim()
  } catch {
    return DEFAULT_NAMESPACE
  }
}

function deploymentToMcpServer(deployment: Deployment): McpServer {
  const metadata = deployment.metadata ?? {}
  const labels = metadata.labels ?? {}
  const annotations = metadata.annotations ?? {}
  const name = metadata.name ?? "unknown"
  const alias = annotations[ANNOTATION_ALIAS] ?? labels[LABEL_ALIAS] ?? annotations[LEGACY_ANNOTATION_SERVER] ?? labels[LEGACY_LABEL_SERVER]
  const displayName = alias ?? name
  const project = annotations[ANNOTATION_PROJECT] ?? labels[LABEL_PROJECT] ?? metadata.namespace ?? DEFAULT_NAMESPACE
  const tools = splitCsv(annotations[ANNOTATION_TOOLS])

  return {
    id: name,
    name,
    alias,
    description: annotations[ANNOTATION_DESCRIPTION] ?? `The MCP server for ${displayName}`,
    project,
    totalToolCalls: "N/A",
    tools,
    iconSrc: annotations[ANNOTATION_ICON] ?? iconForServer(displayName),
    logoText: initialsFor(displayName),
    logoBg: "#ffffff",
    logoFg: "#111111",
  }
}

function splitCsv(value?: string): string[] {
  if (!value) return []
  return value.split(",").map((item) => item.trim()).filter(Boolean)
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
  if (name === "confluence") return "/icons/confluence.png"
  if (name === "athenz") return "/icons/athenz.png"
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
