import crypto from "node:crypto"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import type { GatewayCredential } from "./sharedSession.js"

export type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>

export type OAuthEndpoints = {
  issuer: string
  authorizationEndpoint: string
  tokenEndpoint: string
  registrationEndpoint: string
}

type AuthorizationCodeLoginOptions = {
  fetch?: FetchLike
  openBrowser: (url: string) => Promise<void>
  timeoutMs?: number
  now?: () => number
}

type ProtectedResourceMetadata = {
  authorization_servers?: unknown
}

type AuthorizationServerMetadata = {
  issuer?: unknown
  authorization_endpoint?: unknown
  token_endpoint?: unknown
  registration_endpoint?: unknown
  code_challenge_methods_supported?: unknown
}

const DEFAULT_LOGIN_TIMEOUT_MS = 5 * 60_000
const OAUTH_REQUEST_TIMEOUT_MS = 10_000

export async function discoverOAuthEndpoints(
  target: URL,
  options: { fetch?: FetchLike; allowInsecureHttp?: boolean } = {},
): Promise<OAuthEndpoints> {
  assertSafeUrl(target, options.allowInsecureHttp)
  if (target.username || target.password || target.hash) {
    throw new Error("MCP Gateway URL must not contain credentials or a fragment")
  }

  const fetchImpl = options.fetch ?? fetch
  const resourceMetadataUrl = new URL(
    `/.well-known/oauth-protected-resource${target.pathname === "/" ? "" : target.pathname}`,
    target.origin,
  )
  const protectedResource = await fetchJson<ProtectedResourceMetadata>(fetchImpl, resourceMetadataUrl)
  const authorizationServers = protectedResource.authorization_servers
  if (!Array.isArray(authorizationServers) || typeof authorizationServers[0] !== "string") {
    throw new Error("MCP protected-resource metadata did not advertise an authorization server")
  }

  const advertisedIssuer = new URL(authorizationServers[0])
  assertSafeUrl(advertisedIssuer, options.allowInsecureHttp)
  const issuerPath = advertisedIssuer.pathname === "/" ? "" : advertisedIssuer.pathname.replace(/\/$/, "")
  const metadataUrl = new URL(`/.well-known/oauth-authorization-server${issuerPath}`, advertisedIssuer.origin)
  const metadata = await fetchJson<AuthorizationServerMetadata>(fetchImpl, metadataUrl)

  const issuer = requiredUrl(metadata.issuer, "issuer", options.allowInsecureHttp)
  if (issuer !== advertisedIssuer.toString().replace(/\/$/, "")) {
    throw new Error("OAuth metadata issuer does not match the protected resource advertisement")
  }
  const supportedChallenges = metadata.code_challenge_methods_supported
  if (!Array.isArray(supportedChallenges) || !supportedChallenges.includes("S256")) {
    throw new Error("MCP Gateway OAuth server must support PKCE S256")
  }

  return {
    issuer,
    authorizationEndpoint: requiredUrl(metadata.authorization_endpoint, "authorization_endpoint", options.allowInsecureHttp),
    tokenEndpoint: requiredUrl(metadata.token_endpoint, "token_endpoint", options.allowInsecureHttp),
    registrationEndpoint: requiredUrl(metadata.registration_endpoint, "registration_endpoint", options.allowInsecureHttp),
  }
}

export async function performAuthorizationCodeLogin(
  endpoints: OAuthEndpoints,
  options: AuthorizationCodeLoginOptions,
): Promise<GatewayCredential> {
  const fetchImpl = options.fetch ?? fetch
  const now = options.now ?? Date.now
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS
  const state = randomValue()
  const verifier = randomValue()
  const callback = deferred<string>()
  const callbackServer = createCallbackServer(state, callback)

  await listenOnLoopback(callbackServer)
  const address = callbackServer.address() as AddressInfo
  const redirectUri = `http://127.0.0.1:${address.port}/callback`

  try {
    const registration = await registerPublicClient(fetchImpl, endpoints.registrationEndpoint, redirectUri)
    const authorizationUrl = new URL(endpoints.authorizationEndpoint)
    authorizationUrl.search = new URLSearchParams({
      client_id: registration.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state,
      code_challenge: deriveS256CodeChallenge(verifier),
      code_challenge_method: "S256",
    }).toString()

    await options.openBrowser(authorizationUrl.toString())
    const code = await withTimeout(callback.promise, timeoutMs, "Timed out waiting for browser authentication")
    const tokenResponse = await fetchImpl(endpoints.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(OAUTH_REQUEST_TIMEOUT_MS),
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: registration.clientId,
        redirect_uri: redirectUri,
        code,
        code_verifier: verifier,
      }),
    })

    if (!tokenResponse.ok) throw new Error(`OAuth token endpoint returned HTTP ${tokenResponse.status}`)
    const token = await tokenResponse.json() as {
      access_token?: unknown
      token_type?: unknown
      expires_in?: unknown
    }
    if (
      typeof token.access_token !== "string"
      || token.access_token.length === 0
      || typeof token.token_type !== "string"
      || token.token_type.toLowerCase() !== "bearer"
      || typeof token.expires_in !== "number"
      || !Number.isFinite(token.expires_in)
      || token.expires_in <= 0
    ) {
      throw new Error("OAuth token endpoint returned an invalid bearer credential")
    }

    return {
      version: 1,
      issuer: endpoints.issuer,
      accessToken: token.access_token,
      tokenType: "Bearer",
      expiresAt: now() + token.expires_in * 1000,
    }
  } finally {
    await closeServer(callbackServer)
  }
}

export function deriveS256CodeChallenge(verifier: string) {
  return crypto.createHash("sha256").update(verifier).digest("base64url")
}

async function registerPublicClient(fetchImpl: FetchLike, endpoint: string, redirectUri: string) {
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(OAUTH_REQUEST_TIMEOUT_MS),
    body: JSON.stringify({
      client_name: "ID-JAG The Hard Way MCP Credential Broker",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  })
  if (!response.ok) throw new Error(`OAuth client registration returned HTTP ${response.status}`)
  const body = await response.json() as { client_id?: unknown }
  if (typeof body.client_id !== "string" || body.client_id.length === 0) {
    throw new Error("OAuth client registration did not return client_id")
  }
  return { clientId: body.client_id }
}

function createCallbackServer(expectedState: string, callback: ReturnType<typeof deferred<string>>) {
  return createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1")
    if (request.method !== "GET" || requestUrl.pathname !== "/callback") {
      response.writeHead(404).end("Not found")
      return
    }

    response.setHeader("cache-control", "no-store")
    response.setHeader("connection", "close")
    response.setHeader("content-type", "text/html; charset=utf-8")
    const returnedState = requestUrl.searchParams.get("state") ?? ""
    const error = requestUrl.searchParams.get("error")
    const code = requestUrl.searchParams.get("code")

    if (!safeEqual(returnedState, expectedState)) {
      response.writeHead(400).end(callbackPage("Authentication failed", "The OAuth state did not match. Return to your terminal."))
      callback.reject(new Error("OAuth callback state did not match"))
      return
    }
    if (error) {
      response.writeHead(400).end(callbackPage("Authentication was not completed", "Return to your terminal and retry the MCP connection."))
      callback.reject(new Error(`OAuth authorization failed: ${safeErrorCode(error)}`))
      return
    }
    if (!code) {
      response.writeHead(400).end(callbackPage("Authentication failed", "The callback did not contain an authorization code."))
      callback.reject(new Error("OAuth callback did not contain an authorization code"))
      return
    }

    response.writeHead(200).end(callbackPage("Authentication complete", "You may close this window and return to your MCP client."))
    callback.resolve(code)
  })
}

function callbackPage(title: string, message: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><main><h1>${title}</h1><p>${message}</p></main></body></html>`
}

async function fetchJson<T>(fetchImpl: FetchLike, url: URL): Promise<T> {
  const response = await fetchImpl(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(OAUTH_REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`OAuth metadata request returned HTTP ${response.status}`)
  return response.json() as Promise<T>
}

function requiredUrl(value: unknown, field: string, allowInsecureHttp = false) {
  if (typeof value !== "string") throw new Error(`OAuth metadata did not contain ${field}`)
  const url = new URL(value)
  assertSafeUrl(url, allowInsecureHttp)
  if (url.username || url.password || url.hash) throw new Error(`OAuth ${field} URL is not safe`)
  return url.toString().replace(/\/$/, "")
}

function assertSafeUrl(url: URL, allowInsecureHttp = false) {
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]"
  if (url.protocol === "https:" || (url.protocol === "http:" && (loopback || allowInsecureHttp))) return
  throw new Error("MCP and OAuth URLs must use HTTPS; use --allow-insecure-http only for development")
}

function randomValue() {
  return crypto.randomBytes(32).toString("base64url")
}

function safeEqual(actual: string, expected: string) {
  const actualBytes = Buffer.from(actual)
  const expectedBytes = Buffer.from(expected)
  return actualBytes.length === expectedBytes.length && crypto.timingSafeEqual(actualBytes, expectedBytes)
}

function safeErrorCode(value: string) {
  return value.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 100) || "unknown_error"
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function listenOnLoopback(server: Server) {
  server.listen(0, "127.0.0.1")
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve)
    server.once("error", reject)
  })
}

async function closeServer(server: Server) {
  if (!server.listening) return
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
    server.closeIdleConnections()
  })
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
