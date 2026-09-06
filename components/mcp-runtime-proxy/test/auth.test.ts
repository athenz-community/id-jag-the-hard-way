import assert from "node:assert/strict"
import { generateKeyPairSync, sign } from "node:crypto"
import http, { type Server } from "node:http"
import test from "node:test"
import {
  AccessTokenError,
  createAthenzAccessTokenVerifier,
  createRemoteJwksKeyResolver,
} from "../src/auth.ts"

const NOW = 1_800_000_000_000
const AUDIENCE = "mcp-hub.mcps.k8s-docs-server"
const REQUIRED_SCOPE = `${AUDIENCE}:role.accessor`
const signingKeys = generateKeyPairSync("rsa", { modulusLength: 2048 })
const publicJwk = {
  ...signingKeys.publicKey.export({ format: "jwk" }),
  alg: "RS256",
  kid: "zts-test-key",
  use: "sig",
}

test("accepts a signed, unexpired Athenz access token for the required audience and scope", async () => {
  const verifier = verifierForTest()

  const verification = await verifier.verify(`Bearer ${accessToken({
    aud: AUDIENCE,
    client_id: "mcp-hub.mcp-gateway",
    exp: NOW / 1000 + 300,
    scp: ["accessor"],
    sub: "mcp-hub.mcp-gateway",
    uid: "idjag-learner",
  })}`)

  assert.deepEqual(verification, {
    audiences: [AUDIENCE],
    clientId: "mcp-hub.mcp-gateway",
    expiresAt: new Date(NOW + 300_000).toISOString(),
    expiresInSeconds: 300,
    keyId: "zts-test-key",
    scopes: ["accessor"],
    subject: "mcp-hub.mcp-gateway",
    userId: "idjag-learner",
  })
})

test("accepts a fully-qualified managed scope in a multi-audience token", async () => {
  const verifier = verifierForTest()

  await verifier.verify(`Bearer ${accessToken({
    aud: ["api", AUDIENCE],
    exp: NOW / 1000 + 300,
    scp: ["api:role.docs-getter", REQUIRED_SCOPE],
  })}`)
})

test("rejects missing, expired, incorrectly signed, and wrong-audience tokens", async () => {
  const verifier = verifierForTest()
  const otherKeys = generateKeyPairSync("rsa", { modulusLength: 2048 })

  await assertAccessError(() => verifier.verify(undefined), 401, "missing_access_token")
  await assertAccessError(() => verifier.verify(`Bearer ${accessToken({
    aud: AUDIENCE,
    exp: NOW / 1000,
    scp: ["accessor"],
  })}`), 401, "invalid_access_token")
  await assertAccessError(() => verifier.verify(`Bearer ${accessToken({
    aud: AUDIENCE,
    exp: NOW / 1000 + 300,
    scp: ["accessor"],
  }, otherKeys.privateKey)}`), 401, "invalid_access_token")
  await assertAccessError(() => verifier.verify(`Bearer ${accessToken({
    aud: "other-domain",
    exp: NOW / 1000 + 300,
    scp: ["accessor"],
  })}`), 401, "invalid_access_token")
})

test("rejects a valid token without the required scope", async () => {
  const verifier = verifierForTest()

  await assertAccessError(() => verifier.verify(`Bearer ${accessToken({
    aud: AUDIENCE,
    exp: NOW / 1000 + 300,
    scp: ["reader"],
  })}`), 403, "insufficient_scope")
})

test("loads RSA signing keys from the configured JWKS URI", async (t) => {
  let requestedUrl = ""
  const jwks = http.createServer((request, response) => {
    requestedUrl = request.url ?? ""
    response.setHeader("content-type", "application/json")
    response.end(JSON.stringify({ keys: [publicJwk] }))
  })
  const port = await listen(jwks)
  t.after(() => close(jwks))
  const resolveSigningKey = createRemoteJwksKeyResolver({
    allowInsecureHttp: true,
    jwksUrl: new URL(`http://127.0.0.1:${port}/zts/v1/oauth2/keys?rfc=true`),
  })
  const verifier = createAthenzAccessTokenVerifier({
    expectedAudience: AUDIENCE,
    now: () => NOW,
    requiredScope: REQUIRED_SCOPE,
    resolveSigningKey,
  })

  await verifier.verify(`Bearer ${accessToken({
    aud: AUDIENCE,
    exp: NOW / 1000 + 300,
    scope: "accessor",
  })}`)
  assert.equal(requestedUrl, "/zts/v1/oauth2/keys?rfc=true")
})

test("refreshes JWKS after ZTS rotates a signing key", async (t) => {
  const rotatedKeys = generateKeyPairSync("rsa", { modulusLength: 2048 })
  const rotatedPublicJwk = {
    ...rotatedKeys.publicKey.export({ format: "jwk" }),
    alg: "RS256",
    kid: "zts-test-key",
    use: "sig",
  }
  let requests = 0
  const jwks = http.createServer((_request, response) => {
    requests += 1
    response.setHeader("content-type", "application/json")
    response.end(JSON.stringify({ keys: [requests === 1 ? publicJwk : rotatedPublicJwk] }))
  })
  const port = await listen(jwks)
  t.after(() => close(jwks))
  const verifier = createAthenzAccessTokenVerifier({
    expectedAudience: AUDIENCE,
    now: () => NOW,
    requiredScope: REQUIRED_SCOPE,
    resolveSigningKey: createRemoteJwksKeyResolver({
      allowInsecureHttp: true,
      jwksUrl: new URL(`http://127.0.0.1:${port}/zts/v1/oauth2/keys?rfc=true`),
    }),
  })
  const claims = {
    aud: AUDIENCE,
    exp: NOW / 1000 + 300,
    scp: ["accessor"],
  }

  await verifier.verify(`Bearer ${accessToken(claims)}`)
  await verifier.verify(`Bearer ${accessToken(claims, rotatedKeys.privateKey)}`)

  assert.equal(requests, 2)
})

function verifierForTest() {
  return createAthenzAccessTokenVerifier({
    expectedAudience: AUDIENCE,
    now: () => NOW,
    requiredScope: REQUIRED_SCOPE,
    resolveSigningKey: async () => signingKeys.publicKey,
  })
}

function accessToken(claims: Record<string, unknown>, privateKey = signingKeys.privateKey) {
  const header = encode({ alg: "RS256", kid: "zts-test-key", typ: "at+jwt" })
  const payload = encode(claims)
  const signingInput = `${header}.${payload}`
  const signature = sign("RSA-SHA256", Buffer.from(signingInput, "ascii"), privateKey).toString("base64url")
  return `${signingInput}.${signature}`
}

function encode(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url")
}

async function assertAccessError(
  operation: () => Promise<void>,
  status: number,
  code: string,
) {
  await assert.rejects(operation, (error) => (
    error instanceof AccessTokenError
    && error.status === status
    && error.code === code
  ))
}

function listen(server: Server) {
  return new Promise<number>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        reject(new Error("Test server did not receive a TCP port"))
        return
      }
      resolve(address.port)
    })
  })
}

function close(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
}
