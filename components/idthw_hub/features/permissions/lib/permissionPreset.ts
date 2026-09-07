import type {
  ConfiguredExchangeHelperRequirement,
  ConfiguredExchangePolicyRule,
  ConfiguredPermissionRequirement,
  PermissionPreset,
  PermissionPresetGroup,
  PermissionPolicyRequirement,
  PermissionRequirement,
  ToolPermissionSettings,
} from "../types/permissions"

export const SIGNED_IN_USER_MEMBER = "<signed_in_user>"
export const PERMISSION_PRESET_VERSION = 1

const ATHENZ_PRINCIPAL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.[A-Za-z0-9][A-Za-z0-9._-]*$/
const ATHENZ_DOMAIN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const ATHENZ_ROLE_PATTERN = /^([A-Za-z0-9][A-Za-z0-9._-]*):role\.([A-Za-z0-9][A-Za-z0-9._-]*)$/
const ROUTE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,251}[a-z0-9])?$/i

export function parsePermissionPresetForServer(
  value: unknown,
  serverId: string,
  signedInPrincipal: string,
  helperContext?: ExchangeHelperContext,
): PermissionPreset | undefined {
  const settings = toolPermissionSettingsForServer(value, serverId)
  return settings
    ? permissionPresetFromToolSettings(settings, serverId, signedInPrincipal, helperContext)
    : undefined
}

export type ExchangeHelperContext = {
  gatewayPrincipal?: string
  servicePrincipal?: string
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
    assertOnlyKeys(
      tool,
      ["exchangeHelperRequirements", "includeExchangeHelpers", "requirements"],
      `tool permission settings for ${toolName}`,
    )
    let requirements = parseConfiguredRequirements(
      tool.requirements,
      `requirements for tool ${toolName}`,
    )
    const legacyIncludeExchangeHelpers = optionalBoolean(
      tool.includeExchangeHelpers,
      `includeExchangeHelpers for tool ${toolName}`,
    )
    const legacyExchangeHelperRequirements = tool.exchangeHelperRequirements === undefined
      ? undefined
      : parseConfiguredExchangeHelperRequirements(
        tool.exchangeHelperRequirements,
        `exchangeHelperRequirements for tool ${toolName}`,
      )
    if (legacyExchangeHelperRequirements && legacyIncludeExchangeHelpers !== true) {
      throw new Error(`Custom exchange helpers for tool ${toolName} require includeExchangeHelpers to be true`)
    }
    if (legacyIncludeExchangeHelpers !== undefined || legacyExchangeHelperRequirements) {
      if (requirements.some(({ includeExchangeHelpers, exchangeHelperRequirements }) => (
        includeExchangeHelpers !== undefined || exchangeHelperRequirements !== undefined
      ))) {
        throw new Error(`Tool ${toolName} cannot mix legacy tool-level and per-permission exchange helpers`)
      }
      const signedInRequirementCount = requirements.filter(
        ({ member }) => member === SIGNED_IN_USER_MEMBER,
      ).length
      if (legacyIncludeExchangeHelpers && signedInRequirementCount === 0) {
        throw new Error(`Exchange helpers for tool ${toolName} require a signed-in-user permission`)
      }
      if (legacyExchangeHelperRequirements && signedInRequirementCount !== 1) {
        throw new Error(`Customized legacy exchange helpers for tool ${toolName} require exactly one signed-in-user permission`)
      }
      requirements = requirements.map((requirement) => requirement.member === SIGNED_IN_USER_MEMBER
        ? {
            ...requirement,
            ...(legacyExchangeHelperRequirements ? { exchangeHelperRequirements: legacyExchangeHelperRequirements } : {}),
            includeExchangeHelpers: legacyIncludeExchangeHelpers,
          }
        : requirement)
    }
    tools[toolName] = {
      requirements,
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
  helperContext?: ExchangeHelperContext,
): PermissionPreset {
  if (!ROUTE_ID_PATTERN.test(serverId)) {
    throw new Error(`Invalid MCP server route ID ${JSON.stringify(serverId)}`)
  }

  const groups: PermissionPresetGroup[] = []
  for (const [toolName, tool] of Object.entries(settings.tools)) {
    const requirements = tool.requirements.flatMap((configuredRequirement, toolRequirementIndex) => {
      const location = `requirements for tool ${toolName}[${toolRequirementIndex}]`
      const directRequirement = resolveConfiguredRequirement(
        configuredRequirement,
        location,
        signedInPrincipal,
        toolRequirementIndex,
      )
      if (!configuredRequirement.includeExchangeHelpers) return [directRequirement]

      const configuredHelpers = configuredRequirement.exchangeHelperRequirements
        ?? exchangeHelperRequirements(
          [configuredRequirement],
          helperContext?.servicePrincipal ?? "",
          helperContext?.gatewayPrincipal ?? "mcp-hub.mcp-gateway",
        )
      const helperRequirements = configuredHelpers.map((configuredHelper, helperIndex): PermissionRequirement => ({
        ...resolveConfiguredRequirement(
          configuredHelper,
          `exchange helpers for ${location}[${helperIndex}]`,
          signedInPrincipal,
        ),
        ...(configuredHelper.policies === undefined ? {} : {
          exchangePolicies: configuredHelper.policies,
          exchangePoliciesCustomized: true,
        }),
        source: "helper",
        toolRequirementIndex,
      }))
      return [directRequirement, ...helperRequirements]
    })
    const policies: PermissionPolicyRequirement[] = requirements.flatMap((requirement) => (
      requirement.source === "helper"
        ? (requirement.exchangePolicies ?? []).map((policy) => ({
            ...policy,
            label: "Configured exchange policy",
            role: requirement.role,
            source: "helper" as const,
            toolRequirementIndex: requirement.toolRequirementIndex,
          }))
        : []
    ))
    groups.push({
      kind: "tool",
      label: `Tool: ${toolName}`,
      ...(policies.length > 0 ? { policies } : {}),
      requirements,
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

export function exchangePolicyRules(
  targetRole: string,
  sourceAudience: string,
  sourceExchangeRole?: string,
) {
  const target = parseAthenzRole(targetRole)
  const source = sourceAudience.trim()
  if (!ATHENZ_DOMAIN_PATTERN.test(source)) {
    throw new Error(`Invalid Athenz source audience ${JSON.stringify(sourceAudience)}`)
  }
  if (sourceExchangeRole && parseAthenzRole(sourceExchangeRole).domain !== source) {
    throw new Error("Athenz source-exchange role must belong to the source audience")
  }

  return [{
    action: "zts.jag_exchange" as const,
    effect: "ALLOW" as const,
    resource: targetRole,
    role: `${target.domain}:role.${target.role}-jag-exchanger`,
  }, ...(sourceExchangeRole ? [{
    action: "zts.token_source_exchange" as const,
    effect: "ALLOW" as const,
    resource: `${source}:${target.domain}`,
    role: sourceExchangeRole,
  }] : []), {
    action: "zts.token_target_exchange" as const,
    effect: "ALLOW" as const,
    resource: `${target.domain}:${source}:role.${target.role}`,
    role: `${target.domain}:role.${target.role}-exchanger`,
  }]
}

export function withExpectedExchangePolicies(
  preset: PermissionPreset | undefined,
  sourceAudience: string | undefined,
): PermissionPreset | undefined {
  if (!preset || !sourceAudience) return preset

  return {
    ...preset,
    groups: preset.groups.map((group) => {
      const policies: PermissionPolicyRequirement[] = [...(group.policies ?? [])]
      const seen = new Set(policies.map(({ action, effect, resource, role }) => (
        `${effect}\n${action}\n${role}\n${resource}`
      )))
      const customizedHelperPolicyRoles = new Set([
        ...policies
          .filter(({ source }) => source === "helper")
          .map(({ role, toolRequirementIndex }) => `${toolRequirementIndex ?? ""}\n${role}`),
        ...group.requirements
          .filter(({ exchangePoliciesCustomized, source }) => source === "helper" && exchangePoliciesCustomized)
          .map(({ role, toolRequirementIndex }) => `${toolRequirementIndex ?? ""}\n${role}`),
      ])
      const sourceExchangeRole = group.requirements.find(({ role, source }) => (
        source === "managed" && (
          role.endsWith(":role.accessor-source-exchanger")
          || role.endsWith("-accessor-source-exchanger")
        )
      ))?.role
      const requirementRoles = new Set(group.requirements.map(({ role }) => role))

      const addPolicy = (
        rule: ReturnType<typeof exchangePolicyRules>[number],
        label: string,
        source: PermissionPolicyRequirement["source"],
        toolRequirementIndex?: number,
      ) => {
        if (!requirementRoles.has(rule.role)) return
        if (
          source === "helper"
          && customizedHelperPolicyRoles.has(`${toolRequirementIndex ?? ""}\n${rule.role}`)
        ) return
        const identity = `${rule.effect}\n${rule.action}\n${rule.role}\n${rule.resource}`
        if (seen.has(identity)) return
        seen.add(identity)
        policies.push({ ...rule, label, source, toolRequirementIndex })
      }

      for (const requirement of group.requirements) {
        if (requirement.configuredMember !== SIGNED_IN_USER_MEMBER) continue
        const isToolAccess = requirement.source === "tool"
        const rules = exchangePolicyRules(
          requirement.role,
          sourceAudience,
          isToolAccess ? sourceExchangeRole : undefined,
        )
        addPolicy(
          rules[0],
          isToolAccess ? "ID-JAG exchange policy" : "MCP access ID-JAG policy",
          isToolAccess ? "helper" : "managed",
          requirement.toolRequirementIndex,
        )
        if (!isToolAccess) continue

        for (const rule of rules.slice(1)) {
          if (rule.action === "zts.token_source_exchange") {
            addPolicy(rule, "Source-token exchange policy", "managed", requirement.toolRequirementIndex)
          } else {
            addPolicy(rule, "Target-token exchange policy", "helper", requirement.toolRequirementIndex)
          }
        }
      }

      return { ...group, policies }
    }),
  }
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
  if (!ROUTE_ID_PATTERN.test(serverId)) {
    throw new Error(`Invalid MCP server route ID ${JSON.stringify(serverId)}`)
  }
  const routeRoles = parseAccessScope(routeAccessScope)

  return Object.fromEntries(Object.entries(settings.tools).map(([toolName, tool]) => {
    const roles = tool.requirements
      .filter(({ member }) => member === SIGNED_IN_USER_MEMBER)
      .map(({ role }) => role)
    const scopes = [...new Set([...roles, ...routeRoles])].sort()
    if (scopes.length === 0) throw new Error(`Tool ${toolName} has no signed-in-user or managed access scope`)
    return [toolName, scopes.join(" ")]
  }))
}

export function exchangeHelperRequirements(
  requirements: ConfiguredPermissionRequirement[],
  servicePrincipal: string,
  gatewayPrincipal = "mcp-hub.mcp-gateway",
): ConfiguredExchangeHelperRequirement[] {
  validateConfiguredMember(servicePrincipal, "exchange helper MCP service principal")
  validateConfiguredMember(gatewayPrincipal, "exchange helper Gateway principal")

  const directRoles = requirements
    .filter(({ member }) => member === SIGNED_IN_USER_MEMBER)
    .map(({ role }) => parseAthenzRole(role))
  if (directRoles.length === 0) {
    throw new Error("Exchange helpers require at least one signed-in-user tool permission")
  }

  const helpers = directRoles.flatMap(({ domain, role }) => [{
    label: "MCP Gateway can request delegated downstream access",
    member: gatewayPrincipal,
    role: `${domain}:role.${role}-jag-exchanger`,
  }, {
    label: "MCP service can exchange into the downstream role",
    member: servicePrincipal,
    role: `${domain}:role.${role}-exchanger`,
  }])
  const seen = new Set<string>()
  return helpers.filter(({ member, role }) => {
    const identity = `${member}\n${role}`
    if (seen.has(identity)) return false
    seen.add(identity)
    return true
  })
}

export function withManagedAccessRequirements(
  preset: PermissionPreset | undefined,
  serverId: string,
  routeAccessScope: string | undefined,
  signedInPrincipal: string,
  gatewayPrincipal = "mcp-hub.mcp-gateway",
  servicePrincipal?: string,
): PermissionPreset | undefined {
  const roles = parseAccessScope(routeAccessScope)
  if (roles.length === 0) return preset
  if (!ATHENZ_PRINCIPAL_PATTERN.test(signedInPrincipal)) {
    throw new Error(`Signed-in user resolved to invalid Athenz principal ${JSON.stringify(signedInPrincipal)}`)
  }
  if (!ATHENZ_PRINCIPAL_PATTERN.test(gatewayPrincipal)) {
    throw new Error(`MCP Gateway resolved to invalid Athenz principal ${JSON.stringify(gatewayPrincipal)}`)
  }
  if (servicePrincipal && !ATHENZ_PRINCIPAL_PATTERN.test(servicePrincipal)) {
    throw new Error(`MCP service resolved to invalid Athenz principal ${JSON.stringify(servicePrincipal)}`)
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
    }, ...(servicePrincipal ? [{
      configuredMember: servicePrincipal,
      label: "MCP service can exchange from this MCP server access role",
      member: servicePrincipal,
      role: `${parsed.domain}:role.${parsed.role}-source-exchanger`,
      source: "managed" as const,
    }] : [])]
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
    assertOnlyKeys(
      requirement,
      ["exchangeHelperRequirements", "includeExchangeHelpers", "label", "member", "role"],
      itemLocation,
    )

    const configuredMember = requireString(requirement.member, `${itemLocation}.member`)
    const role = requireString(requirement.role, `${itemLocation}.role`)
    const label = requirement.label === undefined
      ? "Required role membership"
      : requireString(requirement.label, `${itemLocation}.label`)
    validateConfiguredMember(configuredMember, itemLocation)
    parseAthenzRole(role)

    const includeExchangeHelpers = optionalBoolean(
      requirement.includeExchangeHelpers,
      `${itemLocation}.includeExchangeHelpers`,
    )
    const exchangeHelperRequirements = requirement.exchangeHelperRequirements === undefined
      ? undefined
      : parseConfiguredExchangeHelperRequirements(
        requirement.exchangeHelperRequirements,
        `${itemLocation}.exchangeHelperRequirements`,
      )
    if ((includeExchangeHelpers !== undefined || exchangeHelperRequirements !== undefined)
      && configuredMember !== SIGNED_IN_USER_MEMBER) {
      throw new Error(`Exchange helpers at ${itemLocation} require the signed-in-user member`)
    }
    if (exchangeHelperRequirements !== undefined && includeExchangeHelpers !== true) {
      throw new Error(`Custom exchange helpers at ${itemLocation} require includeExchangeHelpers to be true`)
    }

    const identity = `${configuredMember}\n${role}`
    if (seen.has(identity)) {
      throw new Error(`Duplicate permission requirement for ${configuredMember} in ${role}`)
    }
    seen.add(identity)

    return {
      ...(exchangeHelperRequirements ? { exchangeHelperRequirements } : {}),
      ...(includeExchangeHelpers === undefined ? {} : { includeExchangeHelpers }),
      label,
      member: configuredMember,
      role,
    }
  })
}

function parseConfiguredExchangeHelperRequirements(
  value: unknown,
  location: string,
): ConfiguredExchangeHelperRequirement[] {
  if (!Array.isArray(value)) throw new Error(`${capitalize(location)} must be an array`)

  const seen = new Set<string>()
  return value.map((configuredRequirement, index) => {
    const itemLocation = `${location}[${index}]`
    const requirement = requireRecord(configuredRequirement, itemLocation)
    assertOnlyKeys(requirement, ["label", "member", "policies", "policy", "role"], itemLocation)
    const member = requireString(requirement.member, `${itemLocation}.member`)
    const role = requireString(requirement.role, `${itemLocation}.role`)
    const label = requirement.label === undefined
      ? "Required role membership"
      : requireString(requirement.label, `${itemLocation}.label`)
    validateConfiguredMember(member, itemLocation)
    if (member === SIGNED_IN_USER_MEMBER) {
      throw new Error(`Exchange helper requirements at ${location} must use static service principals`)
    }
    parseAthenzRole(role)
    if (requirement.policy !== undefined && requirement.policies !== undefined) {
      throw new Error(`${capitalize(itemLocation)} cannot define both policy and policies`)
    }
    const policies = requirement.policy !== undefined
      ? [parseConfiguredExchangePolicy(requirement.policy, `${itemLocation}.policy`)]
      : requirement.policies === undefined
        ? undefined
        : parseConfiguredExchangePolicies(requirement.policies, `${itemLocation}.policies`)

    const identity = `${member}\n${role}`
    if (seen.has(identity)) throw new Error(`Duplicate exchange helper requirement for ${member} in ${role}`)
    seen.add(identity)
    return { label, member, ...(policies === undefined ? {} : { policies }), role }
  })
}

function parseConfiguredExchangePolicies(
  value: unknown,
  location: string,
): ConfiguredExchangePolicyRule[] {
  if (!Array.isArray(value)) throw new Error(`${capitalize(location)} must be an array`)
  const seen = new Set<string>()
  return value.map((policy, index) => {
    const parsed = parseConfiguredExchangePolicy(policy, `${location}[${index}]`)
    const identity = `${parsed.effect}\n${parsed.action}\n${parsed.resource}`
    if (seen.has(identity)) throw new Error(`Duplicate exchange policy at ${location}[${index}]`)
    seen.add(identity)
    return parsed
  })
}

function parseConfiguredExchangePolicy(
  value: unknown,
  location: string,
): ConfiguredExchangePolicyRule {
  const policy = requireRecord(value, location)
  assertOnlyKeys(policy, ["action", "effect", "resource"], location)
  const effect = requireString(policy.effect, `${location}.effect`)
  if (effect !== "ALLOW" && effect !== "DENY") {
    throw new Error(`${capitalize(location)}.effect must be ALLOW or DENY`)
  }
  return {
    action: requireString(policy.action, `${location}.action`),
    effect,
    resource: requireString(policy.resource, `${location}.resource`),
  }
}

function resolveConfiguredRequirement(
  { exchangeHelperRequirements, includeExchangeHelpers, label, member: configuredMember, role }: ConfiguredPermissionRequirement,
  location: string,
  signedInPrincipal: string,
  toolRequirementIndex?: number,
): PermissionRequirement {
  return {
    configuredMember,
    ...(exchangeHelperRequirements ? { exchangeHelpersCustomized: true } : {}),
    ...(includeExchangeHelpers === undefined ? {} : { includeExchangeHelpers }),
    label,
    member: resolveMember(configuredMember, signedInPrincipal, location),
    role,
    source: "tool",
    ...(toolRequirementIndex === undefined ? {} : { toolRequirementIndex }),
  }
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

function optionalBoolean(value: unknown, location: string) {
  if (value === undefined) return undefined
  if (typeof value !== "boolean") throw new Error(`${capitalize(location)} must be a boolean`)
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
