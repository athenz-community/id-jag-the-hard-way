import assert from "node:assert/strict"
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  assertExchangedTokenGrant,
  createAthenzTokenFilePublisher,
  DownstreamTokenExchangeError,
  tokenExchangeConfigFromEnvironment,
} from "../src/tokenExchange.ts"

test("loads token-file exchange defaults only when explicitly enabled", () => {
  assert.equal(tokenExchangeConfigFromEnvironment({}), undefined)
  const config = tokenExchangeConfigFromEnvironment({ ATHENZ_TOKEN_FILE_EXCHANGE_ENABLED: "true" })
  assert.ok(config)
  assert.equal(config.endpoint.toString(), "https://athenz-zts-server.athenz:4443/zts/v1/oauth2/token")
  assert.equal(config.certificatePath, "/var/run/athenz/service.cert.pem")
  assert.equal(config.keyPath, "/var/run/athenz/service.key.pem")
  assert.equal(config.caPath, "/var/run/athenz/ca.crt")
  assert.equal(config.outputDirectory, "/var/run/idthw-access-tokens")
})

test("publishes an exchanged token atomically in a request-scoped file", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "mcp-runtime-token-test-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  let exchangeInput: { audience: string; scope: string; sourceToken: string } | undefined
  const publisher = createAthenzTokenFilePublisher({
    caPath: "/unused/ca",
    certificatePath: "/unused/cert",
    endpoint: new URL("https://zts.example.test/zts/v1/oauth2/token"),
    keyPath: "/unused/key",
    outputDirectory: directory,
    timeoutMs: 1000,
  }, {
    exchange: async (_config, sourceToken, scope, audience) => {
      exchangeInput = { audience, scope, sourceToken }
      return "test-exchanged-token"
    },
  })

  const publication = await publisher.publish({
    requestId: "12345678-1234-1234-1234-123456789abc",
    scope: "api:role.docs-poster api:role.docs-getter",
    sourceToken: "test-source-token",
    toolName: "post_k8s_doc",
  })

  assert.deepEqual(exchangeInput, {
    audience: "api",
    scope: "api:role.docs-getter api:role.docs-poster",
    sourceToken: "test-source-token",
  })
  assert.equal(
    publication.filePath,
    join(directory, "post_k8s_doc", "12345678-1234-1234-1234-123456789abc.jwt"),
  )
  assert.equal(await readFile(publication.filePath, "utf8"), "test-exchanged-token\n")
  assert.equal((await stat(publication.filePath)).mode & 0o777, 0o640)
  assert.deepEqual(await readdir(join(directory, "post_k8s_doc")), ["12345678-1234-1234-1234-123456789abc.jwt"])

  await publication.remove()
  assert.deepEqual(await readdir(join(directory, "post_k8s_doc")), [])
})

test("rejects multiple downstream domains and unsafe tool names", async () => {
  const publisher = createAthenzTokenFilePublisher({
    caPath: "/unused/ca",
    certificatePath: "/unused/cert",
    endpoint: new URL("https://zts.example.test/zts/v1/oauth2/token"),
    keyPath: "/unused/key",
    outputDirectory: "/tmp/test-token-output",
    timeoutMs: 1000,
  }, { exchange: async () => "unused" })
  const base = {
    requestId: "12345678-1234-1234-1234-123456789abc",
    sourceToken: "test-source-token",
    toolName: "get_k8s_docs",
  }

  await assert.rejects(
    publisher.publish({ ...base, scope: "api:role.reader storage:role.reader" }),
    (error) => error instanceof DownstreamTokenExchangeError && error.status === 502,
  )
  await assert.rejects(
    publisher.publish({ ...base, scope: "api:role.reader", toolName: "../escape" }),
    (error) => error instanceof DownstreamTokenExchangeError && error.status === 502,
  )
})

test("validates the exchanged token audience, scope, and lifetime", () => {
  const valid = tokenForTest({
    aud: "api",
    exp: Math.floor(Date.now() / 1000) + 300,
    scp: ["docs-getter"],
  })
  assert.doesNotThrow(() => assertExchangedTokenGrant(valid, "api", "api:role.docs-getter"))

  assert.throws(
    () => assertExchangedTokenGrant(tokenForTest({
      aud: "wrong",
      exp: Math.floor(Date.now() / 1000) + 300,
      scp: ["docs-getter"],
    }), "api", "api:role.docs-getter"),
    /invalid downstream access token/,
  )
  assert.throws(
    () => assertExchangedTokenGrant(tokenForTest({
      aud: "api",
      exp: Math.floor(Date.now() / 1000) - 1,
      scp: ["docs-getter"],
    }), "api", "api:role.docs-getter"),
    /invalid downstream access token/,
  )
})

function tokenForTest(claims: Record<string, unknown>) {
  return [
    Buffer.from(JSON.stringify({ alg: "RS256", typ: "at+jwt" })).toString("base64url"),
    Buffer.from(JSON.stringify(claims)).toString("base64url"),
    "test-signature",
  ].join(".")
}
