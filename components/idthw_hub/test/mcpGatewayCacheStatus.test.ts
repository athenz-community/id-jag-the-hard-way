import assert from "node:assert/strict"
import test from "node:test"
import { getMcpGatewayCacheStatus } from "../features/catalog/lib/mcpGatewayCacheStatus.ts"

test("returns sanitized access-token and ID-JAG cache metadata", async (t) => {
  const previousStatusUrl = process.env.MCP_HUB_GATEWAY_STATUS_URL
  const previousRegistryToken = process.env.MCP_HUB_REGISTRY_TOKEN
  const previousFetch = globalThis.fetch
  t.after(() => {
    restoreEnvironment("MCP_HUB_GATEWAY_STATUS_URL", previousStatusUrl)
    restoreEnvironment("MCP_HUB_REGISTRY_TOKEN", previousRegistryToken)
    globalThis.fetch = previousFetch
  })

  process.env.MCP_HUB_GATEWAY_STATUS_URL = "http://mcp-gateway.test/internal/cache-status"
  process.env.MCP_HUB_REGISTRY_TOKEN = "registry-token"
  globalThis.fetch = async (_input, init) => {
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer registry-token")
    return Response.json({
      generatedAt: "2026-09-06T05:11:36.373Z",
      expirySkewSeconds: 60,
      sessions: [{
        username: "idjag-learner",
        subject: "keycloak-subject",
        expiresAt: "2026-09-06T06:48:47.000Z",
        status: "valid",
        athenzAccessTokens: {
          expirySkewSeconds: 60,
          entries: [{
            audiences: ["mcp-hub.mcps.k8s-docs-server"],
            scope: "mcp-hub.mcps.k8s-docs-server:role.accessor",
            cachedAt: "2026-09-06T05:06:51.293Z",
            expiresAt: "2026-09-06T06:48:47.000Z",
            status: "valid",
            token: "access-token-must-not-leak",
          }],
        },
        athenzIdJags: {
          expirySkewSeconds: 60,
          entries: [{
            audiences: ["https://athenz-zts-server.athenz:4443/zts/v1"],
            scope: "mcp-hub.mcps.k8s-docs-server:role.accessor",
            cachedAt: "2026-09-06T05:06:50.000Z",
            expiresAt: "2026-09-06T06:48:47.000Z",
            status: "valid",
            token: "id-jag-must-not-leak",
          }],
        },
      }],
    })
  }

  const status = await getMcpGatewayCacheStatus()

  assert.equal(status.available, true)
  if (!status.available) return
  assert.equal(status.sessions[0].athenzIdJags.entryCount, 1)
  assert.deepEqual(status.sessions[0].athenzAccessTokens.entries[0], {
    audiences: ["mcp-hub.mcps.k8s-docs-server"],
    scope: "mcp-hub.mcps.k8s-docs-server:role.accessor",
    cachedAt: "2026-09-06T05:06:51.293Z",
    expiresAt: "2026-09-06T06:48:47.000Z",
    status: "valid",
  })
  assert.deepEqual(status.sessions[0].athenzIdJags.entries[0], {
    audiences: ["https://athenz-zts-server.athenz:4443/zts/v1"],
    scope: "mcp-hub.mcps.k8s-docs-server:role.accessor",
    cachedAt: "2026-09-06T05:06:50.000Z",
    expiresAt: "2026-09-06T06:48:47.000Z",
    status: "valid",
  })
  const serialized = JSON.stringify(status)
  assert.equal(serialized.includes("access-token-must-not-leak"), false)
  assert.equal(serialized.includes("id-jag-must-not-leak"), false)
})

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
