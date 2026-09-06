import assert from "node:assert/strict"
import { createServer, type RequestListener } from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, describe, it } from "node:test"
import { createApp } from "../src/app.js"
import { ATHENZ_ZTS_AUDIENCE, GATEWAY_SESSION_TTL_SECONDS } from "../src/config/env.js"
import type { InternalRouterDependencies } from "../src/routes/internal.js"
import type { ProtectedRouterDependencies } from "../src/routes/protected.js"
import {
  AthenzAccessTokenManager,
  AthenzInsufficientScopeError,
  ReauthenticationRequiredError,
} from "../src/services/athenz.js"
import { McpRegistryClient } from "../src/services/mcpRegistry.js"
import {
  clearOAuthStores,
  createAuthorizationCode,
  deriveS256CodeChallenge,
  isAllowedRedirectUri,
  registerClient,
  verifyS256CodeChallenge,
} from "../src/utils/oauthStore.js"
import { sessionStore } from "../src/utils/sessionStore.js"

afterEach(() => {
  sessionStore.clear()
  clearOAuthStores()
})

describe("MCP Gateway", () => {
  it("publishes health and OAuth metadata", async () => {
    await withServer(async (baseUrl) => {
      const health = await fetch(`${baseUrl}/health`)
      assert.equal(health.status, 200)
      assert.deepEqual(await health.json(), { status: "ok" })

      const metadata = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`)
      assert.equal(metadata.status, 200)
      const body = await metadata.json() as {
        code_challenge_methods_supported: string[]
        end_session_endpoint: string
        idp_logout_ticket_endpoint: string
      }
      assert.deepEqual(body.code_challenge_methods_supported, ["S256"])
      assert.equal(body.end_session_endpoint, "https://mcp-gateway.test/oauth/idp-logout")
      assert.equal(body.idp_logout_ticket_endpoint, "https://mcp-gateway.test/oauth/idp-logout-ticket")
    })
  })

  it("invalidates the Gateway session and creates a one-use Keycloak browser logout", async () => {
    const sessionToken = sessionStore.create({
      idToken: "stored-id-token",
      idTokenExpiresAt: Math.floor(Date.now() / 1000) + 300,
      subject: "keycloak-subject",
      username: "idjag-learner",
      expiresAt: Math.floor(Date.now() / 1000) + 300,
    })

    await withServer(async (baseUrl) => {
      const ticketResponse = await fetch(`${baseUrl}/oauth/idp-logout-ticket`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: sessionToken }),
      })
      assert.equal(ticketResponse.status, 200)
      assert.equal(ticketResponse.headers.get("cache-control"), "no-store")
      const rawTicketBody = await ticketResponse.text()
      assert.equal(rawTicketBody.includes("stored-id-token"), false)
      assert.equal(rawTicketBody.includes(sessionToken), false)
      const ticketBody = JSON.parse(rawTicketBody) as { logout_url: string }
      const browserLogout = new URL(ticketBody.logout_url)
      assert.equal(browserLogout.origin, "https://mcp-gateway.test")
      assert.equal(sessionStore.get(sessionToken), null)

      const logoutResponse = await fetch(
        `${baseUrl}${browserLogout.pathname}${browserLogout.search}`,
        { redirect: "manual" },
      )
      assert.equal(logoutResponse.status, 302)
      const keycloakLogout = new URL(logoutResponse.headers.get("location") ?? "")
      assert.equal(keycloakLogout.origin, "https://keycloak.test")
      assert.equal(keycloakLogout.pathname, "/realms/master/protocol/openid-connect/logout")
      assert.equal(keycloakLogout.searchParams.get("id_token_hint"), "stored-id-token")
      assert.equal(keycloakLogout.searchParams.get("client_id"), "mcp-gateway")
      assert.equal(
        keycloakLogout.searchParams.get("post_logout_redirect_uri"),
        "https://mcp-gateway.test/oauth/idp-logout/complete",
      )

      const reusedTicket = await fetch(
        `${baseUrl}${browserLogout.pathname}${browserLogout.search}`,
        { redirect: "manual" },
      )
      assert.equal(reusedTicket.status, 400)
    })
  })

  it("reports sanitized OAuth session and Athenz cache status to authenticated Hub callers", async () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 300
    const sessionToken = sessionStore.create({
      idToken: "stored-id-token-must-not-leak",
      idTokenExpiresAt: expiresAt,
      subject: "keycloak-subject",
      username: "idjag-learner",
      expiresAt,
    })

    await withServer(async (baseUrl) => {
      const unauthorized = await fetch(`${baseUrl}/internal/cache-status`)
      assert.equal(unauthorized.status, 401)

      const response = await fetch(`${baseUrl}/internal/cache-status`, {
        headers: { authorization: "Bearer registry-secret" },
      })
      assert.equal(response.status, 200)
      assert.equal(response.headers.get("cache-control"), "no-store")
      const rawBody = await response.text()
      const body = JSON.parse(rawBody) as {
        sessionCount: number
        sessions: Array<{
          username: string
          subject: string
          expiresAt: string
          athenzAccessTokens: { entries: Array<{ scope: string }> }
          athenzIdJags: { entries: Array<{ audiences: string[]; scope: string }> }
        }>
      }
      assert.equal(body.sessionCount, 1)
      assert.equal(body.sessions[0].username, "idjag-learner")
      assert.equal(body.sessions[0].subject, "keycloak-subject")
      assert.equal(body.sessions[0].expiresAt, new Date(expiresAt * 1000).toISOString())
      assert.equal(body.sessions[0].athenzAccessTokens.entries[0].scope, "api:role.docs-getter")
      assert.deepEqual(body.sessions[0].athenzIdJags.entries[0].audiences, [ATHENZ_ZTS_AUDIENCE])
      assert.equal(body.sessions[0].athenzIdJags.entries[0].scope, "api:role.docs-getter")
      assert.equal(rawBody.includes("stored-id-token-must-not-leak"), false)
      assert.equal(rawBody.includes(sessionToken), false)
      assert.equal(rawBody.includes("issued-athenz-at-must-not-leak"), false)
      assert.equal(rawBody.includes("issued-id-jag-must-not-leak"), false)
    }, {}, {
      registryToken: "registry-secret",
      getAccessTokenCacheStatus: () => ({
        entryCount: 1,
        usableEntryCount: 1,
        refreshRequiredEntryCount: 0,
        expiredEntryCount: 0,
        expirySkewSeconds: 60,
        entries: [{
          scope: "api:role.docs-getter",
          cachedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
          status: "valid",
        }],
      }),
      getIdJagCacheStatus: () => ({
        entryCount: 1,
        usableEntryCount: 1,
        refreshRequiredEntryCount: 0,
        expiredEntryCount: 0,
        expirySkewSeconds: 60,
        entries: [{
          audiences: [ATHENZ_ZTS_AUDIENCE],
          scope: "api:role.docs-getter",
          cachedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
          status: "valid",
        }],
      }),
    })
  })

  it("registers a loopback OAuth client and starts a PKCE login", async () => {
    await withServer(async (baseUrl) => {
      const registration = await fetch(`${baseUrl}/oauth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ redirect_uris: ["http://127.0.0.1:43123/callback"] }),
      })
      assert.equal(registration.status, 201)
      const client = await registration.json() as { client_id: string }
      const verifier = "test-verifier-with-enough-random-looking-characters"
      const parameters = new URLSearchParams({
        client_id: client.client_id,
        redirect_uri: "http://127.0.0.1:43123/callback",
        response_type: "code",
        state: "client-state",
        code_challenge: deriveS256CodeChallenge(verifier),
        code_challenge_method: "S256",
      })
      const authorization = await fetch(`${baseUrl}/oauth/authorize?${parameters}`, { redirect: "manual" })
      assert.equal(authorization.status, 302)
      assert.match(authorization.headers.get("location") ?? "", /\/protocol\/openid-connect\/auth/)
    })
  })

  it("keeps the opaque Gateway session alive beyond the short-lived ID token", async () => {
    const redirectUri = "http://127.0.0.1:43123/callback"
    const verifier = "test-verifier-with-enough-random-looking-characters"
    const client = registerClient([redirectUri])
    const idTokenExpiresAt = Math.floor(Date.now() / 1000) + 120
    const code = createAuthorizationCode({
      clientId: client.clientId,
      redirectUri,
      clientCodeChallenge: deriveS256CodeChallenge(verifier),
      idToken: "short-lived-id-token",
      subject: "keycloak-subject",
      username: "idjag-learner",
      identityExpiresAt: idTokenExpiresAt,
    })

    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: client.clientId,
          redirect_uri: redirectUri,
          code,
          code_verifier: verifier,
        }),
      })

      assert.equal(response.status, 200)
      const body = await response.json() as { access_token: string; expires_in: number }
      assert.equal(body.expires_in, GATEWAY_SESSION_TTL_SECONDS)
      const session = sessionStore.get(body.access_token)
      assert.equal(session?.idTokenExpiresAt, idTokenExpiresAt)
      assert.ok((session?.expiresAt ?? 0) > idTokenExpiresAt)
    })
  })

  it("requires a gateway session before MCP access", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/mcp/k8s-docs-server`, { method: "POST" })
      assert.equal(response.status, 401)
      assert.match(response.headers.get("www-authenticate") ?? "", /oauth-protected-resource\/mcp\/k8s-docs-server/)
    })
  })

  it("invalidates the Gateway session and requests browser login when a fresh ID token is required", async () => {
    const now = Math.floor(Date.now() / 1000)
    const sessionToken = sessionStore.create({
      idToken: "short-lived-id-token",
      idTokenExpiresAt: now + 300,
      subject: "keycloak-subject",
      username: "idjag-learner",
      expiresAt: now + 3_600,
    })

    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/mcp/k8s-docs-server`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${sessionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "get_k8s_docs", arguments: {} },
        }),
      })

      assert.equal(response.status, 401)
      assert.match(response.headers.get("www-authenticate") ?? "", /oauth-protected-resource\/mcp\/k8s-docs-server/)
      assert.equal((await response.json() as { error: string }).error, "reauth_required")
      assert.equal(sessionStore.get(sessionToken), null)
    }, {
      resolveRoute: async () => ({
        proxyUrl: "http://core-mcp-proxy.test/mcp/k8s-docs-server",
        toolScopes: { get_k8s_docs: "api:role.docs-getter" },
      }),
      getAccessToken: async () => {
        throw new ReauthenticationRequiredError("ID token expired")
      },
    })
  })

  it("forwards MCP discovery without requesting an Athenz access token", async () => {
    let receivedAuthorization = "not-observed"
    let receivedBody = ""

    await withHttpServer(async (request, response) => {
      receivedAuthorization = request.headers.authorization ?? ""
      for await (const chunk of request) receivedBody += chunk.toString()
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: [] } }))
    }, async (coreMcpProxyUrl) => {
      const sessionToken = sessionStore.create({
        idToken: "stored-id-token",
        idTokenExpiresAt: Math.floor(Date.now() / 1000) + 300,
        subject: "keycloak-subject",
        username: "idjag-learner",
        expiresAt: Math.floor(Date.now() / 1000) + 300,
      })

      await withServer(async (baseUrl) => {
        const response = await fetch(`${baseUrl}/mcp/k8s-docs-server`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${sessionToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
        })

        assert.equal(response.status, 200)
      }, {
        resolveRoute: async () => ({
          proxyUrl: `${coreMcpProxyUrl}/mcp/k8s-docs-server`,
          accessScope: "api:role.mcp-accessor api:role.docs-getter",
        }),
        getAccessToken: async () => {
          throw new Error("Public MCP discovery must not request an Athenz access token")
        },
      })

      assert.equal(receivedAuthorization, "")
      assert.deepEqual(JSON.parse(receivedBody), { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
    })
  })

  it("keeps an active MCP event stream open beyond the upstream response timeout", async () => {
    await withHttpServer(async (_request, response) => {
      response.setHeader("content-type", "text/event-stream")
      response.flushHeaders()
      response.write("event: message\ndata: first\n\n")
      await new Promise((resolve) => setTimeout(resolve, 40))
      response.end("event: message\ndata: second\n\n")
    }, async (coreMcpProxyUrl) => {
      const sessionToken = sessionStore.create({
        idToken: "stored-id-token",
        idTokenExpiresAt: Math.floor(Date.now() / 1000) + 300,
        subject: "keycloak-subject",
        username: "idjag-learner",
        expiresAt: Math.floor(Date.now() / 1000) + 300,
      })

      await withServer(async (baseUrl) => {
        const response = await fetch(`${baseUrl}/mcp/k8s-docs-server`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${sessionToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
        })

        assert.equal(response.status, 200)
        assert.equal(await response.text(), [
          "event: message\ndata: first\n\n",
          "event: message\ndata: second\n\n",
        ].join(""))
      }, {
        resolveRoute: async () => ({
          proxyUrl: `${coreMcpProxyUrl}/mcp/k8s-docs-server`,
        }),
        upstreamResponseTimeoutMs: 10,
      })
    })
  })

  it("replaces the opaque session bearer with the selected tool's Athenz token", async () => {
    let receivedPath = ""
    let receivedAuthorization = ""
    let receivedDownstreamScope = ""
    let receivedSessionId = ""
    let receivedBody = ""

    await withHttpServer(async (request, response) => {
      receivedPath = request.url ?? ""
      receivedAuthorization = request.headers.authorization ?? ""
      receivedDownstreamScope = String(request.headers["x-idthw-mcp-downstream-scope"] ?? "")
      receivedSessionId = String(request.headers["mcp-session-id"] ?? "")
      for await (const chunk of request) receivedBody += chunk.toString()
      response.statusCode = 200
      response.setHeader("content-type", "application/json")
      response.setHeader("mcp-session-id", "upstream-session")
      response.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: [] } }))
    }, async (coreMcpProxyUrl) => {
      const expiresAt = Math.floor(Date.now() / 1000) + 300
      const sessionToken = sessionStore.create({
        idToken: "stored-id-token",
        idTokenExpiresAt: expiresAt,
        subject: "keycloak-subject",
        username: "idjag-learner",
        expiresAt,
      })
      let tokenRequest: { idToken: string; scope: string } | undefined

      await withServer(async (baseUrl) => {
        const response = await fetch(`${baseUrl}/mcp/k8s-docs-server?trace=1`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${sessionToken}`,
            "content-type": "application/json",
            "mcp-session-id": "client-session",
            "x-idthw-mcp-downstream-scope": "attacker:role.spoofed",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: { name: "get_k8s_docs", arguments: {} },
          }),
        })

        assert.equal(response.status, 200)
        assert.equal(response.headers.get("mcp-session-id"), "upstream-session")
        assert.equal(response.headers.get("x-mcp-gateway-server-id"), "k8s-docs-server")
      }, {
        accessScope: "api:role.mcp-accessor api:role.docs-getter",
        resolveRoute: async () => ({
          proxyUrl: `${coreMcpProxyUrl}/mcp/k8s-docs-server`,
          accessScope: "api:role.mcp-accessor",
          toolScopes: {
            get_k8s_docs: "api:role.docs-getter api:role.mcp-accessor",
            post_k8s_doc: "api:role.docs-poster api:role.mcp-accessor",
            delete_k8s_doc: "api:role.docs-deleter api:role.mcp-accessor",
          },
        }),
        getAccessToken: async (session, scope) => {
          tokenRequest = { idToken: session.idToken, scope }
          return "user-scoped-athenz-at"
        },
      })

      assert.equal(receivedPath, "/mcp/k8s-docs-server?trace=1")
      assert.equal(receivedAuthorization, "Bearer user-scoped-athenz-at")
      assert.equal(receivedDownstreamScope, "api:role.docs-getter")
      assert.equal(receivedSessionId, "client-session")
      assert.deepEqual(JSON.parse(receivedBody), {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "get_k8s_docs", arguments: {} },
      })
      assert.deepEqual(tokenRequest, {
        idToken: "stored-id-token",
        scope: "api:role.docs-getter api:role.mcp-accessor",
      })
    })
  })

  it("selects GET, POST, and DELETE access scopes from tools/call params.name", async () => {
    await withHttpServer((_request, response) => {
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [] } }))
    }, async (coreMcpProxyUrl) => {
      const sessionToken = sessionStore.create({
        idToken: "stored-id-token",
        idTokenExpiresAt: Math.floor(Date.now() / 1000) + 300,
        subject: "keycloak-subject",
        username: "idjag-learner",
        expiresAt: Math.floor(Date.now() / 1000) + 300,
      })
      const requestedScopes: string[] = []

      await withServer(async (baseUrl) => {
        for (const toolName of ["get_k8s_docs", "post_k8s_doc", "delete_k8s_doc"]) {
          const response = await fetch(`${baseUrl}/mcp/k8s-docs-server`, {
            method: "POST",
            headers: {
              authorization: `Bearer ${sessionToken}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "tools/call",
              params: { name: toolName, arguments: {} },
            }),
          })
          assert.equal(response.status, 200)
        }
      }, {
        resolveRoute: async () => ({
          proxyUrl: `${coreMcpProxyUrl}/mcp/k8s-docs-server`,
          accessScope: "api:role.docs-getter api:role.mcp-accessor",
          toolScopes: {
            get_k8s_docs: "api:role.docs-getter api:role.mcp-accessor",
            post_k8s_doc: "api:role.docs-poster api:role.mcp-accessor",
            delete_k8s_doc: "api:role.docs-deleter api:role.mcp-accessor",
          },
        }),
        getAccessToken: async (_session, scope) => {
          requestedScopes.push(scope)
          return "user-scoped-athenz-at"
        },
      })

      assert.deepEqual(requestedScopes, [
        "api:role.docs-getter api:role.mcp-accessor",
        "api:role.docs-poster api:role.mcp-accessor",
        "api:role.docs-deleter api:role.mcp-accessor",
      ])
    })
  })

  it("rejects unmapped and malformed tools/call without requesting a fallback token", async () => {
    const sessionToken = sessionStore.create({
      idToken: "stored-id-token",
      idTokenExpiresAt: Math.floor(Date.now() / 1000) + 300,
      subject: "keycloak-subject",
      username: "idjag-learner",
      expiresAt: Math.floor(Date.now() / 1000) + 300,
    })
    let accessTokenRequests = 0

    await withServer(async (baseUrl) => {
      const unmapped = await fetch(`${baseUrl}/mcp/k8s-docs-server`, {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "unconfigured_tool", arguments: {} },
        }),
      })
      assert.equal(unmapped.status, 403)
      assert.equal((await unmapped.json() as { error: string }).error, "tool_scope_not_configured")

      const malformed = await fetch(`${baseUrl}/mcp/k8s-docs-server`, {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: {} }),
      })
      assert.equal(malformed.status, 400)
      assert.equal((await malformed.json() as { error: string }).error, "invalid_tool_call")
    }, {
      resolveRoute: async () => ({
        proxyUrl: "http://core-mcp-proxy.test/mcp/k8s-docs-server",
        accessScope: "api:role.docs-getter api:role.mcp-accessor",
        toolScopes: { get_k8s_docs: "api:role.docs-getter api:role.mcp-accessor" },
      }),
      getAccessToken: async () => {
        accessTokenRequests += 1
        return "must-not-be-issued"
      },
    })

    assert.equal(accessTokenRequests, 0)
  })

  it("caches actual token grants and reuses ID-JAG after the ID token expires", async () => {
    let now = 2_000_000_000_000
    const requestedScope = "api:role.docs-getter api:role.mcp-accessor"
    const idJag = fakeJwt({
      aud: ATHENZ_ZTS_AUDIENCE,
      scp: requestedScope.split(" "),
      exp: Math.floor((now + 900_000) / 1000),
    })
    let idJagRequests = 0
    let accessTokenRequests = 0
    const forms: URLSearchParams[] = []
    const manager = new AthenzAccessTokenManager(async (form) => {
      forms.push(form)
      if (form.get("requested_token_type") === "urn:ietf:params:oauth:token-type:id-jag") {
        idJagRequests += 1
        return { access_token: idJag, expires_in: 900, scope: requestedScope }
      }

      accessTokenRequests += 1
      return {
        access_token: fakeJwt({
          aud: "api",
          scp: ["docs-getter", "mcp-accessor"],
          exp: Math.floor((now + 120_000) / 1000),
        }),
        expires_in: 120,
        scope: "docs-getter mcp-accessor",
      }
    }, () => now)
    const session = {
      idToken: "stored-id-token",
      idTokenExpiresAt: Math.floor((now + 120_000) / 1000),
      subject: "keycloak-subject",
      username: "idjag-learner",
      expiresAt: Math.floor((now + 3_600_000) / 1000),
    }

    const [first, concurrent] = await Promise.all([
      manager.getAccessToken(session, "api:role.mcp-accessor api:role.docs-getter"),
      manager.getAccessToken(session, "api:role.docs-getter api:role.mcp-accessor"),
    ])
    assert.equal(first, concurrent)
    assert.equal(idJagRequests, 1)
    assert.equal(accessTokenRequests, 1)

    now += 180_000
    const renewed = await manager.getAccessToken(session, requestedScope)

    assert.notEqual(renewed, "")
    assert.equal(idJagRequests, 1)
    assert.equal(accessTokenRequests, 2)
    assert.equal(forms[0].get("subject_token"), "stored-id-token")
    assert.equal(forms[0].get("audience"), ATHENZ_ZTS_AUDIENCE)
    assert.equal(forms[1].get("assertion"), idJag)
    assert.equal(forms[2].get("assertion"), idJag)
    const cacheStatus = manager.getCacheStatus(session)
    assert.equal(cacheStatus.entryCount, 1)
    assert.equal(cacheStatus.entries[0].scope, "docs-getter mcp-accessor")
    assert.equal(JSON.stringify(cacheStatus).includes(idJag), false)
    const idJagCacheStatus = manager.getIdJagCacheStatus(session)
    assert.equal(idJagCacheStatus.entryCount, 1)
    assert.deepEqual(idJagCacheStatus.entries[0].audiences, [ATHENZ_ZTS_AUDIENCE])
    assert.equal(idJagCacheStatus.entries[0].scope, requestedScope)
    assert.equal(idJagCacheStatus.entries[0].status, "valid")
    assert.equal(JSON.stringify(idJagCacheStatus).includes(idJag), false)
  })

  it("stores a partially granted ID-JAG under its actual audience and scope", async () => {
    let now = 2_000_000_000_000
    const grantedScope = "api:role.docs-getter"
    const idJag = fakeJwt({
      aud: ATHENZ_ZTS_AUDIENCE,
      scp: [grantedScope],
      exp: Math.floor((now + 900_000) / 1000),
    })
    let idJagRequests = 0
    let accessTokenRequests = 0
    const manager = new AthenzAccessTokenManager(async (form) => {
      if (form.get("requested_token_type") === "urn:ietf:params:oauth:token-type:id-jag") {
        idJagRequests += 1
        return { access_token: idJag, expires_in: 900, scope: grantedScope }
      }
      accessTokenRequests += 1
      assert.equal(form.get("scope"), grantedScope)
      assert.equal(form.get("assertion"), idJag)
      return {
        access_token: fakeJwt({ aud: "api", scp: ["docs-getter"], exp: Math.floor((now + 300_000) / 1000) }),
        expires_in: 300,
        scope: "docs-getter",
      }
    }, () => now)
    const session = {
      idToken: "stored-id-token",
      idTokenExpiresAt: Math.floor((now + 120_000) / 1000),
      subject: "keycloak-subject",
      username: "idjag-learner",
      expiresAt: Math.floor((now + 3_600_000) / 1000),
    }

    await assert.rejects(
      manager.getAccessToken(session, `${grantedScope} api:role.mcp-accessor`),
      AthenzInsufficientScopeError,
    )
    now += 180_000

    const accessToken = await manager.getAccessToken(session, grantedScope)
    assert.notEqual(accessToken, "")
    assert.equal(idJagRequests, 1)
    assert.equal(accessTokenRequests, 1)
  })

  it("does not reuse a role-only access-token scope across different actual audiences", async () => {
    const now = 2_000_000_000_000
    let idJagRequests = 0
    let accessTokenRequests = 0
    const manager = new AthenzAccessTokenManager(async (form) => {
      const requestedScope = form.get("scope") ?? ""
      const [audience, role = ""] = requestedScope.split(":role.")
      if (form.get("requested_token_type") === "urn:ietf:params:oauth:token-type:id-jag") {
        idJagRequests += 1
        return {
          access_token: fakeJwt({
            aud: ATHENZ_ZTS_AUDIENCE,
            scp: [requestedScope],
            exp: Math.floor((now + 600_000) / 1000),
          }),
          expires_in: 600,
          scope: requestedScope,
        }
      }
      accessTokenRequests += 1
      return {
        access_token: fakeJwt({ aud: audience, scp: [role], exp: Math.floor((now + 300_000) / 1000) }),
        expires_in: 300,
        scope: role,
      }
    }, () => now)
    const session = {
      idToken: "stored-id-token",
      idTokenExpiresAt: Math.floor((now + 300_000) / 1000),
      subject: "keycloak-subject",
      username: "idjag-learner",
      expiresAt: Math.floor((now + 3_600_000) / 1000),
    }

    await manager.getAccessToken(session, "api:role.reader")
    await manager.getAccessToken(session, "other-api:role.reader")

    assert.equal(idJagRequests, 2)
    assert.equal(accessTokenRequests, 2)
  })

  it("requires browser reauthentication when neither cached token nor a fresh ID token is available", async () => {
    const now = 2_000_000_000_000
    let tokenRequests = 0
    const manager = new AthenzAccessTokenManager(async () => {
      tokenRequests += 1
      throw new Error("must not request an ID-JAG with an expired ID token")
    }, () => now)
    const session = {
      idToken: "expired-id-token",
      idTokenExpiresAt: Math.floor((now - 1_000) / 1000),
      subject: "keycloak-subject",
      username: "idjag-learner",
      expiresAt: Math.floor((now + 3_600_000) / 1000),
    }

    await assert.rejects(
      manager.getAccessToken(session, "api:role.docs-getter"),
      ReauthenticationRequiredError,
    )
    assert.equal(tokenRequests, 0)
  })

  it("requires browser reauthentication when ZTS rejects an otherwise fresh ID token", async () => {
    const now = 2_000_000_000_000
    const manager = new AthenzAccessTokenManager(async () => ({
      error: "invalid_grant",
      error_description: "The subject ID token is expired",
    }), () => now)
    const session = {
      idToken: "rejected-id-token",
      idTokenExpiresAt: Math.floor((now + 300_000) / 1000),
      subject: "keycloak-subject",
      username: "idjag-learner",
      expiresAt: Math.floor((now + 3_600_000) / 1000),
    }

    await assert.rejects(
      manager.getAccessToken(session, "api:role.docs-getter"),
      ReauthenticationRequiredError,
    )
  })

  it("resolves and caches route metadata from the MCP Hub API", async () => {
    let registryRequests = 0
    await withHttpServer((request, response) => {
      registryRequests += 1
      assert.equal(request.headers.authorization, "Bearer registry-secret")
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({
        servers: [{
          routeId: "k8s-docs-server",
          proxyUrl: "http://core-mcp-proxy.mcp-hub:8080/mcp/k8s-docs-server",
          accessScope: "api:role.mcp-accessor api:role.docs-getter",
          toolScopes: {
            get_k8s_docs: "api:role.docs-getter api:role.mcp-accessor",
            post_k8s_doc: "api:role.docs-poster api:role.mcp-accessor",
          },
        }],
      }))
    }, async (registryOrigin) => {
      const registry = new McpRegistryClient(`${registryOrigin}/api/mcp-servers`, "registry-secret", 5000)
      const first = await registry.resolveRoute("k8s-docs-server")
      const cached = await registry.resolveRoute("k8s-docs-server")

      assert.deepEqual(first, {
        proxyUrl: "http://core-mcp-proxy.mcp-hub:8080/mcp/k8s-docs-server",
        accessScope: "api:role.mcp-accessor api:role.docs-getter",
        toolScopes: {
          get_k8s_docs: "api:role.docs-getter api:role.mcp-accessor",
          post_k8s_doc: "api:role.docs-poster api:role.mcp-accessor",
        },
      })
      assert.deepEqual(cached, first)
      assert.equal(registryRequests, 1)
    })
  })

  it("resolves an opaque bearer without exposing the stored ID token", async () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 300
    const token = sessionStore.create({
      idToken: "stored-id-token",
      idTokenExpiresAt: expiresAt,
      subject: "keycloak-subject",
      username: "idjag-learner",
      expiresAt,
    })

    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/session`, {
        headers: { authorization: `Bearer ${token}` },
      })
      assert.equal(response.status, 200)
      const body = await response.json() as Record<string, unknown>
      assert.equal(body.username, "idjag-learner")
      assert.equal(body.expires_at, expiresAt)
      assert.equal("idToken" in body, false)
    })
  })

  it("validates PKCE and limits plaintext redirects to loopback", () => {
    const verifier = "test-verifier-with-enough-random-looking-characters"
    const challenge = deriveS256CodeChallenge(verifier)
    assert.equal(verifyS256CodeChallenge(verifier, challenge), true)
    assert.equal(verifyS256CodeChallenge("wrong-verifier", challenge), false)
    assert.equal(isAllowedRedirectUri("http://127.0.0.1:43123/callback"), true)
    assert.equal(isAllowedRedirectUri("https://client.example/callback"), true)
    assert.equal(isAllowedRedirectUri("http://client.example/callback"), false)
  })
})

async function withServer(
  run: (baseUrl: string) => Promise<void>,
  dependencies: Partial<ProtectedRouterDependencies> = {},
  internalDependencies: Partial<InternalRouterDependencies> = {},
) {
  const server = createApp(dependencies, internalDependencies).listen(0, "127.0.0.1")
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve)
    server.once("error", reject)
  })

  try {
    const address = server.address() as AddressInfo
    await run(`http://127.0.0.1:${address.port}`)
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
  }
}

async function withHttpServer(listener: RequestListener, run: (baseUrl: string) => Promise<void>) {
  const server = createServer(listener).listen(0, "127.0.0.1")
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve)
    server.once("error", reject)
  })

  try {
    const address = server.address() as AddressInfo
    await run(`http://127.0.0.1:${address.port}`)
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
  }
}

function fakeJwt(claims: Record<string, unknown>) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url")
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url")
  return `${header}.${payload}.signature`
}
