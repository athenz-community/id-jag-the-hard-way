import type {
  PermissionPreset,
  PermissionPresetGroup,
  PermissionRequirement,
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

  const groups: PermissionPresetGroup[] = []
  if (server.tools !== undefined) {
    const tools = requireRecord(server.tools, `tool requirements for ${serverId}`)
    for (const [toolName, configuredTool] of Object.entries(tools)) {
      if (!toolName.trim()) throw new Error(`Tool name for ${serverId} must not be empty`)
      const tool = requireRecord(configuredTool, `permission preset for tool ${toolName}`)
      assertOnlyKeys(tool, ["requirements"], `permission preset for tool ${toolName}`)
      groups.push({
        kind: "tool",
        label: `Tool: ${toolName}`,
        requirements: parseRequirements(
          tool.requirements,
          `requirements for tool ${toolName}`,
          signedInPrincipal,
        ),
        toolName,
      })
    }
  }

  if (groups.length === 0 || groups.every(({ requirements }) => requirements.length === 0)) {
    throw new Error(`Permission preset for ${serverId} must define at least one requirement`)
  }

  return { groups, serverId }
}

export function parseAthenzRole(value: string) {
  const match = ATHENZ_ROLE_PATTERN.exec(value)
  if (!match) throw new Error(`Invalid Athenz role ${JSON.stringify(value)}`)
  return { domain: match[1], role: match[2] }
}

function parseRequirements(
  value: unknown,
  location: string,
  signedInPrincipal: string,
): PermissionRequirement[] {
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
    const member = resolveMember(configuredMember, signedInPrincipal, itemLocation)
    parseAthenzRole(role)

    const identity = `${configuredMember}\n${role}`
    if (seen.has(identity)) {
      throw new Error(`Duplicate permission requirement for ${configuredMember} in ${role}`)
    }
    seen.add(identity)

    return { configuredMember, label, member, role }
  })
}

function resolveMember(configuredMember: string, signedInPrincipal: string, location: string) {
  if (configuredMember === SIGNED_IN_USER_MEMBER) {
    if (!ATHENZ_PRINCIPAL_PATTERN.test(signedInPrincipal)) {
      throw new Error(`Signed-in user resolved to invalid Athenz principal ${JSON.stringify(signedInPrincipal)}`)
    }
    return signedInPrincipal
  }

  if (configuredMember.includes("<") || configuredMember.includes(">")) {
    throw new Error(
      `Unknown or partial permission member placeholder ${JSON.stringify(configuredMember)} at ${location}`,
    )
  }
  if (!ATHENZ_PRINCIPAL_PATTERN.test(configuredMember)) {
    throw new Error(`Invalid Athenz principal ${JSON.stringify(configuredMember)} at ${location}`)
  }
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
