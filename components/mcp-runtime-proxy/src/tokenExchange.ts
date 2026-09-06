import { randomUUID } from "node:crypto"
import { mkdir, open, readFile, rename, rm } from "node:fs/promises"
import https from "node:https"
import { join } from "node:path"

const MAX_TOKEN_RESPONSE_BYTES = 64 * 1024
const MAX_SCOPE_BYTES = 8 * 1024

export const MCP_ACCESS_TOKEN_FILE_META_KEY = "mcp.idthw.dev/access-token-file"
export const MCP_DOWNSTREAM_SCOPE_HEADER = "x-idthw-mcp-downstream-scope"

export type ToolAccessTokenPublication = {
  filePath: string
  remove(): Promise<void>
}

export type ToolAccessTokenPublisher = {
  publish(input: {
    requestId: string
    scope: string
    sourceToken: string
    toolName: string
  }): Promise<ToolAccessTokenPublication>
}

type TokenExchangeConfig = {
  caPath: string
  certificatePath: string
  endpoint: URL
  keyPath: string
  outputDirectory: string
  timeoutMs: number
}

type TokenExchangeDependencies = {
  exchange?: typeof exchangeAthenzAccessToken
}

export class DownstreamTokenExchangeError extends Error {
  readonly status: 403 | 502
  readonly code: "downstream_token_exchange_denied" | "downstream_token_exchange_unavailable"

  constructor(
    status: 403 | 502,
    code: "downstream_token_exchange_denied" | "downstream_token_exchange_unavailable",
    message: string,
  ) {
    super(message)
    this.status = status
    this.code = code
  }
}

export function createAthenzTokenFilePublisher(
  config: TokenExchangeConfig,
  dependencies: TokenExchangeDependencies = {},
): ToolAccessTokenPublisher {
  if (config.endpoint.protocol !== "https:") {
    throw new Error("ATHENZ_TOKEN_EXCHANGE_URL must use HTTPS")
  }
  if (config.endpoint.username || config.endpoint.password) {
    throw new Error("ATHENZ_TOKEN_EXCHANGE_URL must not contain credentials")
  }
  if (!config.outputDirectory.startsWith("/")) {
    throw new Error("ATHENZ_TOKEN_FILE_DIR must be an absolute path")
  }

  return {
    async publish({ requestId, scope, sourceToken, toolName }) {
      const scopes = validatedScopes(scope)
      const audiences = [...new Set(scopes.map(scopeAudience))]
      const toolDirectory = safeToolDirectory(toolName)
      const fileName = `${safeRequestId(requestId)}.jwt`
      if (audiences.length !== 1) {
        throw new DownstreamTokenExchangeError(
          502,
          "downstream_token_exchange_unavailable",
          "A tool access-token file currently supports exactly one downstream Athenz domain.",
        )
      }

      const accessToken = await (dependencies.exchange ?? exchangeAthenzAccessToken)(
        config,
        sourceToken,
        scopes.join(" "),
        audiences[0],
      )
      const directory = join(config.outputDirectory, toolDirectory)
      const filePath = join(directory, fileName)
      const temporaryPath = `${filePath}.${randomUUID()}.tmp`
      try {
        await mkdir(directory, { mode: 0o770, recursive: true })
        const file = await open(temporaryPath, "wx", 0o640)
        try {
          await file.writeFile(`${accessToken}\n`, "utf8")
        } finally {
          await file.close()
        }
        await rename(temporaryPath, filePath)
      } catch (error) {
        await rm(temporaryPath, { force: true })
        if (error instanceof DownstreamTokenExchangeError) throw error
        throw new DownstreamTokenExchangeError(
          502,
          "downstream_token_exchange_unavailable",
          "The downstream access-token file could not be published.",
        )
      }

      return {
        filePath,
        async remove() {
          await rm(filePath, { force: true })
        },
      }
    },
  }
}

export function tokenExchangeConfigFromEnvironment(
  environment: Record<string, string | undefined> = process.env,
): TokenExchangeConfig | undefined {
  if (environment.ATHENZ_TOKEN_FILE_EXCHANGE_ENABLED !== "true") return undefined
  return {
    caPath: environment.ATHENZ_TOKEN_EXCHANGE_CA_PATH ?? "/var/run/athenz/ca.crt",
    certificatePath: environment.ATHENZ_TOKEN_EXCHANGE_CERT_PATH ?? "/var/run/athenz/service.cert.pem",
    endpoint: new URL(
      environment.ATHENZ_TOKEN_EXCHANGE_URL
        ?? "https://athenz-zts-server.athenz:4443/zts/v1/oauth2/token",
    ),
    keyPath: environment.ATHENZ_TOKEN_EXCHANGE_KEY_PATH ?? "/var/run/athenz/service.key.pem",
    outputDirectory: environment.ATHENZ_TOKEN_FILE_DIR ?? "/var/run/idthw-access-tokens",
    timeoutMs: positiveInteger(environment.ATHENZ_TOKEN_EXCHANGE_TIMEOUT_MS ?? "10000"),
  }
}

async function exchangeAthenzAccessToken(
  config: TokenExchangeConfig,
  sourceToken: string,
  scope: string,
  audience: string,
) {
  const [cert, key, ca] = await Promise.all([
    readFile(config.certificatePath),
    readFile(config.keyPath),
    readFile(config.caPath),
  ])
  const encodedBody = new URLSearchParams({
    audience,
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    scope,
    subject_token: sourceToken,
    subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
  }).toString()

  const payload = await new Promise<unknown>((resolve, reject) => {
    const request = https.request(config.endpoint, {
      ca,
      cert,
      headers: {
        Accept: "application/json",
        "Content-Length": Buffer.byteLength(encodedBody),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      key,
      method: "POST",
      rejectUnauthorized: true,
      timeout: config.timeoutMs,
    }, (response) => {
      let body = ""
      let bytes = 0
      response.setEncoding("utf8")
      response.on("data", (chunk: string) => {
        bytes += Buffer.byteLength(chunk)
        if (bytes > MAX_TOKEN_RESPONSE_BYTES) {
          response.destroy(new Error("ZTS token response exceeded the size limit"))
          return
        }
        body += chunk
      })
      response.on("end", () => {
        const status = response.statusCode ?? 0
        if (status < 200 || status >= 300) {
          reject(new DownstreamTokenExchangeError(
            status === 400 || status === 401 || status === 403 ? 403 : 502,
            status === 400 || status === 401 || status === 403
              ? "downstream_token_exchange_denied"
              : "downstream_token_exchange_unavailable",
            status === 400 || status === 401 || status === 403
              ? "Athenz denied the downstream token exchange."
              : "Athenz token exchange is unavailable.",
          ))
          return
        }
        try {
          resolve(JSON.parse(body) as unknown)
        } catch {
          reject(new DownstreamTokenExchangeError(
            502,
            "downstream_token_exchange_unavailable",
            "Athenz returned an invalid token response.",
          ))
        }
      })
      response.on("error", reject)
    })
    request.on("error", reject)
    request.on("timeout", () => request.destroy(new Error("Athenz token exchange timed out")))
    request.end(encodedBody)
  }).catch((error) => {
    if (error instanceof DownstreamTokenExchangeError) throw error
    throw new DownstreamTokenExchangeError(
      502,
      "downstream_token_exchange_unavailable",
      "Athenz token exchange is unavailable.",
    )
  })

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw invalidTokenResponse()
  }
  const accessToken = (payload as { access_token?: unknown }).access_token
  if (typeof accessToken !== "string" || !accessToken || accessToken.length > 32 * 1024) {
    throw invalidTokenResponse()
  }
  assertExchangedTokenGrant(accessToken, audience, scope)
  return accessToken
}

export function assertExchangedTokenGrant(token: string, audience: string, requestedScope: string) {
  try {
    const parts = token.split(".")
    if (parts.length !== 3) throw new Error("invalid JWT")
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>
    const audiences = typeof claims.aud === "string"
      ? [claims.aud]
      : Array.isArray(claims.aud) && claims.aud.every((value) => typeof value === "string")
        ? claims.aud
        : []
    if (!audiences.includes(audience)) throw new Error("unexpected audience")
    const granted = tokenScopes(claims)
    for (const requested of validatedScopes(requestedScope)) {
      const role = requested.slice(requested.indexOf(":role.") + ":role.".length)
      if (!granted.has(requested) && !granted.has(role)) throw new Error("missing scope")
    }
    const currentTime = Math.floor(Date.now() / 1000)
    if (typeof claims.exp !== "number" || !Number.isFinite(claims.exp) || claims.exp <= currentTime) {
      throw new Error("expired token")
    }
    if (claims.nbf !== undefined && (
      typeof claims.nbf !== "number"
      || !Number.isFinite(claims.nbf)
      || claims.nbf > currentTime
    )) throw new Error("token is not active")
  } catch {
    throw invalidTokenResponse()
  }
}

function tokenScopes(claims: Record<string, unknown>) {
  const scopes = new Set<string>()
  for (const value of [claims.scp, claims.scope]) {
    if (typeof value === "string") {
      for (const scope of value.split(/\s+/)) if (scope) scopes.add(scope)
    } else if (Array.isArray(value) && value.every((scope) => typeof scope === "string")) {
      for (const scope of value) if (scope) scopes.add(scope)
    }
  }
  return scopes
}

function validatedScopes(value: string) {
  if (Buffer.byteLength(value) > MAX_SCOPE_BYTES) throw invalidScope()
  const scopes = [...new Set(value.trim().split(/\s+/).filter(Boolean))].sort()
  if (scopes.length === 0 || scopes.some((scope) => !/^[A-Za-z0-9][A-Za-z0-9._-]*:role\.[A-Za-z0-9][A-Za-z0-9._-]*$/.test(scope))) {
    throw invalidScope()
  }
  return scopes
}

function scopeAudience(scope: string) {
  return scope.slice(0, scope.indexOf(":role."))
}

function safeToolDirectory(toolName: string) {
  const value = toolName.trim()
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$/.test(value)) {
    throw new DownstreamTokenExchangeError(
      502,
      "downstream_token_exchange_unavailable",
      "The MCP tool name cannot be represented as an access-token directory.",
    )
  }
  return value
}

function safeRequestId(requestId: string) {
  if (!/^[a-f0-9-]{36}$/.test(requestId)) throw new Error("Invalid Runtime Proxy request ID")
  return requestId
}

function invalidScope() {
  return new DownstreamTokenExchangeError(
    403,
    "downstream_token_exchange_denied",
    "The requested downstream Athenz scope is invalid.",
  )
}

function invalidTokenResponse() {
  return new DownstreamTokenExchangeError(
    502,
    "downstream_token_exchange_unavailable",
    "Athenz returned an invalid downstream access token.",
  )
}

function positiveInteger(value: string) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error("ATHENZ_TOKEN_EXCHANGE_TIMEOUT_MS must be positive")
  return parsed
}
