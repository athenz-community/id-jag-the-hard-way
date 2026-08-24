import { Router, type Request, type Response } from "express"
import {
  KEYCLOAK_AUTHORIZATION_ENDPOINT,
  KEYCLOAK_CLIENT_ID,
  PUBLIC_BASE_URL,
} from "../config/env.js"
import { exchangeKeycloakAuthorizationCode, verifyKeycloakIdToken } from "../services/keycloak.js"
import {
  consumeAuthorizationCode,
  consumeAuthorizationTransaction,
  createAuthorizationCode,
  createAuthorizationTransaction,
  deriveS256CodeChallenge,
  getClient,
  isAllowedRedirectUri,
  registerClient,
  verifyS256CodeChallenge,
} from "../utils/oauthStore.js"
import { sessionStore } from "../utils/sessionStore.js"

const router = Router()

router.get("/.well-known/oauth-authorization-server", (_request, response) => {
  response.json({
    issuer: PUBLIC_BASE_URL,
    authorization_endpoint: `${PUBLIC_BASE_URL}/oauth/authorize`,
    token_endpoint: `${PUBLIC_BASE_URL}/oauth/token`,
    registration_endpoint: `${PUBLIC_BASE_URL}/oauth/register`,
    revocation_endpoint: `${PUBLIC_BASE_URL}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
  })
})

router.post("/oauth/register", (request, response) => {
  const redirectUris: string[] = Array.isArray(request.body?.redirect_uris)
    ? request.body.redirect_uris.filter((value: unknown): value is string => typeof value === "string")
    : []

  if (redirectUris.length === 0 || redirectUris.some((value) => !isAllowedRedirectUri(value))) {
    response.status(400).json({
      error: "invalid_redirect_uri",
      error_description: "Use an HTTPS redirect URI or an HTTP loopback redirect URI.",
    })
    return
  }

  const client = registerClient(redirectUris)
  response.status(201).json({
    client_id: client.clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: client.redirectUris,
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  })
})

router.get("/oauth/authorize", (request, response) => {
  const clientId = queryValue(request, "client_id")
  const redirectUri = queryValue(request, "redirect_uri")
  const responseType = queryValue(request, "response_type")
  const clientState = queryValue(request, "state")
  const codeChallenge = queryValue(request, "code_challenge")
  const codeChallengeMethod = queryValue(request, "code_challenge_method")
  const client = clientId ? getClient(clientId) : null

  if (
    !client
    || !redirectUri
    || !client.redirectUris.includes(redirectUri)
    || responseType !== "code"
    || !clientState
    || !codeChallenge
    || codeChallengeMethod !== "S256"
  ) {
    response.status(400).send("Invalid OAuth authorization request")
    return
  }

  const { upstreamState, transaction } = createAuthorizationTransaction({
    clientId: client.clientId,
    clientState,
    redirectUri,
    clientCodeChallenge: codeChallenge,
  })
  const parameters = new URLSearchParams({
    client_id: KEYCLOAK_CLIENT_ID,
    response_type: "code",
    redirect_uri: `${PUBLIC_BASE_URL}/oauth/callback`,
    scope: "openid email profile",
    state: upstreamState,
    nonce: transaction.nonce,
    code_challenge: deriveS256CodeChallenge(transaction.keycloakCodeVerifier),
    code_challenge_method: "S256",
  })

  response.redirect(`${KEYCLOAK_AUTHORIZATION_ENDPOINT}?${parameters}`)
})

router.get("/oauth/callback", async (request, response) => {
  const upstreamState = queryValue(request, "state")
  const transaction = upstreamState ? consumeAuthorizationTransaction(upstreamState) : null
  if (!transaction) {
    response.status(400).send("Invalid or expired OAuth state")
    return
  }

  const keycloakError = queryValue(request, "error")
  if (keycloakError) {
    redirectWithParameters(response, transaction.redirectUri, {
      error: keycloakError,
      state: transaction.clientState,
    })
    return
  }

  const code = queryValue(request, "code")
  if (!code) {
    response.status(400).send("Keycloak callback did not contain an authorization code")
    return
  }

  try {
    const idToken = await exchangeKeycloakAuthorizationCode(code, transaction.keycloakCodeVerifier)
    const identity = await verifyKeycloakIdToken(idToken, transaction.nonce)
    const gatewayCode = createAuthorizationCode({
      clientId: transaction.clientId,
      redirectUri: transaction.redirectUri,
      clientCodeChallenge: transaction.clientCodeChallenge,
      idToken,
      subject: identity.subject,
      username: identity.username,
      identityExpiresAt: identity.expiresAt,
    })

    redirectWithParameters(response, transaction.redirectUri, {
      code: gatewayCode,
      state: transaction.clientState,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Keycloak callback failed"
    response.status(502).send(message)
  }
})

router.post("/oauth/token", (request, response) => {
  const code = bodyValue(request, "code")
  const clientId = bodyValue(request, "client_id")
  const redirectUri = bodyValue(request, "redirect_uri")
  const codeVerifier = bodyValue(request, "code_verifier")
  const grantType = bodyValue(request, "grant_type")
  const authorizationCode = code ? consumeAuthorizationCode(code) : null

  if (
    !authorizationCode
    || grantType !== "authorization_code"
    || clientId !== authorizationCode.clientId
    || redirectUri !== authorizationCode.redirectUri
    || !codeVerifier
    || !verifyS256CodeChallenge(codeVerifier, authorizationCode.clientCodeChallenge)
  ) {
    response.status(400).json({ error: "invalid_grant", error_description: "Authorization code validation failed." })
    return
  }

  const accessToken = sessionStore.create({
    idToken: authorizationCode.idToken,
    subject: authorizationCode.subject,
    username: authorizationCode.username,
    expiresAt: authorizationCode.identityExpiresAt,
  })
  response.setHeader("cache-control", "no-store")
  response.setHeader("pragma", "no-cache")
  response.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: Math.max(0, authorizationCode.identityExpiresAt - Math.floor(Date.now() / 1000)),
    scope: "openid email profile",
  })
})

router.post("/oauth/revoke", (request, response) => {
  const token = bodyValue(request, "token")
  if (token) sessionStore.delete(token)
  response.sendStatus(200)
})

function queryValue(request: Request, name: string) {
  const value = request.query[name]
  return typeof value === "string" ? value : undefined
}

function bodyValue(request: Request, name: string) {
  const value = request.body?.[name]
  return typeof value === "string" ? value : undefined
}

function redirectWithParameters(response: Response, redirectUri: string, parameters: Record<string, string>) {
  const url = new URL(redirectUri)
  for (const [name, value] of Object.entries(parameters)) url.searchParams.set(name, value)
  response.redirect(url.toString())
}

export default router
