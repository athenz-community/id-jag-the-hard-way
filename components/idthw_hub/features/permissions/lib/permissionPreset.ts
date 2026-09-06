import type {
  ConfiguredPermissionRequirement,
  PermissionPreset,
  PermissionPresetGroup,
  PermissionRequirement,
  ToolPermissionSettings,
} from "../types/permissions"

export const SIGNED_IN_USER_MEMBER = "<signed_in_user>"
export const PERMISSION_PRESET_VERSION = 1

const ATHENZ_PRINCIPAL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.[A-Za-z0-9][A-Za-z0-9._-]*$/
const ATHENZ_ROLE_PATTERN = /^([A-Za-z0-9][A-Za-z0-9._-]*):role\.([A-Za-z0-9][A-Za-z0-9._-]*)$/
const ROUTE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,251}[a-z0-9])?$/i

export function parsePermissionPresetForServer(
  value: unknown,
  serverId: string,
  signedInPrincipal: string,
): PermissionPreset | undefined {
  const settings = toolPermissionSettingsForServer(value, serverId)
  return settings ? permissionPresetFromToolSettings(settings, serverId, signedInPrincipal) : undefined
}

export function toolPermissionSettingsForServer(
  value: unknown,
  serverId: string,
): ToolPermissionSettings | undefined {
  const root = requireRecord(value, "permission preset")
  assertOnlyKeys(root, ["version", "servers"], "permission preset")
  if (root.version !== PERMISSION_PRESET_VERSION) {
    throw new Error(`Permission preset version must be ${PERMISSION_PRESET_VERSION}`)
  }

  const servers = requireRecord(root.servers, "permission preset servers")
  const configuredServer = servers[serverId]
  if (configuredServer === undefined) return undefined

  if (!ROUTE_ID_PATTERN.test(serverId)) {
    throw new Error(`Invalid MCP server route ID ${JSON.stringify(serverId)}`)
  }

  const server = requireRecord(configuredServer, `permission preset for ${serverId}`)
  assertOnlyKeys(server, ["tools"], `permission preset for ${serverId}`)
  return parseToolPermissionSettings({ version: PERMISSION_PRESET_VERSION, tools: server.tools })
}

export function parseToolPermissionSettings(value: unknown): ToolPermissionSettings {
  const root = requireRecord(value, "tool permission settings")
  assertOnlyKeys(root, ["version", "tools"], "tool permission settings")
  if (root.version !== PERMISSION_PRESET_VERSION) {
    throw new Error(`Tool permission settings version must be ${PERMISSION_PRESET_VERSION}`)
  }

  const configuredTools = requireRecord(root.tools, "tool permission settings tools")
  const tools: ToolPermissionSettings["tools"] = {}
  for (const [toolName, configuredTool] of Object.entries(configuredTools)) {
    if (!toolName.trim()) throw new Error("Tool permission settings contain an empty tool name")
    const tool = requireRecord(configuredTool, `tool permission settings for ${toolName}`)
    assertOnlyKeys(tool, ["requirements"], `tool permission settings for ${toolName}`)
    tools[toolName] = {
      requirements: parseConfiguredRequirements(
        tool.requirements,
        `requirements for tool ${toolName}`,
      ),
    }
  }

  if (Object.keys(tools).length === 0) {
    throw new Error("Tool permission settings must define at least one tool")
  }

  return { version: PERMISSION_PRESET_VERSION, tools }
}

export function permissionPresetFromToolSettings(
  settings: ToolPermissionSettings,
  serverId: string,
  signedInPrincipal: string,
): PermissionPreset {
  if (!ROUTE_ID_PATTERN.test(serverId)) {
    throw new Error(`Invalid MCP server route ID ${JSON.stringify(serverId)}`)
  }

  const groups: PermissionPresetGroup[] = []
  for (const [toolName, tool] of Object.entries(settings.tools)) {
    groups.push({
      kind: "tool",
      label: `Tool: ${toolName}`,
      requirements: resolveConfiguredRequirements(
        tool.requirements,
        `requirements for tool ${toolName}`,
        signedInPrincipal,
      ),
      toolName,
    })
  }

  return { groups, serverId }
}

export function mergeToolPermissionSettings(
  base: ToolPermissionSettings | undefined,
  overrides: ToolPermissionSettings | undefined,
): ToolPermissionSettings | undefined {
  if (!base) return overrides
  if (!overrides) return base
  return {
    version: PERMISSION_PRESET_VERSION,
    tools: { ...base.tools, ...overrides.tools },
  }
}

export function parseAthenzRole(value: string) {
  const match = ATHENZ_ROLE_PATTERN.exec(value)
  if (!match) throw new Error(`Invalid Athenz role ${JSON.stringify(value)}`)
  return { domain: match[1], role: match[2] }
}

export function parseToolAccessScopesForServer(
  value: unknown,
  serverId: string,
  routeAccessScope?: string,
): Record<string, string> | undefined {
  const settings = toolPermissionSettingsForServer(value, serverId)
  return settings ? toolAccessScopesFromSettings(settings, serverId, routeAccessScope) : undefined
}

export function toolAccessScopesFromSettings(
  settings: ToolPermissionSettings,
  serverId: string,
  routeAccessScope?: string,
): Record<string, string> {
  const preset = permissionPresetFromToolSettings(settings, serverId, "human.scope-resolver")
  const routeRoles = parseAccessScope(routeAccessScope)

  return Object.fromEntries(preset.groups.map((group) => {
    const roles = group.requirements
      .filter(({ configuredMember }) => configuredMember === SIGNED_IN_USER_MEMBER)
      .map(({ role }) => role)
    if (!group.toolName) throw new Error(`Tool ${group.label} has no tool name`)
    const scopes = [...new Set([...roles, ...routeRoles])].sort()
    if (scopes.length === 0) throw new Error(`Tool ${group.toolName} has no signed-in-user or managed access scope`)
    return [group.toolName, scopes.join(" ")]
  }))
}

export function withManagedAccessRequirements(
  preset: PermissionPreset | undefined,
  serverId: string,
  routeAccessScope: string | undefined,
  signedInPrincipal: string,
  gatewayPrincipal = "mcp-hub.mcp-gateway",
): PermissionPreset | undefined {
  const roles = parseAccessScope(routeAccessScope)
  if (roles.length === 0) return preset
  if (!ATHENZ_PRINCIPAL_PATTERN.test(signedInPrincipal)) {
    throw new Error(`Signed-in user resolved to invalid Athenz principal ${JSON.stringify(signedInPrincipal)}`)
  }
  if (!ATHENZ_PRINCIPAL_PATTERN.test(gatewayPrincipal)) {
    throw new Error(`MCP Gateway resolved to invalid Athenz principal ${JSON.stringify(gatewayPrincipal)}`)
  }

  const requirements: PermissionRequirement[] = roles.flatMap((role) => {
    const parsed = parseAthenzRole(role)
    return [{
      configuredMember: SIGNED_IN_USER_MEMBER,
      label: "Signed-in user can invoke this Athenz-protected MCP server",
      member: signedInPrincipal,
      role,
      source: "managed",
    }, {
      configuredMember: gatewayPrincipal,
      label: "MCP Gateway can request protected MCP access",
      member: gatewayPrincipal,
      role: `${parsed.domain}:role.${parsed.role}-jag-exchanger`,
      source: "managed",
    }]
  })

  if (!preset) {
    return {
      serverId,
      groups: [{
        kind: "tool",
        label: "Athenz-protected MCP access",
        requirements,
      }],
    }
  }

  return {
    ...preset,
    groups: preset.groups.map((group) => ({
      ...group,
      requirements: mergeRequirements(group.requirements, requirements),
    })),
  }
}

function parseAccessScope(value: string | undefined) {
  const roles = [...new Set(value?.trim().split(/\s+/).filter(Boolean) ?? [])]
  for (const role of roles) parseAthenzRole(role)
  return roles
}

function mergeRequirements(current: PermissionRequirement[], added: PermissionRequirement[]) {
  const identities = new Set(current.map(({ member, role }) => `${member}\n${role}`))
  return [...current, ...added.filter(({ member, role }) => !identities.has(`${member}\n${role}`))]
}

function parseConfiguredRequirements(
  value: unknown,
  location: string,
): ConfiguredPermissionRequirement[] {
  if (!Array.isArray(value)) throw new Error(`${capitalize(location)} must be an array`)

  const seen = new Set<string>()
  return value.map((configuredRequirement, index) => {
    const itemLocation = `${location}[${index}]`
    const requirement = requireRecord(configuredRequirement, itemLocation)
    assertOnlyKeys(requirement, ["label", "member", "role"], itemLocation)

    const configuredMember = requireString(requirement.member, `${itemLocation}.member`)
    const role = requireString(requirement.role, `${itemLocation}.role`)
    const label = requirement.label === undefined
      ? "Required role membership"
      : requireString(requirement.label, `${itemLocation}.label`)
    validateConfiguredMember(configuredMember, itemLocation)
    parseAthenzRole(role)

    const identity = `${configuredMember}\n${role}`
    if (seen.has(identity)) {
      throw new Error(`Duplicate permission requirement for ${configuredMember} in ${role}`)
    }
    seen.add(identity)

    return { label, member: configuredMember, role }
  })
}

function resolveConfiguredRequirements(
  configured: ConfiguredPermissionRequirement[],
  location: string,
  signedInPrincipal: string,
): PermissionRequirement[] {
  return configured.map(({ label, member: configuredMember, role }, index) => ({
    configuredMember,
    label,
    member: resolveMember(configuredMember, signedInPrincipal, `${location}[${index}]`),
    role,
    source: "tool",
  }))
}

function validateConfiguredMember(configuredMember: string, location: string) {
  if (configuredMember === SIGNED_IN_USER_MEMBER) return
  if (configuredMember.includes("<") || configuredMember.includes(">")) {
    throw new Error(
      `Unknown or partial permission member placeholder ${JSON.stringify(configuredMember)} at ${location}`,
    )
  }
  if (!ATHENZ_PRINCIPAL_PATTERN.test(configuredMember)) {
    throw new Error(`Invalid Athenz principal ${JSON.stringify(configuredMember)} at ${location}`)
  }
}

function resolveMember(configuredMember: string, signedInPrincipal: string, location: string) {
  if (configuredMember === SIGNED_IN_USER_MEMBER) {
    if (!ATHENZ_PRINCIPAL_PATTERN.test(signedInPrincipal)) {
      throw new Error(`Signed-in user resolved to invalid Athenz principal ${JSON.stringify(signedInPrincipal)}`)
    }
    return signedInPrincipal
  }

  validateConfiguredMember(configuredMember, location)
  return configuredMember
}

function requireRecord(value: unknown, location: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${capitalize(location)} must be an object`)
  }
  return value as Record<string, unknown>
}

function requireString(value: unknown, location: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${capitalize(location)} must be a non-empty string`)
  }
  return value
}

function assertOnlyKeys(value: Record<string, unknown>, allowedKeys: string[], location: string) {
  const allowed = new Set(allowedKeys)
  const unknownKey = Object.keys(value).find((key) => !allowed.has(key))
  if (unknownKey) throw new Error(`Unknown field ${JSON.stringify(unknownKey)} in ${location}`)
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
