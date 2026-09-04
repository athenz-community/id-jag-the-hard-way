import assert from "node:assert/strict"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { test } from "node:test"
import { listLiveMcpTools } from "../features/catalog/lib/mcpTools.ts"
import type { McpServer } from "../features/catalog/types/catalog.ts"

test("live tool discovery does not send an authorization header", async () => {
  let authorization = "not-observed"
  const upstream = createServer(async (request, response) => {
    authorization = request.headers.authorization ?? ""
    for await (const chunk of request) void chunk
    response.setHeader("content-type", "application/json")
    response.end(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
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

    assert.equal(authorization, "")
    assert.deepEqual(result.tools, [{ name: "get_k8s_docs" }])
    assert.equal(result.error, undefined)
  } finally {
    await new Promise<void>((resolve, reject) => {
      upstream.close((error) => error ? reject(error) : resolve())
    })
  }
})
