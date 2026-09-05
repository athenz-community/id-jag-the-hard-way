import assert from "node:assert/strict"
import http, { type Server } from "node:http"
import test from "node:test"
import { createRuntimeProxyServer } from "../src/proxy.ts"

test("passes MCP requests and responses through unchanged", async (t) => {
  const received: { body?: string; header?: string; url?: string } = {}
  const upstream = http.createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
    request.on("end", () => {
      received.body = Buffer.concat(chunks).toString("utf8")
      received.header = request.headers["mcp-session-id"] as string
      received.url = request.url
      response.statusCode = 202
      response.setHeader("content-type", "application/json")
      response.setHeader("mcp-session-id", "session-response")
      response.end(received.body)
    })
  })
  const upstreamPort = await listen(upstream)
  t.after(() => close(upstream))

  const proxy = createRuntimeProxyServer(new URL(`http://127.0.0.1:${upstreamPort}`))
  const proxyPort = await listen(proxy)
  t.after(() => close(proxy))

  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
  const response = await fetch(`http://127.0.0.1:${proxyPort}/mcp?source=test`, {
    method: "POST",
    headers: { "content-type": "application/json", "mcp-session-id": "session-request" },
    body,
  })

  assert.equal(response.status, 202)
  assert.equal(response.headers.get("mcp-session-id"), "session-response")
  assert.equal(await response.text(), body)
  assert.deepEqual(received, { body, header: "session-request", url: "/mcp?source=test" })
})

test("streams event responses without changing their content type", async (t) => {
  const upstream = http.createServer((_request, response) => {
    response.setHeader("content-type", "text/event-stream")
    response.write("event: message\ndata: first\n\n")
    setTimeout(() => response.end("event: message\ndata: second\n\n"), 10)
  })
  const upstreamPort = await listen(upstream)
  t.after(() => close(upstream))

  const proxy = createRuntimeProxyServer(new URL(`http://127.0.0.1:${upstreamPort}`))
  const proxyPort = await listen(proxy)
  t.after(() => close(proxy))

  const response = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, { headers: { accept: "text/event-stream" } })
  assert.equal(response.headers.get("content-type"), "text/event-stream")
  assert.equal(await response.text(), "event: message\ndata: first\n\nevent: message\ndata: second\n\n")
})

test("serves health checks without contacting the MCP target", async (t) => {
  const proxy = createRuntimeProxyServer(new URL("http://127.0.0.1:1"))
  const proxyPort = await listen(proxy)
  t.after(() => close(proxy))

  for (const path of ["/healthz", "/readyz"]) {
    const response = await fetch(`http://127.0.0.1:${proxyPort}${path}`)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ok: true })
  }
})

function listen(server: Server) {
  return new Promise<number>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        reject(new Error("Test server did not receive a TCP port"))
        return
      }
      resolve(address.port)
    })
  })
}

function close(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
}
