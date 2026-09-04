import NextAuth from "next-auth"
import type { Account, Profile } from "next-auth"
import { getToken } from "next-auth/jwt"
import type { NextRequest } from "next/server"
import type { OIDCConfig } from "next-auth/providers"
import { idpConfig, IDP_PROVIDER_ID } from "@/features/auth/config/idp"
import type { CachedHubAccount, HubAccountSummary } from "@/features/auth/types/accounts"

type HubIdpProfile = Profile & {
  exp?: number
  preferred_username?: string
}

type KeycloakAccount = Account & {
  refresh_expires_in?: number
}

type RefreshTokenResponse = {
  id_token?: unknown
  refresh_token?: unknown
  refresh_expires_in?: unknown
}

const authSecret = process.env.AUTH_SECRET
const configuredCacheSize = Number.parseInt(process.env.MCP_HUB_ACCOUNT_CACHE_SIZE ?? "5", 10)
const accountCacheSize = Number.isFinite(configuredCacheSize)
  ? Math.min(8, Math.max(1, configuredCacheSize))
  : 5

function stringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function idTokenExpiry(idToken: string) {
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8")) as { exp?: unknown }
    return numberValue(payload.exp)
  } catch {
    return undefined
  }
}

function refreshTokenExpiry(refreshExpiresIn: unknown) {
  const lifetime = numberValue(refreshExpiresIn)
  return lifetime ? Math.floor(Date.now() / 1000) + lifetime : undefined
}

function isCachedAccount(value: unknown): value is CachedHubAccount {
  if (!value || typeof value !== "object") return false
  const account = value as Partial<CachedHubAccount>
  return Boolean(
    stringValue(account.subject)
    && stringValue(account.username)
    && stringValue(account.idToken),
  )
}

function canRefresh(account: CachedHubAccount, now: number) {
  return Boolean(
    account.refreshToken
    && (!account.refreshTokenExpiresAt || account.refreshTokenExpiresAt > now),
  )
}

function isUsable(account: CachedHubAccount, now: number) {
  return !account.idTokenExpiresAt
    || account.idTokenExpiresAt > now
    || canRefresh(account, now)
}

function accountFromToken(token: Record<string, unknown>): CachedHubAccount | undefined {
  const subject = stringValue(token.subject)
  const username = stringValue(token.username)
  const idToken = stringValue(token.idToken)
  if (!subject || !username || !idToken) return undefined

  return {
    subject,
    username,
    idToken,
    idTokenExpiresAt: numberValue(token.idTokenExpiresAt),
    refreshToken: stringValue(token.refreshToken),
    refreshTokenExpiresAt: numberValue(token.refreshTokenExpiresAt),
    name: stringValue(token.name),
    email: stringValue(token.email),
    image: stringValue(token.picture),
  }
}

function cachedAccountsFromToken(token: Record<string, unknown> | null | undefined) {
  if (!token) return []
  const cached = Array.isArray(token.cachedAccounts)
    ? token.cachedAccounts.filter(isCachedAccount)
    : []
  const legacyAccount = accountFromToken(token)
  if (legacyAccount && !cached.some((account) => account.subject === legacyAccount.subject)) {
    cached.unshift(legacyAccount)
  }
  return cached
}

function compactAccounts(accounts: CachedHubAccount[]) {
  const now = Math.floor(Date.now() / 1000)
  const subjects = new Set<string>()
  return accounts
    .filter((account) => isUsable(account, now))
    .filter((account) => {
      if (subjects.has(account.subject)) return false
      subjects.add(account.subject)
      return true
    })
    .slice(0, accountCacheSize)
}

function accountSummary(account: CachedHubAccount): HubAccountSummary {
  return {
    subject: account.subject,
    username: account.username,
    name: account.name,
    email: account.email,
    image: account.image,
  }
}

function applyActiveAccount(
  token: Record<string, unknown>,
  account: CachedHubAccount,
  cachedAccounts: CachedHubAccount[],
) {
  return {
    ...token,
    sub: account.subject,
    subject: account.subject,
    username: account.username,
    name: account.name ?? account.username,
    email: account.email,
    picture: account.image,
    idToken: account.idToken,
    idTokenExpiresAt: account.idTokenExpiresAt,
    refreshToken: account.refreshToken,
    refreshTokenExpiresAt: account.refreshTokenExpiresAt,
    cachedAccounts,
  }
}

async function previousCachedAccounts(request?: NextRequest) {
  if (!request || !authSecret) return []

  const secureFirst = request.nextUrl.protocol === "https:"
  for (const secureCookie of [secureFirst, !secureFirst]) {
    const previousToken = await getToken({ req: request, secret: authSecret, secureCookie })
    if (previousToken) return cachedAccountsFromToken(previousToken)
  }
  return []
}

async function refreshAccount(account: CachedHubAccount): Promise<CachedHubAccount | undefined> {
  if (!account.refreshToken) return undefined

  try {
    const response = await fetch(idpConfig.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: account.refreshToken,
        client_id: idpConfig.clientId,
        client_secret: idpConfig.clientSecret,
      }),
      cache: "no-store",
    })
    if (!response.ok) return undefined

    const refreshed = await response.json() as RefreshTokenResponse
    const idToken = stringValue(refreshed.id_token)
    const expiresAt = idToken ? idTokenExpiry(idToken) : undefined
    if (!idToken || !expiresAt) return undefined

    return {
      ...account,
      idToken,
      idTokenExpiresAt: expiresAt,
      refreshToken: stringValue(refreshed.refresh_token) ?? account.refreshToken,
      refreshTokenExpiresAt: refreshTokenExpiry(refreshed.refresh_expires_in)
        ?? account.refreshTokenExpiresAt,
    }
  } catch {
    return undefined
  }
}

const oidcProvider: OIDCConfig<HubIdpProfile> = {
  id: IDP_PROVIDER_ID,
  name: idpConfig.name,
  type: "oidc",
  issuer: idpConfig.issuer,
  wellKnown: idpConfig.wellKnown,
  authorization: idpConfig.authorizationEndpoint,
  clientId: idpConfig.clientId,
  clientSecret: idpConfig.clientSecret,
}

export const { handlers, auth, signIn, signOut, unstable_update: updateSession } = NextAuth(
  (request) => ({
    trustHost: true,
    secret: authSecret,
    pages: {
      signIn: "/",
    },
    providers: [oidcProvider],
    callbacks: {
      async authorized({ auth: session, request: authorizedRequest }) {
        if (authorizedRequest.nextUrl.pathname === "/") return true
        return Boolean(session?.user)
      },
      async signIn({ profile }) {
        return typeof profile?.preferred_username === "string"
          && profile.preferred_username.length > 0
      },
      async jwt({ token, account, profile, trigger, session }) {
        let accounts = cachedAccountsFromToken(token)
        let requestedSubject = stringValue(token.subject)

        if (account?.id_token && profile) {
          const username = stringValue(profile.preferred_username)
          const subject = stringValue(profile.sub)
          const expiresAt = numberValue(profile.exp) ?? idTokenExpiry(account.id_token)
          if (!username || !subject || !expiresAt) return null

          const keycloakAccount = account as KeycloakAccount
          const newAccount: CachedHubAccount = {
            subject,
            username,
            idToken: account.id_token,
            idTokenExpiresAt: expiresAt,
            refreshToken: stringValue(account.refresh_token),
            refreshTokenExpiresAt: refreshTokenExpiry(keycloakAccount.refresh_expires_in),
            name: stringValue(profile.name) ?? stringValue(token.name),
            email: stringValue(profile.email) ?? stringValue(token.email),
            image: stringValue(profile.picture) ?? stringValue(token.picture),
          }
          accounts = [
            newAccount,
            ...(await previousCachedAccounts(request)).filter(
              (cachedAccount) => cachedAccount.subject !== subject,
            ),
          ]
          requestedSubject = subject
        } else if (trigger === "update") {
          requestedSubject = stringValue(session?.activeSubject) ?? requestedSubject
        }

        accounts = compactAccounts(accounts)
        let selected = accounts.find((cachedAccount) => cachedAccount.subject === requestedSubject)
        if (!selected && trigger === "update") {
          requestedSubject = stringValue(token.subject)
          selected = accounts.find((cachedAccount) => cachedAccount.subject === requestedSubject)
        }
        if (!selected) return null

        const now = Math.floor(Date.now() / 1000)
        if (selected.idTokenExpiresAt && selected.idTokenExpiresAt <= now + 30) {
          const refreshed = await refreshAccount(selected)
          if (!refreshed) {
            if (trigger === "update" && requestedSubject !== token.subject) {
              accounts = accounts.filter((cachedAccount) => cachedAccount.subject !== requestedSubject)
              selected = accounts.find((cachedAccount) => cachedAccount.subject === token.subject)
              if (!selected) return null
              if (selected.idTokenExpiresAt && selected.idTokenExpiresAt <= now + 30) {
                const currentRefreshed = await refreshAccount(selected)
                if (!currentRefreshed) return null
                selected = currentRefreshed
                accounts = accounts.map((cachedAccount) => (
                  cachedAccount.subject === currentRefreshed.subject
                    ? currentRefreshed
                    : cachedAccount
                ))
              }
            } else {
              return null
            }
          } else {
            selected = refreshed
            accounts = accounts.map((cachedAccount) => (
              cachedAccount.subject === refreshed.subject ? refreshed : cachedAccount
            ))
          }
        }

        return applyActiveAccount(token, selected, accounts)
      },
      async session({ session, token }) {
        session.idToken = stringValue(token.idToken)
        session.accounts = compactAccounts(cachedAccountsFromToken(token)).map(accountSummary)
        if (session.user) {
          session.user.username = stringValue(token.username)
          session.user.subject = stringValue(token.subject)
        }
        return session
      },
    },
  }),
)
