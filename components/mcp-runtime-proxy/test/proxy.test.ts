import assert from "node:assert/strict"
import http, { type Server } from "node:http"
import test from "node:test"
import { AccessTokenError, JwksUnavailableError } from "../src/auth.ts"
import { createRuntimeProxyServer } from "../src/proxy.ts"

const allowAccess = { verify: async (_authorization: string | undefined) => {} }

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

  const proxy = createRuntimeProxyServer(new URL(`http://127.0.0.1:${upstreamPort}`), allowAccess)
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

  const proxy = createRuntimeProxyServer(new URL(`http://127.0.0.1:${upstreamPort}`), allowAccess)
  const proxyPort = await listen(proxy)
  t.after(() => close(proxy))

  const response = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
    headers: { accept: "text/event-stream", authorization: "Bearer valid-test-token" },
  })
  assert.equal(response.headers.get("content-type"), "text/event-stream")
  assert.equal(await response.text(), "event: message\ndata: first\n\nevent: message\ndata: second\n\n")
})

test("serves health checks without contacting the MCP target", async (t) => {
  const proxy = createRuntimeProxyServer(new URL("http://127.0.0.1:1"), allowAccess)
  const proxyPort = await listen(proxy)
  t.after(() => close(proxy))

  for (const path of ["/healthz", "/readyz"]) {
    const response = await fetch(`http://127.0.0.1:${proxyPort}${path}`)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ok: true })
  }
})

test("allows protocol bootstrap and tool discovery without an access token", async (t) => {
  let upstreamCalls = 0
  let verifierCalls = 0
  const upstream = http.createServer((_request, response) => {
    upstreamCalls += 1
    response.end("ok")
  })
  const upstreamPort = await listen(upstream)
  t.after(() => close(upstream))
  const proxy = createRuntimeProxyServer(new URL(`http://127.0.0.1:${upstreamPort}`), {
    verify: async () => {
      verifierCalls += 1
      throw new AccessTokenError(401, "missing_access_token", "An access token is required.")
    },
  })
  const proxyPort = await listen(proxy)
  t.after(() => close(proxy))

  for (const method of ["initialize", "notifications/initialized", "ping", "tools/list"]) {
    const response = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method }),
    })
    assert.equal(response.status, 200)
  }

  assert.equal(upstreamCalls, 4)
  assert.equal(verifierCalls, 0)
})

test("requires a valid access token for protected MCP calls", async (t) => {
  let upstreamCalls = 0
  let upstreamAuthorization: string | undefined
  const upstream = http.createServer((request, response) => {
    upstreamCalls += 1
    upstreamAuthorization = request.headers.authorization
    response.end("ok")
  })
  const upstreamPort = await listen(upstream)
  t.after(() => close(upstream))
  const seenAuthorizations: Array<string | undefined> = []
  const proxy = createRuntimeProxyServer(
    new URL(`http://127.0.0.1:${upstreamPort}`),
    {
      verify: async (authorization) => {
        seenAuthorizations.push(authorization)
        if (!authorization) {
          throw new AccessTokenError(401, "missing_access_token", "An access token is required.")
        }
      },
    },
  )
  const proxyPort = await listen(proxy)
  t.after(() => close(proxy))
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "read" } })

  const denied = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  })
  assert.equal(denied.status, 401)
  assert.match(denied.headers.get("www-authenticate") ?? "", /^Bearer /)
  assert.equal(upstreamCalls, 0)

  const allowed = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
    method: "POST",
    headers: { authorization: "Bearer signed-athenz-token", "content-type": "application/json" },
    body,
  })
  assert.equal(allowed.status, 200)
  assert.equal(await allowed.text(), "ok")
  assert.deepEqual(seenAuthorizations, [undefined, "Bearer signed-athenz-token"])
  assert.equal(upstreamCalls, 1)
  assert.equal(upstreamAuthorization, "Bearer signed-athenz-token")
})

test("logs safe verified access-token metadata without logging the raw token", async (t) => {
  const logs: Array<{ event: string; fields: Record<string, unknown>; level: string }> = []
  const logger = {
    error: (event: string, fields: Record<string, unknown> = {}) => logs.push({ event, fields, level: "error" }),
    info: (event: string, fields: Record<string, unknown> = {}) => logs.push({ event, fields, level: "info" }),
    warn: (event: string, fields: Record<string, unknown> = {}) => logs.push({ event, fields, level: "warn" }),
  }
  const upstream = http.createServer((_request, response) => response.end("ok"))
  const upstreamPort = await listen(upstream)
  t.after(() => close(upstream))
  const proxy = createRuntimeProxyServer(
    new URL(`http://127.0.0.1:${upstreamPort}`),
    {
      verify: async () => ({
        audiences: ["mcp-hub.mcps.k8s-docs-server"],
        clientId: "mcp-hub.mcp-gateway",
        expiresAt: "2026-09-06T06:48:47.000Z",
        expiresInSeconds: 3600,
        keyId: "zts-key-1",
        scopes: ["mcp-hub.mcps.k8s-docs-server:role.accessor"],
        subject: "mcp-hub.mcp-gateway",
        userId: "idjag-learner",
      }),
    },
    logger,
  )
  const proxyPort = await listen(proxy)
  t.after(() => close(proxy))

  const response = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
    method: "POST",
    headers: { authorization: "Bearer signed-athenz-token", "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "read" } }),
  })
  assert.equal(await response.text(), "ok")

  assert.deepEqual(logs.map(({ event }) => event), [
    "request_received",
    "access_token_verified",
    "request_completed",
  ])
  const verified = logs.find(({ event }) => event === "access_token_verified")
  assert.equal(verified?.fields.userId, "idjag-learner")
  assert.deepEqual(verified?.fields.scopes, ["mcp-hub.mcps.k8s-docs-server:role.accessor"])
  assert.equal(JSON.stringify(logs).includes("signed-athenz-token"), false)
})

test("returns forbidden when the token lacks the required scope", async (t) => {
  const proxy = createRuntimeProxyServer(new URL("http://127.0.0.1:1"), {
    verify: async () => {
      throw new AccessTokenError(403, "insufficient_scope", "The required scope is missing.")
    },
  })
  const proxyPort = await listen(proxy)
  t.after(() => close(proxy))

  const response = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
    method: "POST",
    headers: { authorization: "Bearer signed-athenz-token", "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "read" } }),
  })
  assert.equal(response.status, 403)
  assert.match(response.headers.get("www-authenticate") ?? "", /insufficient_scope/)
})

test("fails closed when ZTS signing keys are unavailable", async (t) => {
  const proxy = createRuntimeProxyServer(new URL("http://127.0.0.1:1"), {
    verify: async () => {
      throw new JwksUnavailableError("ZTS is unavailable")
    },
  })
  const proxyPort = await listen(proxy)
  t.after(() => close(proxy))

  const response = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
    method: "POST",
    headers: { authorization: "Bearer signed-athenz-token", "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "read" } }),
  })
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: "authentication_unavailable" })
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
