import { createPublicKey, verify, type KeyObject } from "node:crypto"

export type AuthContext = {
  audience: string
  clientId: string
  project: string
  scope: string
  subject: string
}

export type TokenVerifier = (authorization: string | undefined) => AuthContext

type TokenVerifierOptions = {
  publicKey: string | Buffer | KeyObject
  audiencePrefix?: string
  requiredScope?: string
  now?: () => number
}

export class AccessTokenError extends Error {
  readonly statusCode: 401 | 403
  readonly code: "missing_access_token" | "invalid_access_token" | "insufficient_scope"

  constructor(
    statusCode: 401 | 403,
    code: "missing_access_token" | "invalid_access_token" | "insufficient_scope",
    message: string,
  ) {
    super(message)
    this.statusCode = statusCode
    this.code = code
  }
}

export function createTokenVerifier(options: TokenVerifierOptions): TokenVerifier {
  const publicKey = options.publicKey instanceof Object && "type" in options.publicKey
    ? options.publicKey as KeyObject
    : createPublicKey(options.publicKey)
  const audiencePrefix = options.audiencePrefix ?? "gen-ai.services."
  const requiredScope = options.requiredScope ?? "gen-ai-users"
  const now = options.now ?? (() => Math.floor(Date.now() / 1000))

  return (authorization) => {
    const token = bearerToken(authorization)
    const segments = token.split(".")
    if (segments.length !== 3 || segments.some((segment) => !/^[A-Za-z0-9_-]+$/.test(segment))) {
      throw invalidToken()
    }

    const header = decodeJsonSegment(segments[0])
    const claims = decodeJsonSegment(segments[1])
    if (header.alg !== "RS256" || header.typ !== "at+jwt") {
      throw invalidToken()
    }
    if (!verify(
      "RSA-SHA256",
      Buffer.from(`${segments[0]}.${segments[1]}`),
      publicKey,
      Buffer.from(segments[2], "base64url"),
    )) {
      throw invalidToken()
    }

    const currentTime = now()
    if (!isNumericDate(claims.exp) || currentTime >= claims.exp) {
      throw invalidToken()
    }
    if (claims.nbf !== undefined && (!isNumericDate(claims.nbf) || currentTime < claims.nbf)) {
      throw invalidToken()
    }

    const audience = tokenAudience(claims.aud, audiencePrefix)
    const project = audience.slice(audiencePrefix.length)
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(project)) {
      throw invalidToken()
    }

    const subject = typeof claims.sub === "string" ? claims.sub : ""
    if (!subject.startsWith("user.") || subject.length <= "user.".length) {
      throw invalidToken()
    }
    const clientId = typeof claims.client_id === "string" ? claims.client_id : ""
    if (!clientId) throw invalidToken()
    if (!tokenScopes(claims).has(requiredScope)) {
      throw new AccessTokenError(403, "insufficient_scope", `The access token must grant ${requiredScope}.`)
    }

    return {
      audience,
      clientId,
      project,
      scope: `${audience}:role.${requiredScope}`,
      subject,
    }
  }
}

function bearerToken(value: string | undefined) {
  const match = /^Bearer\s+(\S+)$/i.exec(value?.trim() ?? "")
  if (!match) {
    throw new AccessTokenError(401, "missing_access_token", "Pass an Athenz access token as Authorization: Bearer <token>.")
  }
  return match[1]
}

function decodeJsonSegment(segment: string): Record<string, unknown> {
  if (segment.length > 32_768) throw invalidToken()
  try {
    const value = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"))
    if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidToken()
    return value
  } catch (error) {
    if (error instanceof AccessTokenError) throw error
    throw invalidToken()
  }
}

function tokenAudience(value: unknown, prefix: string) {
  const audiences = typeof value === "string"
    ? [value]
    : Array.isArray(value) && value.every((item) => typeof item === "string")
      ? value
      : []
  const matching = audiences.filter((audience) => audience.startsWith(prefix))
  if (audiences.length !== 1 || matching.length !== 1) throw invalidToken()
  return matching[0]
}

function tokenScopes(claims: Record<string, unknown>) {
  const scopes = new Set<string>()
  for (const claim of [claims.scp, claims.scope]) {
    if (typeof claim === "string") {
      for (const scope of claim.split(/\s+/)) if (scope) scopes.add(scope)
    } else if (Array.isArray(claim)) {
      for (const scope of claim) if (typeof scope === "string" && scope) scopes.add(scope)
    }
  }
  return scopes
}

function isNumericDate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function invalidToken() {
  return new AccessTokenError(401, "invalid_access_token", "The Athenz access token is invalid or expired.")
}
