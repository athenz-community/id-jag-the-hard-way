import { Readable } from "node:stream"
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http"
import type { McpRoute } from "./kubernetes.ts"

type ProxyArgs = {
  req: IncomingMessage
  res: ServerResponse
  route: McpRoute
  suffix: string
  search: string
}

export async function proxyToUpstream({ req, res, route, suffix, search }: ProxyArgs) {
  const upstream = buildUpstreamUrl({ route, suffix, search })
  const headers = forwardedHeaders(req.headers, upstream)
  const body = ["GET", "HEAD"].includes(req.method ?? "") ? undefined : Readable.toWeb(req)

  const response = await fetch(upstream, {
    method: req.method,
    headers,
    body: body as BodyInit | undefined,
    duplex: body ? "half" : undefined,
    redirect: "manual",
  } as RequestInit)

  res.statusCode = response.status
  response.headers.forEach((value, key) => {
    if (!["connection", "content-encoding", "transfer-encoding"].includes(key.toLowerCase())) {
      res.setHeader(key, value)
    }
  })
  res.setHeader("x-core-mcp-proxy-route", route.id)
  res.setHeader("x-core-mcp-proxy-upstream", route.upstreamUrl)

  if (!response.body) {
    res.end()
    return
  }

  Readable.fromWeb(response.body).pipe(res)
}

function buildUpstreamUrl({ route, suffix, search }: { route: McpRoute; suffix: string; search: string }) {
  const upstream = new URL(route.upstreamUrl)
  if (suffix && suffix !== "/") {
    upstream.pathname = joinPath(upstream.pathname, suffix)
  }
  upstream.search = search
  return upstream
}

function joinPath(base: string, suffix: string) {
  const cleanBase = base.endsWith("/") ? base.slice(0, -1) : base
  const cleanSuffix = suffix.startsWith("/") ? suffix : `/${suffix}`
  return `${cleanBase}${cleanSuffix}`
}

function forwardedHeaders(headers: IncomingHttpHeaders, upstream: URL) {
  const forwarded = new Headers()
  for (const [key, value] of Object.entries(headers)) {
    if (!value) continue
    if (["host", "connection", "content-length"].includes(key.toLowerCase())) continue
    forwarded.set(key, Array.isArray(value) ? value.join(", ") : value)
  }
  forwarded.set("host", upstream.host)
  return forwarded
}
