import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { Router, type Request, type Response } from "express"
import {
  MCP_GATEWAY_ACCESS_SCOPE,
  PUBLIC_BASE_URL,
} from "../config/env.js"
import {
  AthenzInsufficientScopeError,
  athenzAccessTokenManager,
  ReauthenticationRequiredError,
} from "../services/athenz.js"
import { mcpRegistryClient, RegistryServerNotFoundError, type ResolvedMcpRoute } from "../services/mcpRegistry.js"
import { sessionStore, type GatewaySession } from "../utils/sessionStore.js"

export type ProtectedRouterDependencies = {
  accessScope: string
  getAccessToken: (session: GatewaySession, scope: string) => Promise<string>
  resolveRoute: (serverId: string) => Promise<ResolvedMcpRoute>
  upstreamResponseTimeoutMs: number
}

export const MCP_DOWNSTREAM_SCOPE_HEADER = "x-idthw-mcp-downstream-scope"

const defaultDependencies: ProtectedRouterDependencies = {
  accessScope: MCP_GATEWAY_ACCESS_SCOPE,
  getAccessToken: (session, scope) => athenzAccessTokenManager.getAccessToken(session, scope),
  resolveRoute: (serverId) => mcpRegistryClient.resolveRoute(serverId),
  upstreamResponseTimeoutMs: 60_000,
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
      const publicRequest = isPublicMcpDiscoveryRequest(request)
      const accessScope = publicRequest
        ? undefined
        : accessScopeForRequest(request, route, dependencies.accessScope)
      const accessToken = accessScope
        ? await dependencies.getAccessToken(session, accessScope)
        : undefined
      await proxyToCore({
        request,
        response,
        accessToken,
        downstreamScope: accessScope
          ? downstreamScopeForRequest(request, route, accessScope, dependencies.accessScope)
          : undefined,
        serverId,
        proxyUrl: route.proxyUrl,
        responseTimeoutMs: dependencies.upstreamResponseTimeoutMs,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : "MCP Gateway forwarding failed"
      console.error("MCP Gateway request failed", { serverId, subject: session.subject, message })
      if (!response.headersSent) {
        if (error instanceof ReauthenticationRequiredError) {
          const token = bearerToken(request)
          if (token) sessionStore.delete(token)
          setAuthenticationChallenge(response, serverId)
          response.setHeader("cache-control", "no-store")
          response.status(401).json({
            error: "reauth_required",
            message: "A fresh identity-provider login is required before requesting this Athenz scope.",
          })
          return
        }

        const status = error instanceof RegistryServerNotFoundError
          ? 404
          : error instanceof InvalidToolCallError
            ? 400
            : error instanceof ToolScopeNotConfiguredError || error instanceof AthenzInsufficientScopeError
              ? 403
              : 502
        const code = status === 404
          ? "mcp_server_not_found"
          : status === 400
            ? "invalid_tool_call"
            : status === 403
              ? error instanceof AthenzInsufficientScopeError
                ? "insufficient_scope"
                : "tool_scope_not_configured"
              : "mcp_gateway_forwarding_failed"
        response.status(status).json({ error: code, message })
      } else {
        response.end()
      }
    }
  })

  return router
}

function accessScopeForRequest(request: Request, route: ResolvedMcpRoute, fallbackScope: string) {
  const routeScope = route.accessScope ?? fallbackScope
  if (request.method !== "POST" || !request.body || typeof request.body !== "object" || Array.isArray(request.body)) {
    return routeScope
  }

  const message = request.body as { method?: unknown; params?: unknown }
  if (message.method !== "tools/call") return routeScope
  if (!message.params || typeof message.params !== "object" || Array.isArray(message.params)) {
    throw new InvalidToolCallError("tools/call params must be an object")
  }

  const toolName = (message.params as { name?: unknown }).name
  if (typeof toolName !== "string" || !toolName.trim()) {
    throw new InvalidToolCallError("tools/call params.name must be a non-empty string")
  }
  if (!route.toolScopes) return routeScope

  const toolScope = Object.hasOwn(route.toolScopes, toolName) ? route.toolScopes[toolName] : undefined
  if (!toolScope) throw new ToolScopeNotConfiguredError(toolName)
  return toolScope
}

function downstreamScopeForRequest(
  request: Request,
  route: ResolvedMcpRoute,
  selectedScope: string,
  fallbackScope: string,
) {
  if (
    request.method !== "POST"
    || !request.body
    || typeof request.body !== "object"
    || Array.isArray(request.body)
    || (request.body as { method?: unknown }).method !== "tools/call"
    || !route.toolScopes
  ) return undefined

  const routeScopes = new Set(scopeValues(route.accessScope ?? fallbackScope))
  const downstreamScopes = scopeValues(selectedScope).filter((scope) => !routeScopes.has(scope))
  return downstreamScopes.length > 0 ? downstreamScopes.join(" ") : undefined
}

function scopeValues(scope: string) {
  return [...new Set(scope.trim().split(/\s+/).filter(Boolean))].sort()
}

class InvalidToolCallError extends Error {}

class ToolScopeNotConfiguredError extends Error {
  constructor(readonly toolName: string) {
    super(`No Athenz access scope is configured for MCP tool: ${toolName}`)
  }
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
  downstreamScope,
  serverId,
  proxyUrl,
  responseTimeoutMs,
}: {
  request: Request
  response: Response
  accessToken?: string
  downstreamScope?: string
  serverId: string
  proxyUrl: string
  responseTimeoutMs: number
}) {
  const upstreamUrl = buildProxyUrl(proxyUrl, request.originalUrl, serverId)
  const headers = forwardedRequestHeaders(request, accessToken, downstreamScope)
  const body = requestBody(request)
  const upstreamResponse = await fetchUntilResponse(upstreamUrl, {
    method: request.method,
    headers,
    body,
    redirect: "manual",
  }, responseTimeoutMs)

  response.status(upstreamResponse.status)
  upstreamResponse.headers.forEach((value, key) => {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) response.setHeader(key, value)
  })
  response.setHeader("x-mcp-gateway-server-id", serverId)

  if (!upstreamResponse.body) {
    response.end()
    return
  }

  await pipeline(Readable.fromWeb(upstreamResponse.body as never), response)
}

async function fetchUntilResponse(url: URL, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
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

function forwardedRequestHeaders(request: Request, accessToken?: string, downstreamScope?: string) {
  const headers = new Headers()
  for (const [key, value] of Object.entries(request.headers)) {
    if (
      !value
      || HOP_BY_HOP_HEADERS.has(key.toLowerCase())
      || key.toLowerCase() === "host"
      || key.toLowerCase() === "authorization"
      || key.toLowerCase() === MCP_DOWNSTREAM_SCOPE_HEADER
    ) {
      continue
    }
    headers.set(key, Array.isArray(value) ? value.join(", ") : value)
  }
  if (accessToken) headers.set("authorization", `Bearer ${accessToken}`)
  if (downstreamScope) headers.set(MCP_DOWNSTREAM_SCOPE_HEADER, downstreamScope)
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
  const token = bearerToken(request)
  const session = token ? sessionStore.get(token) : null
  if (session) return session

  setAuthenticationChallenge(response, serverId)
  response.status(401).json({ error: "unauthorized", message: "Authenticate through the MCP Gateway OAuth flow." })
  return null
}

function bearerToken(request: Request) {
  const authorization = request.headers.authorization
  return authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : ""
}

function setAuthenticationChallenge(response: Response, serverId?: string) {
  const metadataPath = serverId
    ? `/.well-known/oauth-protected-resource/mcp/${encodeURIComponent(serverId)}`
    : "/.well-known/oauth-protected-resource"
  response.setHeader(
    "www-authenticate",
    `Bearer realm="${PUBLIC_BASE_URL}", resource_metadata="${PUBLIC_BASE_URL}${metadataPath}"`,
  )
}
