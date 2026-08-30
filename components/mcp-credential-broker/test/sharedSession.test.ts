import assert from "node:assert/strict"
import { chmod, mkdir, mkdtemp, rm, stat, symlink, unlink, utimes, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, it } from "node:test"
import type { GatewayCredential } from "../src/sharedSession.js"
import { sessionPaths, SharedSessionStore } from "../src/sharedSession.js"

const ISSUER = "https://gateway.example"

describe("SharedSessionStore", () => {
  it("runs one acquisition while concurrent connector processes share the result", async () => {
    await withTemporaryDirectory(async (directory) => {
      let acquisitions = 0
      const acquire = async () => {
        acquisitions += 1
        await new Promise((resolve) => setTimeout(resolve, 30))
        return credential("shared-session", Date.now() + 300_000)
      }
      const stores = [
        new SharedSessionStore(directory, { pollIntervalMs: 5 }),
        new SharedSessionStore(directory, { pollIntervalMs: 5 }),
        new SharedSessionStore(directory, { pollIntervalMs: 5 }),
      ]

      const sessions = await Promise.all(stores.map((store) => store.getOrCreate(ISSUER, acquire)))

      assert.equal(acquisitions, 1)
      assert.deepEqual(sessions.map((session) => session.accessToken), [
        "shared-session",
        "shared-session",
        "shared-session",
      ])
      if (process.platform !== "win32") {
        const paths = sessionPaths(directory, ISSUER)
        assert.equal((await stat(directory)).mode & 0o777, 0o700)
        assert.equal((await stat(paths.credential)).mode & 0o777, 0o600)
      }
    })
  })

  it("replaces a cached credential after its usable lifetime", async () => {
    await withTemporaryDirectory(async (directory) => {
      let now = 1_000_000
      let acquisitions = 0
      const store = new SharedSessionStore(directory, { now: () => now })
      const acquire = async () => credential(`session-${++acquisitions}`, now + 120_000)

      const first = await store.getOrCreate(ISSUER, acquire)
      now += 70_000
      const second = await store.getOrCreate(ISSUER, acquire)

      assert.equal(first.accessToken, "session-1")
      assert.equal(second.accessToken, "session-2")
      assert.equal(acquisitions, 2)
    })
  })

  it("recovers a stale lock left by a terminated connector", async () => {
    await withTemporaryDirectory(async (directory) => {
      const paths = sessionPaths(directory, ISSUER)
      await writeFile(paths.lock, JSON.stringify({ nonce: "abandoned" }), { mode: 0o600 })
      const old = new Date(Date.now() - 60_000)
      await utimes(paths.lock, old, old)
      let waited = 0
      const store = new SharedSessionStore(directory, {
        lockStaleMs: 1_000,
        pollIntervalMs: 1,
        onWait: () => { waited += 1 },
      })

      const result = await store.getOrCreate(ISSUER, async () => credential("recovered", Date.now() + 300_000))

      assert.equal(result.accessToken, "recovered")
      assert.equal(waited, 1)
    })
  })

  it("does not delete a replacement credential while invalidations race", async () => {
    await withTemporaryDirectory(async (directory) => {
      const store = new SharedSessionStore(directory, { pollIntervalMs: 2 })
      await store.getOrCreate(ISSUER, async () => credential("rejected-session", Date.now() + 300_000))
      const paths = sessionPaths(directory, ISSUER)
      await writeFile(paths.lock, JSON.stringify({ nonce: "refresh-in-progress" }), { mode: 0o600 })

      const invalidation = store.invalidate(ISSUER, "rejected-session")
      await new Promise((resolve) => setTimeout(resolve, 10))
      await writeFile(
        paths.credential,
        JSON.stringify(credential("replacement-session", Date.now() + 300_000)),
        { mode: 0o600 },
      )
      await unlink(paths.lock)
      await invalidation

      const result = await store.getOrCreate(ISSUER, async () => {
        throw new Error("replacement credential should remain cached")
      })
      assert.equal(result.accessToken, "replacement-session")
    })
  })

  it("does not follow a credential-cache directory symlink", async () => {
    if (process.platform === "win32") return
    await withTemporaryDirectory(async (directory) => {
      const privateDirectory = path.join(directory, "private")
      const linkedDirectory = path.join(directory, "linked")
      await chmod(directory, 0o700)
      await mkdir(privateDirectory)
      await symlink(privateDirectory, linkedDirectory)
      const store = new SharedSessionStore(linkedDirectory)

      await assert.rejects(
        store.getOrCreate(ISSUER, async () => credential("must-not-write", Date.now() + 300_000)),
        /not a private directory/,
      )
    })
  })

  it("does not change permissions on an unsafe existing cache directory", async () => {
    if (process.platform === "win32") return
    await withTemporaryDirectory(async (directory) => {
      await chmod(directory, 0o755)
      const store = new SharedSessionStore(directory)

      await assert.rejects(
        store.getOrCreate(ISSUER, async () => credential("must-not-write", Date.now() + 300_000)),
        /must not be accessible by group or other users/,
      )
      assert.equal((await stat(directory)).mode & 0o777, 0o755)
    })
  })
})

function credential(accessToken: string, expiresAt: number): GatewayCredential {
  return { version: 1, issuer: ISSUER, accessToken, tokenType: "Bearer", expiresAt }
}

async function withTemporaryDirectory(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "idthw-mcp-broker-test-"))
  try {
    await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
