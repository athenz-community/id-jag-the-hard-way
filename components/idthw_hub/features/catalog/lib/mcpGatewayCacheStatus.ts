type CacheEntryStatus = "valid" | "refresh-required" | "expired"
type SessionStatus = "valid" | "refresh-required"

type GatewayAccessTokenCacheStatus = {
  entryCount: number
  usableEntryCount: number
  refreshRequiredEntryCount: number
  expiredEntryCount: number
  expirySkewSeconds: number
  entries: Array<{
    audiences: string[]
    scope: string
    cachedAt: string
    expiresAt: string
    status: CacheEntryStatus
  }>
}

type GatewayIdJagCacheStatus = {
  entryCount: number
  usableEntryCount: number
  refreshRequiredEntryCount: number
  expiredEntryCount: number
  expirySkewSeconds: number
  entries: Array<{
    audiences: string[]
    scope: string
    cachedAt: string
    expiresAt: string
    status: CacheEntryStatus
  }>
}

type GatewayOAuthSession = {
  username: string
  subject: string
  expiresAt: string
  status: SessionStatus
  athenzAccessTokens: GatewayAccessTokenCacheStatus
  athenzIdJags: GatewayIdJagCacheStatus
}

export type McpGatewayCacheStatus = {
  configured: true
  available: true
  generatedAt: string
  sessionCount: number
  validSessionCount: number
  refreshRequiredSessionCount: number
  expirySkewSeconds: number
  sessions: GatewayOAuthSession[]
} | {
  configured: boolean
  available: false
  generatedAt: string
  error: string
}

export async function getMcpGatewayCacheStatus(): Promise<McpGatewayCacheStatus> {
  const statusUrl = process.env.MCP_HUB_GATEWAY_STATUS_URL?.trim()
  if (!statusUrl) return unavailable(false, "MCP_HUB_GATEWAY_STATUS_URL is not configured")

  const registryToken = process.env.MCP_HUB_REGISTRY_TOKEN
  if (!registryToken) return unavailable(true, "MCP_HUB_REGISTRY_TOKEN is not configured")

  try {
    const url = new URL(statusUrl)
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("MCP Gateway status URL must use HTTP or HTTPS")
    }

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${registryToken}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) throw new Error(`MCP Gateway cache status returned ${response.status}`)
    return sanitizeGatewayStatus(await response.json())
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to read MCP Gateway cache status"
    return unavailable(true, message)
  }
}

function sanitizeGatewayStatus(value: unknown): McpGatewayCacheStatus {
  const payload = record(value, "MCP Gateway cache status")
  const sessions = array(payload.sessions, "sessions").map((value, index) => {
    const session = record(value, `sessions[${index}]`)
    return {
      username: string(session.username, `sessions[${index}].username`),
      subject: string(session.subject, `sessions[${index}].subject`),
      expiresAt: string(session.expiresAt, `sessions[${index}].expiresAt`),
      status: sessionStatus(session.status, `sessions[${index}].status`),
      athenzAccessTokens: sanitizeAccessTokenStatus(session.athenzAccessTokens, index),
      athenzIdJags: sanitizeIdJagStatus(session.athenzIdJags, index),
    }
  })
  const refreshRequiredSessionCount = sessions.filter((session) => session.status === "refresh-required").length

  return {
    configured: true,
    available: true,
    generatedAt: string(payload.generatedAt, "generatedAt"),
    sessionCount: sessions.length,
    validSessionCount: sessions.length - refreshRequiredSessionCount,
    refreshRequiredSessionCount,
    expirySkewSeconds: number(payload.expirySkewSeconds, "expirySkewSeconds"),
    sessions,
  }
}

function sanitizeIdJagStatus(value: unknown, sessionIndex: number): GatewayIdJagCacheStatus {
  const field = `sessions[${sessionIndex}].athenzIdJags`
  const payload = record(value, field)
  const entries = array(payload.entries, `${field}.entries`).map((value, entryIndex) => {
    const entryField = `${field}.entries[${entryIndex}]`
    const entry = record(value, entryField)
    return {
      audiences: stringArray(entry.audiences, `${entryField}.audiences`),
      scope: string(entry.scope, `${entryField}.scope`),
      cachedAt: string(entry.cachedAt, `${entryField}.cachedAt`),
      expiresAt: string(entry.expiresAt, `${entryField}.expiresAt`),
      status: cacheEntryStatus(entry.status, `${entryField}.status`),
    }
  })

  return {
    entryCount: entries.length,
    usableEntryCount: entries.filter((entry) => entry.status === "valid").length,
    refreshRequiredEntryCount: entries.filter((entry) => entry.status === "refresh-required").length,
    expiredEntryCount: entries.filter((entry) => entry.status === "expired").length,
    expirySkewSeconds: number(payload.expirySkewSeconds, `${field}.expirySkewSeconds`),
    entries,
  }
}

function sanitizeAccessTokenStatus(value: unknown, sessionIndex: number): GatewayAccessTokenCacheStatus {
  const field = `sessions[${sessionIndex}].athenzAccessTokens`
  const payload = record(value, field)
  const entries = array(payload.entries, `${field}.entries`).map((value, entryIndex) => {
    const entryField = `${field}.entries[${entryIndex}]`
    const entry = record(value, entryField)
    return {
      audiences: stringArray(entry.audiences, `${entryField}.audiences`),
      scope: string(entry.scope, `${entryField}.scope`),
      cachedAt: string(entry.cachedAt, `${entryField}.cachedAt`),
      expiresAt: string(entry.expiresAt, `${entryField}.expiresAt`),
      status: cacheEntryStatus(entry.status, `${entryField}.status`),
    }
  })

  return {
    entryCount: entries.length,
    usableEntryCount: entries.filter((entry) => entry.status === "valid").length,
    refreshRequiredEntryCount: entries.filter((entry) => entry.status === "refresh-required").length,
    expiredEntryCount: entries.filter((entry) => entry.status === "expired").length,
    expirySkewSeconds: number(payload.expirySkewSeconds, `${field}.expirySkewSeconds`),
    entries,
  }
}

function unavailable(configured: boolean, error: string): McpGatewayCacheStatus {
  return {
    configured,
    available: false,
    generatedAt: new Date().toISOString(),
    error,
  }
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`)
  return value as Record<string, unknown>
}

function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`)
  return value
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new Error(`${field} must be an array of strings`)
  }
  return value
}

function string(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} must be a string`)
  return value
}

function number(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${field} must be a number`)
  return value
}

function sessionStatus(value: unknown, field: string): SessionStatus {
  if (value === "valid" || value === "refresh-required") return value
  throw new Error(`${field} is invalid`)
}

function cacheEntryStatus(value: unknown, field: string): CacheEntryStatus {
  if (value === "valid" || value === "refresh-required" || value === "expired") return value
  throw new Error(`${field} is invalid`)
}
