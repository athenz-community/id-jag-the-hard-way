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
  accessScope?: string
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
