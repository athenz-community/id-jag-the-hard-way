import assert from "node:assert/strict"
import test from "node:test"
import {
  ensureMcpManagedAccess,
  type ZmsRequest,
} from "../features/registration/api/mcpManagedAccess.ts"

test("idempotently provisions access in an existing project domain", async () => {
  const state = new FakeZms()

  const first = await ensureMcpManagedAccess(
    "k8s-docs-server",
    "idjag-learner",
    "mcp-hub.mcps.k8s-docs-server.runtime",
    state.request,
  )
  assert.deepEqual(first, {
    accessorMemberAdded: true,
    exchangePolicyCreated: true,
    exchangerMemberAdded: true,
    exchangerRoleCreated: true,
    roleCreated: true,
  })

  const domain = "mcp-hub.mcps.k8s-docs-server"
  assert.deepEqual([...state.roles.get("accessor") ?? []], ["human.idjag-learner"])
  assert.deepEqual([...state.roles.get("accessor-jag-exchanger") ?? []], ["mcp-hub.mcp-gateway"])
  assert.deepEqual(state.policy, {
    name: `${domain}:policy.accessor-jag-exchanger_zts_jag_exchange_role_accessor`,
    assertions: [{
      role: `${domain}:role.accessor-jag-exchanger`,
      resource: `${domain}:role.accessor`,
      action: "zts.jag_exchange",
    }],
  })

  const mutationCount = state.mutations.length
  const second = await ensureMcpManagedAccess(
    "k8s-docs-server",
    "idjag-learner",
    "mcp-hub.mcps.k8s-docs-server.runtime",
    state.request,
  )
  assert.deepEqual(second, {
    accessorMemberAdded: false,
    exchangePolicyCreated: false,
    exchangerMemberAdded: false,
    exchangerRoleCreated: false,
    roleCreated: false,
  })
  assert.equal(state.mutations.length, mutationCount)
})

test("does not create a missing project domain", async () => {
  const mutations: string[] = []
  const request: ZmsRequest = async (method, requestPath) => {
    if (method !== "GET") mutations.push(requestPath)
    return { status: 404, body: "{}" }
  }

  await assert.rejects(
    ensureMcpManagedAccess(
      "missing-project",
      "alice",
      "mcp-hub.mcps.missing-project.runtime",
      request,
    ),
    /Athenz domain mcp-hub\.mcps\.missing-project does not exist/,
  )
  assert.deepEqual(mutations, [])
})

class FakeZms {
  mutations: Array<{ body?: unknown; method: string; path: string }> = []
  policy: Record<string, unknown> | undefined
  roles = new Map<string, Set<string>>()

  request: ZmsRequest = async (method, requestPath, body) => {
    if (method !== "GET") this.mutations.push({ body, method, path: requestPath })

    if (requestPath === "/domain/mcp-hub.mcps.k8s-docs-server") {
      return response(200, {})
    }
    if (requestPath === "/domain/mcp-hub.mcps.k8s-docs-server/service/runtime") {
      return response(200, {})
    }

    const memberMatch = /^\/domain\/mcp-hub\.mcps\.k8s-docs-server\/role\/([^/]+)\/member\/([^/]+)$/.exec(requestPath)
    if (memberMatch && method === "PUT") {
      const role = decodeURIComponent(memberMatch[1])
      const member = decodeURIComponent(memberMatch[2])
      this.roles.get(role)?.add(member)
      return response(200, {})
    }

    const roleMatch = /^\/domain\/mcp-hub\.mcps\.k8s-docs-server\/role\/([^/]+)$/.exec(requestPath)
    if (roleMatch) {
      const role = decodeURIComponent(roleMatch[1])
      if (method === "PUT") {
        this.roles.set(role, new Set())
        return response(200, {})
      }
      const members = this.roles.get(role)
      return members
        ? response(200, { roleMembers: [...members].map((memberName) => ({ memberName })) })
        : response(404, {})
    }

    const policyPath = "/domain/mcp-hub.mcps.k8s-docs-server/policy/accessor-jag-exchanger_zts_jag_exchange_role_accessor"
    if (requestPath === policyPath) {
      if (method === "PUT") {
        this.policy = body as Record<string, unknown>
        return response(200, {})
      }
      return this.policy ? response(200, this.policy) : response(404, {})
    }

    throw new Error(`Unexpected ZMS request: ${method} ${requestPath}`)
  }
}

function response(status: number, body: unknown) {
  return { status, body: JSON.stringify(body) }
}
