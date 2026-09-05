import assert from "node:assert/strict"
import test from "node:test"
import { buildMcpKubernetesManifest, buildMcpKubernetesResources } from "../features/registration/lib/kubernetesManifest.ts"

const input = {
  accessManagement: "hub" as const,
  argument: "--port=8080",
  command: "/app/server",
  environmentKey: "API_TOKEN",
  environmentSecret: true,
  environmentValue: "must-not-appear",
  image: "ghcr.io/example/mcp:latest",
  mcpKeyName: "docs-mcp",
  path: "/mcp",
  port: "8080",
  project: "k8s-docs-server",
  serverName: "Docs MCP",
  serviceAccount: "mcp-hub.mcps.k8s-docs-server.runtime",
}

test("builds namespace, secret, deployment, and service resources", () => {
  const resources = buildMcpKubernetesResources(input)
  assert.deepEqual(resources.map((resource) => resource.kind), ["Namespace", "Secret", "Deployment", "Service"])

  const deployment = resources[2] as {
    metadata: { annotations: Record<string, string> }
    spec: { template: { spec: { containers: Array<{ env: unknown[]; image: string; name: string }> } } }
  }
  assert.equal(deployment.metadata.annotations["mcp.idthw.dev/id"], "docs-mcp")
  assert.equal(
    deployment.metadata.annotations["mcp.idthw.dev/iam-service-account"],
    "mcp-hub.mcps.k8s-docs-server.runtime",
  )
  assert.equal(deployment.spec.template.spec.containers[0].env.length, 1)
  assert.equal(deployment.spec.template.spec.containers[1].name, "mcp-runtime-proxy")
  assert.equal(
    deployment.spec.template.spec.containers[1].image,
    "ghcr.io/mlajkim/mcp-runtime-proxy:latest",
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
  assert.doesNotMatch(manifest, /[&*]a\d/)
})

test("routes server-managed access directly to the MCP container", () => {
  const resources = buildMcpKubernetesResources({ ...input, accessManagement: "server" })
  const deployment = resources[2] as { spec: { template: { spec: { containers: unknown[] } } } }
  const service = resources[3] as { spec: { ports: Array<{ targetPort: number }> } }
  assert.equal(deployment.spec.template.spec.containers.length, 1)
  assert.equal(service.spec.ports[0].targetPort, 8080)
})
