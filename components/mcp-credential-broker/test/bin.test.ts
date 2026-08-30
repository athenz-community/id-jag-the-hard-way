import assert from "node:assert/strict"
import { execFile, spawn } from "node:child_process"
import { mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { it } from "node:test"
import { SharedSessionStore } from "../src/sharedSession.js"

const execFileAsync = promisify(execFile)

it("runs the CLI when npm invokes it through a bin symlink", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "idthw-mcp-broker-bin-test-"))
  const source = fileURLToPath(new URL("../src/index.ts", import.meta.url))
  const linkedBin = path.join(directory, "idthw-mcp-connect.ts")

  try {
    await symlink(source, linkedBin)
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ["--import", "tsx", linkedBin, "--help"],
      {
        cwd: path.dirname(fileURLToPath(new URL("../package.json", import.meta.url))),
        env: { ...process.env, NODE_NO_WARNINGS: "1" },
      },
    )

    assert.match(stdout, /^Usage: idthw-mcp-connect/)
    assert.equal(stderr, "")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it("logs out by clearing only locally cached Gateway sessions", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "idthw-mcp-broker-logout-test-"))
  const source = fileURLToPath(new URL("../src/index.ts", import.meta.url))
  const linkedBin = path.join(directory, "idthw-mcp-connect.ts")
  const cacheDirectory = path.join(directory, "credentials")

  try {
    await symlink(source, linkedBin)
    const sessionStore = new SharedSessionStore(cacheDirectory)
    for (const issuer of ["https://gateway-one.example", "https://gateway-two.example"]) {
      await sessionStore.getOrCreate(issuer, async () => ({
        version: 1,
        issuer,
        accessToken: `opaque-session-for-${issuer}`,
        tokenType: "Bearer",
        expiresAt: Date.now() + 300_000,
      }))
    }
    await writeFile(path.join(cacheDirectory, "keep.txt"), "not a broker credential\n")

    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ["--import", "tsx", linkedBin, "--logout"],
      {
        cwd: path.dirname(fileURLToPath(new URL("../package.json", import.meta.url))),
        env: {
          ...process.env,
          IDTHW_MCP_CREDENTIAL_CACHE_DIR: cacheDirectory,
          NODE_NO_WARNINGS: "1",
        },
      },
    )

    assert.equal(stdout, "Cleared 2 locally cached MCP Gateway sessions.\n")
    assert.equal(stderr, "")
    assert.deepEqual(await readdir(cacheDirectory), ["keep.txt"])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it("completes an MCP initialize handshake when launched through a bin symlink", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "idthw-mcp-broker-handshake-test-"))
  const source = fileURLToPath(new URL("../src/index.ts", import.meta.url))
  const linkedBin = path.join(directory, "idthw-mcp-connect.ts")

  try {
    await symlink(source, linkedBin)
    await withMockGateway(async (gatewayUrl) => {
      const cacheDirectory = path.join(directory, "credentials")
      const sessionStore = new SharedSessionStore(cacheDirectory)
      await sessionStore.getOrCreate(gatewayUrl, async () => ({
        version: 1,
        issuer: gatewayUrl,
        accessToken: "opaque-test-session",
        tokenType: "Bearer",
        expiresAt: Date.now() + 300_000,
      }))

      const child = spawn(
        process.execPath,
        ["--import", "tsx", linkedBin, `${gatewayUrl}/mcp/confluence-mcp`],
        {
          cwd: path.dirname(fileURLToPath(new URL("../package.json", import.meta.url))),
          env: {
            ...process.env,
            IDTHW_MCP_CREDENTIAL_CACHE_DIR: cacheDirectory,
            NODE_NO_WARNINGS: "1",
          },
          stdio: ["pipe", "pipe", "pipe"],
        },
      )

      let stderr = ""
      child.stderr.on("data", (chunk) => { stderr += chunk.toString() })
      const responsePromise = readJsonLine(child.stdout, child, () => stderr)
      child.stdin.write(`${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "codex-test", version: "1.0.0" },
        },
      })}\n`)

      try {
        const response = await withTimeout(responsePromise, 5_000)
        assert.equal(response.id, 1)
        assert.equal(response.result?.serverInfo?.name, "mock-upstream")
      } finally {
        child.kill()
      }
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

async function withMockGateway(run: (gatewayUrl: string) => Promise<void>) {
  let gatewayUrl = ""
  const server = createServer(async (request, response) => {
    if (request.url === "/.well-known/oauth-protected-resource/mcp/confluence-mcp") {
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ authorization_servers: [gatewayUrl] }))
      return
    }
    if (request.url === "/.well-known/oauth-authorization-server") {
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({
        issuer: gatewayUrl,
        authorization_endpoint: `${gatewayUrl}/oauth/authorize`,
        token_endpoint: `${gatewayUrl}/oauth/token`,
        registration_endpoint: `${gatewayUrl}/oauth/register`,
        code_challenge_methods_supported: ["S256"],
      }))
      return
    }
    if (request.url === "/mcp/confluence-mcp" && request.method === "GET") {
      response.writeHead(405).end()
      return
    }
    if (request.url === "/mcp/confluence-mcp" && request.method === "POST") {
      assert.equal(request.headers.authorization, "Bearer opaque-test-session")
      let rawBody = ""
      for await (const chunk of request) rawBody += chunk.toString()
      const message = JSON.parse(rawBody) as { id?: string | number; method?: string }
      if (message.method === "initialize") {
        response.setHeader("content-type", "application/json")
        response.end(JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            protocolVersion: "2025-06-18",
            capabilities: { tools: {} },
            serverInfo: { name: "mock-upstream", version: "1.0.0" },
          },
        }))
      } else {
        response.writeHead(202).end()
      }
      return
    }
    response.writeHead(404).end()
  })
  server.listen(0, "127.0.0.1")
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve)
    server.once("error", reject)
  })
  gatewayUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  try {
    await run(gatewayUrl)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

function readJsonLine(
  stream: NodeJS.ReadableStream,
  child: ReturnType<typeof spawn>,
  stderr: () => string,
) {
  return new Promise<{ id?: number; result?: { serverInfo?: { name?: string } } }>((resolve, reject) => {
    let buffer = ""
    stream.on("data", (chunk) => {
      buffer += chunk.toString()
      const newline = buffer.indexOf("\n")
      if (newline < 0) return
      try {
        resolve(JSON.parse(buffer.slice(0, newline)))
      } catch (error) {
        reject(error)
      }
    })
    child.once("error", reject)
    child.once("exit", (code) => reject(new Error(`Broker exited before initialize response (${code}): ${stderr()}`)))
  })
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Timed out waiting for MCP initialize response")), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
