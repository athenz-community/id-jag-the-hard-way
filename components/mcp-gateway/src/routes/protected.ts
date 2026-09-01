import { Readable } from "node:stream"
import { Router, type Request, type Response } from "express"
import {
  MCP_GATEWAY_ACCESS_SCOPE,
  PUBLIC_BASE_URL,
} from "../config/env.js"
import { athenzAccessTokenManager } from "../services/athenz.js"
import { mcpRegistryClient, RegistryServerNotFoundError, type ResolvedMcpRoute } from "../services/mcpRegistry.js"
import { sessionStore, type GatewaySession } from "../utils/sessionStore.js"

export type ProtectedRouterDependencies = {
  accessScope: string
  getAccessToken: (session: GatewaySession, scope: string) => Promise<string>
  resolveRoute: (serverId: string) => Promise<ResolvedMcpRoute>
}

const defaultDependencies: ProtectedRouterDependencies = {
  accessScope: MCP_GATEWAY_ACCESS_SCOPE,
  getAccessToken: (session, scope) => athenzAccessTokenManager.getAccessToken(session, scope),
  resolveRoute: (serverId) => mcpRegistryClient.resolveRoute(serverId),
}

export function createProtectedRouter(overrides: Partial<ProtectedRouterDependencies> = {}) {
  const dependencies = { ...defaultDependencies, ...overrides }
  const router = Router()

  router.get("/.well-known/oauth-protected-resource", (_request, response) => {
    response.json(protectedResourceMetadata(PUBLIC_BASE_URL))
  })

  router.get("/.well-known/oauth-protected-resource/mcp/:serverId", (request, response) => {
    const serverId = request.params.serverId
    response.json(protectedResourceMetadata(`${PUBLIC_BASE_URL}/mcp/${encodeURIComponent(serverId)}`))
  })

  router.get("/session", (request, response) => {
    const session = requireSession(request, response)
    if (!session) return

    response.setHeader("cache-control", "no-store")
    response.json({
      authenticated: true,
      subject: session.subject,
      username: session.username,
      expires_at: session.expiresAt,
    })
  })

  router.all("/mcp", (_request, response) => {
    response.status(404).json({ error: "missing_server_id", message: "Use /mcp/{server-id}." })
  })

  router.use("/mcp/:serverId", async (request, response) => {
    const serverId = request.params.serverId
    if (!isValidServerId(serverId)) {
      response.status(400).json({ error: "invalid_server_id" })
      return
    }

    const session = requireSession(request, response, serverId)
    if (!session) return

    try {
      const route = await dependencies.resolveRoute(serverId)
      const accessToken = isPublicMcpDiscoveryRequest(request)
        ? undefined
        : await dependencies.getAccessToken(session, route.accessScope ?? dependencies.accessScope)
      await proxyToCore({ request, response, accessToken, serverId, proxyUrl: route.proxyUrl })
    } catch (error) {
      const message = error instanceof Error ? error.message : "MCP Gateway forwarding failed"
      console.error("MCP Gateway request failed", { serverId, subject: session.subject, message })
      if (!response.headersSent) {
        const status = error instanceof RegistryServerNotFoundError ? 404 : 502
        response.status(status).json({ error: status === 404 ? "mcp_server_not_found" : "mcp_gateway_forwarding_failed", message })
      } else {
        response.end()
      }
    }
  })

  return router
}

function protectedResourceMetadata(resource: string) {
  return {
    resource,
    authorization_servers: [PUBLIC_BASE_URL],
    bearer_methods_supported: ["header"],
  }
}

async function proxyToCore({
  request,
  response,
  accessToken,
  serverId,
  proxyUrl,
}: {
  request: Request
  response: Response
  accessToken?: string
  serverId: string
  proxyUrl: string
}) {
  const upstreamUrl = buildProxyUrl(proxyUrl, request.originalUrl, serverId)
  const headers = forwardedRequestHeaders(request, accessToken)
  const body = requestBody(request)
  const upstreamResponse = await fetch(upstreamUrl, {
    method: request.method,
    headers,
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(60_000),
  })

  response.status(upstreamResponse.status)
  upstreamResponse.headers.forEach((value, key) => {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) response.setHeader(key, value)
  })
  response.setHeader("x-mcp-gateway-server-id", serverId)

  if (!upstreamResponse.body) {
    response.end()
    return
  }

  Readable.fromWeb(upstreamResponse.body as never).pipe(response)
}

function buildProxyUrl(proxyUrl: string, originalUrl: string, serverId: string) {
  const upstreamUrl = new URL(proxyUrl)
  const requestedUrl = new URL(originalUrl, "http://mcp-gateway.invalid")
  const gatewayBasePath = `/mcp/${encodeURIComponent(serverId)}`
  const suffix = requestedUrl.pathname.startsWith(gatewayBasePath)
    ? requestedUrl.pathname.slice(gatewayBasePath.length)
    : ""
  if (suffix && suffix !== "/") {
    upstreamUrl.pathname = `${upstreamUrl.pathname.replace(/\/+$/, "")}/${suffix.replace(/^\/+/, "")}`
  }
  upstreamUrl.search = requestedUrl.search
  return upstreamUrl
}

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "content-encoding",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
])

function forwardedRequestHeaders(request: Request, accessToken?: string) {
  const headers = new Headers()
  for (const [key, value] of Object.entries(request.headers)) {
    if (!value || HOP_BY_HOP_HEADERS.has(key.toLowerCase()) || key.toLowerCase() === "host" || key.toLowerCase() === "authorization") {
      continue
    }
    headers.set(key, Array.isArray(value) ? value.join(", ") : value)
  }
  if (accessToken) headers.set("authorization", `Bearer ${accessToken}`)
  return headers
}

function isPublicMcpDiscoveryRequest(request: Request) {
  if (request.method !== "POST" || !request.body || typeof request.body !== "object" || Array.isArray(request.body)) {
    return false
  }

  const method = (request.body as { method?: unknown }).method
  return typeof method === "string" && PUBLIC_MCP_METHODS.has(method)
}

const PUBLIC_MCP_METHODS = new Set([
  "initialize",
  "notifications/initialized",
  "ping",
  "tools/list",
])

function requestBody(request: Request): BodyInit | undefined {
  if (request.method === "GET" || request.method === "HEAD" || request.body === undefined) return undefined
  if (Buffer.isBuffer(request.body)) return Uint8Array.from(request.body)
  if (typeof request.body === "string") return request.body
  return JSON.stringify(request.body)
}

function isValidServerId(serverId: string) {
  return /^[a-z0-9](?:[a-z0-9._-]{0,251}[a-z0-9])?$/i.test(serverId)
}

function requireSession(request: Request, response: Response, serverId?: string) {
  const authorization = request.headers.authorization
  const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : ""
  const session = token ? sessionStore.get(token) : null
  if (session) return session

  const metadataPath = serverId
    ? `/.well-known/oauth-protected-resource/mcp/${encodeURIComponent(serverId)}`
    : "/.well-known/oauth-protected-resource"
  response.setHeader(
    "www-authenticate",
    `Bearer realm="${PUBLIC_BASE_URL}", resource_metadata="${PUBLIC_BASE_URL}${metadataPath}"`,
  )
  response.status(401).json({ error: "unauthorized", message: "Authenticate through the MCP Gateway OAuth flow." })
  return null
}
