import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { describe, it } from "node:test"
import {
  deriveS256CodeChallenge,
  discoverOAuthEndpoints,
  performAuthorizationCodeLogin,
  revokeGatewayCredential,
  type FetchLike,
  type OAuthEndpoints,
} from "../src/oauth.js"

describe("OAuth client", () => {
  it("discovers the Gateway authorization server from route-specific protected-resource metadata", async () => {
    const requested: string[] = []
    const fetch: FetchLike = async (url) => {
      requested.push(url.toString())
      if (url.toString().includes("oauth-protected-resource")) {
        return Response.json({ authorization_servers: ["https://gateway.example"] })
      }
      return Response.json({
        issuer: "https://gateway.example",
        authorization_endpoint: "https://gateway.example/oauth/authorize",
        token_endpoint: "https://gateway.example/oauth/token",
        registration_endpoint: "https://gateway.example/oauth/register",
        code_challenge_methods_supported: ["S256"],
      })
    }

    const endpoints = await discoverOAuthEndpoints(
      new URL("https://gateway.example/mcp/confluence"),
      { fetch },
    )

    assert.deepEqual(requested, [
      "https://gateway.example/.well-known/oauth-protected-resource/mcp/confluence",
      "https://gateway.example/.well-known/oauth-authorization-server",
    ])
    assert.deepEqual(endpoints, gatewayEndpoints())
  })

  it("rejects plaintext non-loopback Gateway URLs unless development mode is explicit", async () => {
    await assert.rejects(
      discoverOAuthEndpoints(new URL("http://gateway.example/mcp/server"), {
        fetch: async () => { throw new Error("must not fetch") },
      }),
      /must use HTTPS/,
    )
  })

  it("registers an ephemeral public client and validates the PKCE browser callback", async () => {
    let authorizationUrl: URL | undefined
    let registeredRedirectUri = ""
    let tokenForm: URLSearchParams | undefined
    const fetch: FetchLike = async (url, init) => {
      if (url.toString().endsWith("/oauth/register")) {
        const registration = JSON.parse(String(init?.body)) as { redirect_uris: string[]; token_endpoint_auth_method: string }
        registeredRedirectUri = registration.redirect_uris[0]
        assert.equal(registration.token_endpoint_auth_method, "none")
        return Response.json({ client_id: "public-client" }, { status: 201 })
      }
      if (url.toString().endsWith("/oauth/token")) {
        tokenForm = init?.body as URLSearchParams
        return Response.json({ access_token: "opaque-gateway-session", token_type: "Bearer", expires_in: 300 })
      }
      throw new Error(`Unexpected request: ${url}`)
    }

    const result = await performAuthorizationCodeLogin(gatewayEndpoints(), {
      fetch,
      now: () => 10_000,
      openBrowser: async (value) => {
        authorizationUrl = new URL(value)
        assert.equal(authorizationUrl.searchParams.get("client_id"), "public-client")
        assert.equal(authorizationUrl.searchParams.get("redirect_uri"), registeredRedirectUri)
        const callback = new URL(registeredRedirectUri)
        callback.searchParams.set("code", "gateway-code")
        callback.searchParams.set("state", authorizationUrl.searchParams.get("state") ?? "")
        const response = await globalThis.fetch(callback)
        assert.equal(response.status, 200)
      },
    })

    assert.ok(authorizationUrl)
    assert.equal(tokenForm?.get("code"), "gateway-code")
    assert.equal(tokenForm?.get("client_id"), "public-client")
    const verifier = tokenForm?.get("code_verifier") ?? ""
    assert.equal(
      authorizationUrl.searchParams.get("code_challenge"),
      createHash("sha256").update(verifier).digest("base64url"),
    )
    assert.deepEqual(result, {
      version: 1,
      issuer: "https://gateway.example",
      accessToken: "opaque-gateway-session",
      tokenType: "Bearer",
      expiresAt: 310_000,
    })
  })

  it("derives an S256 challenge without exposing the verifier", () => {
    const verifier = "a-private-pkce-verifier"
    assert.equal(deriveS256CodeChallenge(verifier), createHash("sha256").update(verifier).digest("base64url"))
    assert.notEqual(deriveS256CodeChallenge(verifier), verifier)
  })

  it("discovers the cached issuer's revocation endpoint and revokes its Gateway session", async () => {
    const requested: string[] = []
    let revocationForm: URLSearchParams | undefined
    const fetch: FetchLike = async (url, init) => {
      requested.push(url.toString())
      if (url.toString().endsWith("/.well-known/oauth-authorization-server")) {
        return Response.json({
          issuer: "https://gateway.example",
          revocation_endpoint: "https://gateway.example/oauth/revoke",
        })
      }
      revocationForm = init?.body as URLSearchParams
      return new Response(null, { status: 200 })
    }

    await revokeGatewayCredential({
      version: 1,
      issuer: "https://gateway.example",
      accessToken: "opaque-gateway-session",
      tokenType: "Bearer",
      expiresAt: Date.now() + 300_000,
    }, { fetch })

    assert.deepEqual(requested, [
      "https://gateway.example/.well-known/oauth-authorization-server",
      "https://gateway.example/oauth/revoke",
    ])
    assert.equal(revocationForm?.get("token"), "opaque-gateway-session")
    assert.equal(revocationForm?.get("token_type_hint"), "access_token")
  })
})

function gatewayEndpoints(): OAuthEndpoints {
  return {
    issuer: "https://gateway.example",
    authorizationEndpoint: "https://gateway.example/oauth/authorize",
    tokenEndpoint: "https://gateway.example/oauth/token",
    registrationEndpoint: "https://gateway.example/oauth/register",
  }
}
