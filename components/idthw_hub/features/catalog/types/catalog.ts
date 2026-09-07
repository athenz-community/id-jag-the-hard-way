export type McpServerStatus = "active" | "in-progress" | "unhealthy"

export type McpServer = {
  id: string
  routeId: string
  name: string
  namespace: string
  alias?: string
  description: string
  project: string
  publicUrl?: string
  gatewayUrl?: string
  proxyUrl: string
  accessManagement: "hub" | "server"
  accessAudience?: string
  accessScope?: string
  serviceAccount?: string
  status: McpServerStatus
  statusMessage: string
  toolPermissionOverrides?: unknown
  toolScopes?: Record<string, string>
  totalToolCalls: string
  iconSrc?: string
  logoText: string
  logoBg: string
  logoFg: string
}

export type CatalogResponse = {
  servers: McpServer[]
  error?: string
}
