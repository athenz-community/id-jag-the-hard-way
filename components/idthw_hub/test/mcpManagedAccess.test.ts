import assert from "node:assert/strict"
import test from "node:test"
import {
  deleteMcpManagedAccess,
  ensureMcpManagedAccess,
  ensureMcpSourceExchangeAccess,
  type ZmsRequest,
} from "../features/registration/api/mcpManagedAccess.ts"

test("idempotently provisions access in an existing project domain", async () => {
  const state = new FakeZms()

  const first = await ensureMcpManagedAccess(
    "k8s-docs-server",
    "docs-mcp",
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
    sourceExchangerMemberAdded: true,
    sourceExchangerRoleCreated: true,
  })

  const domain = "mcp-hub.mcps.k8s-docs-server"
  assert.deepEqual([...state.roles.get("docs-mcp-accessor") ?? []], ["human.idjag-learner"])
  assert.deepEqual(
    [...state.roles.get("docs-mcp-accessor-jag-exchanger") ?? []],
    ["mcp-hub.mcp-gateway"],
  )
  assert.deepEqual(
    [...state.roles.get("docs-mcp-accessor-source-exchanger") ?? []],
    ["mcp-hub.mcps.k8s-docs-server.runtime"],
  )
  assert.deepEqual(state.policy, {
    name: `${domain}:policy.docs-mcp-accessor-jag-exchanger_zts_jag_exchange_role_docs-mcp-accessor`,
    assertions: [{
      role: `${domain}:role.docs-mcp-accessor-jag-exchanger`,
      resource: `${domain}:role.docs-mcp-accessor`,
      action: "zts.jag_exchange",
    }],
  })

  const mutationCount = state.mutations.length
  const second = await ensureMcpManagedAccess(
    "k8s-docs-server",
    "docs-mcp",
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
    sourceExchangerMemberAdded: false,
    sourceExchangerRoleCreated: false,
  })
  assert.equal(state.mutations.length, mutationCount)
})

test("keeps managed roles and policies isolated between MCP servers in one project", async () => {
  const state = new FakeZms()

  await ensureMcpManagedAccess(
    "k8s-docs-server",
    "docs-mcp",
    "idjag-learner",
    "mcp-hub.mcps.k8s-docs-server.runtime",
    state.request,
  )
  await ensureMcpManagedAccess(
    "k8s-docs-server",
    "confluence",
    "alice",
    "mcp-hub.mcps.k8s-docs-server.runtime",
    state.request,
  )

  assert.deepEqual([...state.roles.get("docs-mcp-accessor") ?? []], ["human.idjag-learner"])
  assert.deepEqual([...state.roles.get("confluence-accessor") ?? []], ["human.alice"])
  assert.equal(state.policies.size, 2)
  assert.ok(state.policies.has("docs-mcp-accessor-jag-exchanger_zts_jag_exchange_role_docs-mcp-accessor"))
  assert.ok(state.policies.has("confluence-accessor-jag-exchanger_zts_jag_exchange_role_confluence-accessor"))
})

test("repairs an existing per-server JAG policy without discarding its assertions", async () => {
  const state = new FakeZms()
  const domain = "mcp-hub.mcps.k8s-docs-server"
  const policyName = "docs-mcp-accessor-jag-exchanger_zts_jag_exchange_role_docs-mcp-accessor"
  const existingAssertion = {
    action: "custom.action",
    resource: `${domain}:custom.resource`,
    role: `${domain}:role.custom-role`,
  }
  state.policies.set(policyName, {
    name: `${domain}:policy.${policyName}`,
    assertions: [existingAssertion],
  })

  const report = await ensureMcpManagedAccess(
    "k8s-docs-server",
    "docs-mcp",
    "idjag-learner",
    "mcp-hub.mcps.k8s-docs-server.runtime",
    state.request,
  )

  assert.equal(report.exchangePolicyCreated, true)
  assert.deepEqual(state.policies.get(policyName)?.assertions, [existingAssertion, {
    action: "zts.jag_exchange",
    resource: `${domain}:role.docs-mcp-accessor`,
    role: `${domain}:role.docs-mcp-accessor-jag-exchanger`,
  }])
})

test("adds each configured audience to the per-server source-exchange policy", async () => {
  const state = new FakeZms()

  const first = await ensureMcpSourceExchangeAccess(
    "k8s-docs-server",
    "docs-mcp",
    "mcp-hub.mcps.k8s-docs-server.runtime",
    ["content", "api", "api"],
    state.request,
  )
  assert.deepEqual(first, {
    policyUpdated: true,
    sourceExchangerMemberAdded: true,
    sourceExchangerRoleCreated: true,
  })
  const domain = "mcp-hub.mcps.k8s-docs-server"
  assert.deepEqual(state.sourcePolicy, {
    name: `${domain}:policy.docs-mcp-accessor-source-exchanger_zts_token_source_exchange`,
    assertions: [{
      action: "zts.token_source_exchange",
      resource: `${domain}:api`,
      role: `${domain}:role.docs-mcp-accessor-source-exchanger`,
    }, {
      action: "zts.token_source_exchange",
      resource: `${domain}:content`,
      role: `${domain}:role.docs-mcp-accessor-source-exchanger`,
    }],
  })

  const mutationCount = state.mutations.length
  const second = await ensureMcpSourceExchangeAccess(
    "k8s-docs-server",
    "docs-mcp",
    "mcp-hub.mcps.k8s-docs-server.runtime",
    ["content", "api"],
    state.request,
  )
  assert.deepEqual(second, {
    policyUpdated: false,
    sourceExchangerMemberAdded: false,
    sourceExchangerRoleCreated: false,
  })
  assert.equal(state.mutations.length, mutationCount)
})

test("deletes only one MCP server's managed roles and policies", async () => {
  const domain = "mcp-hub.mcps.k8s-docs-server"
  const domainPath = `/domain/${domain}`
  const roleNames = [
    "docs-mcp-accessor-jag-exchanger",
    "docs-mcp-accessor-source-exchanger",
    "docs-mcp-accessor",
  ]
  const policyNames = [
    "docs-mcp-accessor-jag-exchanger_zts_jag_exchange_role_docs-mcp-accessor",
    "docs-mcp-accessor-source-exchanger_zts_token_source_exchange",
  ]
  const existing = new Set([
    ...roleNames.map((name) => `${domainPath}/role/${name}`),
    ...policyNames.map((name) => `${domainPath}/policy/${name}`),
  ])
  const calls: Array<{ method: string; path: string }> = []
  const request: ZmsRequest = async (method, requestPath) => {
    calls.push({ method, path: requestPath })
    if (requestPath === domainPath) return response(200, {})
    if (method === "DELETE") {
      const found = existing.delete(requestPath)
      return response(found ? 204 : 404, {})
    }
    return response(existing.has(requestPath) ? 200 : 404, {})
  }

  assert.deepEqual(
    await deleteMcpManagedAccess("k8s-docs-server", "docs-mcp", request),
    { policiesDeleted: policyNames, rolesDeleted: roleNames },
  )
  assert.equal(existing.size, 0)
  assert.equal(calls.some(({ path }) => path.includes("/service/")), false)
  assert.equal(calls.some(({ path }) => path.includes("confluence-accessor")), false)
  assert.deepEqual(
    await deleteMcpManagedAccess("k8s-docs-server", "docs-mcp", request),
    { policiesDeleted: [], rolesDeleted: [] },
  )
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
      "docs-mcp",
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
  policies = new Map<string, Record<string, unknown>>()
  sourcePolicies = new Map<string, Record<string, unknown>>()
  roles = new Map<string, Set<string>>()

  get policy() {
    return this.policies.get("docs-mcp-accessor-jag-exchanger_zts_jag_exchange_role_docs-mcp-accessor")
  }

  get sourcePolicy() {
    return this.sourcePolicies.get("docs-mcp-accessor-source-exchanger_zts_token_source_exchange")
  }

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

    const policyMatch = /^\/domain\/mcp-hub\.mcps\.k8s-docs-server\/policy\/([^/]+)$/.exec(requestPath)
    const policyName = policyMatch ? decodeURIComponent(policyMatch[1]) : ""
    if (policyName.includes("_zts_jag_exchange_role_")) {
      if (method === "PUT") {
        this.policies.set(policyName, body as Record<string, unknown>)
        return response(200, {})
      }
      const policy = this.policies.get(policyName)
      return policy ? response(200, policy) : response(404, {})
    }

    if (policyName.endsWith("_zts_token_source_exchange")) {
      if (method === "PUT") {
        this.sourcePolicies.set(policyName, body as Record<string, unknown>)
        return response(200, {})
      }
      const policy = this.sourcePolicies.get(policyName)
      return policy ? response(200, policy) : response(404, {})
    }

    throw new Error(`Unexpected ZMS request: ${method} ${requestPath}`)
  }
}

function response(status: number, body: unknown) {
  return { status, body: JSON.stringify(body) }
}
