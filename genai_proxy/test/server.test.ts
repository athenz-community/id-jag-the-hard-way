import assert from "node:assert/strict"
import http, { type IncomingMessage, type Server } from "node:http"
import { afterEach, test } from "node:test"
import { AccessTokenError, type TokenVerifier } from "../src/auth.ts"
import { createGenAIProxy } from "../src/server.ts"
import { UsageStore } from "../src/usage.ts"

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => close(server)))
})

test("healthz is available without an access token", async () => {
  const proxy = await listen(createGenAIProxy({ authenticate, upstreamBaseUrl: "http://127.0.0.1:1" }))
  const response = await fetch(url(proxy, "/healthz"))

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { status: "ok", upstream: "openai-compatible" })
})

test("upstream requests require an Athenz Bearer access token", async () => {
  let upstreamCalled = false
  const ollama = await listen(http.createServer((_req, res) => {
    upstreamCalled = true
    res.end()
  }))
  const proxy = await listen(createGenAIProxy({ authenticate, upstreamBaseUrl: url(ollama, "/") }))

  const response = await fetch(url(proxy, "/api/tags"))

  assert.equal(response.status, 401)
  assert.equal(response.headers.get("www-authenticate"), 'Bearer realm="genai-proxy"')
  assert.equal(upstreamCalled, false)
  assert.equal((await response.json() as { error: string }).error, "missing_access_token")
})

test("forwards requests without leaking the Athenz AT upstream", async () => {
  let received: { method?: string; url?: string; authorization?: string; body?: string; requestId?: string } = {}
  const ollama = await listen(http.createServer(async (req, res) => {
    received = {
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization,
      requestId: req.headers["x-request-id"] as string | undefined,
      body: await readBody(req),
    }
    res.statusCode = 201
    res.setHeader("content-type", "application/x-ndjson")
    res.setHeader("x-ollama-test", "forwarded")
    res.write('{"message":{"content":"hello"}}\n')
    res.end('{"done":true}\n')
  }))
  const usageStore = new UsageStore({ now: () => new Date("2026-07-20T12:00:00Z") })
  const proxy = await listen(createGenAIProxy({ authenticate, upstreamBaseUrl: url(ollama, "/"), usageStore }))

  const response = await fetch(url(proxy, "/api/chat?trace=yes"), {
    method: "POST",
    headers: {
      authorization: "Bearer secret-athenz-at",
      "content-type": "application/json",
      "x-request-id": "request-1",
    },
    body: JSON.stringify({ model: "gpt-5.6-luna", messages: [{ role: "user", content: "hi" }] }),
  })

  assert.equal(response.status, 201)
  assert.equal(response.headers.get("x-ollama-test"), "forwarded")
  assert.equal(await response.text(), '{"message":{"content":"hello"}}\n{"done":true}\n')
  assert.equal(received.method, "POST")
  assert.equal(received.url, "/api/chat?trace=yes")
  assert.equal(received.authorization, undefined)
  assert.equal(received.requestId, "request-1")
  assert.deepEqual(JSON.parse(received.body ?? ""), {
    model: "gpt-5.6-luna",
    messages: [{ role: "user", content: "hi" }],
  })

  const users = await fetch(url(proxy, "/api/users/idjag-learner"))
  assert.equal(users.status, 200)
  assert.deepEqual(await users.json(), { projects: [] })

  const missingUser = await fetch(url(proxy, "/api/users"))
  assert.equal(missingUser.status, 400)
})

test("replaces the Athenz AT with the configured upstream API key and meters Responses API usage", async () => {
  let receivedAuthorization: string | undefined
  const upstream = await listen(http.createServer(async (req, res) => {
    receivedAuthorization = req.headers.authorization
    await readBody(req)
    res.setHeader("content-type", "text/event-stream")
    res.end([
      'data: {"type":"response.output_text.delta","delta":"hello"}',
      'data: {"type":"response.completed","response":{"usage":{"input_tokens":7,"output_tokens":11,"total_tokens":18}}}',
      "data: [DONE]",
      "",
    ].join("\n\n"))
  }))
  const usageStore = new UsageStore({ now: () => new Date("2026-07-20T12:00:00Z") })
  const proxy = await listen(createGenAIProxy({
    authenticate,
    upstreamBaseUrl: url(upstream, "/v1"),
    upstreamApiKey: "upstream-secret",
    usageStore,
  }))

  const response = await fetch(url(proxy, "/v1/responses"), {
    method: "POST",
    headers: {
      authorization: "Bearer secret-athenz-at",
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: "gpt-5.6-luna", input: "hi", stream: true }),
  })
  assert.equal(response.status, 200)
  await response.arrayBuffer()
  assert.equal(receivedAuthorization, "Bearer upstream-secret")

  const users = await fetch(url(proxy, "/api/users/idjag-learner"))
  const payload = await users.json() as {
    projects: Array<{ users: Array<{ input_tokens: number; output_tokens: number; total_tokens: number }> }>
  }
  assert.equal(payload.projects[0].users[0].input_tokens, 7)
  assert.equal(payload.projects[0].users[0].output_tokens, 11)
  assert.equal(payload.projects[0].users[0].total_tokens, 18)
})

test("returns user-specific project usage, limits, spend, and model costs without an AT", async () => {
  const ollama = await listen(http.createServer((_req, res) => {
    res.setHeader("content-type", "application/x-ndjson")
    res.write('{"message":{"content":"hello"}}\n')
    res.end('{"done":true,"prompt_eval_count":3,"eval_count":5}\n')
  }))
  const usageStore = new UsageStore({ now: () => new Date("2026-07-20T12:00:00Z") })
  const proxy = await listen(createGenAIProxy({ authenticate, upstreamBaseUrl: url(ollama, "/"), usageStore }))

  const generated = await fetch(url(proxy, "/api/chat"), {
    method: "POST",
    headers: { authorization: "Bearer secret-athenz-at" },
    body: "{}",
  })
  assert.equal(generated.status, 200)
  await generated.arrayBuffer()

  const athenzUsers = await fetch(url(proxy, "/api/users/idjag-learner"))
  assert.deepEqual(await athenzUsers.json(), {
    projects: [{
      project: "athenz",
      scope: "gen-ai.services.athenz:role.gen-ai-users",
      daily_limit_usd: 240,
      daily_limit_fraction_digits: 2,
      daily_spend_usd: 0.000033,
      users: [{
        date: "2026-07-20",
        last_usage: "21:00:00",
        sub: "user.idjag-learner",
        client_id: "home.idjag-learner.local.athenzd",
        scope: "gen-ai.services.athenz:role.gen-ai-users",
        requests: 1,
        input_tokens: 3,
        output_tokens: 5,
        total_tokens: 8,
        estimated_cost_usd: 0.000033,
        tokens: [{
          model: "gpt-5.6-luna",
          requests: 1,
          input: 3,
          output: 5,
          total: 8,
          estimated_cost_usd: 0.000033,
        }],
      }],
    }],
  })

  const unknownUser = await fetch(url(proxy, "/api/users/unknown-user"))
  assert.equal(unknownUser.status, 200)
  assert.deepEqual(await unknownUser.json(), { projects: [] })
})

test("rejects generation requests with 429 after a service code exceeds its daily spending limit", async () => {
  let upstreamCalls = 0
  const ollama = await listen(http.createServer((_req, res) => {
    upstreamCalls += 1
    res.end('{"done":true,"prompt_eval_count":1,"eval_count":1}\n')
  }))
  const usageStore = new UsageStore({ now: () => new Date("2026-07-20T12:00:00Z") })
  usageStore.record({
    project: "gen-ai.services.athenz",
    subject: "user.idjag-learner",
    clientId: "home.idjag-learner.local.athenzd",
    model: "gpt-5.6-luna",
    scope: "gen-ai.services.athenz:role.gen-ai-users",
  }, { promptTokens: 0, completionTokens: 40_000_001, totalTokens: 40_000_001 })
  usageStore.record({
    project: "gen-ai.services.spire",
    subject: "user.idjag-learner",
    clientId: "home.idjag-learner.local.athenzd",
    model: "gpt-5.6-terra",
    scope: "gen-ai.services.spire:role.gen-ai-users",
  }, { promptTokens: 0, completionTokens: 134, totalTokens: 134 })
  const proxy = await listen(createGenAIProxy({ authenticate, upstreamBaseUrl: url(ollama, "/"), usageStore }))

  for (const [authorization, serviceCode, limit] of [
    ["Bearer secret-athenz-at", "athenz", 240],
    ["Bearer project-spire", "spire", 0.002],
  ] as const) {
    const response = await fetch(url(proxy, "/api/chat"), {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-5.6-luna", messages: [] }),
    })

    assert.equal(response.status, 429)
    assert.equal(response.statusText, "Too Many Requests")
    assert.ok(Number(response.headers.get("retry-after")) > 0)
    const payload = await response.json() as Record<string, unknown>
    assert.equal(payload.error, "too_many_requests")
    assert.equal(payload.code, "daily_service_code_limit_exceeded")
    assert.equal(payload.service_code, serviceCode)
    assert.equal(payload.limit_usd, limit)
  }
  assert.equal(upstreamCalls, 0)
})

test("returns a redacted 502 when the GenAI upstream is unavailable", async () => {
  const proxy = await listen(createGenAIProxy({ authenticate, upstreamBaseUrl: "http://127.0.0.1:1" }))
  const response = await fetch(url(proxy, "/v1/models"), {
    headers: { authorization: "Bearer must-not-appear" },
  })

  assert.equal(response.status, 502)
  const body = await response.text()
  assert.match(body, /genai_upstream_unavailable/)
  assert.doesNotMatch(body, /must-not-appear/)
})

async function listen(server: Server) {
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  return server
}

async function close(server: Server) {
  if (!server.listening) return
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
}

function url(server: Server, path: string) {
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("server is not listening on TCP")
  return `http://127.0.0.1:${address.port}${path}`
}

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString("utf8")
}

const authenticate: TokenVerifier = (authorization) => {
  if (!authorization?.startsWith("Bearer ")) {
    throw new AccessTokenError(401, "missing_access_token", "Missing token")
  }
  const project = authorization === "Bearer project-spire" ? "spire" : "athenz"
  return {
    audience: `gen-ai.services.${project}`,
    clientId: "home.idjag-learner.local.athenzd",
    project,
    scope: `gen-ai.services.${project}:role.gen-ai-users`,
    subject: "user.idjag-learner",
  }
}
