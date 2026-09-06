import { stringify } from "yaml"

const RUNTIME_PROXY_IMAGE = "ghcr.io/mlajkim/mcp-runtime-proxy:latest"
const RUNTIME_PROXY_PORT = 8082

export type McpEnvironmentVariable = {
  key: string
  value: string
  secret: boolean
}

export type McpKubernetesManifestInput = {
  accessManagement: "hub" | "server"
  arguments: string[]
  command: string
  creationMethod: "direct" | "template"
  description: string
  environmentVariables: McpEnvironmentVariable[]
  image: string
  mcpKeyName: string
  path: string
  port: string
  project: string
  serverName: string
  serviceAccount: string
  templateKey: string
  visibility: "personal" | "project"
}

type McpKubernetesResourceOptions = {
  includeSecretValues?: boolean
}

export function buildMcpKubernetesManifest(input: McpKubernetesManifestInput) {
  return buildMcpKubernetesResources(input)
    .map((resource) => stringify(resource, { lineWidth: 0 }).trimEnd())
    .join("\n---\n")
}

export function buildMcpKubernetesResources(
  input: McpKubernetesManifestInput,
  options: McpKubernetesResourceOptions = {},
) {
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
    "mcp.idthw.dev/creation-method": input.creationMethod,
    "mcp.idthw.dev/visibility": input.visibility,
  }
  if (input.description) annotations["mcp.idthw.dev/description"] = input.description
  if (input.creationMethod === "template" && input.templateKey) {
    annotations["mcp.idthw.dev/template-key"] = input.templateKey
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
  const containerArguments = input.arguments.map((argument) => argument.trim()).filter(Boolean)
  if (containerArguments.length > 0) container.args = containerArguments

  const containers = [container]
  if (input.accessManagement === "hub") {
    containers.push({
      name: "mcp-runtime-proxy",
      image: RUNTIME_PROXY_IMAGE,
      imagePullPolicy: "Always",
      env: [
        { name: "PORT", value: String(RUNTIME_PROXY_PORT) },
        { name: "MCP_TARGET_URL", value: `http://127.0.0.1:${port}` },
      ],
      ports: [{ name: "proxy-http", containerPort: RUNTIME_PROXY_PORT }],
    })
  }

  const resources: Record<string, unknown>[] = [{
    apiVersion: "v1",
    kind: "Namespace",
    metadata: { name: input.project },
  }]

  const environmentVariables = input.environmentVariables.filter(({ key, value }) => key && value)
  const secretVariables = environmentVariables.filter(({ secret }) => secret)
  const secretName = `${name}-env`
  if (secretVariables.length > 0) {
    resources.push({
      apiVersion: "v1",
      kind: "Secret",
      metadata: { name: secretName, namespace: input.project },
      type: "Opaque",
      stringData: Object.fromEntries(secretVariables.map(({ key, value }) => [
        key,
        options.includeSecretValues ? value : "<redacted in preview>",
      ])),
    })
  }
  if (environmentVariables.length > 0) {
    container.env = environmentVariables.map(({ key, value, secret }) => secret
      ? {
          name: key,
          valueFrom: { secretKeyRef: { name: secretName, key } },
        }
      : { name: key, value })
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
