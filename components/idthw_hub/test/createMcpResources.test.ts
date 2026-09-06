import assert from "node:assert/strict"
import test from "node:test"
import {
  createMcpResources,
  McpResourceConflictError,
  type KubectlRunner,
} from "../features/registration/api/createMcpResources.ts"

const input = {
  accessManagement: "hub" as const,
  arguments: [],
  command: "",
  environmentVariables: [
    { key: "API_TOKEN", secret: true, value: "test-secret-value" },
    { key: "UPSTREAM_URL", secret: false, value: "https://example.test" },
  ],
  image: "ghcr.io/example/mcp:latest",
  mcpKeyName: "docs-mcp",
  path: "/mcp",
  port: "8080",
  project: "k8s-docs-server",
  serverName: "Docs MCP",
  serviceAccount: "mcp-hub.mcps.k8s-docs-server.runtime",
}

test("creates a missing namespace and the generated MCP resources", async () => {
  const calls: Array<{ args: string[]; stdin?: string }> = []
  const runner: KubectlRunner = async (args, stdin) => {
    calls.push({ args, stdin })
    return { stdout: "", stderr: "" }
  }

  await createMcpResources(input, runner)

  assert.equal(calls.some(({ args }) => args.join(" ").includes("create namespace k8s-docs-server")), true)
  const applyCalls = calls.filter(({ args }) => args.includes("-f"))
  assert.equal(applyCalls.length, 2)
  assert.match(applyCalls[0].stdin ?? "", /kind: Deployment/)
  assert.match(applyCalls[0].stdin ?? "", /kind: Service/)
  assert.match(applyCalls[0].stdin ?? "", /test-secret-value/)
  assert.doesNotMatch(applyCalls[0].stdin ?? "", /redacted in preview/)
})

test("rejects an MCP key already registered in any namespace", async () => {
  const runner: KubectlRunner = async (args) => ({
    stdout: args.includes("--all-namespaces")
      ? "docs-mcp docs-mcp other-project <none>\n"
      : "",
    stderr: "",
  })

  await assert.rejects(
    createMcpResources(input, runner),
    McpResourceConflictError,
  )
})

test("ignores Hub infrastructure deployments that are not catalog servers", async () => {
  const calls: string[][] = []
  const runner: KubectlRunner = async (args) => {
    calls.push(args)
    return {
      stdout: args.includes("--all-namespaces")
        ? "docs-mcp docs-mcp <none> <none>\n"
        : args.includes("namespace")
          ? "namespace/k8s-docs-server\n"
          : "",
      stderr: "",
    }
  }

  await createMcpResources(input, runner)
  assert.equal(calls.some((args) => args.includes("-f")), true)
})

test("does not overwrite an existing MCP Deployment or Service", async () => {
  const runner: KubectlRunner = async (args) => ({
    stdout: args.some((value) => value === "deployment/docs-mcp")
      ? "deployment.apps/docs-mcp\n"
      : args.includes("namespace")
        ? "namespace/k8s-docs-server\n"
        : "",
    stderr: "",
  })

  await assert.rejects(
    createMcpResources(input, runner),
    McpResourceConflictError,
  )
})
