import {
  MCP_HUB_REGISTRY_CACHE_TTL_MS,
  MCP_HUB_REGISTRY_TOKEN,
  MCP_HUB_REGISTRY_URL,
} from "../config/env.js"

type RegistryServer = {
  routeId?: unknown
  proxyUrl?: unknown
  accessScope?: unknown
}

export type ResolvedMcpRoute = {
  proxyUrl: string
  accessScope?: string
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
        accessScope: typeof server.accessScope === "string" && server.accessScope.trim() ? server.accessScope.trim() : undefined,
      })
    }

    this.cache = { expiresAt: now + this.cacheTtlMs, routes }
    return routes
  }
}

export class RegistryServerNotFoundError extends Error {
  constructor(readonly serverId: string) {
    super(`MCP server is not registered: ${serverId}`)
  }
}

export const mcpRegistryClient = new McpRegistryClient()
