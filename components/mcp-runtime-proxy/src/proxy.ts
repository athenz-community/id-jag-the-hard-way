import { randomUUID } from "node:crypto"
import http, { type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from "node:http"
import https from "node:https"
import {
  AccessTokenError,
  JwksUnavailableError,
  type AthenzAccessTokenVerifier,
  type VerifiedAthenzAccessToken,
} from "./auth.ts"
import { runtimeProxyLogger, type RuntimeProxyLogger } from "./logger.ts"
import {
  DownstreamTokenExchangeError,
  MCP_ACCESS_TOKEN_FILE_META_KEY,
  MCP_DOWNSTREAM_SCOPE_HEADER,
  type ToolAccessTokenPublication,
  type ToolAccessTokenPublisher,
} from "./tokenExchange.ts"

const MAX_BUFFERED_REQUEST_BYTES = 64 * 1024
const PUBLIC_MCP_METHODS = new Set([
  "initialize",
  "notifications/initialized",
  "ping",
  "tools/list",
])

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
])

export function createRuntimeProxyServer(
  target: URL,
  accessTokenVerifier: AthenzAccessTokenVerifier,
  logger: RuntimeProxyLogger = runtimeProxyLogger,
  tokenPublisher?: ToolAccessTokenPublisher,
) {
  if (!(["http:", "https:"] as string[]).includes(target.protocol)) {
    throw new Error("MCP_TARGET_URL must use http or https")
  }
  if (target.username || target.password) {
    throw new Error("MCP_TARGET_URL must not contain credentials")
  }

  const server = http.createServer((request, response) => {
    void handleRequest(request, response, target, accessTokenVerifier, logger, tokenPublisher)
  })
  server.requestTimeout = 0
  return server
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  target: URL,
  accessTokenVerifier: AthenzAccessTokenVerifier,
  logger: RuntimeProxyLogger,
  tokenPublisher?: ToolAccessTokenPublisher,
) {
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`)
  if (requestUrl.pathname === "/healthz" || requestUrl.pathname === "/readyz") {
    sendJson(response, 200, { ok: true })
    return
  }

  const requestId = randomUUID()
  const startedAt = Date.now()
  const requestFields = {
    requestId,
    method: request.method ?? "UNKNOWN",
    path: requestUrl.pathname,
  }
  logger.info("request_received", {
    ...requestFields,
    accessTokenPresent: Boolean(request.headers.authorization),
  })

  let publication: ToolAccessTokenPublication | undefined
  try {
    const authorization = await authorizeRequest(request, accessTokenVerifier)
    if (authorization.accessTokenVerified) {
      logger.info("access_token_verified", {
        ...requestFields,
        ...authorization.verification,
      })
    } else {
      logger.info("public_request_allowed", {
        ...requestFields,
        mcpMethod: authorization.publicMethod,
      })
    }

    let bufferedBody = authorization.bufferedBody
    const downstreamScope = downstreamScopeHeader(request.headers)
    if (downstreamScope !== undefined) {
      if (!authorization.accessTokenVerified) {
        throw downstreamDenied("A downstream Athenz scope is allowed only for a protected MCP tool call.")
      }
      if (!tokenPublisher) {
        throw new DownstreamTokenExchangeError(
          502,
          "downstream_token_exchange_unavailable",
          "Downstream access-token publication is not enabled for this MCP server.",
        )
      }
      bufferedBody ??= await readRequestBody(request)
      const toolCall = parseToolCall(bufferedBody)
      assertGrantedDownstreamScopes(downstreamScope, authorization.verification)
      publication = await tokenPublisher.publish({
        requestId,
        scope: downstreamScope,
        sourceToken: verifiedBearerToken(request.headers.authorization),
        toolName: toolCall.toolName,
      })
      bufferedBody = withAccessTokenFile(toolCall.message, publication.filePath)
      logger.info("downstream_access_token_published", {
        ...requestFields,
        scope: normalizedScopes(downstreamScope),
        toolName: toolCall.toolName,
      })
    }

    const upstreamStatus = await proxyRequest(
      request,
      response,
      buildUpstreamUrl(target, requestUrl),
      bufferedBody,
    )
    logger.info("request_completed", {
      ...requestFields,
      durationMs: Date.now() - startedAt,
      upstreamStatus,
    })
  } catch (error) {
    if (error instanceof AccessTokenError) {
      logger.warn("access_denied", {
        ...requestFields,
        accessTokenPresent: Boolean(request.headers.authorization),
        code: error.code,
        durationMs: Date.now() - startedAt,
        status: error.status,
      })
      sendAccessTokenError(response, error)
      return
    }
    if (error instanceof JwksUnavailableError) {
      logger.error("access_token_validation_unavailable", {
        ...requestFields,
        durationMs: Date.now() - startedAt,
        message: error.message,
      })
      sendJson(response, 503, { error: "authentication_unavailable" })
      return
    }
    if (error instanceof DownstreamTokenExchangeError) {
      const log = error.status === 403 ? logger.warn.bind(logger) : logger.error.bind(logger)
      log("downstream_token_exchange_failed", {
        ...requestFields,
        code: error.code,
        durationMs: Date.now() - startedAt,
        message: error.message,
        status: error.status,
      })
      if (error.status === 403) {
        response.setHeader("www-authenticate", 'Bearer realm="mcp-runtime-proxy", error="insufficient_scope"')
      }
      sendJson(response, error.status, { error: error.code, message: error.message })
      return
    }
    const message = error instanceof Error ? error.message : "Unknown upstream error"
    logger.error("upstream_request_failed", {
      ...requestFields,
      durationMs: Date.now() - startedAt,
      message,
    })
    if (response.headersSent) {
      response.destroy(error instanceof Error ? error : undefined)
      return
    }
    sendJson(response, 502, { error: "MCP upstream unavailable" })
  } finally {
    if (publication) {
      try {
        await publication.remove()
        logger.info("downstream_access_token_removed", requestFields)
      } catch (error) {
        logger.error("downstream_access_token_cleanup_failed", {
          ...requestFields,
          message: error instanceof Error ? error.message : "Unknown cleanup error",
        })
      }
    }
  }
}

async function authorizeRequest(
  request: IncomingMessage,
  accessTokenVerifier: AthenzAccessTokenVerifier,
): Promise<AuthorizedRequest> {
  const authorization = request.headers.authorization
  if (authorization) {
    const verification = await accessTokenVerifier.verify(authorization)
    return { accessTokenVerified: true, verification }
  }

  if (request.method === "POST") {
    const body = await readRequestBody(request)
    const publicMethod = publicMcpMethod(body)
    if (publicMethod) return { accessTokenVerified: false, bufferedBody: body, publicMethod }
  }

  await accessTokenVerifier.verify(undefined)
  throw new Error("Access-token verification unexpectedly returned without a token")
}

type AuthorizedRequest = {
  accessTokenVerified: boolean
  bufferedBody?: Buffer
  publicMethod?: string
  verification?: VerifiedAthenzAccessToken
}

function proxyRequest(
  request: IncomingMessage,
  response: ServerResponse,
  upstreamUrl: URL,
  bufferedBody?: Buffer,
) {
  return new Promise<number>((resolve, reject) => {
    const transport = upstreamUrl.protocol === "https:" ? https : http
    const upstreamRequest = transport.request(upstreamUrl, {
      method: request.method,
      headers: forwardedRequestHeaders(request.headers, upstreamUrl, bufferedBody),
    }, (upstreamResponse) => {
      response.statusCode = upstreamResponse.statusCode ?? 502
      if (upstreamResponse.statusMessage) response.statusMessage = upstreamResponse.statusMessage
      copyResponseHeaders(upstreamResponse.headers, response)
      upstreamResponse.on("error", reject)
      upstreamResponse.on("end", () => resolve(response.statusCode))
      upstreamResponse.pipe(response)
    })

    upstreamRequest.on("error", reject)
    request.on("aborted", () => upstreamRequest.destroy())
    response.on("close", () => {
      if (!response.writableEnded) upstreamRequest.destroy()
    })
    if (bufferedBody) upstreamRequest.end(bufferedBody)
    else request.pipe(upstreamRequest)
  })
}

function readRequestBody(request: IncomingMessage) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    let bytes = 0
    let tooLarge = false
    request.on("data", (chunk: Buffer | string) => {
      if (tooLarge) return
      const value = Buffer.from(chunk)
      bytes += value.length
      if (bytes > MAX_BUFFERED_REQUEST_BYTES) {
        tooLarge = true
        reject(new AccessTokenError(
          request.headers.authorization ? 403 : 401,
          request.headers.authorization ? "insufficient_scope" : "missing_access_token",
          request.headers.authorization
            ? "The MCP request body exceeds the protected-call size limit."
            : "Pass an Athenz access token as Authorization: Bearer <token>.",
        ))
        return
      }
      chunks.push(value)
    })
    request.on("end", () => {
      if (!tooLarge) resolve(Buffer.concat(chunks))
    })
    request.on("error", reject)
  })
}

function publicMcpMethod(body: Buffer) {
  try {
    const message = JSON.parse(body.toString("utf8")) as unknown
    if (!message || typeof message !== "object" || Array.isArray(message)) return undefined
    const method = (message as { method?: unknown }).method
    return typeof method === "string" && PUBLIC_MCP_METHODS.has(method) ? method : undefined
  } catch {
    return undefined
  }
}

function downstreamScopeHeader(headers: IncomingHttpHeaders) {
  const value = headers[MCP_DOWNSTREAM_SCOPE_HEADER]
  if (value === undefined) return undefined
  if (Array.isArray(value) || !value.trim()) {
    throw downstreamDenied("The downstream Athenz scope header is invalid.")
  }
  normalizedScopes(value)
  return value
}

function normalizedScopes(value: string) {
  const scopes = [...new Set(value.trim().split(/\s+/).filter(Boolean))].sort()
  if (
    scopes.length === 0
    || scopes.some((scope) => !/^[A-Za-z0-9][A-Za-z0-9._-]*:role\.[A-Za-z0-9][A-Za-z0-9._-]*$/.test(scope))
  ) {
    throw downstreamDenied("The requested downstream Athenz scope is invalid.")
  }
  return scopes
}

function assertGrantedDownstreamScopes(
  downstreamScope: string,
  verification: VerifiedAthenzAccessToken | undefined,
) {
  const granted = new Set(verification?.scopes ?? [])
  const missing = normalizedScopes(downstreamScope).filter((scope) => !granted.has(scope))
  if (missing.length > 0) {
    throw downstreamDenied("The verified Athenz access token does not grant the requested downstream scope.")
  }
}

function parseToolCall(body: Buffer) {
  let message: unknown
  try {
    message = JSON.parse(body.toString("utf8")) as unknown
  } catch {
    throw downstreamDenied("The protected MCP tool call is not valid JSON.")
  }
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    throw downstreamDenied("The protected MCP tool call must be a JSON-RPC object.")
  }
  const request = message as { method?: unknown; params?: unknown }
  if (request.method !== "tools/call" || !request.params || typeof request.params !== "object" || Array.isArray(request.params)) {
    throw downstreamDenied("A downstream Athenz scope is allowed only for tools/call.")
  }
  const toolName = (request.params as { name?: unknown }).name
  if (typeof toolName !== "string" || !toolName.trim()) {
    throw downstreamDenied("tools/call params.name must be a non-empty string.")
  }
  return { message: message as Record<string, unknown>, toolName }
}

function withAccessTokenFile(message: Record<string, unknown>, filePath: string) {
  const params = message.params as Record<string, unknown>
  const currentMeta = params._meta
  if (currentMeta !== undefined && (
    !currentMeta
    || typeof currentMeta !== "object"
    || Array.isArray(currentMeta)
  )) {
    throw downstreamDenied("tools/call params._meta must be an object when provided.")
  }
  const meta = currentMeta as Record<string, unknown> | undefined
  return Buffer.from(JSON.stringify({
    ...message,
    params: {
      ...params,
      _meta: {
        ...meta,
        [MCP_ACCESS_TOKEN_FILE_META_KEY]: filePath,
      },
    },
  }))
}

function verifiedBearerToken(authorization: string | undefined) {
  const match = /^Bearer (\S+)$/i.exec(authorization ?? "")
  if (!match) throw downstreamDenied("The verified Athenz access token is unavailable for downstream exchange.")
  return match[1]
}

function downstreamDenied(message: string) {
  return new DownstreamTokenExchangeError(403, "downstream_token_exchange_denied", message)
}

function buildUpstreamUrl(target: URL, requestUrl: URL) {
  const upstreamUrl = new URL(target)
  upstreamUrl.pathname = joinPath(upstreamUrl.pathname, requestUrl.pathname)
  upstreamUrl.search = requestUrl.search
  return upstreamUrl
}

function joinPath(basePath: string, requestPath: string) {
  const base = basePath === "/" ? "" : basePath.replace(/\/$/, "")
  const path = requestPath.startsWith("/") ? requestPath : `/${requestPath}`
  return `${base}${path}` || "/"
}

function forwardedRequestHeaders(
  headers: IncomingHttpHeaders,
  upstreamUrl: URL,
  bufferedBody?: Buffer,
) {
  const forwarded: IncomingHttpHeaders = {}
  for (const [name, value] of Object.entries(headers)) {
    if (
      value === undefined
      || HOP_BY_HOP_HEADERS.has(name.toLowerCase())
      || name.toLowerCase() === "host"
      || name.toLowerCase() === MCP_DOWNSTREAM_SCOPE_HEADER
      || (bufferedBody !== undefined && (
        name.toLowerCase() === "content-length"
        || name.toLowerCase() === "content-encoding"
      ))
    ) continue
    forwarded[name] = value
  }
  forwarded.host = upstreamUrl.host
  if (bufferedBody !== undefined) forwarded["content-length"] = String(bufferedBody.byteLength)
  return forwarded
}

function copyResponseHeaders(headers: IncomingHttpHeaders, response: ServerResponse) {
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || HOP_BY_HOP_HEADERS.has(name.toLowerCase())) continue
    response.setHeader(name, value)
  }
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown) {
  response.statusCode = statusCode
  response.setHeader("content-type", "application/json; charset=utf-8")
  response.setHeader("cache-control", "no-store")
  response.end(JSON.stringify(body))
}

function sendAccessTokenError(response: ServerResponse, error: AccessTokenError) {
  const challenge = error.status === 403
    ? `Bearer realm="mcp-runtime-proxy", error="insufficient_scope"`
    : error.code === "invalid_access_token"
      ? `Bearer realm="mcp-runtime-proxy", error="invalid_token"`
      : `Bearer realm="mcp-runtime-proxy"`
  response.setHeader("www-authenticate", challenge)
  sendJson(response, error.status, { error: error.code, message: error.message })
}
