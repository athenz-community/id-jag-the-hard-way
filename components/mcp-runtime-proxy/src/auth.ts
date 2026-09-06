import { createPublicKey, verify, type KeyObject } from "node:crypto"
import http from "node:http"
import https from "node:https"

const MAX_JWKS_BYTES = 1024 * 1024
const MAX_TOKEN_BYTES = 32 * 1024

type JwtRecord = Record<string, unknown>

export type SigningKeyResolver = (kid: string, forceRefresh?: boolean) => Promise<KeyObject>

export type VerifiedAthenzAccessToken = {
  audiences: string[]
  clientId?: string
  expiresAt: string
  expiresInSeconds: number
  keyId: string
  scopes: string[]
  subject?: string
  userId?: string
}

export type AthenzAccessTokenVerifier = {
  verify(authorization: string | undefined): Promise<VerifiedAthenzAccessToken | void>
}

export class AccessTokenError extends Error {
  readonly status: 401 | 403
  readonly code: "missing_access_token" | "invalid_access_token" | "insufficient_scope"

  constructor(
    status: 401 | 403,
    code: "missing_access_token" | "invalid_access_token" | "insufficient_scope",
    message: string,
  ) {
    super(message)
    this.status = status
    this.code = code
  }
}

export class JwksUnavailableError extends Error {}

export function createAthenzAccessTokenVerifier({
  expectedAudience,
  now = Date.now,
  requiredScope,
  resolveSigningKey,
}: {
  expectedAudience: string
  now?: () => number
  requiredScope: string
  resolveSigningKey: SigningKeyResolver
}): AthenzAccessTokenVerifier {
  if (!validAthenzName(expectedAudience)) throw new Error("ATHENZ_EXPECTED_AUDIENCE is invalid")
  const rolePrefix = `${expectedAudience}:role.`
  if (!requiredScope.startsWith(rolePrefix) || !validAthenzName(requiredScope.slice(rolePrefix.length))) {
    throw new Error("ATHENZ_REQUIRED_SCOPE must be a role in ATHENZ_EXPECTED_AUDIENCE")
  }
  const shortScope = requiredScope.slice(rolePrefix.length)

  return {
    async verify(authorization) {
      const token = bearerToken(authorization)
      const parsed = parseJwt(token)
      let signingKey = await resolveSigningKey(parsed.header.kid)
      let signatureValid = verifySignature(parsed, signingKey)
      if (!signatureValid) {
        signingKey = await resolveSigningKey(parsed.header.kid, true)
        signatureValid = verifySignature(parsed, signingKey)
      }
      if (!signatureValid) throw invalidToken()

      const currentTime = Math.floor(now() / 1000)
      if (!Number.isFinite(parsed.claims.exp) || typeof parsed.claims.exp !== "number" || parsed.claims.exp <= currentTime) {
        throw invalidToken()
      }
      if (parsed.claims.nbf !== undefined && (
        typeof parsed.claims.nbf !== "number"
        || !Number.isFinite(parsed.claims.nbf)
        || parsed.claims.nbf > currentTime
      )) {
        throw invalidToken()
      }

      const audiences = tokenAudiences(parsed.claims.aud)
      if (!audiences.includes(expectedAudience)) throw invalidToken()

      const scopes = tokenScopes(parsed.claims)
      const hasRequiredScope = scopes.has(requiredScope)
        || (audiences.length === 1 && scopes.has(shortScope))
      if (!hasRequiredScope) {
        throw new AccessTokenError(
          403,
          "insufficient_scope",
          `The Athenz access token must grant ${requiredScope}.`,
        )
      }

      return {
        audiences: [...audiences].sort(),
        clientId: stringClaim(parsed.claims.client_id),
        expiresAt: new Date(parsed.claims.exp * 1000).toISOString(),
        expiresInSeconds: parsed.claims.exp - currentTime,
        keyId: parsed.header.kid,
        scopes: [...scopes].sort(),
        subject: stringClaim(parsed.claims.sub),
        userId: stringClaim(parsed.claims.uid),
      }
    },
  }
}

export function createRemoteJwksKeyResolver({
  allowInsecureHttp = false,
  ca,
  cacheTtlMs = 5 * 60 * 1000,
  jwksUrl,
  timeoutMs = 5000,
}: {
  allowInsecureHttp?: boolean
  ca?: Buffer
  cacheTtlMs?: number
  jwksUrl: URL
  timeoutMs?: number
}): SigningKeyResolver {
  if (jwksUrl.username || jwksUrl.password) throw new Error("ATHENZ_JWKS_URL must not contain credentials")
  if (jwksUrl.protocol !== "https:" && !(allowInsecureHttp && jwksUrl.protocol === "http:")) {
    throw new Error("ATHENZ_JWKS_URL must use https")
  }
  if (!Number.isFinite(cacheTtlMs) || cacheTtlMs <= 0) throw new Error("JWKS cache TTL must be positive")
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("JWKS timeout must be positive")

  let cache: { expiresAt: number; keys: Map<string, KeyObject> } | undefined
  let pending: Promise<Map<string, KeyObject>> | undefined

  async function load(forceRefresh: boolean) {
    if (!forceRefresh && cache && cache.expiresAt > Date.now()) return cache.keys
    if (!pending) {
      const endpoint = new URL(jwksUrl)
      if (forceRefresh) endpoint.searchParams.set("r", "1")
      pending = fetchJwks(endpoint, { ca, timeoutMs })
        .then((keys) => {
          cache = { expiresAt: Date.now() + cacheTtlMs, keys }
          return keys
        })
        .finally(() => { pending = undefined })
    }
    return pending
  }

  return async (kid, forceRefresh = false) => {
    let keys = await load(forceRefresh)
    let key = keys.get(kid)
    if (!key && !forceRefresh) {
      keys = await load(true)
      key = keys.get(kid)
    }
    if (!key) throw invalidToken()
    return key
  }
}

function bearerToken(authorization: string | undefined) {
  if (!authorization) {
    throw new AccessTokenError(
      401,
      "missing_access_token",
      "Pass an Athenz access token as Authorization: Bearer <token>.",
    )
  }
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(authorization)
  if (!match || Buffer.byteLength(match[1]) > MAX_TOKEN_BYTES) throw invalidToken()
  return match[1]
}

function parseJwt(token: string) {
  const [encodedHeader, encodedClaims, encodedSignature] = token.split(".")
  const header = decodeRecord(encodedHeader)
  const claims = decodeRecord(encodedClaims)
  if (header.alg !== "RS256" || header.typ !== "at+jwt" || typeof header.kid !== "string" || !header.kid) {
    throw invalidToken()
  }

  let signature: Buffer
  try {
    signature = Buffer.from(encodedSignature, "base64url")
  } catch {
    throw invalidToken()
  }
  if (signature.length === 0) throw invalidToken()

  return {
    claims,
    header: { kid: header.kid },
    signature,
    signingInput: Buffer.from(`${encodedHeader}.${encodedClaims}`, "ascii"),
  }
}

function verifySignature(
  token: ReturnType<typeof parseJwt>,
  signingKey: KeyObject,
) {
  try {
    return verify("RSA-SHA256", token.signingInput, signingKey, token.signature)
  } catch {
    return false
  }
}

function decodeRecord(value: string) {
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown
    if (decoded && typeof decoded === "object" && !Array.isArray(decoded)) return decoded as JwtRecord
  } catch {
    // Return the stable token error below.
  }
  throw invalidToken()
}

function tokenAudiences(value: unknown) {
  const audiences = typeof value === "string"
    ? [value]
    : Array.isArray(value) && value.every((audience) => typeof audience === "string")
      ? value
      : []
  const normalized = [...new Set(audiences.map((audience) => audience.trim()).filter(Boolean))]
  if (normalized.length === 0) throw invalidToken()
  return normalized
}

function tokenScopes(claims: JwtRecord) {
  const scopes = new Set<string>()
  for (const value of [claims.scp, claims.scope]) {
    if (value === undefined) continue
    if (typeof value === "string") {
      for (const scope of value.split(/\s+/)) if (scope) scopes.add(scope)
      continue
    }
    if (Array.isArray(value) && value.every((scope) => typeof scope === "string")) {
      for (const scope of value) if (scope) scopes.add(scope)
      continue
    }
    throw invalidToken()
  }
  return scopes
}

async function fetchJwks(endpoint: URL, { ca, timeoutMs }: { ca?: Buffer; timeoutMs: number }) {
  let payload: unknown
  try {
    payload = await requestJson(endpoint, ca, timeoutMs)
  } catch (error) {
    throw new JwksUnavailableError(
      `Unable to load ZTS JWKS: ${error instanceof Error ? error.message : "request failed"}`,
    )
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new JwksUnavailableError("ZTS returned an invalid JWKS document")
  }
  const configuredKeys = (payload as { keys?: unknown }).keys
  if (!Array.isArray(configuredKeys)) throw new JwksUnavailableError("ZTS returned an invalid JWKS document")

  const keys = new Map<string, KeyObject>()
  for (const value of configuredKeys) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue
    const jwk = value as JsonWebKey
    if (
      typeof jwk.kid !== "string"
      || !jwk.kid
      || jwk.kty !== "RSA"
      || (jwk.use !== undefined && jwk.use !== "sig")
      || (jwk.alg !== undefined && jwk.alg !== "RS256")
      || typeof jwk.n !== "string"
      || typeof jwk.e !== "string"
    ) continue
    if (keys.has(jwk.kid)) throw new JwksUnavailableError("ZTS JWKS contains duplicate signing key IDs")
    try {
      keys.set(jwk.kid, createPublicKey({ key: jwk, format: "jwk" }))
    } catch {
      throw new JwksUnavailableError("ZTS JWKS contains an invalid RSA signing key")
    }
  }
  if (keys.size === 0) throw new JwksUnavailableError("ZTS JWKS contains no supported signing keys")
  return keys
}

function requestJson(endpoint: URL, ca: Buffer | undefined, timeoutMs: number) {
  return new Promise<unknown>((resolve, reject) => {
    const transport = endpoint.protocol === "https:" ? https : http
    const request = transport.request(endpoint, {
      method: "GET",
      ...(endpoint.protocol === "https:" ? { ca } : {}),
      headers: { Accept: "application/json" },
      timeout: timeoutMs,
    }, (response) => {
      let body = ""
      let bytes = 0
      response.setEncoding("utf8")
      response.on("data", (chunk: string) => {
        bytes += Buffer.byteLength(chunk)
        if (bytes > MAX_JWKS_BYTES) {
          response.destroy(new Error("JWKS response exceeded the size limit"))
          return
        }
        body += chunk
      })
      response.on("end", () => {
        if (response.statusCode !== 200) {
          reject(new Error(`ZTS returned HTTP ${response.statusCode ?? "unknown"}`))
          return
        }
        try {
          resolve(JSON.parse(body) as unknown)
        } catch {
          reject(new Error("ZTS returned invalid JWKS JSON"))
        }
      })
      response.on("error", reject)
    })
    request.on("timeout", () => request.destroy(new Error("ZTS JWKS request timed out")))
    request.on("error", reject)
    request.end()
  })
}

function invalidToken() {
  return new AccessTokenError(
    401,
    "invalid_access_token",
    "The Athenz access token is invalid or expired.",
  )
}

function validAthenzName(value: string) {
  return /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(value)
}

function stringClaim(value: unknown) {
  return typeof value === "string" && value ? value : undefined
}
