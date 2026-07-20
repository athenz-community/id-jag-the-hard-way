import assert from "node:assert/strict"
import { generateKeyPairSync, sign } from "node:crypto"
import { test } from "node:test"
import { AccessTokenError, createTokenVerifier } from "../src/auth.ts"

const now = 1_800_000_000
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
const verifyToken = createTokenVerifier({ publicKey, now: () => now })

test("validates an Athenz AT and returns its project and human subject", () => {
  const context = verifyToken(`Bearer ${accessToken()}`)

  assert.deepEqual(context, {
    audience: "gen-ai.services.athenz",
    clientId: "home.alice.local.athenzd",
    project: "athenz",
    scope: "gen-ai.services.athenz:role.gen-ai-users",
    subject: "user.alice",
  })
})

test("requires the gen-ai-users scope", () => {
  assertAccessTokenError(
    () => verifyToken(`Bearer ${accessToken({ scp: ["docs-reader"], scope: "docs-reader" })}`),
    403,
    "insufficient_scope",
  )
})

test("rejects missing, expired, wrong-project, and incorrectly signed tokens", () => {
  assertAccessTokenError(() => verifyToken(undefined), 401, "missing_access_token")
  assertAccessTokenError(
    () => verifyToken(`Bearer ${accessToken({ exp: now })}`),
    401,
    "invalid_access_token",
  )
  assertAccessTokenError(
    () => verifyToken(`Bearer ${accessToken({ aud: "other.services.athenz" })}`),
    401,
    "invalid_access_token",
  )

  const otherKeys = generateKeyPairSync("rsa", { modulusLength: 2048 })
  assertAccessTokenError(
    () => verifyToken(`Bearer ${accessToken({}, otherKeys.privateKey)}`),
    401,
    "invalid_access_token",
  )
})

function accessToken(overrides: Record<string, unknown> = {}, signingKey = privateKey) {
  const header = encode({ alg: "RS256", typ: "at+jwt", kid: "test-zts" })
  const payload = encode({
    sub: "user.alice",
    aud: "gen-ai.services.athenz",
    exp: now + 3600,
    iat: now,
    scp: ["gen-ai-users"],
    scope: "gen-ai-users",
    client_id: "home.alice.local.athenzd",
    ...overrides,
  })
  const signature = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), signingKey).toString("base64url")
  return `${header}.${payload}.${signature}`
}

function encode(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url")
}

function assertAccessTokenError(action: () => unknown, statusCode: number, code: string) {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof AccessTokenError)
    assert.equal(error.statusCode, statusCode)
    assert.equal(error.code, code)
    return true
  })
}
