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
  const proxy = await listen(createGenAIProxy({ authenticate }))
  const response = await fetch(url(proxy, "/healthz"))

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { status: "ok", upstream: "ollama" })
})

test("Ollama requests require a Bearer access token", async () => {
  let upstreamCalled = false
  const ollama = await listen(http.createServer((_req, res) => {
    upstreamCalled = true
    res.end()
  }))
  const proxy = await listen(createGenAIProxy({ authenticate, ollamaBaseUrl: url(ollama, "/") }))

  const response = await fetch(url(proxy, "/api/tags"))

  assert.equal(response.status, 401)
  assert.equal(response.headers.get("www-authenticate"), 'Bearer realm="genai-proxy"')
  assert.equal(upstreamCalled, false)
  assert.equal((await response.json() as { error: string }).error, "missing_access_token")
})

test("forwards native Ollama requests without leaking the AT upstream", async () => {
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
  const proxy = await listen(createGenAIProxy({ authenticate, ollamaBaseUrl: url(ollama, "/"), usageStore }))

  const response = await fetch(url(proxy, "/api/chat?trace=yes"), {
    method: "POST",
    headers: {
      authorization: "Bearer secret-athenz-at",
      "content-type": "application/json",
      "x-request-id": "request-1",
    },
    body: JSON.stringify({ model: "gemma4:26b", messages: [{ role: "user", content: "hi" }] }),
  })

  assert.equal(response.status, 201)
  assert.equal(response.headers.get("x-ollama-test"), "forwarded")
  assert.equal(await response.text(), '{"message":{"content":"hello"}}\n{"done":true}\n')
  assert.equal(received.method, "POST")
  assert.equal(received.url, "/api/chat?trace=yes")
  assert.equal(received.authorization, undefined)
  assert.equal(received.requestId, "request-1")
  assert.deepEqual(JSON.parse(received.body ?? ""), {
    model: "gemma4:26b",
    messages: [{ role: "user", content: "hi" }],
  })

  const users = await fetch(url(proxy, "/api/users"))
  assert.equal(users.status, 200)
  assert.deepEqual(await users.json(), { projects: [] })
})

test("records Ollama token usage by project and exposes all projects without an AT", async () => {
  const ollama = await listen(http.createServer((_req, res) => {
    res.setHeader("content-type", "application/x-ndjson")
    res.write('{"message":{"content":"hello"}}\n')
    res.end('{"done":true,"prompt_eval_count":3,"eval_count":5}\n')
  }))
  const usageStore = new UsageStore({ now: () => new Date("2026-07-20T12:00:00Z") })
  const proxy = await listen(createGenAIProxy({ authenticate, ollamaBaseUrl: url(ollama, "/"), usageStore }))

  const generated = await fetch(url(proxy, "/api/chat"), {
    method: "POST",
    headers: { authorization: "Bearer secret-athenz-at" },
    body: "{}",
  })
  assert.equal(generated.status, 200)
  await generated.arrayBuffer()

  const athenzUsers = await fetch(url(proxy, "/api/users"))
  assert.deepEqual(await athenzUsers.json(), {
    projects: [{
      project: "athenz",
      scope: "gen-ai.services.athenz:role.gen-ai-users",
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
      }],
    }],
  })
})

test("returns a redacted 502 when Ollama is unavailable", async () => {
  const proxy = await listen(createGenAIProxy({ authenticate, ollamaBaseUrl: "http://127.0.0.1:1" }))
  const response = await fetch(url(proxy, "/v1/models"), {
    headers: { authorization: "Bearer must-not-appear" },
  })

  assert.equal(response.status, 502)
  const body = await response.text()
  assert.match(body, /ollama_upstream_unavailable/)
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
