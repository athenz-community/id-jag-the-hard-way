import { stringify } from "yaml"
import { mcpServiceKeyId } from "./mcpServiceKeyId.ts"
import type { ToolPermissionSettings } from "../../permissions/types/permissions.ts"

const RUNTIME_PROXY_IMAGE = "ghcr.io/mlajkim/mcp-runtime-proxy:latest"
const RUNTIME_PROXY_PORT = 8082
const SERVICE_CERTIFICATE_FILE = "service.cert.pem"
const SERVICE_PRIVATE_KEY_FILE = "service.key.pem"
const ACCESS_TOKEN_FILE_DIRECTORY = "/var/run/idthw-access-tokens"

export const MCP_RUNTIME_PROXY_CA_CONFIG_MAP = "mcp-runtime-proxy-athenz-ca"
export const MCP_MANAGED_IDENTITY_ANNOTATION = "mcp.idthw.dev/managed-identity-secret"

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
  toolPermissions?: ToolPermissionSettings
  visibility: "personal" | "project"
}

export type McpKubernetesResourceOptions = {
  generatedServicePrivateKey?: string
  includeSecretValues?: boolean
  managedServiceIdentity?: boolean
  managedServiceKeyId?: string
  runtimeProxyImage?: string
  runtimeProxyImagePullPolicy?: "Always" | "IfNotPresent" | "Never"
}

export function managedMcpAccessDomain(project: string) {
  return `mcp-hub.mcps.${project}`
}

export function managedMcpAccessRole(mcpKeyName: string) {
  if (!/^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/.test(mcpKeyName)) {
    throw new Error("Managed MCP key is invalid")
  }
  return `${mcpKeyName}-accessor`
}

export function managedMcpAccessScope(project: string, mcpKeyName: string) {
  return `${managedMcpAccessDomain(project)}:role.${managedMcpAccessRole(mcpKeyName)}`
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
  const managedServiceIdentity = input.accessManagement === "hub"
    && options.managedServiceIdentity !== false
  const bootstrapSecretName = `${name}-athenz-bootstrap`
  const identitySecretName = `${name}-athenz-identity`
  const runtimeProxyServiceAccountName = `${name}-runtime-proxy`
  const runtimeProxyRoleName = `${name}-runtime-proxy-identity`
  const managedServiceKeyId = options.managedServiceKeyId ?? mcpServiceKeyId(name)
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
    annotations["mcp.idthw.dev/access-audience"] = managedMcpAccessDomain(input.project)
    annotations["mcp.idthw.dev/access-scope"] = managedMcpAccessScope(input.project, name)
  }
  if (input.toolPermissions) {
    annotations["mcp.idthw.dev/tool-permissions"] = JSON.stringify(input.toolPermissions)
  }
  if (managedServiceIdentity) {
    annotations[MCP_MANAGED_IDENTITY_ANNOTATION] = identitySecretName
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
    const requiredScope = managedMcpAccessScope(input.project, name)
    const serviceName = input.serviceAccount.startsWith(`${expectedAudience}.`)
      ? input.serviceAccount.slice(expectedAudience.length + 1)
      : "service-account-required"
    const runtimeProxy: Record<string, unknown> = {
      name: "mcp-runtime-proxy",
      image: options.runtimeProxyImage ?? RUNTIME_PROXY_IMAGE,
      imagePullPolicy: options.runtimeProxyImagePullPolicy ?? "Always",
      env: [
        { name: "PORT", value: String(RUNTIME_PROXY_PORT) },
        { name: "MCP_TARGET_URL", value: `http://127.0.0.1:${port}` },
        { name: "MCP_READINESS_PATH", value: input.path || "/mcp" },
        {
          name: "ATHENZ_JWKS_URL",
          value: "https://athenz-zts-server.athenz:4443/zts/v1/oauth2/keys?rfc=true",
        },
        { name: "ATHENZ_JWKS_CA_PATH", value: "/var/run/athenz/ca.crt" },
        { name: "ATHENZ_EXPECTED_AUDIENCE", value: expectedAudience },
        { name: "ATHENZ_REQUIRED_SCOPE", value: requiredScope },
      ],
      livenessProbe: {
        httpGet: { path: "/healthz", port: "proxy-http" },
        failureThreshold: 3,
        periodSeconds: 10,
        timeoutSeconds: 2,
      },
      ports: [{ name: "proxy-http", containerPort: RUNTIME_PROXY_PORT }],
      readinessProbe: {
        httpGet: { path: "/readyz", port: "proxy-http" },
        failureThreshold: 2,
        periodSeconds: 5,
        timeoutSeconds: 5,
      },
      volumeMounts: [{ name: "athenz-ca", mountPath: "/var/run/athenz", readOnly: true }],
    }
    containers.push(runtimeProxy)

    const volumes: Record<string, unknown>[] = managedServiceIdentity ? [] : [{
      name: "athenz-ca",
      configMap: {
        name: MCP_RUNTIME_PROXY_CA_CONFIG_MAP,
        items: [{ key: "ca.crt", path: "ca.crt" }],
      },
    }]
    if (managedServiceIdentity) {
      container.volumeMounts = [
        {
          name: "athenz-service-identity",
          mountPath: "/var/run/athenz",
          readOnly: true,
        },
        {
          name: "downstream-access-tokens",
          mountPath: ACCESS_TOKEN_FILE_DIRECTORY,
          readOnly: true,
        },
      ]
      runtimeProxy.env = [
        ...(runtimeProxy.env as Array<Record<string, unknown>>),
        { name: "ATHENZ_SERVICE_DOMAIN", value: expectedAudience },
        { name: "ATHENZ_SERVICE_NAME", value: serviceName },
        { name: "ATHENZ_SERVICE_KEY_ID", value: managedServiceKeyId },
        { name: "ATHENZ_ZTS_URL", value: "https://athenz-zts-server.athenz:4443/zts/v1" },
        { name: "ATHENZ_ZTS_CA_PATH", value: "/var/run/athenz/ca.crt" },
        { name: "ATHENZ_ZTS_DNS_DOMAIN", value: "zts.athenz.cloud" },
        { name: "ATHENZ_BOOTSTRAP_PRIVATE_KEY_PATH", value: `/var/run/athenz-bootstrap/${SERVICE_PRIVATE_KEY_FILE}` },
        { name: "ATHENZ_PUBLISHED_CERT_PATH", value: `/var/run/athenz/${SERVICE_CERTIFICATE_FILE}` },
        { name: "ATHENZ_IDENTITY_REFRESH_SECONDS", value: "86400" },
        { name: "ATHENZ_IDENTITY_RETRY_SECONDS", value: "300" },
        { name: "ATHENZ_TOKEN_FILE_EXCHANGE_ENABLED", value: "true" },
        {
          name: "ATHENZ_TOKEN_EXCHANGE_URL",
          value: "https://athenz-zts-server.athenz:4443/zts/v1/oauth2/token",
        },
        { name: "ATHENZ_TOKEN_EXCHANGE_CERT_PATH", value: "/var/run/athenz/service.cert.pem" },
        { name: "ATHENZ_TOKEN_EXCHANGE_KEY_PATH", value: "/var/run/athenz/service.key.pem" },
        { name: "ATHENZ_TOKEN_EXCHANGE_CA_PATH", value: "/var/run/athenz/ca.crt" },
        { name: "ATHENZ_TOKEN_FILE_DIR", value: ACCESS_TOKEN_FILE_DIRECTORY },
        { name: "KUBERNETES_IDENTITY_SECRET_NAME", value: identitySecretName },
        {
          name: "POD_NAME",
          valueFrom: { fieldRef: { fieldPath: "metadata.name" } },
        },
        {
          name: "POD_NAMESPACE",
          valueFrom: { fieldRef: { fieldPath: "metadata.namespace" } },
        },
      ]
      runtimeProxy.volumeMounts = [
        { name: "athenz-service-identity", mountPath: "/var/run/athenz", readOnly: true },
        { name: "athenz-bootstrap-key", mountPath: "/var/run/athenz-bootstrap", readOnly: true },
        {
          name: "runtime-proxy-kube-api",
          mountPath: "/var/run/secrets/kubernetes.io/serviceaccount",
          readOnly: true,
        },
        { name: "runtime-proxy-tmp", mountPath: "/tmp" },
        { name: "downstream-access-tokens", mountPath: ACCESS_TOKEN_FILE_DIRECTORY },
      ]
      runtimeProxy.securityContext = {
        allowPrivilegeEscalation: false,
        capabilities: { drop: ["ALL"] },
        readOnlyRootFilesystem: true,
        runAsNonRoot: true,
        runAsGroup: 1000,
        runAsUser: 1000,
      }
      podSpec.automountServiceAccountToken = false
      podSpec.securityContext = {
        fsGroup: 1000,
        fsGroupChangePolicy: "OnRootMismatch",
      }
      podSpec.serviceAccountName = runtimeProxyServiceAccountName
      volumes.push({
        name: "athenz-bootstrap-key",
        secret: {
          secretName: bootstrapSecretName,
          items: [{ key: SERVICE_PRIVATE_KEY_FILE, path: SERVICE_PRIVATE_KEY_FILE }],
        },
      }, {
        name: "athenz-service-identity",
        projected: {
          sources: [{
            secret: {
              name: identitySecretName,
              items: [
                { key: SERVICE_CERTIFICATE_FILE, path: SERVICE_CERTIFICATE_FILE },
                { key: SERVICE_PRIVATE_KEY_FILE, path: SERVICE_PRIVATE_KEY_FILE },
              ],
            },
          }, {
            configMap: {
              name: MCP_RUNTIME_PROXY_CA_CONFIG_MAP,
              items: [
                { key: "ca.crt", path: "ca.crt" },
                { key: "ca.crt", path: "ca.cert.pem" },
              ],
            },
          }],
        },
      }, {
        name: "runtime-proxy-kube-api",
        projected: {
          defaultMode: 420,
          sources: [{
            serviceAccountToken: {
              audience: "https://kubernetes.default.svc.cluster.local",
              expirationSeconds: 3600,
              path: "token",
            },
          }, {
            configMap: {
              name: "kube-root-ca.crt",
              items: [{ key: "ca.crt", path: "ca.crt" }],
            },
          }],
        },
      }, {
        name: "runtime-proxy-tmp",
        emptyDir: {},
      }, {
        name: "downstream-access-tokens",
        emptyDir: {},
      })
    }
    podSpec.volumes = volumes
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

  if (managedServiceIdentity) {
    const privateKeyValue = options.includeSecretValues
      ? requiredGeneratedPrivateKey(options.generatedServicePrivateKey)
      : "<generated during server creation>"
    const publishedValue = options.includeSecretValues ? "" : "<issued by MCP Runtime Proxy>"
    resources.push({
      apiVersion: "v1",
      kind: "Secret",
      metadata: { name: bootstrapSecretName, namespace: input.project, labels: { ...appLabels } },
      immutable: true,
      type: "Opaque",
      stringData: { [SERVICE_PRIVATE_KEY_FILE]: privateKeyValue },
    }, {
      apiVersion: "v1",
      kind: "Secret",
      metadata: { name: identitySecretName, namespace: input.project, labels: { ...appLabels } },
      type: "Opaque",
      stringData: {
        [SERVICE_CERTIFICATE_FILE]: publishedValue,
        [SERVICE_PRIVATE_KEY_FILE]: publishedValue,
      },
    }, {
      apiVersion: "v1",
      kind: "ServiceAccount",
      metadata: { name: runtimeProxyServiceAccountName, namespace: input.project, labels: { ...appLabels } },
      automountServiceAccountToken: false,
    }, {
      apiVersion: "rbac.authorization.k8s.io/v1",
      kind: "Role",
      metadata: { name: runtimeProxyRoleName, namespace: input.project, labels: { ...appLabels } },
      rules: [{
        apiGroups: [""],
        resources: ["secrets"],
        resourceNames: [identitySecretName],
        verbs: ["get", "patch", "update"],
      }],
    }, {
      apiVersion: "rbac.authorization.k8s.io/v1",
      kind: "RoleBinding",
      metadata: { name: runtimeProxyRoleName, namespace: input.project, labels: { ...appLabels } },
      roleRef: {
        apiGroup: "rbac.authorization.k8s.io",
        kind: "Role",
        name: runtimeProxyRoleName,
      },
      subjects: [{
        kind: "ServiceAccount",
        name: runtimeProxyServiceAccountName,
        namespace: input.project,
      }],
    })
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
      progressDeadlineSeconds: 120,
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

function requiredGeneratedPrivateKey(value: string | undefined) {
  if (!value?.trim()) throw new Error("Generated MCP service private key is required")
  return value
}
