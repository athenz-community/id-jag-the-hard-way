import http, { type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from "node:http"
import https from "node:https"
import {
  AccessTokenError,
  JwksUnavailableError,
  type AthenzAccessTokenVerifier,
} from "./auth.ts"

const MAX_PUBLIC_REQUEST_BYTES = 64 * 1024
const PUBLIC_MCP_METHODS = new Set([
  "initialize",
  "notifications/initialized",
  "ping",
  "tools/list",
])

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
])

export function createRuntimeProxyServer(target: URL, accessTokenVerifier: AthenzAccessTokenVerifier) {
  if (!(["http:", "https:"] as string[]).includes(target.protocol)) {
    throw new Error("MCP_TARGET_URL must use http or https")
  }
  if (target.username || target.password) {
    throw new Error("MCP_TARGET_URL must not contain credentials")
  }

  const server = http.createServer((request, response) => {
    void handleRequest(request, response, target, accessTokenVerifier)
  })
  server.requestTimeout = 0
  return server
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  target: URL,
  accessTokenVerifier: AthenzAccessTokenVerifier,
) {
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`)
  if (requestUrl.pathname === "/healthz" || requestUrl.pathname === "/readyz") {
    sendJson(response, 200, { ok: true })
    return
  }

  try {
    const bufferedBody = await authorizeRequest(request, accessTokenVerifier)
    await proxyRequest(request, response, buildUpstreamUrl(target, requestUrl), bufferedBody)
  } catch (error) {
    if (error instanceof AccessTokenError) {
      console.warn("MCP access denied", {
        code: error.code,
        method: request.method,
        path: requestUrl.pathname,
        status: error.status,
      })
      sendAccessTokenError(response, error)
      return
    }
    if (error instanceof JwksUnavailableError) {
      console.error("MCP access-token validation unavailable", {
        method: request.method,
        path: requestUrl.pathname,
        message: error.message,
      })
      sendJson(response, 503, { error: "authentication_unavailable" })
      return
    }
    const message = error instanceof Error ? error.message : "Unknown upstream error"
    console.error("MCP upstream request failed", { method: request.method, path: requestUrl.pathname, message })
    if (response.headersSent) {
      response.destroy(error instanceof Error ? error : undefined)
      return
    }
    sendJson(response, 502, { error: "MCP upstream unavailable" })
  }
}

async function authorizeRequest(
  request: IncomingMessage,
  accessTokenVerifier: AthenzAccessTokenVerifier,
) {
  const authorization = request.headers.authorization
  if (authorization) {
    await accessTokenVerifier.verify(authorization)
    return undefined
  }

  if (request.method === "POST") {
    const body = await readRequestBody(request)
    if (isPublicMcpRequest(body)) return body
  }

  await accessTokenVerifier.verify(undefined)
  return undefined
}

function proxyRequest(
  request: IncomingMessage,
  response: ServerResponse,
  upstreamUrl: URL,
  bufferedBody?: Buffer,
) {
  return new Promise<void>((resolve, reject) => {
    const transport = upstreamUrl.protocol === "https:" ? https : http
    const upstreamRequest = transport.request(upstreamUrl, {
      method: request.method,
      headers: forwardedRequestHeaders(request.headers, upstreamUrl),
    }, (upstreamResponse) => {
      response.statusCode = upstreamResponse.statusCode ?? 502
      if (upstreamResponse.statusMessage) response.statusMessage = upstreamResponse.statusMessage
      copyResponseHeaders(upstreamResponse.headers, response)
      upstreamResponse.on("error", reject)
      upstreamResponse.on("end", resolve)
      upstreamResponse.pipe(response)
    })

    upstreamRequest.on("error", reject)
    request.on("aborted", () => upstreamRequest.destroy())
    response.on("close", () => {
      if (!response.writableEnded) upstreamRequest.destroy()
    })
    if (bufferedBody) upstreamRequest.end(bufferedBody)
    else request.pipe(upstreamRequest)
  })
}

function readRequestBody(request: IncomingMessage) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    let bytes = 0
    let tooLarge = false
    request.on("data", (chunk: Buffer | string) => {
      if (tooLarge) return
      const value = Buffer.from(chunk)
      bytes += value.length
      if (bytes > MAX_PUBLIC_REQUEST_BYTES) {
        tooLarge = true
        reject(new AccessTokenError(
          401,
          "missing_access_token",
          "Pass an Athenz access token as Authorization: Bearer <token>.",
        ))
        return
      }
      chunks.push(value)
    })
    request.on("end", () => {
      if (!tooLarge) resolve(Buffer.concat(chunks))
    })
    request.on("error", reject)
  })
}

function isPublicMcpRequest(body: Buffer) {
  try {
    const message = JSON.parse(body.toString("utf8")) as unknown
    return Boolean(
      message
      && typeof message === "object"
      && !Array.isArray(message)
      && PUBLIC_MCP_METHODS.has(String((message as { method?: unknown }).method)),
    )
  } catch {
    return false
  }
}

function buildUpstreamUrl(target: URL, requestUrl: URL) {
  const upstreamUrl = new URL(target)
  upstreamUrl.pathname = joinPath(upstreamUrl.pathname, requestUrl.pathname)
  upstreamUrl.search = requestUrl.search
  return upstreamUrl
}

function joinPath(basePath: string, requestPath: string) {
  const base = basePath === "/" ? "" : basePath.replace(/\/$/, "")
  const path = requestPath.startsWith("/") ? requestPath : `/${requestPath}`
  return `${base}${path}` || "/"
}

function forwardedRequestHeaders(headers: IncomingHttpHeaders, upstreamUrl: URL) {
  const forwarded: IncomingHttpHeaders = {}
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || HOP_BY_HOP_HEADERS.has(name.toLowerCase()) || name.toLowerCase() === "host") continue
    forwarded[name] = value
  }
  forwarded.host = upstreamUrl.host
  return forwarded
}

function copyResponseHeaders(headers: IncomingHttpHeaders, response: ServerResponse) {
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || HOP_BY_HOP_HEADERS.has(name.toLowerCase())) continue
    response.setHeader(name, value)
  }
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown) {
  response.statusCode = statusCode
  response.setHeader("content-type", "application/json; charset=utf-8")
  response.setHeader("cache-control", "no-store")
  response.end(JSON.stringify(body))
}

function sendAccessTokenError(response: ServerResponse, error: AccessTokenError) {
  const challenge = error.status === 403
    ? `Bearer realm="mcp-runtime-proxy", error="insufficient_scope"`
    : error.code === "invalid_access_token"
      ? `Bearer realm="mcp-runtime-proxy", error="invalid_token"`
      : `Bearer realm="mcp-runtime-proxy"`
  response.setHeader("www-authenticate", challenge)
  sendJson(response, error.status, { error: error.code, message: error.message })
}
