import assert from "node:assert/strict"
import test from "node:test"
import {
  buildMcpResourceUpdate,
  configurationFromDeployment,
} from "../features/registration/api/mcpResources.ts"

const deployment = {
  metadata: {
    name: "docs-mcp",
    namespace: "k8s-docs-server",
    labels: {
      "app.kubernetes.io/part-of": "mcp-hub",
      "mcp.idthw.dev/project": "k8s-docs-server",
    },
    annotations: {
      "mcp.idthw.dev/id": "docs-mcp",
      "mcp.idthw.dev/alias": "Docs MCP",
      "mcp.idthw.dev/path": "/mcp",
      "mcp.idthw.dev/access-management": "hub",
      "mcp.idthw.dev/creation-method": "template",
      "mcp.idthw.dev/visibility": "project",
      "mcp.idthw.dev/template-key": "docs-template",
      "mcp.idthw.dev/description": "Documentation tools",
      "mcp.idthw.dev/iam-service-account": "mcp-hub.mcps.k8s-docs-server.runtime",
    },
  },
  spec: {
    template: {
      spec: {
        containers: [
          {
            name: "docs-mcp",
            image: "ghcr.io/example/docs-mcp:1",
            command: ["/app/server"],
            args: ["--port", "9000"],
            ports: [{ containerPort: 9000 }],
            env: [
              {
                name: "API_TOKEN",
                valueFrom: { secretKeyRef: { name: "docs-mcp-env", key: "API_TOKEN" } },
              },
              { name: "UPSTREAM_URL", value: "https://example.test" },
            ],
          },
          { name: "mcp-runtime-proxy", image: "ghcr.io/mlajkim/mcp-runtime-proxy:latest" },
        ],
      },
    },
  },
}

test("loads editable deployment fields without loading secret values", () => {
  const configuration = configurationFromDeployment(deployment, "k8s-docs-server", "docs-mcp")
  assert.equal(configuration.image, "ghcr.io/example/docs-mcp:1")
  assert.equal(configuration.port, "9000")
  assert.equal(configuration.creationMethod, "template")
  assert.equal(configuration.templateKey, "docs-template")
  assert.deepEqual(configuration.environmentVariables[0], {
    key: "API_TOKEN",
    value: "",
    secret: true,
    preserveExistingSecret: true,
  })
})

test("builds deployment and service patches while preserving existing secret references", () => {
  const existing = configurationFromDeployment(deployment, "k8s-docs-server", "docs-mcp")
  const update = buildMcpResourceUpdate({
    ...existing,
    image: "ghcr.io/example/docs-mcp:2",
    environmentVariables: [
      { key: "API_TOKEN", value: "", secret: true, preserveExistingSecret: true },
      { key: "UPSTREAM_URL", value: "https://updated.example.test", secret: false },
    ],
  }, deployment)
  const containers = (update.deploymentPatch as {
    spec: { template: { spec: { containers: Array<{ name: string; image: string; env?: unknown[] }> } } }
  }).spec.template.spec.containers
  const mainContainer = containers.find(({ name }) => name === "docs-mcp")
  assert.equal(mainContainer?.image, "ghcr.io/example/docs-mcp:2")
  assert.deepEqual(mainContainer?.env?.[0], {
    name: "API_TOKEN",
    valueFrom: { secretKeyRef: { name: "docs-mcp-env", key: "API_TOKEN" } },
  })
  assert.deepEqual(update.newSecretValues, {})
})

test("includes only newly supplied secret values in the Secret patch", () => {
  const existing = configurationFromDeployment(deployment, "k8s-docs-server", "docs-mcp")
  const update = buildMcpResourceUpdate({
    ...existing,
    environmentVariables: [
      { key: "API_TOKEN", value: "replacement-test-value", secret: true },
    ],
  }, deployment)
  assert.deepEqual(update.newSecretValues, { API_TOKEN: "replacement-test-value" })
})
