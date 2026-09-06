import { readFile } from "node:fs/promises"
import https from "node:https"
import { decodeJwt } from "jose"
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
  scope?: string
  error?: string
  error_description?: string
}

type CachedAccessToken = {
  token: string
  audiences: string[]
  cachedAtMs: number
  expiresAtMs: number
  scopes: string[]
}

type CachedIdJag = {
  token: string
  audiences: string[]
  cachedAtMs: number
  expiresAtMs: number
  scopes: string[]
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

export type AthenzIdJagCacheStatus = {
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
    status: "valid" | "refresh-required" | "expired"
  }>
}

export type PostTokenForm = (body: URLSearchParams) => Promise<AthenzTokenResponse>

export class ReauthenticationRequiredError extends Error {}

export class AthenzInsufficientScopeError extends Error {
  constructor(
    readonly requestedScopes: string[],
    readonly grantedScopes: string[],
    tokenName: string,
  ) {
    super(
      `${tokenName} granted scopes [${grantedScopes.join(" ")}] do not cover requested scopes [${requestedScopes.join(" ")}]`,
    )
  }
}

export class AthenzAccessTokenManager {
  private readonly cachedTokens = new WeakMap<GatewaySession, Map<string, CachedAccessToken>>()
  private readonly cachedIdJags = new WeakMap<GatewaySession, Map<string, CachedIdJag>>()
  private readonly inFlight = new WeakMap<GatewaySession, Map<string, Promise<string>>>()

  constructor(
    private readonly postTokenForm: PostTokenForm = postFormToZts,
    private readonly now: () => number = Date.now,
  ) {}

  async getAccessToken(session: GatewaySession, scope: string) {
    const normalizedScope = normalizeScope(scope)
    const requestedScopes = scopeValues(normalizedScope)
    const cached = this.findAccessToken(session, requestedScopes)
    if (cached) return cached.token

    const requestKey = cacheKey([ATHENZ_ZTS_AUDIENCE], requestedScopes)
    const pending = this.inFlight.get(session)?.get(requestKey)
    if (pending) return pending

    const issuance = this.issueAccessToken(session, requestedScopes)
    const sessionRequests = this.inFlight.get(session) ?? new Map<string, Promise<string>>()
    sessionRequests.set(requestKey, issuance)
    this.inFlight.set(session, sessionRequests)

    try {
      return await issuance
    } finally {
      sessionRequests.delete(requestKey)
    }
  }

  getCacheStatus(session: GatewaySession): AthenzAccessTokenCacheStatus {
    const now = this.now()
    let usableEntryCount = 0
    let refreshRequiredEntryCount = 0
    let expiredEntryCount = 0
    const entries = Array.from(this.cachedTokens.get(session)?.values() ?? [], (cachedToken) => {
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
        scope: cachedToken.scopes.join(" "),
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

  getIdJagCacheStatus(session: GatewaySession): AthenzIdJagCacheStatus {
    const now = this.now()
    let usableEntryCount = 0
    let refreshRequiredEntryCount = 0
    let expiredEntryCount = 0
    const entries = Array.from(this.cachedIdJags.get(session)?.values() ?? [], (cachedIdJag) => {
      let status: "valid" | "refresh-required" | "expired"
      if (cachedIdJag.expiresAtMs <= now) {
        status = "expired"
        expiredEntryCount += 1
      } else if (cachedIdJag.expiresAtMs <= now + TOKEN_EXPIRY_SKEW_MS) {
        status = "refresh-required"
        refreshRequiredEntryCount += 1
      } else {
        status = "valid"
        usableEntryCount += 1
      }

      return {
        audiences: [...cachedIdJag.audiences],
        scope: cachedIdJag.scopes.join(" "),
        cachedAt: new Date(cachedIdJag.cachedAtMs).toISOString(),
        expiresAt: new Date(cachedIdJag.expiresAtMs).toISOString(),
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

  private findAccessToken(session: GatewaySession, requestedScopes: string[]) {
    const cache = this.cachedTokens.get(session)
    if (!cache) return undefined

    const now = this.now()
    for (const [key, entry] of cache) {
      if (entry.expiresAtMs <= now + TOKEN_EXPIRY_SKEW_MS) {
        cache.delete(key)
        continue
      }
      if (
        audiencesExactlyMatch(entry.audiences, requestedAudiences(requestedScopes))
        && scopesExactlyMatch(entry.scopes, requestedScopes)
      ) return entry
    }
    return undefined
  }

  private findIdJag(session: GatewaySession, requestedScopes: string[]) {
    const cache = this.cachedIdJags.get(session)
    if (!cache) return undefined

    const now = this.now()
    const matches: CachedIdJag[] = []
    for (const [key, entry] of cache) {
      if (entry.expiresAtMs <= now + TOKEN_EXPIRY_SKEW_MS) {
        cache.delete(key)
        continue
      }
      if (entry.audiences.includes(ATHENZ_ZTS_AUDIENCE) && scopesCover(entry.scopes, requestedScopes)) {
        matches.push(entry)
      }
    }
    return matches.sort((left, right) => left.scopes.length - right.scopes.length)[0]
  }

  private async issueAccessToken(session: GatewaySession, requestedScopes: string[]) {
    const scope = requestedScopes.join(" ")
    const cachedIdJag = this.findIdJag(session, requestedScopes)
    const idJag = cachedIdJag?.token ?? await this.issueIdJag(session, requestedScopes)

    const accessTokenResponse = await this.postTokenForm(new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: idJag,
      scope,
      expires_in: String(ATHENZ_ACCESS_TOKEN_EXPIRES_IN),
    }))
    const grant = tokenGrant(accessTokenResponse, "Athenz access token", this.now(), session.expiresAt, true)
    const expectedAudiences = requestedAudiences(requestedScopes)
    if (!audiencesExactlyMatch(grant.audiences, expectedAudiences)) {
      throw new Error(
        `Athenz access token audience [${grant.audiences.join(" ")}] does not match requested audience [${expectedAudiences.join(" ")}]`,
      )
    }
    const sessionTokens = this.cachedTokens.get(session) ?? new Map<string, CachedAccessToken>()
    sessionTokens.set(cacheKey(grant.audiences, grant.scopes), {
      token: grant.token,
      audiences: grant.audiences,
      cachedAtMs: this.now(),
      expiresAtMs: grant.expiresAtMs,
      scopes: grant.scopes,
    })
    this.cachedTokens.set(session, sessionTokens)
    if (!scopesExactlyMatch(grant.scopes, requestedScopes)) {
      throw new AthenzInsufficientScopeError(requestedScopes, grant.scopes, "Athenz access token")
    }
    return grant.token
  }

  private async issueIdJag(session: GatewaySession, requestedScopes: string[]) {
    if (session.idTokenExpiresAt * 1000 <= this.now() + TOKEN_EXPIRY_SKEW_MS) {
      throw new ReauthenticationRequiredError("A fresh identity-provider ID token is required")
    }

    let idJagResponse: AthenzTokenResponse
    try {
      idJagResponse = await this.postTokenForm(new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        requested_token_type: "urn:ietf:params:oauth:token-type:id-jag",
        subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
        subject_token: session.idToken,
        scope: requestedScopes.join(" "),
        audience: ATHENZ_ZTS_AUDIENCE,
        expires_in: String(ATHENZ_ACCESS_TOKEN_EXPIRES_IN),
      }))
    } catch (error) {
      if (isIdentityTokenFailure(error)) {
        throw new ReauthenticationRequiredError("The identity-provider ID token can no longer issue an ID-JAG")
      }
      throw error
    }

    if (isIdentityTokenFailure(idJagResponse)) {
      throw new ReauthenticationRequiredError("The identity-provider ID token can no longer issue an ID-JAG")
    }

    const grant = tokenGrant(idJagResponse, "ID-JAG", this.now(), session.expiresAt, true)
    if (!grant.audiences.includes(ATHENZ_ZTS_AUDIENCE)) {
      throw new Error(
        `ID-JAG audience [${grant.audiences.join(" ")}] does not include requested audience [${ATHENZ_ZTS_AUDIENCE}]`,
      )
    }

    const cache = this.cachedIdJags.get(session) ?? new Map<string, CachedIdJag>()
    cache.set(cacheKey(grant.audiences, grant.scopes), {
      token: grant.token,
      audiences: grant.audiences,
      cachedAtMs: this.now(),
      expiresAtMs: grant.expiresAtMs,
      scopes: grant.scopes,
    })
    this.cachedIdJags.set(session, cache)
    if (!scopesCover(grant.scopes, requestedScopes)) {
      throw new AthenzInsufficientScopeError(requestedScopes, grant.scopes, "ID-JAG")
    }
    return grant.token
  }
}

export const athenzAccessTokenManager = new AthenzAccessTokenManager()

function normalizeScope(scope: string) {
  const values = scopeValues(scope)
  if (values.length === 0) throw new Error("An Athenz scope is required for MCP forwarding")
  return values.join(" ")
}

function scopeValues(scope: string) {
  return [...new Set(scope.trim().split(/\s+/).filter(Boolean))].sort()
}

function tokenGrant(
  response: AthenzTokenResponse,
  tokenName: string,
  now: number,
  sessionExpiresAt: number,
  requireAudience = false,
) {
  const token = requireAccessToken(response, tokenName)
  let claims
  try {
    claims = decodeJwt(token)
  } catch (error) {
    throw new Error(`Failed to decode ${tokenName}: ${error instanceof Error ? error.message : "invalid JWT"}`)
  }

  const scopes = tokenScopes(claims, tokenName)
  if (response.scope !== undefined && !scopesExactlyMatch(scopes, scopeValues(response.scope))) {
    throw new Error(`${tokenName} response scope does not match the token's granted scope`)
  }

  const audiences = tokenAudiences(claims.aud, tokenName, requireAudience)
  if (typeof claims.exp !== "number" || !Number.isFinite(claims.exp)) {
    throw new Error(`${tokenName} does not contain a valid exp claim`)
  }
  const expiresIn = validExpiresIn(response.expires_in, tokenName)
  const responseExpiresAt = expiresIn === undefined
    ? Number.POSITIVE_INFINITY
    : now + expiresIn * 1000
  const expiresAtMs = Math.min(claims.exp * 1000, responseExpiresAt, sessionExpiresAt * 1000)
  if (expiresAtMs <= now + TOKEN_EXPIRY_SKEW_MS) {
    throw new Error(`${tokenName} is expired or too close to expiry`)
  }

  return { token, audiences, scopes, expiresAtMs }
}

function requireAccessToken(response: AthenzTokenResponse, tokenName: string) {
  if (response.access_token) return response.access_token
  const detail = response.error_description ?? response.error ?? "ZTS returned no access_token"
  throw new Error(`Failed to obtain ${tokenName}: ${detail}`)
}

function tokenScopes(claims: ReturnType<typeof decodeJwt>, tokenName: string) {
  for (const name of ["scp", "scope"] as const) {
    const value = claims[name]
    if (typeof value === "string") {
      const scopes = scopeValues(value)
      if (scopes.length > 0) return scopes
    }
    if (Array.isArray(value) && value.every((scope) => typeof scope === "string")) {
      const scopes = scopeValues(value.join(" "))
      if (scopes.length > 0) return scopes
    }
  }
  throw new Error(`${tokenName} does not contain valid scp or scope claims`)
}

function tokenAudiences(value: unknown, tokenName: string, required: boolean) {
  const audiences = typeof value === "string"
    ? [value]
    : Array.isArray(value) && value.every((audience) => typeof audience === "string")
      ? value
      : []
  const normalized = [...new Set(audiences.map((audience) => audience.trim()).filter(Boolean))].sort()
  if (required && normalized.length === 0) throw new Error(`${tokenName} does not contain a valid aud claim`)
  return normalized
}

function validExpiresIn(value: number | undefined, tokenName: string) {
  if (value === undefined) return undefined
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${tokenName} response contains an invalid expires_in`)
  return value
}

function scopesCover(granted: string[], requested: string[]) {
  const available = [...granted]
  return requested.every((scope) => {
    const match = available.findIndex((candidate) => equivalentScope(candidate, scope))
    if (match < 0) return false
    available.splice(match, 1)
    return true
  })
}

function scopesExactlyMatch(left: string[], right: string[]) {
  return left.length === right.length && scopesCover(left, right)
}

function equivalentScope(left: string, right: string) {
  return left === right || roleName(left) === right || roleName(right) === left
}

function roleName(scope: string) {
  const marker = ":role."
  const index = scope.indexOf(marker)
  return index >= 0 ? scope.slice(index + marker.length) : undefined
}

function requestedAudiences(scopes: string[]) {
  return [...new Set(scopes.map((scope) => {
    const marker = ":role."
    const index = scope.indexOf(marker)
    if (index <= 0 || index + marker.length === scope.length) {
      throw new Error(`Athenz scope must be fully qualified as <domain>:role.<role>: ${scope}`)
    }
    return scope.slice(0, index)
  }))].sort()
}

function audiencesExactlyMatch(left: string[], right: string[]) {
  return left.length === right.length && left.every((audience, index) => audience === right[index])
}

function cacheKey(audiences: string[], scopes: string[]) {
  return JSON.stringify([audiences, scopes])
}

function isIdentityTokenFailure(value: unknown) {
  const code = value instanceof AthenzTokenEndpointError
    ? value.errorCode
    : typeof value === "object" && value !== null && "error" in value
      ? String(value.error)
      : ""
  const message = value instanceof Error
    ? value.message
    : typeof value === "object" && value !== null && "error_description" in value
      ? String(value.error_description)
      : ""
  return code === "invalid_grant"
    || code === "invalid_token"
    || /(?:id|subject)[-_ ]?token.*(?:expired|invalid)|(?:expired|invalid).*(?:id|subject)[-_ ]?token/i.test(message)
}

class AthenzTokenEndpointError extends Error {
  constructor(
    readonly statusCode: number,
    readonly errorCode: string,
    detail: string,
  ) {
    super(`ZTS returned ${statusCode}: ${detail}`)
  }
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
            const statusCode = response.statusCode ?? 0
            let errorCode = ""
            let detail = responseBody.slice(0, 1000)
            try {
              const parsed = JSON.parse(responseBody) as {
                error?: unknown
                error_description?: unknown
                message?: unknown
              }
              errorCode = typeof parsed.error === "string" ? parsed.error : ""
              detail = [parsed.error_description, parsed.message, parsed.error]
                .find((value): value is string => typeof value === "string" && value.length > 0)
                ?? detail
            } catch {
              // Keep the bounded response text when ZTS did not return JSON.
            }
            reject(new AthenzTokenEndpointError(statusCode, errorCode, detail))
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
