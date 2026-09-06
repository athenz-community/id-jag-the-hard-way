import {
  MCP_HUB_REGISTRY_CACHE_TTL_MS,
  MCP_HUB_REGISTRY_TOKEN,
  MCP_HUB_REGISTRY_URL,
} from "../config/env.js"

type RegistryServer = {
  routeId?: unknown
  proxyUrl?: unknown
  accessAudience?: unknown
  accessScope?: unknown
  toolScopes?: unknown
}

export type ResolvedMcpRoute = {
  proxyUrl: string
  accessAudience?: string
  accessScope?: string
  toolScopes?: Record<string, string>
}

type RegistryResponse = {
  servers?: RegistryServer[]
  error?: unknown
}

type CachedRegistry = {
  expiresAt: number
  routes: Map<string, ResolvedMcpRoute>
}

export class McpRegistryClient {
  private cache: CachedRegistry = { expiresAt: 0, routes: new Map() }

  constructor(
    private readonly registryUrl = MCP_HUB_REGISTRY_URL,
    private readonly registryToken = MCP_HUB_REGISTRY_TOKEN,
    private readonly cacheTtlMs = MCP_HUB_REGISTRY_CACHE_TTL_MS,
  ) {}

  async resolveRoute(serverId: string) {
    const routes = await this.getRoutes()
    const route = routes.get(serverId)
    if (!route) throw new RegistryServerNotFoundError(serverId)
    return route
  }

  private async getRoutes() {
    const now = Date.now()
    if (this.cache.expiresAt > now) return this.cache.routes

    const headers: Record<string, string> = { Accept: "application/json" }
    if (this.registryToken) headers.Authorization = `Bearer ${this.registryToken}`
    const response = await fetch(this.registryUrl, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) throw new Error(`MCP Hub registry returned ${response.status}`)

    const payload = await response.json() as RegistryResponse
    const routes = new Map<string, ResolvedMcpRoute>()
    for (const server of payload.servers ?? []) {
      if (typeof server.routeId !== "string" || typeof server.proxyUrl !== "string") continue
      const proxyUrl = new URL(server.proxyUrl)
      if (proxyUrl.protocol !== "http:" && proxyUrl.protocol !== "https:") continue
      routes.set(server.routeId, {
        proxyUrl: proxyUrl.toString(),
        accessAudience: parseAccessAudience(server.accessAudience, server.accessScope, server.routeId),
        accessScope: typeof server.accessScope === "string" && server.accessScope.trim() ? server.accessScope.trim() : undefined,
        toolScopes: parseToolScopes(server.toolScopes, server.routeId),
      })
    }

    this.cache = { expiresAt: now + this.cacheTtlMs, routes }
    return routes
  }
}

function parseAccessAudience(value: unknown, accessScope: unknown, serverId: string) {
  const configured = typeof value === "string" && value.trim() ? value.trim() : undefined
  const audience = configured ?? firstScopeDomain(accessScope)
  if (audience !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(audience)) {
    throw new Error(`MCP Hub registry returned invalid accessAudience for ${serverId}`)
  }
  return audience
}

function firstScopeDomain(value: unknown) {
  if (typeof value !== "string") return undefined
  const firstScope = value.trim().split(/\s+/).find(Boolean)
  const marker = ":role."
  const markerIndex = firstScope?.indexOf(marker) ?? -1
  return markerIndex > 0 ? firstScope?.slice(0, markerIndex) : undefined
}

function parseToolScopes(value: unknown, serverId: string) {
  if (value === undefined) return undefined
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`MCP Hub registry returned invalid toolScopes for ${serverId}`)
  }

  const toolScopes: Array<[string, string]> = []
  for (const [toolName, configuredScope] of Object.entries(value)) {
    if (!toolName.trim() || typeof configuredScope !== "string") {
      throw new Error(`MCP Hub registry returned invalid toolScopes for ${serverId}`)
    }
    const scope = [...new Set(configuredScope.split(/\s+/).filter(Boolean))].sort().join(" ")
    if (!scope) throw new Error(`MCP Hub registry returned an empty scope for ${serverId}/${toolName}`)
    toolScopes.push([toolName, scope])
  }
  return Object.fromEntries(toolScopes)
}

export class RegistryServerNotFoundError extends Error {
  constructor(readonly serverId: string) {
    super(`MCP server is not registered: ${serverId}`)
  }
}

export const mcpRegistryClient = new McpRegistryClient()
