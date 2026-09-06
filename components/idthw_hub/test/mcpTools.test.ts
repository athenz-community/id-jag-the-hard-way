import assert from "node:assert/strict"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { test } from "node:test"
import { listLiveMcpTools } from "../features/catalog/lib/mcpTools.ts"
import type { McpServer } from "../features/catalog/types/catalog.ts"

test("live tool discovery does not send an authorization header", async () => {
  const observedRequests: Array<{ authorization: string; method: string; sessionId: string }> = []
  const upstream = createServer(async (request, response) => {
    if (request.method === "DELETE") {
      observedRequests.push({
        authorization: request.headers.authorization ?? "",
        method: "DELETE",
        sessionId: String(request.headers["mcp-session-id"] ?? ""),
      })
      response.writeHead(200).end()
      return
    }

    let body = ""
    for await (const chunk of request) body += chunk
    const payload = JSON.parse(body) as { method: string; id?: number }
    observedRequests.push({
      authorization: request.headers.authorization ?? "",
      method: payload.method,
      sessionId: String(request.headers["mcp-session-id"] ?? ""),
    })

    if (payload.method === "initialize") {
      response.setHeader("mcp-session-id", "test-session")
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({
        jsonrpc: "2.0",
        id: payload.id,
        result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "test", version: "1" } },
      }))
      return
    }
    if (payload.method === "notifications/initialized") {
      response.writeHead(202).end()
      return
    }

    response.setHeader("content-type", "application/json")
    response.end(JSON.stringify({
      jsonrpc: "2.0",
      id: payload.id,
      result: { tools: [{ name: "get_k8s_docs" }] },
    }))
  }).listen(0, "127.0.0.1")

  await new Promise<void>((resolve, reject) => {
    upstream.once("listening", resolve)
    upstream.once("error", reject)
  })

  try {
    const address = upstream.address() as AddressInfo
    const server: McpServer = {
      id: "api:k8s-docs-server",
      routeId: "k8s-docs-server",
      name: "mcp",
      namespace: "api",
      description: "Kubernetes API docs",
      project: "k8s-docs-server",
      proxyUrl: `http://127.0.0.1:${address.port}/mcp/k8s-docs-server`,
      totalToolCalls: "0",
      logoText: "KD",
      logoBg: "#000",
      logoFg: "#fff",
    }

    const result = await listLiveMcpTools(server)

    assert.deepEqual(observedRequests.map(({ authorization }) => authorization), ["", "", "", ""])
    assert.deepEqual(observedRequests.map(({ method }) => method), [
      "initialize",
      "notifications/initialized",
      "tools/list",
      "DELETE",
    ])
    assert.deepEqual(observedRequests.map(({ sessionId }) => sessionId), [
      "",
      "test-session",
      "test-session",
      "test-session",
    ])
    assert.deepEqual(result.tools, [{ name: "get_k8s_docs" }])
    assert.equal(result.error, undefined)
  } finally {
    await new Promise<void>((resolve, reject) => {
      upstream.close((error) => error ? reject(error) : resolve())
    })
  }
})
