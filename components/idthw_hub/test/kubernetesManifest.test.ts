import assert from "node:assert/strict"
import test from "node:test"
import { buildMcpKubernetesManifest, buildMcpKubernetesResources } from "../features/registration/lib/kubernetesManifest.ts"

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
  assert.deepEqual(resources.map((resource) => resource.kind), ["Namespace", "Secret", "Deployment", "Service"])

  const deployment = resources[2] as {
    metadata: { annotations: Record<string, string> }
    spec: { template: { spec: {
      containers: Array<{
        args?: string[]
        env: Array<{ name: string; value: string }>
        image: string
        name: string
      }>
      volumes: Array<{ configMap: { name: string }; name: string }>
    } } }
  }
  assert.equal(deployment.metadata.annotations["mcp.idthw.dev/id"], "docs-mcp")
  assert.equal(deployment.metadata.annotations["mcp.idthw.dev/creation-method"], "direct")
  assert.equal(deployment.metadata.annotations["mcp.idthw.dev/visibility"], "personal")
  assert.equal(
    deployment.metadata.annotations["mcp.idthw.dev/access-scope"],
    "mcp-hub.mcps.k8s-docs-server:role.accessor",
  )
  assert.equal(
    deployment.metadata.annotations["mcp.idthw.dev/iam-service-account"],
    "mcp-hub.mcps.k8s-docs-server.runtime",
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
  assert.equal(
    deployment.spec.template.spec.containers[1].image,
    "ghcr.io/mlajkim/mcp-runtime-proxy:latest",
  )
  assert.deepEqual(deployment.spec.template.spec.containers[1].env, [
    { name: "PORT", value: "8082" },
    { name: "MCP_TARGET_URL", value: "http://127.0.0.1:8080" },
    {
      name: "ATHENZ_JWKS_URL",
      value: "https://athenz-zts-server.athenz:4443/zts/v1/oauth2/keys?rfc=true",
    },
    { name: "ATHENZ_JWKS_CA_PATH", value: "/var/run/athenz/ca.crt" },
    { name: "ATHENZ_EXPECTED_AUDIENCE", value: "mcp-hub.mcps.k8s-docs-server" },
    {
      name: "ATHENZ_REQUIRED_SCOPE",
      value: "mcp-hub.mcps.k8s-docs-server:role.accessor",
    },
  ])
  assert.equal(deployment.spec.template.spec.volumes[0].name, "athenz-ca")
  assert.equal(
    deployment.spec.template.spec.volumes[0].configMap.name,
    "mcp-runtime-proxy-athenz-ca",
  )

  const service = resources[3] as { spec: { ports: Array<{ targetPort: number }> } }
  assert.equal(service.spec.ports[0].targetPort, 8082)
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
  const resources = buildMcpKubernetesResources(input, { includeSecretValues: true })
  const secret = resources[1] as { stringData: Record<string, string> }
  assert.equal(secret.stringData.API_TOKEN, "must-not-appear")
  assert.equal(secret.stringData.OTHER_SECRET, "another-secret")
})

test("routes server-managed access directly to the MCP container", () => {
  const resources = buildMcpKubernetesResources({ ...input, accessManagement: "server" })
  const deployment = resources[2] as {
    spec: { template: { spec: { containers: unknown[]; volumes?: unknown[] } } }
  }
  const service = resources[3] as { spec: { ports: Array<{ targetPort: number }> } }
  assert.equal(deployment.spec.template.spec.containers.length, 1)
  assert.equal(deployment.spec.template.spec.volumes, undefined)
  assert.equal(service.spec.ports[0].targetPort, 8080)
})

test("uses a configured runtime proxy image for actual local deployment", () => {
  const resources = buildMcpKubernetesResources(input, {
    runtimeProxyImage: "mcp-runtime-proxy:dev",
    runtimeProxyImagePullPolicy: "IfNotPresent",
  })
  const deployment = resources[2] as {
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
  const deployment = resources[2] as { metadata: { annotations: Record<string, string> } }
  assert.equal(deployment.metadata.annotations["mcp.idthw.dev/creation-method"], "template")
  assert.equal(deployment.metadata.annotations["mcp.idthw.dev/template-key"], "confluence-mcp")
  assert.equal(deployment.metadata.annotations["mcp.idthw.dev/visibility"], "project")
  assert.equal(deployment.metadata.annotations["mcp.idthw.dev/description"], "Confluence tools")
})
