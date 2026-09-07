import assert from "node:assert/strict"
import test from "node:test"
import {
  emptyEditablePermissionRequirement,
  exchangeHelperDraftsForRequirement,
  generatedExchangeHelperDraftsForRequirement,
  TEMPLATE_MCP_IAM_MEMBER,
  signedInUserPermissionAudiences,
  toolPermissionDraftFromSettings,
  toolPermissionSettingsFingerprint,
  toolPermissionSettingsText,
  validateToolPermissionDraft,
} from "../features/permissions/lib/toolPermissionDraft.ts"

const settings = {
  version: 1 as const,
  tools: {
    get_k8s_docs: {
      requirements: [{
        includeExchangeHelpers: true,
        label: "Signed-in user can read documentation",
        member: "<signed_in_user>",
        role: "api:role.docs-getter",
      }],
    },
  },
}

test("round-trips tool permission settings through the creation draft", () => {
  const draft = toolPermissionDraftFromSettings(settings)
  assert.equal(draft[0].toolName, "get_k8s_docs")
  assert.equal(draft[0].requirements[0].audience, "api")
  assert.equal(draft[0].requirements[0].role, "docs-getter")

  const result = validateToolPermissionDraft(draft, true)
  assert.equal(result.ok, true)
  if (result.ok) assert.deepEqual(result.settings, settings)
})

test("validates tool names and extracts unique signed-in-user audiences", () => {
  const draft = toolPermissionDraftFromSettings(settings)
  assert.deepEqual(validateToolPermissionDraft([
    ...draft,
    { ...draft[0], id: 2 },
  ], true), {
    ok: false,
    error: "Tool names must be unique: get_k8s_docs",
  })
  assert.deepEqual(signedInUserPermissionAudiences(settings), ["api"])
})

test("fingerprints permission metadata omitted from the confirmation display", () => {
  const updatedSettings = {
    ...settings,
    tools: {
      get_k8s_docs: {
        requirements: [{
          ...settings.tools.get_k8s_docs.requirements[0],
          label: "Updated Athenz permission description",
        }],
      },
    },
  }

  assert.equal(toolPermissionSettingsText(settings), toolPermissionSettingsText(updatedSettings))
  assert.notEqual(
    toolPermissionSettingsFingerprint(settings),
    toolPermissionSettingsFingerprint(updatedSettings),
  )
})

test("omits token-exchange helpers when Hub-managed access is disabled", () => {
  const result = validateToolPermissionDraft(toolPermissionDraftFromSettings(settings), false)
  assert.equal(result.ok, true)
  if (!result.ok || !result.settings) return
  assert.equal(result.settings.tools.get_k8s_docs.requirements[0].includeExchangeHelpers, undefined)
})

test("stores an editable template MCP IAM helper binding and resolves it for a server draft", () => {
  const draft = toolPermissionDraftFromSettings(settings)
  draft[0].requirements[0].exchangeHelpersCustomized = true
  draft[0].requirements[0].helperRequirements = [{
    label: "MCP service can exchange into the downstream role",
    member: TEMPLATE_MCP_IAM_MEMBER,
    memberType: "mcp-service",
    policies: [{
      action: "zts.token_target_exchange",
      effect: "ALLOW",
      resource: "api:mcp-hub.mcps.k8s-docs-server:role.docs-getter",
    }],
    role: "api:role.docs-getter-exchanger",
  }]

  const template = validateToolPermissionDraft(draft, true, TEMPLATE_MCP_IAM_MEMBER)
  assert.equal(template.ok, true)
  if (!template.ok || !template.settings) return
  assert.equal(
    template.settings.tools.get_k8s_docs.requirements[0].exchangeHelperRequirements?.[0].member,
    TEMPLATE_MCP_IAM_MEMBER,
  )

  const server = validateToolPermissionDraft(
    toolPermissionDraftFromSettings(template.settings),
    true,
    "mcp-hub.mcps.k8s-docs-server.api-docs",
  )
  assert.equal(server.ok, true)
  if (!server.ok || !server.settings) return
  assert.equal(
    server.settings.tools.get_k8s_docs.requirements[0].exchangeHelperRequirements?.[0].member,
    "mcp-hub.mcps.k8s-docs-server.api-docs",
  )
})

test("auto-completes exchange helpers in every permission authoring flow", () => {
  const requirement = {
    ...emptyEditablePermissionRequirement(),
    audience: "api",
    role: "docs-getter",
  }
  const serverPrincipal = "mcp-hub.mcps.k8s-docs-server.api-docs"
  const contexts = [
    ["direct MCP creation", serverPrincipal],
    ["template-based MCP creation", serverPrincipal],
    ["post-create permission editing", serverPrincipal],
    ["MCP template creation", TEMPLATE_MCP_IAM_MEMBER],
    ["MCP template update", TEMPLATE_MCP_IAM_MEMBER],
  ] as const

  for (const [context, servicePrincipal] of contexts) {
    const helpers = generatedExchangeHelperDraftsForRequirement(
      requirement,
      servicePrincipal,
      "mcp-hub.mcps.k8s-docs-server",
    )
    assert.equal(helpers.length, 2, `${context} should generate two helper roles`)
    assert.equal(
      helpers.reduce((count, helper) => count + helper.policies.length, 0),
      2,
      `${context} should generate two helper policies`,
    )
  }
})

test("rebinds a template helper preview to the selected server IAM account", () => {
  const requirement = {
    ...emptyEditablePermissionRequirement(),
    audience: "api",
    exchangeHelpersCustomized: true,
    helperRequirements: [{
      label: "MCP service can exchange into the downstream role",
      member: TEMPLATE_MCP_IAM_MEMBER,
      memberType: "mcp-service" as const,
      policies: [],
      role: "api:role.docs-getter-exchanger",
    }],
    role: "docs-getter",
  }
  const servicePrincipal = "mcp-hub.mcps.k8s-docs-server.api-docs"

  const [helper] = exchangeHelperDraftsForRequirement(
    requirement,
    servicePrincipal,
    "mcp-hub.mcps.k8s-docs-server",
  )

  assert.equal(helper.member, servicePrincipal)
  assert.equal(requirement.helperRequirements[0].member, TEMPLATE_MCP_IAM_MEMBER)

  const generatedDefaults = generatedExchangeHelperDraftsForRequirement(
    requirement,
    servicePrincipal,
    "mcp-hub.mcps.k8s-docs-server",
  )
  assert.equal(generatedDefaults.length, 2)
  assert.deepEqual(
    generatedDefaults.map(({ member }) => member),
    ["mcp-hub.mcp-gateway", servicePrincipal],
  )
})
