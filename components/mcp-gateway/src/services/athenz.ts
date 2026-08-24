import { readFile } from "node:fs/promises"
import https from "node:https"
import {
  ATHENZ_ACCESS_TOKEN_EXPIRES_IN,
  ATHENZ_CA_PATH,
  ATHENZ_CERT_PATH,
  ATHENZ_KEY_PATH,
  ATHENZ_REJECT_UNAUTHORIZED,
  ATHENZ_REQUEST_TIMEOUT_MS,
  ATHENZ_TLS_SERVER_NAME,
  ATHENZ_ZTS_AUDIENCE,
  ATHENZ_ZTS_URL,
} from "../config/env.js"
import type { GatewaySession } from "../utils/sessionStore.js"

const TOKEN_EXPIRY_SKEW_MS = 60_000

type AthenzTokenResponse = {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

type CachedAccessToken = {
  token: string
  cachedAtMs: number
  expiresAtMs: number
}

export type AthenzAccessTokenCacheStatus = {
  entryCount: number
  usableEntryCount: number
  refreshRequiredEntryCount: number
  expiredEntryCount: number
  expirySkewSeconds: number
  entries: Array<{
    scope: string
    cachedAt: string
    expiresAt: string
    status: "valid" | "refresh-required" | "expired"
  }>
}

export type PostTokenForm = (body: URLSearchParams) => Promise<AthenzTokenResponse>

export class AthenzAccessTokenManager {
  private readonly cachedTokens = new WeakMap<GatewaySession, Map<string, CachedAccessToken>>()
  private readonly inFlight = new WeakMap<GatewaySession, Map<string, Promise<string>>>()

  constructor(private readonly postTokenForm: PostTokenForm = postFormToZts) {}

  async getAccessToken(session: GatewaySession, scope: string) {
    const normalizedScope = normalizeScope(scope)
    const now = Date.now()
    const cached = this.cachedTokens.get(session)?.get(normalizedScope)
    if (cached && cached.expiresAtMs > now + TOKEN_EXPIRY_SKEW_MS) return cached.token

    const pending = this.inFlight.get(session)?.get(normalizedScope)
    if (pending) return pending

    const issuance = this.issueAccessToken(session, normalizedScope)
    const sessionRequests = this.inFlight.get(session) ?? new Map<string, Promise<string>>()
    sessionRequests.set(normalizedScope, issuance)
    this.inFlight.set(session, sessionRequests)

    try {
      return await issuance
    } finally {
      sessionRequests.delete(normalizedScope)
    }
  }

  getCacheStatus(session: GatewaySession): AthenzAccessTokenCacheStatus {
    const now = Date.now()
    let usableEntryCount = 0
    let refreshRequiredEntryCount = 0
    let expiredEntryCount = 0
    const entries = Array.from(this.cachedTokens.get(session)?.entries() ?? [], ([scope, cachedToken]) => {
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
        scope,
        cachedAt: new Date(cachedToken.cachedAtMs).toISOString(),
        expiresAt: new Date(cachedToken.expiresAtMs).toISOString(),
        status,
      }
    })

    return {
      entryCount: entries.length,
      usableEntryCount,
      refreshRequiredEntryCount,
      expiredEntryCount,
      expirySkewSeconds: TOKEN_EXPIRY_SKEW_MS / 1000,
      entries,
    }
  }

  private async issueAccessToken(session: GatewaySession, scope: string) {
    const idJagResponse = await this.postTokenForm(new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      requested_token_type: "urn:ietf:params:oauth:token-type:id-jag",
      subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
      subject_token: session.idToken,
      scope,
      audience: ATHENZ_ZTS_AUDIENCE,
      expires_in: String(ATHENZ_ACCESS_TOKEN_EXPIRES_IN),
    }))
    const idJag = requireAccessToken(idJagResponse, "ID-JAG")

    const accessTokenResponse = await this.postTokenForm(new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: idJag,
      scope,
      expires_in: String(ATHENZ_ACCESS_TOKEN_EXPIRES_IN),
    }))
    const accessToken = requireAccessToken(accessTokenResponse, "Athenz access token")
    const now = Date.now()
    const expiresInSeconds = accessTokenResponse.expires_in ?? ATHENZ_ACCESS_TOKEN_EXPIRES_IN
    const expiresAtMs = Math.min(now + expiresInSeconds * 1000, session.expiresAt * 1000)
    const sessionTokens = this.cachedTokens.get(session) ?? new Map<string, CachedAccessToken>()
    sessionTokens.set(scope, { token: accessToken, cachedAtMs: now, expiresAtMs })
    this.cachedTokens.set(session, sessionTokens)
    return accessToken
  }
}

export const athenzAccessTokenManager = new AthenzAccessTokenManager()

function normalizeScope(scope: string) {
  const values = scope.trim().split(/\s+/).filter(Boolean)
  if (values.length === 0) throw new Error("An Athenz scope is required for MCP forwarding")
  return [...new Set(values)].sort().join(" ")
}

function requireAccessToken(response: AthenzTokenResponse, tokenName: string) {
  if (response.access_token) return response.access_token
  const detail = response.error_description ?? response.error ?? "ZTS returned no access_token"
  throw new Error(`Failed to obtain ${tokenName}: ${detail}`)
}

let credentialsPromise: Promise<{ cert: Buffer; key: Buffer; ca: Buffer }> | undefined

async function postFormToZts(body: URLSearchParams): Promise<AthenzTokenResponse> {
  const credentials = await loadCredentials()
  const endpoint = new URL(`${ATHENZ_ZTS_URL}/oauth2/token`)
  const encodedBody = body.toString()

  return new Promise((resolve, reject) => {
    const request = https.request(
      endpoint,
      {
        method: "POST",
        cert: credentials.cert,
        key: credentials.key,
        ca: credentials.ca,
        servername: ATHENZ_TLS_SERVER_NAME,
        rejectUnauthorized: ATHENZ_REJECT_UNAUTHORIZED,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(encodedBody),
        },
        timeout: ATHENZ_REQUEST_TIMEOUT_MS,
      },
      (response) => {
        let responseBody = ""
        response.setEncoding("utf8")
        response.on("data", (chunk) => {
          responseBody += chunk
        })
        response.on("end", () => {
          if (!response.statusCode || response.statusCode >= 400) {
            reject(new Error(`ZTS returned ${response.statusCode ?? "unknown"}: ${responseBody.slice(0, 1000)}`))
            return
          }

          try {
            resolve(JSON.parse(responseBody) as AthenzTokenResponse)
          } catch (error) {
            reject(error)
          }
        })
      },
    )

    request.on("timeout", () => request.destroy(new Error("Timed out while requesting a token from Athenz ZTS")))
    request.on("error", reject)
    request.write(encodedBody)
    request.end()
  })
}

function loadCredentials() {
  credentialsPromise ??= Promise.all([
    readFile(ATHENZ_CERT_PATH),
    readFile(ATHENZ_KEY_PATH),
    readFile(ATHENZ_CA_PATH),
  ]).then(([cert, key, ca]) => ({ cert, key, ca }))
  return credentialsPromise
}
