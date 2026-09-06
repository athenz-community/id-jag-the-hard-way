import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { parse } from "yaml"
import {
  exchangeHelperRequirements,
  exchangePolicyRules,
  mergeToolPermissionSettings,
  parsePermissionPresetForServer,
  parseToolPermissionSettings,
  parseToolAccessScopesForServer,
  permissionPresetFromToolSettings,
  SIGNED_IN_USER_MEMBER,
  withManagedAccessRequirements,
  withExpectedExchangePolicies,
} from "../features/permissions/lib/permissionPreset.ts"

const validPreset = {
  version: 1,
  servers: {
    "k8s-docs-server": {
      tools: {
        get_k8s_docs: {
          requirements: [
            {
              member: SIGNED_IN_USER_MEMBER,
              role: "api:role.docs-getter",
            },
            {
              member: SIGNED_IN_USER_MEMBER,
              role: "api:role.mcp-accessor",
            },
            {
              member: "mcp-hub.mcp-gateway",
              role: "api:role.mcp-accessor-jag-exchanger",
            },
          ],
        },
      },
    },
  },
}

test("loads the checked-in pure YAML permission settings", async () => {
  const source = await readFile(
    new URL("../config/permission-presets.yaml", import.meta.url),
    "utf8",
  )
  const configured = parse(source, { maxAliasCount: 50 }) as unknown
  const preset = parsePermissionPresetForServer(
    configured,
    "k8s-docs-server",
    "human.idjag-learner",
  )

  assert.ok(preset)
  assert.equal(preset.groups[0].requirements[0].member, "human.idjag-learner")
  assert.equal(preset.groups[0].label, "Tool: get_k8s_docs")
  assert.equal(preset.groups[1].label, "Tool: post_k8s_doc")
  assert.equal(preset.groups[2].label, "Tool: delete_k8s_doc")
  assert.equal(preset.groups[0].requirements[1].role, "api:role.docs-getter-jag-exchanger")
  assert.equal(preset.groups[0].requirements[2].role, "api:role.docs-getter-exchanger")
  assert.equal(preset.groups[1].requirements[0].role, "api:role.docs-poster")
  assert.equal(preset.groups[2].requirements[0].role, "api:role.docs-deleter")
})

test("resolves the exact signed-in-user placeholder and keeps literal principals", () => {
  const preset = parsePermissionPresetForServer(
    validPreset,
    "k8s-docs-server",
    "human.idjag-learner",
  )

  assert.ok(preset)
  assert.equal(preset.groups[0].requirements[0].configuredMember, SIGNED_IN_USER_MEMBER)
  assert.equal(preset.groups[0].requirements[0].member, "human.idjag-learner")
  assert.equal(preset.groups[0].requirements[2].member, "mcp-hub.mcp-gateway")
  assert.equal(preset.groups[0].requirements[0].source, "tool")
  assert.equal(preset.groups[0].label, "Tool: get_k8s_docs")
  assert.equal(preset.groups[0].toolName, "get_k8s_docs")
})

test("derives each tool's Gateway scope from signed-in-user requirements only", async () => {
  const source = await readFile(
    new URL("../config/permission-presets.yaml", import.meta.url),
    "utf8",
  )
  const configured = parse(source, { maxAliasCount: 50 }) as unknown

  assert.deepEqual(parseToolAccessScopesForServer(configured, "k8s-docs-server"), {
    get_k8s_docs: "api:role.docs-getter",
    post_k8s_doc: "api:role.docs-poster",
    delete_k8s_doc: "api:role.docs-deleter",
  })
})

test("derives indented exchange helpers from one direct tool permission", () => {
  const requirements = [{
    label: "Signed-in user can read documentation",
    member: SIGNED_IN_USER_MEMBER,
    role: "api:role.docs-getter",
  }]
  assert.deepEqual(exchangeHelperRequirements(
    requirements,
    "mcp-hub.mcps.k8s-docs-server.api-docs",
  ), [{
    label: "MCP Gateway can request delegated downstream access",
    member: "mcp-hub.mcp-gateway",
    role: "api:role.docs-getter-jag-exchanger",
  }, {
    label: "MCP service can exchange into the downstream role",
    member: "mcp-hub.mcps.k8s-docs-server.api-docs",
    role: "api:role.docs-getter-exchanger",
  }])

  const settings = parseToolPermissionSettings({
    version: 1,
    tools: {
      get_k8s_docs: {
        requirements: [{ ...requirements[0], includeExchangeHelpers: true }],
      },
    },
  })
  const preset = permissionPresetFromToolSettings(
    settings,
    "demo-api",
    "human.idjag-learner",
    { servicePrincipal: "mcp-hub.mcps.k8s-docs-server.api-docs" },
  )
  assert.equal(preset.groups[0].requirements[0].includeExchangeHelpers, true)
  assert.equal(preset.groups[0].requirements[0].toolRequirementIndex, 0)
  assert.deepEqual(
    preset.groups[0].requirements.map(({ source }) => source),
    ["tool", "helper", "helper"],
  )
})

test("derives compact exchange policy rules from the route source audience", () => {
  assert.deepEqual(
    exchangePolicyRules(
      "api:role.docs-getter",
      "mcp-hub.mcps.k8s-docs-server",
      "mcp-hub.mcps.k8s-docs-server:role.accessor-source-exchanger",
    ),
    [{
      action: "zts.jag_exchange",
      effect: "ALLOW",
      resource: "api:role.docs-getter",
      role: "api:role.docs-getter-jag-exchanger",
    }, {
      action: "zts.token_source_exchange",
      effect: "ALLOW",
      resource: "mcp-hub.mcps.k8s-docs-server:api",
      role: "mcp-hub.mcps.k8s-docs-server:role.accessor-source-exchanger",
    }, {
      action: "zts.token_target_exchange",
      effect: "ALLOW",
      resource: "api:mcp-hub.mcps.k8s-docs-server:role.docs-getter",
      role: "api:role.docs-getter-exchanger",
    }],
  )
  assert.equal(
    exchangePolicyRules("api:role.docs-getter", "api")[1].resource,
    "api:api:role.docs-getter",
  )
})

test("keeps exchange policy checks independent and under their tool", () => {
  const settings = parseToolPermissionSettings({
    version: 1,
    tools: {
      get_k8s_docs: {
        requirements: [{
          includeExchangeHelpers: true,
          member: SIGNED_IN_USER_MEMBER,
          role: "api:role.docs-getter",
        }],
      },
    },
  })
  const toolPreset = permissionPresetFromToolSettings(
    settings,
    "myapiserver",
    "human.idjag-learner",
    { servicePrincipal: "mcp-hub.mcps.k8s-docs-server.api-docs" },
  )
  const managedPreset = withManagedAccessRequirements(
    toolPreset,
    "myapiserver",
    "mcp-hub.mcps.k8s-docs-server:role.accessor",
    "human.idjag-learner",
    "mcp-hub.mcp-gateway",
    "mcp-hub.mcps.k8s-docs-server.api-docs",
  )
  const preset = withExpectedExchangePolicies(
    managedPreset,
    "mcp-hub.mcps.k8s-docs-server",
  )

  assert.deepEqual(
    preset?.groups[0].policies?.map(({ action, resource, source }) => ({
      action,
      resource,
      source,
    })),
    [{
      action: "zts.jag_exchange",
      resource: "api:role.docs-getter",
      source: "helper",
    }, {
      action: "zts.token_source_exchange",
      resource: "mcp-hub.mcps.k8s-docs-server:api",
      source: "managed",
    }, {
      action: "zts.token_target_exchange",
      resource: "api:mcp-hub.mcps.k8s-docs-server:role.docs-getter",
      source: "helper",
    }, {
      action: "zts.jag_exchange",
      resource: "mcp-hub.mcps.k8s-docs-server:role.accessor",
      source: "managed",
    }],
  )
})

test("preserves provider-customized exchange helper memberships", () => {
  const settings = parseToolPermissionSettings({
    version: 1,
    tools: {
      get_k8s_docs: {
        requirements: [{
          includeExchangeHelpers: true,
          member: SIGNED_IN_USER_MEMBER,
          role: "api:role.docs-getter",
          exchangeHelperRequirements: [{
            label: "Custom source exchanger",
            member: "custom.api-mcp",
            role: "api:role.custom-source-exchanger",
          }],
        }],
      },
    },
  })
  const preset = permissionPresetFromToolSettings(
    settings,
    "demo-api",
    "human.idjag-learner",
  )

  assert.equal(preset.groups[0].requirements[0].exchangeHelpersCustomized, true)
  assert.deepEqual(preset.groups[0].requirements[1], {
    configuredMember: "custom.api-mcp",
    label: "Custom source exchanger",
    member: "custom.api-mcp",
    role: "api:role.custom-source-exchanger",
    source: "helper",
    toolRequirementIndex: 0,
  })
})

test("normalizes a legacy singular helper policy and keeps it attached to its helper role", () => {
  const settings = parseToolPermissionSettings({
    version: 1,
    tools: {
      get_k8s_docs: {
        requirements: [{
          includeExchangeHelpers: true,
          member: SIGNED_IN_USER_MEMBER,
          role: "api:role.docs-getter",
          exchangeHelperRequirements: [{
            label: "Custom Gateway exchange",
            member: "mcp-hub.mcp-gateway",
            policy: {
              action: "custom.jag_exchange",
              effect: "DENY",
              resource: "api:role.custom-docs-getter",
            },
            role: "api:role.docs-getter-jag-exchanger",
          }],
        }],
      },
    },
  })
  const preset = permissionPresetFromToolSettings(
    settings,
    "demo-api",
    "human.idjag-learner",
  )

  assert.deepEqual(settings.tools.get_k8s_docs.requirements[0].exchangeHelperRequirements?.[0].policies, [{
    action: "custom.jag_exchange",
    effect: "DENY",
    resource: "api:role.custom-docs-getter",
  }])
  assert.deepEqual(preset.groups[0].policies, [{
    action: "custom.jag_exchange",
    effect: "DENY",
    label: "Configured exchange policy",
    resource: "api:role.custom-docs-getter",
    role: "api:role.docs-getter-jag-exchanger",
    source: "helper",
    toolRequirementIndex: 0,
  }])
  assert.deepEqual(preset.groups[0].requirements[1].exchangePolicies, [{
    action: "custom.jag_exchange",
    effect: "DENY",
    resource: "api:role.custom-docs-getter",
  }])
  assert.equal(preset.groups[0].requirements[1].exchangePoliciesCustomized, true)

  const enriched = withExpectedExchangePolicies(
    withManagedAccessRequirements(
      preset,
      "demo-api",
      "mcp-hub.mcps.demo:role.accessor",
      "human.idjag-learner",
      "mcp-hub.mcp-gateway",
      "mcp-hub.mcps.demo.api-mcp",
    ),
    "mcp-hub.mcps.demo",
  )
  assert.deepEqual(
    enriched?.groups[0].policies?.filter(({ source }) => source === "helper"),
    preset.groups[0].policies,
  )
})

test("keeps multiple customized policies on one helper role", () => {
  const settings = parseToolPermissionSettings({
    version: 1,
    tools: {
      get_k8s_docs: {
        requirements: [{
          includeExchangeHelpers: true,
          member: SIGNED_IN_USER_MEMBER,
          role: "api:role.docs-getter",
          exchangeHelperRequirements: [{
            label: "Custom Gateway exchange",
            member: "mcp-hub.mcp-gateway",
            policies: [{
              action: "zts.jag_exchange",
              effect: "ALLOW",
              resource: "api:role.docs-getter",
            }, {
              action: "custom.audit",
              effect: "DENY",
              resource: "api:role.restricted",
            }],
            role: "api:role.docs-getter-jag-exchanger",
          }],
        }],
      },
    },
  })
  const preset = permissionPresetFromToolSettings(settings, "demo-api", "human.idjag-learner")

  assert.equal(preset.groups[0].policies?.length, 2)
  assert.deepEqual(
    preset.groups[0].policies?.map(({ action, effect, resource, role }) => ({ action, effect, resource, role })),
    [{
      action: "zts.jag_exchange",
      effect: "ALLOW",
      resource: "api:role.docs-getter",
      role: "api:role.docs-getter-jag-exchanger",
    }, {
      action: "custom.audit",
      effect: "DENY",
      resource: "api:role.restricted",
      role: "api:role.docs-getter-jag-exchanger",
    }],
  )
})

test("preserves an explicitly empty helper policy list", () => {
  const settings = parseToolPermissionSettings({
    version: 1,
    tools: {
      get_k8s_docs: {
        requirements: [{
          includeExchangeHelpers: true,
          member: SIGNED_IN_USER_MEMBER,
          role: "api:role.docs-getter",
          exchangeHelperRequirements: [{
            label: "Gateway exchange without a policy check",
            member: "mcp-hub.mcp-gateway",
            policies: [],
            role: "api:role.docs-getter-jag-exchanger",
          }],
        }],
      },
    },
  })
  const preset = withExpectedExchangePolicies(
    permissionPresetFromToolSettings(settings, "demo-api", "human.idjag-learner"),
    "mcp-hub.mcps.demo",
  )

  assert.deepEqual(settings.tools.get_k8s_docs.requirements[0].exchangeHelperRequirements?.[0].policies, [])
  assert.deepEqual(preset?.groups[0].policies, [])
})

test("rejects an incomplete customized helper policy", () => {
  assert.throws(
    () => parseToolPermissionSettings({
      version: 1,
      tools: {
        get_k8s_docs: {
          requirements: [{
            includeExchangeHelpers: true,
            member: SIGNED_IN_USER_MEMBER,
            role: "api:role.docs-getter",
            exchangeHelperRequirements: [{
              label: "Broken helper",
              member: "mcp-hub.mcp-gateway",
              policy: {
                action: "zts.jag_exchange",
                effect: "ALLOW",
              },
              role: "api:role.docs-getter-jag-exchanger",
            }],
          }],
        },
      },
    }),
    /policy\.resource/,
  )
})

test("preserves an intentionally empty helper list so defaults can be regenerated later", () => {
  const settings = parseToolPermissionSettings({
    version: 1,
    tools: {
      get_k8s_docs: {
        requirements: [{
          exchangeHelperRequirements: [],
          includeExchangeHelpers: true,
          member: SIGNED_IN_USER_MEMBER,
          role: "api:role.docs-getter",
        }],
      },
    },
  })
  const preset = permissionPresetFromToolSettings(
    settings,
    "demo-api",
    "human.idjag-learner",
    { servicePrincipal: "mcp-hub.mcps.k8s-docs-server.api-docs" },
  )

  assert.equal(preset.groups[0].requirements.length, 1)
  assert.equal(preset.groups[0].requirements[0].exchangeHelpersCustomized, true)
})

test("keeps exchange helpers grouped under each direct access requirement", () => {
  const settings = parseToolPermissionSettings({
    version: 1,
    tools: {
      read_and_write: {
        requirements: [{
          includeExchangeHelpers: true,
          member: SIGNED_IN_USER_MEMBER,
          role: "api:role.reader",
        }, {
          includeExchangeHelpers: true,
          member: SIGNED_IN_USER_MEMBER,
          role: "api:role.writer",
        }],
      },
    },
  })
  const preset = permissionPresetFromToolSettings(
    settings,
    "demo-api",
    "human.idjag-learner",
    { servicePrincipal: "mcp-hub.mcps.k8s-docs-server.api-docs" },
  )

  assert.deepEqual(
    preset.groups[0].requirements.map(({ role, source, toolRequirementIndex }) => ({
      role,
      source,
      toolRequirementIndex,
    })),
    [{ role: "api:role.reader", source: "tool", toolRequirementIndex: 0 },
      { role: "api:role.reader-jag-exchanger", source: "helper", toolRequirementIndex: 0 },
      { role: "api:role.reader-exchanger", source: "helper", toolRequirementIndex: 0 },
      { role: "api:role.writer", source: "tool", toolRequirementIndex: 1 },
      { role: "api:role.writer-jag-exchanger", source: "helper", toolRequirementIndex: 1 },
      { role: "api:role.writer-exchanger", source: "helper", toolRequirementIndex: 1 }],
  )
})

test("rejects automatic exchange helpers on a static direct-access permission", () => {
  assert.throws(
    () => parseToolPermissionSettings({
      version: 1,
      tools: {
        read: {
          requirements: [{
            includeExchangeHelpers: true,
            member: "api.reader",
            role: "api:role.reader",
          }],
        },
      },
    }),
    /require the signed-in-user member/,
  )
})

test("normalizes legacy tool-level exchange helpers onto one direct access requirement", () => {
  const settings = parseToolPermissionSettings({
    version: 1,
    tools: {
      read: {
        includeExchangeHelpers: true,
        exchangeHelperRequirements: [{
          label: "Custom Gateway exchanger",
          member: "mcp-hub.mcp-gateway",
          role: "api:role.reader-jag-exchanger",
        }],
        requirements: [{
          member: SIGNED_IN_USER_MEMBER,
          role: "api:role.reader",
        }],
      },
    },
  })

  assert.equal(settings.tools.read.requirements[0].includeExchangeHelpers, true)
  assert.equal(
    settings.tools.read.requirements[0].exchangeHelperRequirements?.[0].role,
    "api:role.reader-jag-exchanger",
  )
})

test("adds the managed route scope to every configured tool scope", () => {
  assert.deepEqual(parseToolAccessScopesForServer(
    validPreset,
    "k8s-docs-server",
    "mcp-hub.mcps.k8s-docs-server:role.accessor",
  ), {
    get_k8s_docs: "api:role.docs-getter api:role.mcp-accessor mcp-hub.mcps.k8s-docs-server:role.accessor",
  })
})

test("shows managed user and Gateway requirements without a custom tool preset", () => {
  const preset = withManagedAccessRequirements(
    undefined,
    "confluence",
    "mcp-hub.mcps.k8s-docs-server:role.accessor",
    "human.idjag-learner",
    "mcp-hub.mcp-gateway",
    "mcp-hub.mcps.k8s-docs-server.api-docs",
  )

  assert.deepEqual(preset, {
    serverId: "confluence",
    groups: [{
      kind: "tool",
      label: "Athenz-protected MCP access",
      requirements: [{
        configuredMember: SIGNED_IN_USER_MEMBER,
        label: "Signed-in user can invoke this Athenz-protected MCP server",
        member: "human.idjag-learner",
        role: "mcp-hub.mcps.k8s-docs-server:role.accessor",
        source: "managed",
      }, {
        configuredMember: "mcp-hub.mcp-gateway",
        label: "MCP Gateway can request protected MCP access",
        member: "mcp-hub.mcp-gateway",
        role: "mcp-hub.mcps.k8s-docs-server:role.accessor-jag-exchanger",
        source: "managed",
      }, {
        configuredMember: "mcp-hub.mcps.k8s-docs-server.api-docs",
        label: "MCP service can exchange from this MCP access domain",
        member: "mcp-hub.mcps.k8s-docs-server.api-docs",
        role: "mcp-hub.mcps.k8s-docs-server:role.accessor-source-exchanger",
        source: "managed",
      }],
    }],
  })
})

test("merges per-server tool permission overrides over the checked-in defaults", () => {
  const base = parseToolPermissionSettings({
    version: 1,
    tools: {
      read: { requirements: [{ member: SIGNED_IN_USER_MEMBER, role: "api:role.reader" }] },
      write: { requirements: [{ member: SIGNED_IN_USER_MEMBER, role: "api:role.writer" }] },
    },
  })
  const overrides = parseToolPermissionSettings({
    version: 1,
    tools: {
      write: { requirements: [{ member: "api.writer", role: "api:role.writer-service" }] },
    },
  })

  const merged = mergeToolPermissionSettings(base, overrides)
  assert.equal(merged?.tools.read.requirements[0].member, SIGNED_IN_USER_MEMBER)
  assert.equal(merged?.tools.write.requirements[0].member, "api.writer")
})

test("allows an empty override to clear a tool's custom permissions", () => {
  const base = parseToolPermissionSettings({
    version: 1,
    tools: {
      read: { requirements: [{ member: SIGNED_IN_USER_MEMBER, role: "api:role.reader" }] },
    },
  })
  const overrides = parseToolPermissionSettings({
    version: 1,
    tools: { read: { requirements: [] } },
  })

  const merged = mergeToolPermissionSettings(base, overrides)
  assert.deepEqual(merged?.tools.read.requirements, [])
})

test("allows a static service-only tool when the managed MCP scope is present", () => {
  const configured = {
    version: 1,
    servers: {
      confluence: {
        tools: {
          search: { requirements: [{ member: "confluence.indexer", role: "content:role.reader" }] },
        },
      },
    },
  }

  assert.deepEqual(parseToolAccessScopesForServer(
    configured,
    "confluence",
    "mcp-hub.mcps.docs:role.accessor",
  ), {
    search: "mcp-hub.mcps.docs:role.accessor",
  })
})

test("adds managed user and Gateway requirements to every custom tool preset", () => {
  const preset = parsePermissionPresetForServer(
    validPreset,
    "k8s-docs-server",
    "human.idjag-learner",
  )
  const managedPreset = withManagedAccessRequirements(
    preset,
    "k8s-docs-server",
    "mcp-hub.mcps.k8s-docs-server:role.accessor",
    "human.idjag-learner",
  )

  assert.ok(managedPreset)
  assert.deepEqual(
    managedPreset.groups[0].requirements.slice(-2).map(({ member, role }) => ({ member, role })),
    [{
      member: "human.idjag-learner",
      role: "mcp-hub.mcps.k8s-docs-server:role.accessor",
    }, {
      member: "mcp-hub.mcp-gateway",
      role: "mcp-hub.mcps.k8s-docs-server:role.accessor-jag-exchanger",
    }],
  )
})

test("returns no preset for a server that is intentionally not configured", () => {
  const presetWithInvalidOtherServer = structuredClone(validPreset) as Record<string, unknown>
  const servers = presetWithInvalidOtherServer.servers as Record<string, unknown>
  servers.broken = { tools: { broken: { requirements: [{ member: "<unknown>", role: "api:role.reader" }] } } }

  assert.equal(
    parsePermissionPresetForServer(presetWithInvalidOtherServer, "confluence", "human.alice"),
    undefined,
  )
})

test("rejects unknown and partial member placeholders", () => {
  for (const member of ["<current_user>", "human.<signed_in_user>"]) {
    const configured = structuredClone(validPreset)
    configured.servers["k8s-docs-server"].tools.get_k8s_docs.requirements[0].member = member

    assert.throws(
      () => parsePermissionPresetForServer(configured, "k8s-docs-server", "human.alice"),
      /Unknown or partial permission member placeholder/,
    )
  }
})

test("rejects malformed principals, roles, and unknown fields", () => {
  const invalidPrincipal = structuredClone(validPreset)
  invalidPrincipal.servers["k8s-docs-server"].tools.get_k8s_docs.requirements[2].member = "missing-domain"
  assert.throws(
    () => parsePermissionPresetForServer(invalidPrincipal, "k8s-docs-server", "human.alice"),
    /Invalid Athenz principal/,
  )

  const invalidRole = structuredClone(validPreset)
  invalidRole.servers["k8s-docs-server"].tools.get_k8s_docs.requirements[2].role = "api:role."
  assert.throws(
    () => parsePermissionPresetForServer(invalidRole, "k8s-docs-server", "human.alice"),
    /Invalid Athenz role/,
  )

  const unknownField = structuredClone(validPreset) as Record<string, unknown>
  ;(unknownField as { unexpected?: boolean }).unexpected = true
  assert.throws(
    () => parsePermissionPresetForServer(unknownField, "k8s-docs-server", "human.alice"),
    /Unknown field "unexpected"/,
  )
})

test("rejects a separate server-level permission section", () => {
  const configured = structuredClone(validPreset) as Record<string, unknown>
  const servers = configured.servers as Record<string, Record<string, unknown>>
  servers["k8s-docs-server"].serverRequirements = []

  assert.throws(
    () => parsePermissionPresetForServer(configured, "k8s-docs-server", "human.alice"),
    /Unknown field "serverRequirements"/,
  )
})

test("rejects a signed-in user that cannot become an Athenz principal", () => {
  assert.throws(
    () => parsePermissionPresetForServer(validPreset, "k8s-docs-server", "human.bad user"),
    /Signed-in user resolved to invalid Athenz principal/,
  )
})
