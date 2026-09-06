import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import http, { type Server } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { createDelegatedK8sDocsMcpServer } from "../src/server.ts"
import { MCP_ACCESS_TOKEN_FILE_META_KEY } from "../src/tokenFile.ts"

test("supports stateless initialization and tool discovery", async (t) => {
  const server = createDelegatedK8sDocsMcpServer({ upstreamBaseUrl: new URL("http://127.0.0.1:1") })
  const port = await listen(server)
  t.after(() => close(server))

  const initialized = await callMcp(port, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18" },
  })
  assert.equal(initialized.result.protocolVersion, "2025-06-18")
  assert.equal(initialized.result.serverInfo.name, "idthw-demo-api-mcp")

  const listed = await callMcp(port, { jsonrpc: "2.0", id: 2, method: "tools/list" })
  assert.deepEqual(
    listed.result.tools.map((tool: { name: string }) => tool.name),
    ["get_k8s_docs", "post_k8s_doc", "delete_k8s_doc"],
  )
})

test("reads the request-scoped token file and forwards it to K8s Docs", async (t) => {
  const tokenDirectory = await mkdtemp(join(tmpdir(), "delegated-mcp-token-test-"))
  t.after(() => rm(tokenDirectory, { recursive: true, force: true }))
  const tokenFile = await writeToolToken(tokenDirectory, "get_k8s_docs", "12345678-1234-1234-1234-123456789abc.jwt", "first.test.token")

  const receivedAuthorizations: string[] = []
  const upstream = http.createServer((request, response) => {
    receivedAuthorizations.push(request.headers.authorization ?? "")
    response.setHeader("content-type", "application/json")
    response.end(JSON.stringify([{ id: 1, name: "Example" }]))
  })
  const upstreamPort = await listen(upstream)
  t.after(() => close(upstream))
  const server = createDelegatedK8sDocsMcpServer({
    tokenDirectory,
    upstreamBaseUrl: new URL(`http://127.0.0.1:${upstreamPort}`),
  })
  const port = await listen(server)
  t.after(() => close(server))

  const first = await callMcp(port, toolCall("get_k8s_docs", tokenFile))
  assert.equal(first.result.isError, false)
  assert.deepEqual(first.result.structuredContent.data, [{ id: 1, name: "Example" }])

  await writeFile(tokenFile, "second.test.token\n", { encoding: "utf8", mode: 0o640 })
  await callMcp(port, toolCall("get_k8s_docs", tokenFile))
  assert.deepEqual(receivedAuthorizations, ["Bearer first.test.token", "Bearer second.test.token"])
})

test("maps post and delete tools onto the protected Docs API", async (t) => {
  const tokenDirectory = await mkdtemp(join(tmpdir(), "delegated-mcp-method-test-"))
  t.after(() => rm(tokenDirectory, { recursive: true, force: true }))
  const postToken = await writeToolToken(tokenDirectory, "post_k8s_doc", "12345678-1234-1234-1234-123456789abc.jwt", "post.test.token")
  const deleteToken = await writeToolToken(tokenDirectory, "delete_k8s_doc", "22345678-1234-1234-1234-123456789abc.jwt", "delete.test.token")
  const requests: Array<{ body: string; method?: string; url?: string }> = []
  const upstream = http.createServer(async (request, response) => {
    let body = ""
    for await (const chunk of request) body += chunk.toString()
    requests.push({ body, method: request.method, url: request.url })
    response.end("ok")
  })
  const upstreamPort = await listen(upstream)
  t.after(() => close(upstream))
  const server = createDelegatedK8sDocsMcpServer({
    tokenDirectory,
    upstreamBaseUrl: new URL(`http://127.0.0.1:${upstreamPort}`),
  })
  const port = await listen(server)
  t.after(() => close(server))

  await callMcp(port, toolCall("post_k8s_doc", postToken, { name: "Guide", content: "Content" }))
  await callMcp(port, toolCall("delete_k8s_doc", deleteToken, { doc_id: 7 }))

  assert.deepEqual(requests, [
    { body: JSON.stringify({ name: "Guide", content: "Content" }), method: "POST", url: "/api/docs" },
    { body: "", method: "DELETE", url: "/api/docs/7" },
  ])
})

test("rejects missing, escaped, and cross-tool token paths before calling upstream", async (t) => {
  const tokenDirectory = await mkdtemp(join(tmpdir(), "delegated-mcp-reject-test-"))
  t.after(() => rm(tokenDirectory, { recursive: true, force: true }))
  let upstreamCalls = 0
  const upstream = http.createServer((_request, response) => {
    upstreamCalls += 1
    response.end("must not be called")
  })
  const upstreamPort = await listen(upstream)
  t.after(() => close(upstream))
  const server = createDelegatedK8sDocsMcpServer({
    tokenDirectory,
    upstreamBaseUrl: new URL(`http://127.0.0.1:${upstreamPort}`),
  })
  const port = await listen(server)
  t.after(() => close(server))

  const missing = await callMcp(port, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "get_k8s_docs", arguments: {} },
  })
  assert.match(missing.error.message, /metadata|token file/)

  const escaped = await callMcp(port, toolCall("get_k8s_docs", "/tmp/outside/12345678-1234-1234-1234-123456789abc.jwt"))
  assert.match(escaped.error.message, /outside/)

  const crossTool = await callMcp(port, toolCall(
    "get_k8s_docs",
    join(tokenDirectory, "post_k8s_doc", "12345678-1234-1234-1234-123456789abc.jwt"),
  ))
  assert.match(crossTool.error.message, /does not match/)
  assert.equal(upstreamCalls, 0)
})

function toolCall(name: string, tokenFile: string, args: Record<string, unknown> = {}) {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name,
      arguments: args,
      _meta: { [MCP_ACCESS_TOKEN_FILE_META_KEY]: tokenFile },
    },
  }
}

async function writeToolToken(root: string, tool: string, filename: string, token: string) {
  const directory = join(root, tool)
  await mkdir(directory, { recursive: true })
  const path = join(directory, filename)
  await writeFile(path, `${token}\n`, { encoding: "utf8", mode: 0o640 })
  return path
}

async function callMcp(port: number, body: unknown) {
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  return await response.json() as any
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
