export type PermissionRequirement = {
  configuredMember: string
  label: string
  member: string
  role: string
}

export type PermissionPresetGroup = {
  kind: "server" | "tool"
  label: string
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

export type PermissionReadinessGroup = Omit<PermissionPresetGroup, "requirements"> & {
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
