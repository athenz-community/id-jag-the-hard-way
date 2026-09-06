import { parseToolPermissionSettings } from "./permissionPreset.ts"
import type {
  ConfiguredPermissionRequirement,
  EditablePermissionRequirement,
  ToolPermissionDraft,
  ToolPermissionSettings,
} from "../types/permissions.ts"

export const SIGNED_IN_USER_MEMBER = "<signed_in_user>"
export const TEMPLATE_MCP_IAM_MEMBER = "mcp-hub.template-mcp-iam-account"

type ToolPermissionDraftResult =
  | { ok: true; settings: ToolPermissionSettings | undefined }
  | { ok: false; error: string }

export function validateToolPermissionDraft(
  tools: ToolPermissionDraft[],
  includeExchangeHelpers: boolean,
  mcpServicePrincipal?: string,
): ToolPermissionDraftResult {
  if (tools.length === 0) return { ok: true, settings: undefined }

  const configuredTools: ToolPermissionSettings["tools"] = {}
  for (const [index, tool] of tools.entries()) {
    const toolName = tool.toolName.trim()
    if (!toolName) return { ok: false, error: `Tool ${index + 1} name is required` }
    if (configuredTools[toolName]) {
      return { ok: false, error: `Tool names must be unique: ${toolName}` }
    }
    configuredTools[toolName] = {
      requirements: configuredRequirementsFromDraft(
        tool.requirements,
        includeExchangeHelpers,
        mcpServicePrincipal,
      ),
    }
  }

  try {
    return {
      ok: true,
      settings: parseToolPermissionSettings({ version: 1, tools: configuredTools }),
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Tool permissions are invalid",
    }
  }
}

export function toolPermissionDraftFromSettings(
  settings: ToolPermissionSettings | undefined,
  servicePrincipal?: string,
): ToolPermissionDraft[] {
  return Object.entries(settings?.tools ?? {}).map(([toolName, tool], index) => ({
    id: index + 1,
    requirements: editableRequirementsFromConfigured(tool.requirements, servicePrincipal),
    toolName,
  }))
}

export function editableRequirementsFromConfigured(
  requirements: ConfiguredPermissionRequirement[],
  servicePrincipal?: string,
): EditablePermissionRequirement[] {
  return requirements.map((requirement) => {
    const parsedRole = editableRole(requirement.role)
    return {
      audience: parsedRole.audience,
      exchangeHelpersCustomized: requirement.exchangeHelperRequirements !== undefined
        || requirement.includeExchangeHelpers === false,
      helperRequirements: (requirement.exchangeHelperRequirements ?? []).map((helper) => ({
        label: helper.label,
        member: helper.member,
        memberType: helperMemberType(helper.member, servicePrincipal),
        policies: (helper.policies ?? (helper.policy ? [helper.policy] : [])).map((policy) => ({ ...policy })),
        role: helper.role,
      })),
      label: requirement.label,
      member: requirement.member,
      memberType: requirement.member === SIGNED_IN_USER_MEMBER ? "signed-in-user" : "service",
      role: parsedRole.role,
    }
  })
}

export function configuredRequirementsFromDraft(
  requirements: EditablePermissionRequirement[],
  includeExchangeHelpers: boolean,
  mcpServicePrincipal?: string,
): ConfiguredPermissionRequirement[] {
  return requirements.map((requirement) => {
    const managesExchangeHelpers = requirement.memberType === "signed-in-user" && includeExchangeHelpers
    return {
      ...(managesExchangeHelpers ? { includeExchangeHelpers: true } : {}),
      ...(managesExchangeHelpers && requirement.exchangeHelpersCustomized
        ? {
            exchangeHelperRequirements: requirement.helperRequirements.map((helper) => ({
              label: helper.label.trim(),
              member: helper.memberType === "mcp-service" && mcpServicePrincipal
                ? mcpServicePrincipal
                : helper.member.trim(),
              policies: helper.policies.map((policy) => ({
                action: policy.action.trim(),
                effect: policy.effect,
                resource: policy.resource.trim(),
              })),
              role: helper.role.trim(),
            })),
          }
        : {}),
      label: requirement.label.trim() || "Signed-in user can call the downstream API",
      member: requirement.memberType === "signed-in-user"
        ? SIGNED_IN_USER_MEMBER
        : requirement.member.trim(),
      role: configuredRole(requirement.audience, requirement.role),
    }
  })
}

export function emptyEditablePermissionRequirement(): EditablePermissionRequirement {
  return {
    audience: "",
    exchangeHelpersCustomized: false,
    helperRequirements: [],
    label: "",
    member: SIGNED_IN_USER_MEMBER,
    memberType: "signed-in-user",
    role: "",
  }
}

export function toolPermissionSettingsText(settings: ToolPermissionSettings | undefined) {
  if (!settings) return "Not configured"
  return Object.entries(settings.tools)
    .map(([toolName, tool]) => {
      const requirements = tool.requirements.flatMap((requirement) => {
        const direct = `Direct: ${requirement.member} → ${requirement.role}`
        const helpers = (requirement.exchangeHelperRequirements ?? []).flatMap((helper) => [
          `  Helper: ${helper.member === TEMPLATE_MCP_IAM_MEMBER ? "MCP IAM account selected during server creation" : helper.member} → ${helper.role}`,
          ...(helper.policies ?? (helper.policy ? [helper.policy] : []))
            .map((policy) => `    Policy: ${policy.effect} ${policy.action} ${policy.resource}`),
        ])
        const generatedHelpers = requirement.includeExchangeHelpers
          && requirement.exchangeHelperRequirements === undefined
          ? ["  Helpers: generated when an MCP IAM account is selected"]
          : []
        return [direct, ...helpers, ...generatedHelpers]
      })
      return `${toolName}\n${requirements.join("\n") || "No direct permissions"}`
    })
    .join("\n\n")
}

export function toolPermissionSettingsFingerprint(settings: ToolPermissionSettings | undefined) {
  return JSON.stringify(settings ?? null)
}

export function signedInUserPermissionAudiences(settings: ToolPermissionSettings | undefined) {
  if (!settings) return []
  const audiences = Object.values(settings.tools)
    .flatMap(({ requirements }) => requirements)
    .filter(({ member }) => member === SIGNED_IN_USER_MEMBER)
    .map(({ role }) => editableRole(role).audience)
    .filter(Boolean)
  return [...new Set(audiences)].sort()
}

export function hasUnresolvedTemplateMcpIamMember(settings: ToolPermissionSettings | undefined) {
  return Boolean(settings && Object.values(settings.tools).some(({ requirements }) => (
    requirements.some((requirement) => (
      requirement.member === TEMPLATE_MCP_IAM_MEMBER
      || requirement.exchangeHelperRequirements?.some(({ member }) => member === TEMPLATE_MCP_IAM_MEMBER)
    ))
  )))
}

function configuredRole(audience: string, role: string) {
  return `${audience.trim()}:role.${role.trim()}`
}

function editableRole(role: string) {
  const marker = ":role."
  const markerIndex = role.indexOf(marker)
  return markerIndex > 0
    ? { audience: role.slice(0, markerIndex), role: role.slice(markerIndex + marker.length) }
    : { audience: "", role }
}

function helperMemberType(
  member: string,
  servicePrincipal?: string,
): "custom" | "gateway" | "mcp-service" {
  if (member === "mcp-hub.mcp-gateway") return "gateway"
  if (member === TEMPLATE_MCP_IAM_MEMBER) return "mcp-service"
  if (servicePrincipal && member === servicePrincipal) return "mcp-service"
  return "custom"
}
