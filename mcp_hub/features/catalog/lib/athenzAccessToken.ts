import { readFile } from "node:fs/promises"
import https from "node:https"
import path from "node:path"
import { auth } from "@/features/auth/lib/auth"

const DEFAULT_ZTS_URL = "https://localhost:8443/zts/v1"
const DEFAULT_ZTS_AUDIENCE = "https://athenz-zts-server.athenz:4443/zts/v1"
const TOKEN_EXPIRY_SKEW_MS = 60_000
const MAX_CACHED_TOKENS = 100

type AthenzTokenResponse = {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

type CachedToken = {
  token: string
  subject: string
  scope: string
  cachedAtMs: number
  expiresAtMs: number
}

export type McpAccessTokenCacheStatus = {
  generatedAt: string
  entryCount: number
  usableEntryCount: number
  refreshRequiredEntryCount: number
  expiredEntryCount: number
  maxEntries: number
  expirySkewSeconds: number
  entries: Array<{
    subject: string
    scope: string
    cachedAt: string
    expiresAt: string
    status: "valid" | "refresh-required" | "expired"
  }>
}

const cachedTokens = new Map<string, CachedToken>()

export async function getMcpAccessToken(): Promise<string | null> {
  const scope = (process.env.MCP_HUB_MCP_ACCESS_SCOPE ?? "").trim()
  if (!scope) return null

  const session = await auth()
  const idToken = session?.idToken
  const subject = session?.user?.subject ?? session?.user?.username
  if (!idToken || !subject) throw new Error("Authentication with the configured IdP is required")

  const now = Date.now()
  const cacheKey = `${subject}\u0000${scope}`
  const cachedToken = cachedTokens.get(cacheKey)
  if (cachedToken && cachedToken.expiresAtMs > now + TOKEN_EXPIRY_SKEW_MS) {
    return cachedToken.token
  }

  const tokenResponse = await requestAthenzAccessToken(scope, idToken)
  if (!tokenResponse.access_token) {
    const message = tokenResponse.error_description ?? tokenResponse.error ?? "ZTS did not return an access token"
    throw new Error(`Failed to issue a user-scoped MCP access token for ${scope}: ${message}`)
  }

  const expiresInSeconds = tokenResponse.expires_in ?? 3600
  pruneTokenCache(now)
  cachedTokens.set(cacheKey, {
    token: tokenResponse.access_token,
    subject,
    scope,
    cachedAtMs: now,
    expiresAtMs: now + expiresInSeconds * 1000,
  })

  return tokenResponse.access_token
}

export function getMcpAccessTokenCacheStatus(): McpAccessTokenCacheStatus {
  const now = Date.now()
  let usableEntryCount = 0
  let refreshRequiredEntryCount = 0
  let expiredEntryCount = 0

  const entries = Array.from(cachedTokens.values(), (cachedToken) => {
    let status: "valid" | "refresh-required" | "expired"
    if (cachedToken.expiresAtMs <= now) {
      status = "expired"
      expiredEntryCount += 1
    } else if (cachedToken.expiresAtMs <= now + TOKEN_EXPIRY_SKEW_MS) {
      status = "refresh-required"
      refreshRequiredEntryCount += 1
    } else {
      status = "valid"
      usableEntryCount += 1
    }

    return {
      subject: cachedToken.subject,
      scope: cachedToken.scope,
      cachedAt: new Date(cachedToken.cachedAtMs).toISOString(),
      expiresAt: new Date(cachedToken.expiresAtMs).toISOString(),
      status,
    }
  })

  return {
    generatedAt: new Date(now).toISOString(),
    entryCount: entries.length,
    usableEntryCount,
    refreshRequiredEntryCount,
    expiredEntryCount,
    maxEntries: MAX_CACHED_TOKENS,
    expirySkewSeconds: TOKEN_EXPIRY_SKEW_MS / 1000,
    entries,
  }
}

async function requestAthenzAccessToken(scope: string, idToken: string): Promise<AthenzTokenResponse> {
  const certPath = certFilePath("MCP_HUB_ATHENZ_CERT_PATH", "mcp-hub-ui.crt")
  const keyPath = certFilePath("MCP_HUB_ATHENZ_KEY_PATH", "mcp-hub-ui.key")
  const caPath = certFilePath("MCP_HUB_ATHENZ_CA_PATH", "ca.crt")
  const ztsUrl = (process.env.MCP_HUB_ZTS_URL ?? DEFAULT_ZTS_URL).replace(/\/+$/, "")
  const endpoint = `${ztsUrl}/oauth2/token`
  const audience = process.env.MCP_HUB_ZTS_AUDIENCE ?? DEFAULT_ZTS_AUDIENCE

  const [cert, key, ca] = await Promise.all([
    readFile(/* turbopackIgnore: true */ certPath),
    readFile(/* turbopackIgnore: true */ keyPath),
    readFile(/* turbopackIgnore: true */ caPath),
  ])
  const idJagBody = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    requested_token_type: "urn:ietf:params:oauth:token-type:id-jag",
    subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
    subject_token: idToken,
    scope,
    audience,
    expires_in: process.env.MCP_HUB_ACCESS_TOKEN_EXPIRES_IN ?? "3600",
  }).toString()

  const idJagResponse = await postForm(endpoint, idJagBody, cert, key, ca)
  if (!idJagResponse.access_token) {
    const message = idJagResponse.error_description ?? idJagResponse.error ?? "ZTS did not return an ID-JAG token"
    throw new Error(`Failed to exchange the IdP token for ID-JAG: ${message}`)
  }

  const accessTokenBody = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: idJagResponse.access_token,
    scope,
    expires_in: process.env.MCP_HUB_ACCESS_TOKEN_EXPIRES_IN ?? "3600",
  }).toString()

  return postForm(endpoint, accessTokenBody, cert, key, ca)
}

function pruneTokenCache(now: number) {
  for (const [key, value] of cachedTokens) {
    if (value.expiresAtMs <= now + TOKEN_EXPIRY_SKEW_MS) cachedTokens.delete(key)
  }

  while (cachedTokens.size >= MAX_CACHED_TOKENS) {
    const oldestKey = cachedTokens.keys().next().value as string | undefined
    if (!oldestKey) break
    cachedTokens.delete(oldestKey)
  }
}

function certFilePath(envName: string, fileName: string): string {
  const configuredPath = process.env[envName]
  if (configuredPath) return configuredPath

  const configuredDir = process.env.MCP_HUB_CERT_DIR
  if (configuredDir) return path.join(/* turbopackIgnore: true */ configuredDir, fileName)

  return path.join(process.cwd(), "certs", fileName)
}

function postForm(endpoint: string, body: string, cert: Buffer, key: Buffer, ca: Buffer): Promise<AthenzTokenResponse> {
  return new Promise((resolve, reject) => {
    const endpointUrl = new URL(endpoint)
    const tlsServerName = process.env.MCP_HUB_ZTS_TLS_SERVER_NAME
    const headers: Record<string, string | number> = {
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": Buffer.byteLength(body),
      Accept: "application/json",
    }
    if (tlsServerName) {
      headers.Host = endpointUrl.port
        ? `${tlsServerName}:${endpointUrl.port}`
        : tlsServerName
    }

    const request = https.request(
      endpointUrl,
      {
        method: "POST",
        cert,
        key,
        ca,
        servername: tlsServerName,
        rejectUnauthorized: process.env.MCP_HUB_ZTS_REJECT_UNAUTHORIZED === "true",
        headers,
        timeout: 10_000,
      },
      (response) => {
        let responseBody = ""
        response.setEncoding("utf8")
        response.on("data", (chunk) => {
          responseBody += chunk
        })
        response.on("end", () => {
          if (!response.statusCode || response.statusCode >= 400) {
            reject(new Error(`ZTS returned ${response.statusCode ?? "unknown"}: ${responseBody}`))
            return
          }

          try {
            const payload = JSON.parse(responseBody) as AthenzTokenResponse
            resolve(payload)
          } catch (error) {
            reject(error)
          }
        })
      },
    )

    request.on("timeout", () => {
      request.destroy(new Error("Timed out while requesting an MCP Hub access token from ZTS"))
    })
    request.on("error", reject)
    request.write(body)
    request.end()
  })
}
