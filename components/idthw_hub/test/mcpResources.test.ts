import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import {
  buildMcpResourceUpdate,
  configurationFromDeployment,
  deleteMcpResources,
  updateMcpToolPermissions,
} from "../features/registration/api/mcpResources.ts"
import type { KubectlRunner } from "../features/kubernetes/api/kubectl.ts"
import type { ZmsRequest } from "../features/registration/api/mcpManagedAccess.ts"

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
      "mcp.idthw.dev/icon": "/icons/confluence.png",
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
  assert.equal(configuration.iconId, "confluence.png")
  assert.deepEqual(configuration.environmentVariables[0], {
    key: "API_TOKEN",
    value: "",
    secret: true,
    preserveExistingSecret: true,
  })
})

test("loads stored tool permissions for the server editor", () => {
  const toolPermissions = {
    version: 1,
    tools: {
      get_k8s_docs: {
        requirements: [{
          label: "Signed-in user can read documentation",
          member: "<signed_in_user>",
          role: "api:role.docs-getter",
        }],
      },
    },
  }
  const configuredDeployment = {
    ...deployment,
    metadata: {
      ...deployment.metadata,
      annotations: {
        ...deployment.metadata.annotations,
        "mcp.idthw.dev/tool-permissions": JSON.stringify(toolPermissions),
      },
    },
  }
  const configuration = configurationFromDeployment(
    configuredDeployment,
    "k8s-docs-server",
    "docs-mcp",
  )
  assert.deepEqual(configuration.toolPermissions, toolPermissions)
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
    spec: { template: { spec: {
      containers: Array<{ name: string; image: string; env?: unknown[] }>
      volumes?: Array<{ name: string }>
    } } }
  }).spec.template.spec.containers
  const mainContainer = containers.find(({ name }) => name === "docs-mcp")
  assert.equal(mainContainer?.image, "ghcr.io/example/docs-mcp:2")
  assert.deepEqual(mainContainer?.env?.[0], {
    name: "API_TOKEN",
    valueFrom: { secretKeyRef: { name: "docs-mcp-env", key: "API_TOKEN" } },
  })
  assert.deepEqual(update.newSecretValues, {})
  const patch = update.deploymentPatch as {
    metadata: { annotations: Record<string, string> }
    spec: { template: { spec: { volumes?: Array<{ name: string }> } } }
  }
  assert.equal(
    patch.metadata.annotations["mcp.idthw.dev/access-scope"],
    "mcp-hub.mcps.k8s-docs-server:role.accessor",
  )
  assert.equal(patch.metadata.annotations["mcp.idthw.dev/icon"], "confluence.png")
  assert.equal(patch.spec.template.spec.volumes?.[0].name, "athenz-ca")
})

test("adds request-scoped token delivery to an existing managed-identity deployment", () => {
  const managedDeployment = {
    ...deployment,
    metadata: {
      ...deployment.metadata,
      annotations: {
        ...deployment.metadata.annotations,
        "mcp.idthw.dev/managed-identity-secret": "docs-mcp-athenz-identity",
      },
    },
  }
  const existing = configurationFromDeployment(managedDeployment, "k8s-docs-server", "docs-mcp")
  const update = buildMcpResourceUpdate(existing, managedDeployment)
  const podSpec = (update.deploymentPatch as {
    spec: { template: { spec: {
      containers: Array<{
        env?: Array<{ name: string; value?: string }>
        name: string
        volumeMounts?: Array<{ mountPath: string; name: string; readOnly?: boolean }>
      }>
      securityContext?: { fsGroup: number }
      volumes?: Array<{ name: string }>
    } } }
  }).spec.template.spec
  const main = podSpec.containers.find(({ name }) => name === "docs-mcp")
  const proxy = podSpec.containers.find(({ name }) => name === "mcp-runtime-proxy")

  assert.deepEqual(main?.volumeMounts?.find(({ name }) => name === "downstream-access-tokens"), {
    name: "downstream-access-tokens",
    mountPath: "/var/run/idthw-access-tokens",
    readOnly: true,
  })
  assert.deepEqual(proxy?.volumeMounts?.find(({ name }) => name === "downstream-access-tokens"), {
    name: "downstream-access-tokens",
    mountPath: "/var/run/idthw-access-tokens",
  })
  assert.deepEqual(proxy?.env?.find(({ name }) => name === "ATHENZ_TOKEN_FILE_EXCHANGE_ENABLED"), {
    name: "ATHENZ_TOKEN_FILE_EXCHANGE_ENABLED",
    value: "true",
  })
  assert.deepEqual(proxy?.env?.find(({ name }) => name === "ATHENZ_SERVICE_KEY_ID"), {
    name: "ATHENZ_SERVICE_KEY_ID",
    value: "idthw-hub-generated",
  })
  assert.equal(podSpec.securityContext?.fsGroup, 1000)
  assert.equal(podSpec.volumes?.some(({ name }) => name === "downstream-access-tokens"), true)
})

test("removes the icon annotation when switching back to name initials", () => {
  const existing = configurationFromDeployment(deployment, "k8s-docs-server", "docs-mcp")
  const update = buildMcpResourceUpdate({ ...existing, iconId: "" }, deployment)
  assert.equal(
    (update.deploymentPatch as { metadata: { annotations: Record<string, string | null> } })
      .metadata.annotations["mcp.idthw.dev/icon"],
    null,
  )
})

test("removes managed proxy trust and scope when switching to server-managed access", () => {
  const existing = configurationFromDeployment(deployment, "k8s-docs-server", "docs-mcp")
  const update = buildMcpResourceUpdate({
    ...existing,
    accessManagement: "server",
    serviceAccount: "",
  }, deployment)
  const patch = update.deploymentPatch as {
    metadata: { annotations: Record<string, string | null> }
    spec: { template: { spec: { containers: Array<{ name: string }>; securityContext: null; volumes: null } } }
  }

  assert.equal(patch.metadata.annotations["mcp.idthw.dev/access-scope"], null)
  assert.deepEqual(patch.spec.template.spec.containers.map(({ name }) => name), ["docs-mcp"])
  assert.equal(patch.spec.template.spec.securityContext, null)
  assert.equal(patch.spec.template.spec.volumes, null)
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

test("stores per-tool permission overrides on the MCP deployment without restarting it", async () => {
  const calls: string[][] = []
  const patches: Array<Record<string, unknown>> = []
  const runner: KubectlRunner = async (args) => {
    calls.push(args)
    if (args.includes("get")) return { stdout: JSON.stringify(deployment), stderr: "" }
    const patchPath = args[args.indexOf("--patch-file") + 1]
    patches.push(JSON.parse(await readFile(patchPath, "utf8")) as Record<string, unknown>)
    return { stdout: "", stderr: "" }
  }
  let sourcePolicy: unknown
  const requestZms: ZmsRequest = async (method, requestPath, body) => {
    if (requestPath.endsWith("/role/accessor-source-exchanger")) {
      return {
        status: 200,
        body: JSON.stringify({
          roleMembers: [{ memberName: "mcp-hub.mcps.k8s-docs-server.runtime" }],
        }),
      }
    }
    if (requestPath.endsWith("/policy/accessor-source-exchanger_zts_token_source_exchange")) {
      if (method === "PUT") sourcePolicy = body
      return sourcePolicy === undefined
        ? { status: 404, body: "{}" }
        : { status: 200, body: JSON.stringify(sourcePolicy) }
    }
    return { status: 200, body: "{}" }
  }

  const settings = await updateMcpToolPermissions(
    "k8s-docs-server",
    "docs-mcp",
    "get_k8s_docs",
    [{
      includeExchangeHelpers: true,
      label: "Signed-in user can read documentation",
      member: "<signed_in_user>",
      role: "api:role.docs-getter",
    }],
    runner,
    requestZms,
  )

  assert.equal(settings.tools.get_k8s_docs.requirements.length, 1)
  assert.equal(settings.tools.get_k8s_docs.requirements[0].includeExchangeHelpers, true)
  assert.equal(calls.filter((args) => args.includes("patch")).length, 2)
  const metadata = patches[1].metadata as { annotations: Record<string, string> }
  const stored = JSON.parse(metadata.annotations["mcp.idthw.dev/tool-permissions"]) as {
    tools: Record<string, { requirements: Array<{ includeExchangeHelpers?: boolean }> }>
  }
  assert.equal(stored.tools.get_k8s_docs.requirements.length, 1)
  assert.equal(stored.tools.get_k8s_docs.requirements[0].includeExchangeHelpers, true)
  assert.deepEqual(
    (sourcePolicy as { assertions: Array<{ resource: string }> }).assertions.map(({ resource }) => resource),
    ["mcp-hub.mcps.k8s-docs-server:api"],
  )
  assert.equal("spec" in patches[1], false)
})

test("stores an empty tool override when all custom permissions are removed", async () => {
  const patches: Array<Record<string, unknown>> = []
  const runner: KubectlRunner = async (args) => {
    if (args.includes("get")) return { stdout: JSON.stringify(deployment), stderr: "" }
    const patchPath = args[args.indexOf("--patch-file") + 1]
    patches.push(JSON.parse(await readFile(patchPath, "utf8")) as Record<string, unknown>)
    return { stdout: "", stderr: "" }
  }

  const settings = await updateMcpToolPermissions(
    "k8s-docs-server",
    "docs-mcp",
    "get_k8s_docs",
    [],
    runner,
  )

  assert.deepEqual(settings.tools.get_k8s_docs.requirements, [])
  const metadata = patches[1].metadata as { annotations: Record<string, string> }
  const stored = JSON.parse(metadata.annotations["mcp.idthw.dev/tool-permissions"]) as {
    tools: Record<string, { requirements: unknown[] }>
  }
  assert.deepEqual(stored.tools.get_k8s_docs.requirements, [])
})

test("cleanly deletes a server and its dedicated runtime identity resources", async () => {
  const calls: string[][] = []
  const runner: KubectlRunner = async (args) => {
    calls.push(args)
    return args.includes("get")
      ? {
          stdout: JSON.stringify({
            ...deployment,
            metadata: {
              ...deployment.metadata,
              annotations: {
                ...deployment.metadata.annotations,
                "mcp.idthw.dev/managed-identity-secret": "docs-mcp-athenz-identity",
              },
            },
          }),
          stderr: "",
        }
      : { stdout: "", stderr: "" }
  }

  await deleteMcpResources("k8s-docs-server", "docs-mcp", runner)

  const deleteCalls = calls.filter((args) => args.includes("delete"))
  assert.equal(deleteCalls.length, 2)
  assert.equal(deleteCalls[0].includes("--dry-run=server"), true)
  assert.equal(deleteCalls[1].includes("--dry-run=server"), false)
  assert.equal(deleteCalls[1].includes("deployment/docs-mcp"), true)
  assert.equal(deleteCalls[1].includes("service/docs-mcp"), true)
  assert.equal(deleteCalls[1].includes("secret/docs-mcp-env"), true)
  assert.equal(deleteCalls[1].includes("secret/docs-mcp-athenz-bootstrap"), true)
  assert.equal(deleteCalls[1].includes("secret/docs-mcp-athenz-identity"), true)
  assert.equal(deleteCalls[1].includes("serviceaccount/docs-mcp-runtime-proxy"), true)
  assert.equal(deleteCalls[1].includes("role/docs-mcp-runtime-proxy-identity"), true)
  assert.equal(deleteCalls[1].includes("rolebinding/docs-mcp-runtime-proxy-identity"), true)
})
