import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import https from "node:https"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

const ANNOTATION_PROJECT = "mcp.idthw.dev/project"
const ANNOTATION_UPSTREAM_URL = "mcp.idthw.dev/upstream-url"
const ANNOTATION_PUBLIC_URL = "mcp.idthw.dev/public-url"
const ANNOTATION_TRANSPORT = "mcp.idthw.dev/transport"
const ANNOTATION_PATH = "mcp.idthw.dev/path"
const LABEL_PROJECT = "mcp.idthw.dev/project"

export type McpRoute = {
  id: string
  project: string
  upstreamUrl: string
  publicUrl?: string
  transport: string
}

type DiscoverArgs = {
  namespace: string
  labelSelector: string
}

type KubernetesList<T> = {
  items?: T[]
}

type KubernetesMetadata = {
  name?: string
  labels?: Record<string, string>
  annotations?: Record<string, string>
}

type KubernetesDeployment = {
  metadata?: KubernetesMetadata
  spec?: {
    template?: {
      metadata?: {
        labels?: Record<string, string>
      }
    }
  }
}

type KubernetesService = {
  metadata?: KubernetesMetadata
  spec?: {
    selector?: Record<string, string>
    ports?: Array<{
      name?: string
      port?: number
    }>
  }
}

export async function discoverMcpRoutes({ namespace, labelSelector }: DiscoverArgs): Promise<McpRoute[]> {
  const [deployments, services] = await Promise.all([
    readDeployments({ namespace, labelSelector }),
    readServices({ namespace }),
  ])

  return deployments
    .map((deployment) => deploymentToRoute({ deployment, services, namespace }))
    .filter((route) => route !== null)
    .sort((a, b) => a.id.localeCompare(b.id))
}

async function readDeployments({ namespace, labelSelector }: DiscoverArgs): Promise<KubernetesDeployment[]> {
  if (process.env.KUBERNETES_SERVICE_HOST) {
    return readKubernetesJson<KubernetesList<KubernetesDeployment>>(
      `/apis/apps/v1/namespaces/${encodeURIComponent(namespace)}/deployments?labelSelector=${encodeURIComponent(labelSelector)}`,
    ).then((response) => response.items ?? [])
  }

  const { stdout } = await execFileAsync(
    "kubectl",
    ["get", "deployments", "-n", namespace, "-l", labelSelector, "-o", "json"],
    { timeout: 5000 },
  )
  return (JSON.parse(stdout) as KubernetesList<KubernetesDeployment>).items ?? []
}

async function readServices({ namespace }: { namespace: string }): Promise<KubernetesService[]> {
  if (process.env.KUBERNETES_SERVICE_HOST) {
    return readKubernetesJson<KubernetesList<KubernetesService>>(`/api/v1/namespaces/${encodeURIComponent(namespace)}/services`).then(
      (response) => response.items ?? [],
    )
  }

  const { stdout } = await execFileAsync("kubectl", ["get", "services", "-n", namespace, "-o", "json"], {
    timeout: 5000,
  })
  return (JSON.parse(stdout) as KubernetesList<KubernetesService>).items ?? []
}

async function readKubernetesJson<T>(path: string): Promise<T> {
  const host = process.env.KUBERNETES_SERVICE_HOST
  const port = process.env.KUBERNETES_SERVICE_PORT_HTTPS ?? process.env.KUBERNETES_SERVICE_PORT ?? "443"
  const token = await readFile("/var/run/secrets/kubernetes.io/serviceaccount/token", "utf8")
  const ca = await readFile("/var/run/secrets/kubernetes.io/serviceaccount/ca.crt")

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

function deploymentToRoute({
  deployment,
  services,
  namespace,
}: {
  deployment: KubernetesDeployment
  services: KubernetesService[]
  namespace: string
}): McpRoute | null {
  const metadata = deployment.metadata ?? {}
  const annotations = metadata.annotations ?? {}
  const labels = metadata.labels ?? {}
  const id = metadata.name
  const project = annotations[ANNOTATION_PROJECT] ?? labels[LABEL_PROJECT]

  if (!id || !project || id === "core-mcp-proxy") {
    return null
  }

  const upstreamUrl = annotations[ANNOTATION_UPSTREAM_URL] ?? inferServiceUrl({ deployment, services, namespace })
  if (!upstreamUrl) {
    return null
  }

  return {
    id,
    project,
    upstreamUrl,
    publicUrl: annotations[ANNOTATION_PUBLIC_URL],
    transport: annotations[ANNOTATION_TRANSPORT] ?? "streamable-http",
  }
}

function inferServiceUrl({
  deployment,
  services,
  namespace,
}: {
  deployment: KubernetesDeployment
  services: KubernetesService[]
  namespace: string
}): string | undefined {
  const metadata = deployment.metadata ?? {}
  const annotations = metadata.annotations ?? {}
  const name = metadata.name
  const podLabels = deployment.spec?.template?.metadata?.labels ?? {}
  const service = services.find((item) => item.metadata?.name === name) ?? services.find((item) => selectorMatches(item.spec?.selector, podLabels))

  if (!service) {
    return undefined
  }

  const port = pickServicePort(service)
  if (!port) {
    return undefined
  }

  const path = normalizePath(annotations[ANNOTATION_PATH] ?? "/mcp")
  return `http://${service.metadata?.name}.${namespace}:${port}${path}`
}

function selectorMatches(selector: Record<string, string> | undefined, labels: Record<string, string>) {
  const entries = Object.entries(selector ?? {})
  return entries.length > 0 && entries.every(([key, value]) => labels[key] === value)
}

function pickServicePort(service: KubernetesService): number | undefined {
  const ports = service.spec?.ports ?? []
  return ports.find((port) => port.name === "http")?.port ?? ports[0]?.port
}

function normalizePath(value: unknown) {
  const path = String(value || "/mcp").trim()
  return path.startsWith("/") ? path : `/${path}`
}
