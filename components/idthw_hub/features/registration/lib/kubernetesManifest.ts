import { stringify } from "yaml"

const RUNTIME_PROXY_IMAGE = "ghcr.io/mlajkim/mcp-runtime-proxy:latest"
const RUNTIME_PROXY_PORT = 8082

export const MCP_RUNTIME_PROXY_CA_CONFIG_MAP = "mcp-runtime-proxy-athenz-ca"

export type McpEnvironmentVariable = {
  key: string
  value: string
  secret: boolean
  preserveExistingSecret?: boolean
}

export type McpKubernetesManifestInput = {
  accessManagement: "hub" | "server"
  arguments: string[]
  command: string
  creationMethod: "direct" | "template"
  description: string
  environmentVariables: McpEnvironmentVariable[]
  iconId: string
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

export type McpKubernetesResourceOptions = {
  includeSecretValues?: boolean
  runtimeProxyImage?: string
  runtimeProxyImagePullPolicy?: "Always" | "IfNotPresent" | "Never"
}

export function managedMcpAccessDomain(project: string) {
  return `mcp-hub.mcps.${project}`
}

export function managedMcpAccessScope(project: string) {
  return `${managedMcpAccessDomain(project)}:role.accessor`
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
  if (input.iconId) annotations["mcp.idthw.dev/icon"] = input.iconId
  if (input.creationMethod === "template" && input.templateKey) {
    annotations["mcp.idthw.dev/template-key"] = input.templateKey
  }
  if (input.serviceAccount) {
    annotations["mcp.idthw.dev/iam-service-account"] = input.serviceAccount
  }
  if (input.accessManagement === "hub") {
    annotations["mcp.idthw.dev/access-scope"] = managedMcpAccessScope(input.project)
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
  const podSpec: Record<string, unknown> = { containers }
  if (input.accessManagement === "hub") {
    const expectedAudience = managedMcpAccessDomain(input.project)
    const requiredScope = managedMcpAccessScope(input.project)
    containers.push({
      name: "mcp-runtime-proxy",
      image: options.runtimeProxyImage ?? RUNTIME_PROXY_IMAGE,
      imagePullPolicy: options.runtimeProxyImagePullPolicy ?? "Always",
      env: [
        { name: "PORT", value: String(RUNTIME_PROXY_PORT) },
        { name: "MCP_TARGET_URL", value: `http://127.0.0.1:${port}` },
        {
          name: "ATHENZ_JWKS_URL",
          value: "https://athenz-zts-server.athenz:4443/zts/v1/oauth2/keys?rfc=true",
        },
        { name: "ATHENZ_JWKS_CA_PATH", value: "/var/run/athenz/ca.crt" },
        { name: "ATHENZ_EXPECTED_AUDIENCE", value: expectedAudience },
        { name: "ATHENZ_REQUIRED_SCOPE", value: requiredScope },
      ],
      ports: [{ name: "proxy-http", containerPort: RUNTIME_PROXY_PORT }],
      volumeMounts: [{ name: "athenz-ca", mountPath: "/var/run/athenz", readOnly: true }],
    })
    podSpec.volumes = [{
      name: "athenz-ca",
      configMap: {
        name: MCP_RUNTIME_PROXY_CA_CONFIG_MAP,
        items: [{ key: "ca.crt", path: "ca.crt" }],
      },
    }]
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
        spec: podSpec,
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
