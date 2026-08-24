import http, { IncomingMessage, ServerResponse } from "node:http"
import { discoverMcpRoutes } from "./kubernetes.ts"
import type { McpRoute } from "./kubernetes.ts"
import { proxyToUpstream } from "./proxy.ts"

const PORT = Number(process.env.PORT ?? "8080")
const NAMESPACE = process.env.MCP_HUB_NAMESPACE?.trim() || undefined
const LABEL_SELECTOR = process.env.MCP_HUB_LABEL_SELECTOR ?? "app.kubernetes.io/part-of=mcp-hub"
const ROUTE_CACHE_TTL_MS = Number(process.env.ROUTE_CACHE_TTL_MS ?? "5000")

type RouteCache = {
  expiresAt: number
  routes: McpRoute[]
}

let routeCache: RouteCache = {
  expiresAt: 0,
  routes: [],
}

const server = http.createServer(async (req, res) => {
  try {
    await handleRequest(req, res)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error"
    console.error("request failed", { method: req.method, url: req.url, message })
    sendJson(res, 500, { error: message })
  }
})

server.listen(PORT, "0.0.0.0", () => {
  console.log(`core-mcp-proxy listening on 0.0.0.0:${PORT}`)
  console.log(`discovering MCP deployments in namespace=${NAMESPACE ?? "all"} selector=${LABEL_SELECTOR}`)
})

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)

  if (url.pathname === "/health") {
    sendJson(res, 200, { ok: true })
    return
  }

  if (url.pathname === "/routes") {
    const routes = await getRoutes()
    sendJson(res, 200, { routes })
    return
  }

  const match = url.pathname.match(/^\/mcp\/([^/]+)(\/.*)?$/)
  if (!match) {
    sendJson(res, 404, { error: "Expected /mcp/{id}" })
    return
  }

  const id = decodeURIComponent(match[1])
  const routes = await getRoutes()
  const route = routes.find((item) => item.id === id)
  if (!route) {
    sendJson(res, 404, { error: `Unknown MCP server: ${id}`, available: routes.map((item) => item.id) })
    return
  }

  await proxyToUpstream({
    req,
    res,
    route,
    suffix: match[2] ?? "",
    search: url.search,
  })
}

async function getRoutes(): Promise<McpRoute[]> {
  const now = Date.now()
  if (routeCache.expiresAt > now) {
    return routeCache.routes
  }

  const routes = await discoverMcpRoutes({ namespace: NAMESPACE, labelSelector: LABEL_SELECTOR })
  routeCache = {
    expiresAt: now + ROUTE_CACHE_TTL_MS,
    routes,
  }
  return routes
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown) {
  res.statusCode = statusCode
  res.setHeader("content-type", "application/json; charset=utf-8")
  res.end(JSON.stringify(payload))
}
