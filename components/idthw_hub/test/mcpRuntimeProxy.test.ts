import assert from "node:assert/strict"
import test from "node:test"
import {
  ensureMcpRuntimeProxyTrust,
  runtimeProxyResourceOptions,
} from "../features/registration/api/mcpRuntimeProxy.ts"
import type { KubectlRunner } from "../features/kubernetes/api/kubectl.ts"

test("idempotently applies the Athenz CA trust bundle for the runtime proxy", async () => {
  const calls: Array<{ args: string[]; stdin?: string }> = []
  const runner: KubectlRunner = async (args, stdin) => {
    calls.push({ args, stdin })
    return {
      stdout: args.includes("configmap")
        ? "apiVersion: v1\nkind: ConfigMap\ndata:\n  ca.crt: test-ca\n"
        : "",
      stderr: "",
    }
  }

  await ensureMcpRuntimeProxyTrust("k8s-docs-server", runner)

  assert.equal(calls.length, 2)
  assert.equal(calls[0].args.includes("mcp-runtime-proxy-athenz-ca"), true)
  assert.equal(calls[0].args.some((value) => value.startsWith("--from-file=ca.crt=")), true)
  assert.deepEqual(calls[1].args.slice(-3), ["apply", "-f", "-"])
  assert.match(calls[1].stdin ?? "", /kind: ConfigMap/)
})

test("uses the configured local runtime proxy image and pull policy", () => {
  const previousImage = process.env.MCP_HUB_RUNTIME_PROXY_IMAGE
  const previousPullPolicy = process.env.MCP_HUB_RUNTIME_PROXY_IMAGE_PULL_POLICY
  process.env.MCP_HUB_RUNTIME_PROXY_IMAGE = "mcp-runtime-proxy:dev"
  process.env.MCP_HUB_RUNTIME_PROXY_IMAGE_PULL_POLICY = "IfNotPresent"

  try {
    assert.deepEqual(runtimeProxyResourceOptions(), {
      runtimeProxyImage: "mcp-runtime-proxy:dev",
      runtimeProxyImagePullPolicy: "IfNotPresent",
    })
  } finally {
    restoreEnvironment("MCP_HUB_RUNTIME_PROXY_IMAGE", previousImage)
    restoreEnvironment("MCP_HUB_RUNTIME_PROXY_IMAGE_PULL_POLICY", previousPullPolicy)
  }
})

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
