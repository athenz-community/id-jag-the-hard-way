import assert from "node:assert/strict"
import test from "node:test"
import {
  buildMcpKubernetesManifest,
  buildMcpKubernetesResources,
  managedMcpAccessScope,
} from "../features/registration/lib/kubernetesManifest.ts"

const input = {
  accessManagement: "hub" as const,
  arguments: ["  --transport", "streamable-http  ", "   ", "--stateless", "--host", "0.0.0.0", "--port", "9000"],
  command: "/app/server",
  creationMethod: "direct" as const,
  description: "",
  environmentVariables: [
    { key: "API_TOKEN", secret: true, value: "must-not-appear" },
    { key: "OTHER_SECRET", secret: true, value: "another-secret" },
    { key: "UPSTREAM_URL", secret: false, value: "https://example.test" },
  ],
  iconId: "confluence.png",
  image: "ghcr.io/example/mcp:latest",
  mcpKeyName: "docs-mcp",
  path: "/mcp",
  port: "8080",
  project: "k8s-docs-server",
  serverName: "Docs MCP",
  serviceAccount: "mcp-hub.mcps.k8s-docs-server.runtime",
  templateKey: "",
  visibility: "personal" as const,
}

test("builds namespace, secret, deployment, and service resources", () => {
  const resources = buildMcpKubernetesResources(input)
  assert.deepEqual(resources.map((resource) => resource.kind), [
    "Namespace",
    "Secret",
    "Secret",
    "Secret",
    "ServiceAccount",
    "Role",
    "RoleBinding",
    "Deployment",
    "Service",
  ])

  const deployment = resources.find(({ kind }) => kind === "Deployment") as {
    metadata: { annotations: Record<string, string> }
    spec: { progressDeadlineSeconds: number; template: { spec: {
      containers: Array<{
        args?: string[]
        env: Array<{ name: string; value?: string }>
        image: string
        livenessProbe?: unknown
        name: string
        readinessProbe?: unknown
        securityContext?: { runAsGroup?: number; runAsUser?: number }
        volumeMounts?: Array<{ mountPath: string; name: string; readOnly: boolean }>
      }>
      securityContext?: { fsGroup?: number; fsGroupChangePolicy?: string }
      volumes: Array<{
        configMap?: { name: string }
        name: string
        projected?: { sources: Array<{ configMap?: { items: Array<{ key: string; path: string }>; name: string } }> }
      }>
    } } }
  }
  assert.equal(deployment.metadata.annotations["mcp.idthw.dev/id"], "docs-mcp")
  assert.equal(deployment.metadata.annotations["mcp.idthw.dev/creation-method"], "direct")
  assert.equal(deployment.metadata.annotations["mcp.idthw.dev/visibility"], "personal")
  assert.equal(deployment.metadata.annotations["mcp.idthw.dev/icon"], "confluence.png")
  assert.equal(
    deployment.metadata.annotations["mcp.idthw.dev/access-scope"],
    "mcp-hub.mcps.k8s-docs-server:role.docs-mcp-accessor",
  )
  assert.equal(
    deployment.metadata.annotations["mcp.idthw.dev/access-audience"],
    "mcp-hub.mcps.k8s-docs-server",
  )
  assert.equal(
    deployment.metadata.annotations["mcp.idthw.dev/iam-service-account"],
    "mcp-hub.mcps.k8s-docs-server.runtime",
  )
  assert.equal(
    deployment.metadata.annotations["mcp.idthw.dev/managed-identity-secret"],
    "docs-mcp-athenz-identity",
  )
  assert.equal(deployment.spec.template.spec.containers[0].env.length, 3)
  assert.deepEqual(deployment.spec.template.spec.containers[0].args, [
    "--transport",
    "streamable-http",
    "--stateless",
    "--host",
    "0.0.0.0",
    "--port",
    "9000",
  ])
  assert.equal(deployment.spec.template.spec.containers[1].name, "mcp-runtime-proxy")
  assert.equal(deployment.spec.progressDeadlineSeconds, 120)
  assert.equal(
    deployment.spec.template.spec.containers[1].image,
    "ghcr.io/mlajkim/mcp-runtime-proxy:latest",
  )
  const proxyEnvironment = deployment.spec.template.spec.containers[1].env
  assert.deepEqual(
    proxyEnvironment.find(({ name }) => name === "ATHENZ_EXPECTED_AUDIENCE"),
    { name: "ATHENZ_EXPECTED_AUDIENCE", value: "mcp-hub.mcps.k8s-docs-server" },
  )
  assert.deepEqual(
    proxyEnvironment.find(({ name }) => name === "ATHENZ_REQUIRED_SCOPE"),
    {
      name: "ATHENZ_REQUIRED_SCOPE",
      value: "mcp-hub.mcps.k8s-docs-server:role.docs-mcp-accessor",
    },
  )
  assert.deepEqual(
    proxyEnvironment.find(({ name }) => name === "MCP_READINESS_PATH"),
    { name: "MCP_READINESS_PATH", value: "/mcp" },
  )
  assert.deepEqual(deployment.spec.template.spec.containers[1].livenessProbe, {
    httpGet: { path: "/healthz", port: "proxy-http" },
    failureThreshold: 3,
    periodSeconds: 10,
    timeoutSeconds: 2,
  })
  assert.deepEqual(deployment.spec.template.spec.containers[1].readinessProbe, {
    httpGet: { path: "/readyz", port: "proxy-http" },
    failureThreshold: 2,
    periodSeconds: 5,
    timeoutSeconds: 5,
  })
  assert.deepEqual(
    proxyEnvironment.find(({ name }) => name === "ATHENZ_SERVICE_KEY_ID"),
    { name: "ATHENZ_SERVICE_KEY_ID", value: "idthw-hub-docs-mcp" },
  )
  assert.deepEqual(
    proxyEnvironment.find(({ name }) => name === "ATHENZ_IDENTITY_REFRESH_SECONDS"),
    { name: "ATHENZ_IDENTITY_REFRESH_SECONDS", value: "86400" },
  )
  assert.deepEqual(
    proxyEnvironment.find(({ name }) => name === "KUBERNETES_IDENTITY_SECRET_NAME"),
    { name: "KUBERNETES_IDENTITY_SECRET_NAME", value: "docs-mcp-athenz-identity" },
  )
  assert.deepEqual(
    proxyEnvironment.find(({ name }) => name === "ATHENZ_TOKEN_FILE_EXCHANGE_ENABLED"),
    { name: "ATHENZ_TOKEN_FILE_EXCHANGE_ENABLED", value: "true" },
  )
  assert.deepEqual(
    proxyEnvironment.find(({ name }) => name === "ATHENZ_TOKEN_FILE_DIR"),
    { name: "ATHENZ_TOKEN_FILE_DIR", value: "/var/run/idthw-access-tokens" },
  )
  assert.equal(deployment.spec.template.spec.containers[1].securityContext?.runAsUser, 1000)
  assert.equal(deployment.spec.template.spec.containers[1].securityContext?.runAsGroup, 1000)
  assert.deepEqual(deployment.spec.template.spec.containers[0].volumeMounts, [
    {
      name: "athenz-service-identity",
      mountPath: "/var/run/athenz",
      readOnly: true,
    },
    {
      name: "downstream-access-tokens",
      mountPath: "/var/run/idthw-access-tokens",
      readOnly: true,
    },
  ])
  assert.deepEqual(deployment.spec.template.spec.containers[1].volumeMounts?.[0], {
    name: "athenz-service-identity",
    mountPath: "/var/run/athenz",
    readOnly: true,
  })
  assert.deepEqual(
    proxyEnvironment.find(({ name }) => name === "ATHENZ_PUBLISHED_CERT_PATH"),
    { name: "ATHENZ_PUBLISHED_CERT_PATH", value: "/var/run/athenz/service.cert.pem" },
  )
  assert.deepEqual(
    deployment.spec.template.spec.volumes.map(({ name }) => name),
    [
      "athenz-bootstrap-key",
      "athenz-service-identity",
      "runtime-proxy-kube-api",
      "runtime-proxy-tmp",
      "downstream-access-tokens",
    ],
  )
  assert.deepEqual(deployment.spec.template.spec.securityContext, {
    fsGroup: 1000,
    fsGroupChangePolicy: "OnRootMismatch",
  })
  const identityVolume = deployment.spec.template.spec.volumes.find(({ name }) => (
    name === "athenz-service-identity"
  ))
  assert.deepEqual(identityVolume?.projected?.sources[1].configMap, {
    name: "mcp-runtime-proxy-athenz-ca",
    items: [
      { key: "ca.crt", path: "ca.crt" },
      { key: "ca.crt", path: "ca.cert.pem" },
    ],
  })

  const service = resources.find(({ kind }) => kind === "Service") as {
    spec: { ports: Array<{ targetPort: number }> }
  }
  assert.equal(service.spec.ports[0].targetPort, 8082)
})

test("derives an isolated managed access scope from each MCP key", () => {
  assert.equal(
    managedMcpAccessScope("k8s-docs-server", "docs-mcp"),
    "mcp-hub.mcps.k8s-docs-server:role.docs-mcp-accessor",
  )
  assert.equal(
    managedMcpAccessScope("k8s-docs-server", "confluence"),
    "mcp-hub.mcps.k8s-docs-server:role.confluence-accessor",
  )
  assert.throws(
    () => managedMcpAccessScope("k8s-docs-server", "Invalid MCP"),
    /Managed MCP key is invalid/,
  )
})

test("redacts secret environment values from the YAML preview", () => {
  const manifest = buildMcpKubernetesManifest(input)
  assert.match(manifest, /kind: Deployment/)
  assert.match(manifest, /kind: Service/)
  assert.match(manifest, /<redacted in preview>/)
  assert.doesNotMatch(manifest, /must-not-appear/)
  assert.doesNotMatch(manifest, /another-secret/)
  assert.match(manifest, /https:\/\/example\.test/)
  assert.doesNotMatch(manifest, /[&*]a\d/)
})

test("includes secret values only when building resources for creation", () => {
  const resources = buildMcpKubernetesResources(input, {
    generatedServicePrivateKey: "test-generated-private-key",
    includeSecretValues: true,
  })
  const secret = resources.find((resource) => (
    resource.kind === "Secret"
    && (resource.metadata as { name?: string }).name === "docs-mcp-env"
  )) as { stringData: Record<string, string> }
  assert.equal(secret.stringData.API_TOKEN, "must-not-appear")
  assert.equal(secret.stringData.OTHER_SECRET, "another-secret")
  const bootstrap = resources.find((resource) => (
    resource.kind === "Secret"
    && (resource.metadata as { name?: string }).name === "docs-mcp-athenz-bootstrap"
  )) as { stringData: Record<string, string> }
  assert.equal(bootstrap.stringData["service.key.pem"], "test-generated-private-key")
})

test("routes server-managed access directly to the MCP container", () => {
  const resources = buildMcpKubernetesResources({ ...input, accessManagement: "server" })
  const deployment = resources.find(({ kind }) => kind === "Deployment") as {
    spec: { template: { spec: { containers: unknown[]; volumes?: unknown[] } } }
  }
  const service = resources.find(({ kind }) => kind === "Service") as {
    spec: { ports: Array<{ targetPort: number }> }
  }
  assert.equal(deployment.spec.template.spec.containers.length, 1)
  assert.equal(deployment.spec.template.spec.volumes, undefined)
  assert.equal(service.spec.ports[0].targetPort, 8080)
})

test("omits the icon annotation when name initials are selected", () => {
  const resources = buildMcpKubernetesResources({ ...input, iconId: "" })
  const deployment = resources.find(({ kind }) => kind === "Deployment") as {
    metadata: { annotations: Record<string, string> }
  }
  assert.equal(deployment.metadata.annotations["mcp.idthw.dev/icon"], undefined)
})

test("uses a configured runtime proxy image for actual local deployment", () => {
  const resources = buildMcpKubernetesResources(input, {
    runtimeProxyImage: "mcp-runtime-proxy:dev",
    runtimeProxyImagePullPolicy: "IfNotPresent",
  })
  const deployment = resources.find(({ kind }) => kind === "Deployment") as {
    spec: { template: { spec: { containers: Array<{ image: string; imagePullPolicy?: string }> } } }
  }
  assert.equal(deployment.spec.template.spec.containers[1].image, "mcp-runtime-proxy:dev")
  assert.equal(deployment.spec.template.spec.containers[1].imagePullPolicy, "IfNotPresent")
})

test("records the Kubernetes template used to create a server", () => {
  const resources = buildMcpKubernetesResources({
    ...input,
    creationMethod: "template",
    description: "Confluence tools",
    templateKey: "confluence-mcp",
    visibility: "project",
  })
  const deployment = resources.find(({ kind }) => kind === "Deployment") as {
    metadata: { annotations: Record<string, string> }
  }
  assert.equal(deployment.metadata.annotations["mcp.idthw.dev/creation-method"], "template")
  assert.equal(deployment.metadata.annotations["mcp.idthw.dev/template-key"], "confluence-mcp")
  assert.equal(deployment.metadata.annotations["mcp.idthw.dev/visibility"], "project")
  assert.equal(deployment.metadata.annotations["mcp.idthw.dev/description"], "Confluence tools")
})

test("stores initial tool permissions on the MCP Deployment", () => {
  const toolPermissions = {
    version: 1 as const,
    tools: {
      get_k8s_docs: {
        requirements: [{
          includeExchangeHelpers: true,
          label: "Signed-in user can read documentation",
          member: "<signed_in_user>",
          role: "api:role.docs-getter",
        }],
      },
    },
  }
  const resources = buildMcpKubernetesResources({ ...input, toolPermissions })
  const deployment = resources.find(({ kind }) => kind === "Deployment") as {
    metadata: { annotations: Record<string, string> }
  }
  assert.deepEqual(
    JSON.parse(deployment.metadata.annotations["mcp.idthw.dev/tool-permissions"]),
    toolPermissions,
  )
})
