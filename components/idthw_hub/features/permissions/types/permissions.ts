export type ConfiguredPermissionRequirement = {
  exchangeHelperRequirements?: ConfiguredExchangeHelperRequirement[]
  includeExchangeHelpers?: boolean
  label: string
  member: string
  role: string
}

export type ConfiguredExchangeHelperRequirement = {
  label: string
  member: string
  policy?: ConfiguredExchangePolicyRule
  role: string
}

export type ConfiguredExchangePolicyRule = {
  action: string
  effect: "ALLOW" | "DENY"
  resource: string
}

export type ToolPermissionSettings = {
  version: 1
  tools: Record<string, {
    requirements: ConfiguredPermissionRequirement[]
  }>
}

export type PermissionRequirement = {
  configuredMember: string
  exchangePolicy?: ConfiguredExchangePolicyRule
  label: string
  member: string
  role: string
  source: "helper" | "managed" | "tool"
  toolRequirementIndex?: number
  exchangeHelpersCustomized?: boolean
  includeExchangeHelpers?: boolean
}

export type PermissionPolicyRequirement = {
  action: string
  effect: "ALLOW" | "DENY"
  label: string
  resource: string
  role: string
  source: "helper" | "managed"
  toolRequirementIndex?: number
}

export type PermissionPresetGroup = {
  kind: "tool"
  label: string
  policies?: PermissionPolicyRequirement[]
  requirements: PermissionRequirement[]
  toolName?: string
}

export type PermissionPreset = {
  groups: PermissionPresetGroup[]
  serverId: string
}

export type PermissionCheckStatus = "ready" | "missing" | "unavailable"

export type PermissionRequirementCheck = PermissionRequirement & {
  roleUrl: string
  status: PermissionCheckStatus
}

export type PermissionPolicyRequirementCheck = PermissionPolicyRequirement & {
  roleUrl: string
  status: PermissionCheckStatus
}

export type PermissionReadinessGroup = Omit<PermissionPresetGroup, "policies" | "requirements"> & {
  policies: PermissionPolicyRequirementCheck[]
  requirements: PermissionRequirementCheck[]
}

export type PermissionReadiness =
  | {
      message: string
      status: "configuration-error"
    }
  | {
      groups: PermissionReadinessGroup[]
      status: PermissionCheckStatus
    }
