import assert from "node:assert/strict"
import http, { type Server } from "node:http"
import test from "node:test"
import { AccessTokenError, JwksUnavailableError } from "../src/auth.ts"
import { createRuntimeProxyServer } from "../src/proxy.ts"
import { MCP_ACCESS_TOKEN_FILE_META_KEY } from "../src/tokenExchange.ts"

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

test("serves the liveness check without contacting the MCP target", async (t) => {
  const proxy = createRuntimeProxyServer(new URL("http://127.0.0.1:1"), allowAccess)
  const proxyPort = await listen(proxy)
  t.after(() => close(proxy))

  const response = await fetch(`http://127.0.0.1:${proxyPort}/healthz`)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true, status: "alive" })
})

test("reports not ready when the MCP target cannot be reached", async (t) => {
  const proxy = createRuntimeProxyServer(
    new URL("http://127.0.0.1:1"),
    allowAccess,
    undefined,
    undefined,
    { timeoutMs: 100 },
  )
  const proxyPort = await listen(proxy)
  t.after(() => close(proxy))

  const response = await fetch(`http://127.0.0.1:${proxyPort}/readyz`)
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { ok: false, status: "not_ready" })
})

test("uses the MCP lifecycle, ping, and tools/list for readiness", async (t) => {
  const requests: Array<{ method: string; path: string; sessionId: string }> = []
  const upstream = http.createServer(async (request, response) => {
    if (request.method === "DELETE") {
      requests.push({
        method: "DELETE",
        path: request.url ?? "",
        sessionId: String(request.headers["mcp-session-id"] ?? ""),
      })
      response.writeHead(204).end()
      return
    }

    let body = ""
    for await (const chunk of request) body += chunk
    const payload = JSON.parse(body) as { id?: number; method: string }
    requests.push({
      method: payload.method,
      path: request.url ?? "",
      sessionId: String(request.headers["mcp-session-id"] ?? ""),
    })
    if (payload.method === "notifications/initialized") {
      response.writeHead(202).end()
      return
    }

    response.setHeader("content-type", "application/json")
    if (payload.method === "initialize") {
      response.setHeader("mcp-session-id", "readiness-session")
      response.end(JSON.stringify({
        jsonrpc: "2.0",
        id: payload.id,
        result: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          serverInfo: { name: "test", version: "1" },
        },
      }))
      return
    }
    response.end(JSON.stringify({
      jsonrpc: "2.0",
      id: payload.id,
      result: payload.method === "tools/list" ? { tools: [{ name: "get_docs" }] } : {},
    }))
  })
  const upstreamPort = await listen(upstream)
  t.after(() => close(upstream))

  const proxy = createRuntimeProxyServer(
    new URL(`http://127.0.0.1:${upstreamPort}`),
    allowAccess,
    undefined,
    undefined,
    { path: "/custom-mcp", timeoutMs: 1000 },
  )
  const proxyPort = await listen(proxy)
  t.after(() => close(proxy))

  const response = await fetch(`http://127.0.0.1:${proxyPort}/readyz`)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true, status: "ready", toolCount: 1 })
  assert.deepEqual(requests.map(({ method }) => method), [
    "initialize",
    "notifications/initialized",
    "ping",
    "tools/list",
    "DELETE",
  ])
  assert.deepEqual(requests.map(({ path }) => path), Array(5).fill("/custom-mcp"))
  assert.deepEqual(requests.map(({ sessionId }) => sessionId), [
    "",
    "readiness-session",
    "readiness-session",
    "readiness-session",
    "readiness-session",
  ])
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

test("publishes a request-scoped downstream token path in tool-call metadata", async (t) => {
  let upstreamBody: Record<string, unknown> | undefined
  let upstreamInternalHeader: string | undefined
  let upstreamContentLength = ""
  const upstream = http.createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    upstreamBody = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>
    upstreamInternalHeader = request.headers["x-idthw-mcp-downstream-scope"] as string | undefined
    upstreamContentLength = request.headers["content-length"] ?? ""
    response.end("ok")
  })
  const upstreamPort = await listen(upstream)
  t.after(() => close(upstream))

  const published: Array<Record<string, string>> = []
  let removed = false
  const proxy = createRuntimeProxyServer(
    new URL(`http://127.0.0.1:${upstreamPort}`),
    {
      verify: async () => ({
        audiences: ["api", "mcp-hub.mcps.k8s-docs-server"],
        expiresAt: "2026-09-06T06:48:47.000Z",
        expiresInSeconds: 3600,
        keyId: "zts-key-1",
        scopes: ["api:role.docs-getter", "mcp-hub.mcps.k8s-docs-server:role.accessor"],
      }),
    },
    undefined,
    {
      publish: async (input) => {
        published.push(input)
        return {
          filePath: `/var/run/idthw-access-tokens/${input.toolName}/${input.requestId}.jwt`,
          remove: async () => { removed = true },
        }
      },
    },
  )
  const proxyPort = await listen(proxy)
  t.after(() => close(proxy))

  const response = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
    method: "POST",
    headers: {
      authorization: "Bearer signed-athenz-token",
      "content-type": "application/json",
      "x-idthw-mcp-downstream-scope": "api:role.docs-getter",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "get_k8s_docs", arguments: {}, _meta: { trace: "test" } },
    }),
  })

  assert.equal(response.status, 200)
  assert.equal(await response.text(), "ok")
  assert.equal(published.length, 1)
  assert.equal(published[0].scope, "api:role.docs-getter")
  assert.equal(published[0].sourceToken, "signed-athenz-token")
  assert.equal(published[0].toolName, "get_k8s_docs")
  assert.equal(upstreamInternalHeader, undefined)
  assert.equal(removed, true)
  const params = upstreamBody?.params as { _meta?: Record<string, unknown> }
  assert.equal(params._meta?.trace, "test")
  assert.equal(params._meta?.[MCP_ACCESS_TOKEN_FILE_META_KEY], published[0].requestId
    ? `/var/run/idthw-access-tokens/get_k8s_docs/${published[0].requestId}.jwt`
    : undefined)
  assert.equal(upstreamContentLength, String(Buffer.byteLength(JSON.stringify(upstreamBody))))
})

test("uses distinct publications for concurrent calls of the same tool", async (t) => {
  const paths: string[] = []
  const removed: string[] = []
  const upstream = http.createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      params: { _meta: Record<string, string> }
    }
    paths.push(body.params._meta[MCP_ACCESS_TOKEN_FILE_META_KEY])
    setTimeout(() => response.end("ok"), 10)
  })
  const upstreamPort = await listen(upstream)
  t.after(() => close(upstream))
  const proxy = createRuntimeProxyServer(
    new URL(`http://127.0.0.1:${upstreamPort}`),
    {
      verify: async () => ({
        audiences: ["api", "mcp-hub.mcps.k8s-docs-server"],
        expiresAt: "2026-09-06T06:48:47.000Z",
        expiresInSeconds: 3600,
        keyId: "zts-key-1",
        scopes: ["api:role.docs-getter", "mcp-hub.mcps.k8s-docs-server:role.accessor"],
      }),
    },
    undefined,
    {
      publish: async ({ requestId, toolName }) => {
        const filePath = `/var/run/idthw-access-tokens/${toolName}/${requestId}.jwt`
        return { filePath, remove: async () => { removed.push(filePath) } }
      },
    },
  )
  const proxyPort = await listen(proxy)
  t.after(() => close(proxy))

  const request = () => fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
    method: "POST",
    headers: {
      authorization: "Bearer signed-athenz-token",
      "content-type": "application/json",
      "x-idthw-mcp-downstream-scope": "api:role.docs-getter",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_k8s_docs" } }),
  })
  await Promise.all([request(), request()])

  assert.equal(paths.length, 2)
  assert.notEqual(paths[0], paths[1])
  assert.deepEqual(new Set(removed), new Set(paths))
})

test("rejects an ungranted downstream scope without publishing or forwarding", async (t) => {
  let upstreamCalls = 0
  let publisherCalls = 0
  const upstream = http.createServer((_request, response) => {
    upstreamCalls += 1
    response.end("ok")
  })
  const upstreamPort = await listen(upstream)
  t.after(() => close(upstream))
  const proxy = createRuntimeProxyServer(
    new URL(`http://127.0.0.1:${upstreamPort}`),
    {
      verify: async () => ({
        audiences: ["mcp-hub.mcps.k8s-docs-server"],
        expiresAt: "2026-09-06T06:48:47.000Z",
        expiresInSeconds: 3600,
        keyId: "zts-key-1",
        scopes: ["mcp-hub.mcps.k8s-docs-server:role.accessor"],
      }),
    },
    undefined,
    {
      publish: async () => {
        publisherCalls += 1
        throw new Error("must not publish")
      },
    },
  )
  const proxyPort = await listen(proxy)
  t.after(() => close(proxy))

  const response = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
    method: "POST",
    headers: {
      authorization: "Bearer signed-athenz-token",
      "content-type": "application/json",
      "x-idthw-mcp-downstream-scope": "api:role.docs-getter",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_k8s_docs" } }),
  })

  assert.equal(response.status, 403)
  assert.deepEqual(await response.json(), {
    error: "downstream_token_exchange_denied",
    message: "The verified Athenz access token does not grant the requested downstream scope.",
  })
  assert.equal(upstreamCalls, 0)
  assert.equal(publisherCalls, 0)
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
