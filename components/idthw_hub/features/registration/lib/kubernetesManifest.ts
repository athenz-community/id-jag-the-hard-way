import { stringify } from "yaml"

const RUNTIME_PROXY_IMAGE = "ghcr.io/mlajkim/mcp-runtime-proxy:latest"
const RUNTIME_PROXY_PORT = 8082

export type McpKubernetesManifestInput = {
  accessManagement: "hub" | "server"
  argument: string
  command: string
  environmentKey: string
  environmentSecret: boolean
  environmentValue: string
  image: string
  mcpKeyName: string
  path: string
  port: string
  project: string
  serverName: string
  serviceAccount: string
}

export function buildMcpKubernetesManifest(input: McpKubernetesManifestInput) {
  return buildMcpKubernetesResources(input)
    .map((resource) => stringify(resource, { lineWidth: 0 }).trimEnd())
    .join("\n---\n")
}

export function buildMcpKubernetesResources(input: McpKubernetesManifestInput) {
  const name = input.mcpKeyName || "mcp-server-name-required"
  const image = input.image || "<container-image-required>"
  const port = validContainerPort(input.port)
  const appLabels = {
    "app.kubernetes.io/name": name,
    "app.kubernetes.io/part-of": "mcp-hub",
    "mcp.idthw.dev/project": input.project,
  }
  const annotations: Record<string, string> = {
    "mcp.idthw.dev/id": name,
    "mcp.idthw.dev/alias": input.serverName || name,
    "mcp.idthw.dev/path": input.path || "/mcp",
    "mcp.idthw.dev/transport": "streamable-http",
    "mcp.idthw.dev/access-management": input.accessManagement,
  }
  if (input.serviceAccount) {
    annotations["mcp.idthw.dev/iam-service-account"] = input.serviceAccount
  }

  const container: Record<string, unknown> = {
    name,
    image,
    ports: [{ name: "http", containerPort: port }],
  }
  if (input.command) container.command = [input.command]
  if (input.argument) container.args = [input.argument]

  const containers = [container]
  if (input.accessManagement === "hub") {
    containers.push({
      name: "mcp-runtime-proxy",
      image: RUNTIME_PROXY_IMAGE,
      imagePullPolicy: "Always",
      env: [
        { name: "SERVER_PORT", value: String(RUNTIME_PROXY_PORT) },
        { name: "MCP_TARGET_URL", value: `http://localhost:${port}` },
        { name: "MCP_RESOURCE", value: name },
      ],
      ports: [{ name: "proxy-http", containerPort: RUNTIME_PROXY_PORT }],
    })
  }

  const resources: Record<string, unknown>[] = [{
    apiVersion: "v1",
    kind: "Namespace",
    metadata: { name: input.project },
  }]

  if (input.environmentKey && input.environmentValue) {
    if (input.environmentSecret) {
      const secretName = `${name}-env`
      resources.push({
        apiVersion: "v1",
        kind: "Secret",
        metadata: { name: secretName, namespace: input.project },
        type: "Opaque",
        stringData: { [input.environmentKey]: "<redacted in preview>" },
      })
      container.env = [{
        name: input.environmentKey,
        valueFrom: { secretKeyRef: { name: secretName, key: input.environmentKey } },
      }]
    } else {
      container.env = [{ name: input.environmentKey, value: input.environmentValue }]
    }
  }

  resources.push({
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: {
      name,
      namespace: input.project,
      labels: { ...appLabels },
      annotations,
    },
    spec: {
      replicas: 1,
      selector: { matchLabels: { "app.kubernetes.io/name": name } },
      template: {
        metadata: { labels: { ...appLabels } },
        spec: { containers },
      },
    },
  }, {
    apiVersion: "v1",
    kind: "Service",
    metadata: { name, namespace: input.project, labels: { ...appLabels } },
    spec: {
      selector: { "app.kubernetes.io/name": name },
      ports: [{
        name: "http",
        port,
        targetPort: input.accessManagement === "hub" ? RUNTIME_PROXY_PORT : port,
      }],
    },
  })

  return resources
}

function validContainerPort(value: string) {
  const port = Number(value)
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 8080
}
