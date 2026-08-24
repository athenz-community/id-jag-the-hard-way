import { createRemoteJWKSet, errors, jwtVerify } from "jose"
import {
  KEYCLOAK_CLIENT_ID,
  KEYCLOAK_CLIENT_SECRET,
  KEYCLOAK_ISSUER,
  KEYCLOAK_JWKS_ENDPOINT,
  KEYCLOAK_TOKEN_ENDPOINT,
  PUBLIC_BASE_URL,
} from "../config/env.js"

const keycloakJwks = createRemoteJWKSet(new URL(KEYCLOAK_JWKS_ENDPOINT))

type KeycloakTokenResponse = {
  id_token?: unknown
}

export async function exchangeKeycloakAuthorizationCode(code: string, codeVerifier: string) {
  const requestBody = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: KEYCLOAK_CLIENT_ID,
    code,
    redirect_uri: `${PUBLIC_BASE_URL}/oauth/callback`,
    code_verifier: codeVerifier,
  })
  if (KEYCLOAK_CLIENT_SECRET) requestBody.set("client_secret", KEYCLOAK_CLIENT_SECRET)

  const response = await fetch(KEYCLOAK_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: requestBody,
    signal: AbortSignal.timeout(10_000),
  })

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500)
    throw new Error(`Keycloak token exchange failed (${response.status}): ${detail}`)
  }

  const tokens = await response.json() as KeycloakTokenResponse
  if (typeof tokens.id_token !== "string") throw new Error("Keycloak did not return an ID token")
  return tokens.id_token
}

export async function verifyKeycloakIdToken(idToken: string, nonce: string) {
  let payload
  try {
    const result = await jwtVerify(idToken, keycloakJwks, {
      issuer: KEYCLOAK_ISSUER,
      audience: KEYCLOAK_CLIENT_ID,
    })
    payload = result.payload
  } catch (error) {
    if (error instanceof errors.JWTClaimValidationFailed && error.claim === "iss") {
      const receivedIssuer = typeof error.payload.iss === "string" ? error.payload.iss : "<missing>"
      throw new Error(`Keycloak ID token issuer mismatch: expected ${KEYCLOAK_ISSUER}, received ${receivedIssuer}`)
    }
    throw error
  }

  if (payload.nonce !== nonce) throw new Error("Keycloak ID token nonce did not match the login transaction")
  if (!payload.sub || !payload.exp) throw new Error("Keycloak ID token is missing sub or exp")

  return {
    subject: payload.sub,
    username: typeof payload.preferred_username === "string" ? payload.preferred_username : payload.sub,
    expiresAt: payload.exp,
  }
}
