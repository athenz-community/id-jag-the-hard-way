import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { parse } from "yaml"
import {
  parsePermissionPresetForServer,
  parseToolAccessScopesForServer,
  SIGNED_IN_USER_MEMBER,
  withManagedAccessRequirements,
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
  assert.equal(preset.groups[0].requirements[1].role, "api:role.mcp-accessor")
  assert.equal(preset.groups[0].requirements[2].role, "api:role.mcp-accessor-jag-exchanger")
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
    get_k8s_docs: "api:role.docs-getter api:role.mcp-accessor",
    post_k8s_doc: "api:role.docs-poster api:role.mcp-accessor",
    delete_k8s_doc: "api:role.docs-deleter api:role.mcp-accessor",
  })
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
      }, {
        configuredMember: "mcp-hub.mcp-gateway",
        label: "MCP Gateway can request protected MCP access",
        member: "mcp-hub.mcp-gateway",
        role: "mcp-hub.mcps.k8s-docs-server:role.accessor-jag-exchanger",
      }],
    }],
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
