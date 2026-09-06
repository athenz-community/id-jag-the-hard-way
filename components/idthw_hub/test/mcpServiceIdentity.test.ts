import assert from "node:assert/strict"
import test from "node:test"
import {
  ensureMcpServiceCertificateProvider,
  MCP_GENERATED_SERVICE_KEY_ID,
  registerMcpServicePublicKey,
} from "../features/registration/api/mcpServiceIdentity.ts"
import type { ZmsRequest } from "../features/registration/api/mcpManagedAccess.ts"

const publicKey = "dGVzdC1wdWJsaWMta2V5"

test("registers and verifies the Hub-generated service public key", async () => {
  const calls: Array<{ body?: unknown; method: string; path: string }> = []
  let registered = false
  const request: ZmsRequest = async (method, path, body) => {
    calls.push({ body, method, path })
    if (method === "PUT") {
      registered = true
      return { body: "", status: 204 }
    }
    return registered
      ? { body: JSON.stringify({ id: MCP_GENERATED_SERVICE_KEY_ID, key: publicKey }), status: 200 }
      : { body: "", status: 404 }
  }

  assert.equal(await registerMcpServicePublicKey(
    "k8s-docs-server",
    "mcp-hub.mcps.k8s-docs-server.runtime",
    publicKey,
    request,
  ), true)
  assert.deepEqual(calls[1], {
    body: { id: MCP_GENERATED_SERVICE_KEY_ID, key: publicKey },
    method: "PUT",
    path: "/domain/mcp-hub.mcps.k8s-docs-server/service/runtime/publickey/idthw-hub-generated",
  })
})

test("does not rewrite an already matching service public key", async () => {
  const methods: string[] = []
  const request: ZmsRequest = async (method) => {
    methods.push(method)
    return {
      body: JSON.stringify({ id: MCP_GENERATED_SERVICE_KEY_ID, key: publicKey }),
      status: 200,
    }
  }

  assert.equal(await registerMcpServicePublicKey(
    "k8s-docs-server",
    "mcp-hub.mcps.k8s-docs-server.runtime",
    publicKey,
    request,
  ), false)
  assert.deepEqual(methods, ["GET"])
})

test("idempotently enables the ZTS service certificate provider template", async () => {
  let enabled = false
  const calls: Array<{ body?: unknown; method: string; path: string }> = []
  const domain = "mcp-hub.mcps.k8s-docs-server"
  const request: ZmsRequest = async (method, path, body) => {
    calls.push({ body, method, path })
    if (method === "PUT") {
      enabled = true
      return { body: "", status: 204 }
    }
    if (!enabled) return { body: "", status: 404 }
    if (path.includes("/role/")) {
      return {
        body: JSON.stringify({ roleMembers: [{ memberName: "sys.auth.zts" }] }),
        status: 200,
      }
    }
    return {
      body: JSON.stringify({
        assertions: [{
          action: "launch",
          resource: `${domain}:service.runtime`,
          role: `${domain}:role.zts_instance_launch_provider`,
        }],
      }),
      status: 200,
    }
  }

  assert.equal(await ensureMcpServiceCertificateProvider(
    "k8s-docs-server",
    `${domain}.runtime`,
    request,
  ), true)
  assert.deepEqual(calls[2], {
    body: {
      params: [{ name: "service", value: "runtime" }],
      templateNames: ["zts_instance_launch_provider"],
    },
    method: "PUT",
    path: `/domain/${domain}/template`,
  })
  assert.equal(await ensureMcpServiceCertificateProvider(
    "k8s-docs-server",
    `${domain}.runtime`,
    request,
  ), false)
})
