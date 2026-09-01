import crypto from "node:crypto"
import {
  AUTHORIZATION_CODE_TTL_SECONDS,
  AUTHORIZATION_TRANSACTION_TTL_SECONDS,
  IDP_LOGOUT_TICKET_TTL_SECONDS,
} from "../config/env.js"
import { randomToken } from "./sessionStore.js"

export type RegisteredClient = {
  clientId: string
  redirectUris: string[]
}

export type AuthorizationTransaction = {
  clientId: string
  clientState: string
  redirectUri: string
  clientCodeChallenge: string
  keycloakCodeVerifier: string
  nonce: string
  expiresAt: number
}

export type AuthorizationCode = {
  clientId: string
  redirectUri: string
  clientCodeChallenge: string
  idToken: string
  subject: string
  username: string
  identityExpiresAt: number
  expiresAt: number
}

const clients = new Map<string, RegisteredClient>()
const transactions = new Map<string, AuthorizationTransaction>()
const authorizationCodes = new Map<string, AuthorizationCode>()
const identityProviderLogoutTickets = new Map<string, { idToken: string; expiresAt: number }>()

export function registerClient(redirectUris: string[]) {
  const client = {
    clientId: `mcp-client-${crypto.randomUUID()}`,
    redirectUris,
  }
  clients.set(client.clientId, client)
  return client
}

export function getClient(clientId: string) {
  return clients.get(clientId) ?? null
}

export function createAuthorizationTransaction(
  transaction: Omit<AuthorizationTransaction, "keycloakCodeVerifier" | "nonce" | "expiresAt">,
) {
  const upstreamState = randomToken()
  const stored = {
    ...transaction,
    keycloakCodeVerifier: randomToken(),
    nonce: randomToken(),
    expiresAt: now() + AUTHORIZATION_TRANSACTION_TTL_SECONDS,
  }
  transactions.set(upstreamState, stored)
  return { upstreamState, transaction: stored }
}

export function consumeAuthorizationTransaction(upstreamState: string) {
  const transaction = transactions.get(upstreamState)
  transactions.delete(upstreamState)
  if (!transaction || transaction.expiresAt <= now()) return null
  return transaction
}

export function createAuthorizationCode(input: Omit<AuthorizationCode, "expiresAt">) {
  const code = randomToken()
  authorizationCodes.set(code, {
    ...input,
    expiresAt: Math.min(input.identityExpiresAt, now() + AUTHORIZATION_CODE_TTL_SECONDS),
  })
  return code
}

export function consumeAuthorizationCode(code: string) {
  const authorizationCode = authorizationCodes.get(code)
  authorizationCodes.delete(code)
  if (!authorizationCode || authorizationCode.expiresAt <= now()) return null
  return authorizationCode
}

export function createIdentityProviderLogoutTicket(idToken: string) {
  const currentTime = now()
  for (const [ticket, entry] of identityProviderLogoutTickets) {
    if (entry.expiresAt <= currentTime) identityProviderLogoutTickets.delete(ticket)
  }

  const ticket = randomToken()
  identityProviderLogoutTickets.set(ticket, {
    idToken,
    expiresAt: currentTime + IDP_LOGOUT_TICKET_TTL_SECONDS,
  })
  return ticket
}

export function consumeIdentityProviderLogoutTicket(ticket: string) {
  const entry = identityProviderLogoutTickets.get(ticket)
  identityProviderLogoutTickets.delete(ticket)
  if (!entry || entry.expiresAt <= now()) return null
  return entry.idToken
}

export function deriveS256CodeChallenge(verifier: string) {
  return crypto.createHash("sha256").update(verifier).digest("base64url")
}

export function verifyS256CodeChallenge(verifier: string, expectedChallenge: string) {
  const actual = Buffer.from(deriveS256CodeChallenge(verifier))
  const expected = Buffer.from(expectedChallenge)
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
}

export function isAllowedRedirectUri(value: string) {
  try {
    const url = new URL(value)
    if (url.hash || url.username || url.password) return false
    if (url.protocol === "https:") return true
    return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost")
  } catch {
    return false
  }
}

export function clearOAuthStores() {
  clients.clear()
  transactions.clear()
  authorizationCodes.clear()
  identityProviderLogoutTickets.clear()
}

function now() {
  return Math.floor(Date.now() / 1000)
}
