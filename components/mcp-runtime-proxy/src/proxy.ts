import http, { type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from "node:http"
import https from "node:https"

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

export function createRuntimeProxyServer(target: URL) {
  if (!(["http:", "https:"] as string[]).includes(target.protocol)) {
    throw new Error("MCP_TARGET_URL must use http or https")
  }
  if (target.username || target.password) {
    throw new Error("MCP_TARGET_URL must not contain credentials")
  }

  const server = http.createServer((request, response) => {
    void handleRequest(request, response, target)
  })
  server.requestTimeout = 0
  return server
}

async function handleRequest(request: IncomingMessage, response: ServerResponse, target: URL) {
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`)
  if (requestUrl.pathname === "/healthz" || requestUrl.pathname === "/readyz") {
    sendJson(response, 200, { ok: true })
    return
  }

  try {
    await proxyRequest(request, response, buildUpstreamUrl(target, requestUrl))
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown upstream error"
    console.error("MCP upstream request failed", { method: request.method, path: requestUrl.pathname, message })
    if (response.headersSent) {
      response.destroy(error instanceof Error ? error : undefined)
      return
    }
    sendJson(response, 502, { error: "MCP upstream unavailable" })
  }
}

function proxyRequest(request: IncomingMessage, response: ServerResponse, upstreamUrl: URL) {
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
    request.pipe(upstreamRequest)
  })
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
  response.end(JSON.stringify(body))
}
