import http, { type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from "node:http"
import { Readable } from "node:stream"
import { AccessTokenError, type AuthContext, type TokenVerifier } from "./auth.ts"
import { dailyServiceCodeLimits, estimatedTokenCostUsd, estimatedUsageCostUsd } from "./billing.ts"
import { extractTokenUsage, UsageStore } from "./usage.ts"

type Fetch = typeof globalThis.fetch

type ProxyOptions = {
  authenticate: TokenVerifier
  upstreamBaseUrl: string
  upstreamApiKey?: string
  fetchImpl?: Fetch
  usageStore?: UsageStore
}

const meteredPaths = new Set([
  "/api/chat",
  "/api/generate",
  "/v1/chat/completions",
  "/v1/completions",
  "/v1/responses",
])
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
  const upstreamBaseUrl = normalizeUpstreamBaseUrl(options.upstreamBaseUrl)
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const usageStore = options.usageStore ?? new UsageStore()

  return http.createServer((req, res) => {
    void handleRequest(
      req,
      res,
      upstreamBaseUrl,
      options.upstreamApiKey,
      fetchImpl,
      options.authenticate,
      usageStore,
    ).catch((error) => {
      const message = error instanceof Error ? error.message : "Unknown upstream error"
      console.error("GenAI proxy request failed", { method: req.method, url: req.url, message })
      if (!res.headersSent) {
        sendJson(res, 502, {
          error: "genai_upstream_unavailable",
          message: "The configured GenAI upstream could not be reached.",
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
  upstreamBaseUrl: URL,
  upstreamApiKey: string | undefined,
  fetchImpl: Fetch,
  authenticate: TokenVerifier,
  usageStore: UsageStore,
) {
  const requestUrl = new URL(req.url ?? "/", "http://genai-proxy.local")
  const isMeteredRequest = meteredPaths.has(requestUrl.pathname)

  if (requestUrl.pathname === "/healthz") {
    sendJson(res, 200, { status: "ok", upstream: "openai-compatible" })
    return
  }

  if (requestUrl.pathname === "/api/users" || requestUrl.pathname.startsWith("/api/users/")) {
    if (req.method !== "GET") {
      res.setHeader("allow", "GET")
      sendJson(res, 405, { error: "method_not_allowed", message: "Use GET /api/users/{user}." })
      return
    }
    const subject = reportSubject(requestUrl.pathname)
    if (!subject) {
      if (requestUrl.pathname === "/api/users") {
        sendJson(res, 400, { error: "user_required", message: "Use a username without the user. prefix." })
      } else {
        sendJson(res, 200, { projects: [] })
      }
      return
    }
    sendJson(res, 200, { projects: projectUsageReport(usageStore, subject) })
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

  if (isMeteredRequest) {
    const dailyLimit = dailyServiceCodeLimits[auth.project]?.amountUsd
    if (dailyLimit !== undefined) {
      const dailySpend = estimatedUsageCostUsd(usageStore.currentDailyModels(auth.audience))
      if (dailySpend >= dailyLimit) {
        res.setHeader("retry-after", String(secondsUntilNextJstDay()))
        sendJson(res, 429, {
          error: "too_many_requests",
          code: "daily_service_code_limit_exceeded",
          message: `The daily GenAI spending limit for ${auth.project} has been reached. Retry after 00:00 JST.`,
          service_code: auth.project,
          limit_usd: dailyLimit,
          spent_usd: roundedUsd(dailySpend),
        })
        return
      }
    }
  }

  const upstreamUrl = new URL(requestUrl.pathname + requestUrl.search, upstreamBaseUrl)
  let model: string | undefined
  let body: BodyInit | undefined
  if (!["GET", "HEAD"].includes(req.method ?? "")) {
    if (isMeteredRequest) {
      const requestBody = await readRequestBody(req)
      model = requestModel(requestBody)
      body = requestBody as BodyInit
    } else {
      body = Readable.toWeb(req) as BodyInit
    }
  }
  const response = await fetchImpl(upstreamUrl, {
    method: req.method,
    headers: forwardedRequestHeaders(req.headers, upstreamApiKey),
    body,
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
  if (response.ok && isMeteredRequest) {
    let tail = Buffer.alloc(0)
    upstream.on("data", (chunk: Buffer | string) => {
      tail = appendTail(tail, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    upstream.on("end", () => {
      const usage = extractTokenUsage(tail.toString("utf8"))
      if (usage) {
        try {
          usageStore.record({
            project: auth.audience,
            subject: auth.subject,
            clientId: auth.clientId,
            model,
            scope: auth.scope,
          }, usage)
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown persistence error"
          console.error("Failed to persist GenAI proxy usage", { message })
        }
      }
    })
  }
  upstream.on("error", () => res.destroy()).pipe(res)
}

async function readRequestBody(req: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks)
}

function requestModel(body: Buffer) {
  try {
    const value = JSON.parse(body.toString("utf8")) as Record<string, unknown>
    return typeof value.model === "string" ? value.model.trim() || undefined : undefined
  } catch {
    return undefined
  }
}

function reportSubject(pathname: string) {
  const match = /^\/api\/users\/([^/]+)$/.exec(pathname)
  if (!match) return undefined
  try {
    const user = decodeURIComponent(match[1])
    return /^[a-z0-9][a-z0-9._-]*$/i.test(user) ? `user.${user}` : undefined
  } catch {
    return undefined
  }
}

function projectUsageReport(usageStore: UsageStore, subject: string) {
  return usageStore.listProjects(subject).map((project) => {
    const limit = dailyServiceCodeLimits[project.project]
    const projectAudience = `gen-ai.services.${project.project}`
    const dailySpend = estimatedUsageCostUsd(usageStore.currentDailyModels(projectAudience))
    return {
      ...project,
      daily_limit_usd: limit?.amountUsd ?? null,
      daily_limit_fraction_digits: limit?.fractionDigits ?? null,
      daily_spend_usd: roundedUsd(dailySpend),
      users: project.users.map((usage) => {
        const tokens = usage.tokens.map((token) => ({
          ...token,
          estimated_cost_usd: roundedUsd(estimatedTokenCostUsd(token.model, token.input, token.output)),
        }))
        return {
          ...usage,
          estimated_cost_usd: roundedUsd(tokens.reduce((total, token) => total + token.estimated_cost_usd, 0)),
          tokens,
        }
      }),
    }
  })
}

function normalizeUpstreamBaseUrl(value: string) {
  const url = new URL(value)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`GENAI_UPSTREAM_BASE_URL must use http or https, got ${url.protocol}`)
  }
  url.pathname = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`
  return url
}

function forwardedRequestHeaders(headers: IncomingHttpHeaders, upstreamApiKey: string | undefined) {
  const forwarded = new Headers()
  for (const [key, value] of Object.entries(headers)) {
    if (!value || requestHeadersToStrip.has(key.toLowerCase())) continue
    forwarded.set(key, Array.isArray(value) ? value.join(", ") : value)
  }
  if (upstreamApiKey) forwarded.set("authorization", `Bearer ${upstreamApiKey}`)
  return forwarded
}

function appendTail(current: Buffer, chunk: Buffer) {
  const combined = Buffer.concat([current, chunk])
  return combined.length <= maxUsageTailBytes
    ? combined
    : combined.subarray(combined.length - maxUsageTailBytes)
}

function secondsUntilNextJstDay(now = new Date()) {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const nextMidnight = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate() + 1) - 9 * 60 * 60 * 1000
  return Math.max(1, Math.ceil((nextMidnight - now.getTime()) / 1000))
}

function roundedUsd(value: number) {
  return Number(value.toFixed(8))
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown) {
  res.statusCode = statusCode
  res.setHeader("content-type", "application/json; charset=utf-8")
  res.end(JSON.stringify(payload))
}
