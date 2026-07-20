import http, { type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from "node:http"
import { Readable } from "node:stream"
import { AccessTokenError, type AuthContext, type TokenVerifier } from "./auth.ts"
import { extractTokenUsage, UsageStore } from "./usage.ts"

type Fetch = typeof globalThis.fetch

type ProxyOptions = {
  authenticate: TokenVerifier
  ollamaBaseUrl?: string
  fetchImpl?: Fetch
  usageStore?: UsageStore
}

const meteredPaths = new Set(["/api/chat", "/api/generate", "/v1/chat/completions", "/v1/completions"])
const maxUsageTailBytes = 128 * 1024

const requestHeadersToStrip = new Set([
  "authorization",
  "connection",
  "content-length",
  "host",
  "proxy-authenticate",
  "proxy-authorization",
  "transfer-encoding",
])

const responseHeadersToStrip = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "transfer-encoding",
])

export function createGenAIProxy(options: ProxyOptions) {
  const ollamaBaseUrl = normalizeOllamaBaseUrl(options.ollamaBaseUrl ?? "http://127.0.0.1:11434")
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const usageStore = options.usageStore ?? new UsageStore()

  return http.createServer((req, res) => {
    void handleRequest(req, res, ollamaBaseUrl, fetchImpl, options.authenticate, usageStore).catch((error) => {
      const message = error instanceof Error ? error.message : "Unknown upstream error"
      console.error("GenAI proxy request failed", { method: req.method, url: req.url, message })
      if (!res.headersSent) {
        sendJson(res, 502, {
          error: "ollama_upstream_unavailable",
          message: "The local Ollama API could not be reached.",
        })
      } else {
        res.destroy()
      }
    })
  })
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ollamaBaseUrl: URL,
  fetchImpl: Fetch,
  authenticate: TokenVerifier,
  usageStore: UsageStore,
) {
  const requestUrl = new URL(req.url ?? "/", "http://genai-proxy.local")

  if (requestUrl.pathname === "/healthz") {
    sendJson(res, 200, { status: "ok", upstream: "ollama" })
    return
  }

  if (requestUrl.pathname === "/api/users") {
    if (req.method !== "GET") {
      res.setHeader("allow", "GET")
      sendJson(res, 405, { error: "method_not_allowed", message: "Use GET /api/users." })
      return
    }
    sendJson(res, 200, { projects: usageStore.listProjects() })
    return
  }

  let auth: AuthContext
  try {
    auth = authenticate(req.headers.authorization)
  } catch (error) {
    if (!(error instanceof AccessTokenError)) throw error
    const challenge = error.statusCode === 403
      ? 'Bearer realm="genai-proxy", error="insufficient_scope", scope="gen-ai-users"'
      : error.code === "invalid_access_token"
        ? 'Bearer realm="genai-proxy", error="invalid_token"'
        : 'Bearer realm="genai-proxy"'
    res.setHeader("www-authenticate", challenge)
    sendJson(res, error.statusCode, { error: error.code, message: error.message })
    return
  }

  const upstreamUrl = new URL(requestUrl.pathname + requestUrl.search, ollamaBaseUrl)
  const body = ["GET", "HEAD"].includes(req.method ?? "") ? undefined : Readable.toWeb(req)
  const response = await fetchImpl(upstreamUrl, {
    method: req.method,
    headers: forwardedRequestHeaders(req.headers),
    body: body as BodyInit | undefined,
    duplex: body ? "half" : undefined,
    redirect: "manual",
  } as RequestInit)

  res.statusCode = response.status
  response.headers.forEach((value, key) => {
    if (!responseHeadersToStrip.has(key.toLowerCase())) {
      res.setHeader(key, value)
    }
  })

  if (!response.body) {
    res.end()
    return
  }

  const upstream = Readable.fromWeb(response.body)
  if (response.ok && meteredPaths.has(requestUrl.pathname)) {
    let tail = Buffer.alloc(0)
    upstream.on("data", (chunk: Buffer | string) => {
      tail = appendTail(tail, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    upstream.on("end", () => {
      const usage = extractTokenUsage(tail.toString("utf8"))
      if (usage) usageStore.record({
        project: auth.audience,
        subject: auth.subject,
        clientId: auth.clientId,
        scope: auth.scope,
      }, usage)
    })
  }
  upstream.on("error", () => res.destroy()).pipe(res)
}

function normalizeOllamaBaseUrl(value: string) {
  const url = new URL(value)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`OLLAMA_BASE_URL must use http or https, got ${url.protocol}`)
  }
  url.pathname = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`
  return url
}

function forwardedRequestHeaders(headers: IncomingHttpHeaders) {
  const forwarded = new Headers()
  for (const [key, value] of Object.entries(headers)) {
    if (!value || requestHeadersToStrip.has(key.toLowerCase())) continue
    forwarded.set(key, Array.isArray(value) ? value.join(", ") : value)
  }
  return forwarded
}

function appendTail(current: Buffer, chunk: Buffer) {
  const combined = Buffer.concat([current, chunk])
  return combined.length <= maxUsageTailBytes
    ? combined
    : combined.subarray(combined.length - maxUsageTailBytes)
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown) {
  res.statusCode = statusCode
  res.setHeader("content-type", "application/json; charset=utf-8")
  res.end(JSON.stringify(payload))
}
