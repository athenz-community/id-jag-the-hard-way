export type McpServer = {
  id: string
  name: string
  alias?: string
  description: string
  project: string
  totalToolCalls: string
  tools?: string[]
  iconSrc?: string
  logoText: string
  logoBg: string
  logoFg: string
}

export type CatalogResponse = {
  servers: McpServer[]
  error?: string
}
