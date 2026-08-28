import type { FetchLike, OAuthEndpoints } from "./oauth.js"
import type { GatewayCredential, SharedSessionStore } from "./sharedSession.js"

export function createAuthenticatedFetch({
  endpoints,
  sessionStore,
  acquireCredential,
  fetch: fetchImpl = fetch,
}: {
  endpoints: OAuthEndpoints
  sessionStore: SharedSessionStore
  acquireCredential: () => Promise<GatewayCredential>
  fetch?: FetchLike
}): FetchLike {
  return async (url, init) => {
    let credential = await sessionStore.getOrCreate(endpoints.issuer, acquireCredential)
    let response = await fetchImpl(url, withBearer(init, credential.accessToken))
    if (response.status !== 401) return response

    await response.body?.cancel().catch(() => undefined)
    await sessionStore.invalidate(endpoints.issuer, credential.accessToken)
    credential = await sessionStore.getOrCreate(endpoints.issuer, acquireCredential)
    response = await fetchImpl(url, withBearer(init, credential.accessToken))
    return response
  }
}

function withBearer(init: RequestInit | undefined, accessToken: string): RequestInit {
  const headers = new Headers(init?.headers)
  headers.set("authorization", `Bearer ${accessToken}`)
  return { ...init, headers }
}

