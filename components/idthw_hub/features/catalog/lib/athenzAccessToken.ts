export type McpAccessTokenCacheStatus = {
  generatedAt: string
  entryCount: number
  usableEntryCount: number
  refreshRequiredEntryCount: number
  expiredEntryCount: number
  maxEntries: number
  expirySkewSeconds: number
  entries: []
}

// Keep the existing status response shape for callers. MCP Hub no longer mints
// Athenz access tokens because live tool discovery is public; protected tool
// calls are handled and cached by MCP Gateway instead.
export function getMcpAccessTokenCacheStatus(): McpAccessTokenCacheStatus {
  return {
    generatedAt: new Date().toISOString(),
    entryCount: 0,
    usableEntryCount: 0,
    refreshRequiredEntryCount: 0,
    expiredEntryCount: 0,
    maxEntries: 0,
    expirySkewSeconds: 0,
    entries: [],
  }
}
