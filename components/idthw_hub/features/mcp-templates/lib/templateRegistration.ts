import type { McpTemplateInput } from "../types.ts"

const DNS_LABEL_PATTERN = /^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/

type TemplateReferenceResult =
  | { ok: true; reference: { project: string; templateKey: string } | null }
  | { ok: false; error: string }

type TemplateResolutionResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; error: string }

export function getTemplateRegistrationReference(payload: unknown): TemplateReferenceResult {
  if (!isRecord(payload)) return { ok: false, error: "Invalid registration request" }
  if (payload.creationMethod === undefined || payload.creationMethod === "direct") {
    return { ok: true, reference: null }
  }
  if (payload.creationMethod !== "template") {
    return { ok: false, error: "Creation method is invalid" }
  }

  const project = trimmedString(payload.project)
  const templateKey = trimmedString(payload.templateKey)
  if (!project || !DNS_LABEL_PATTERN.test(project) || !templateKey || !DNS_LABEL_PATTERN.test(templateKey)) {
    return { ok: false, error: "MCP template reference is invalid" }
  }
  return { ok: true, reference: { project, templateKey } }
}

export function resolveMcpTemplateRegistration(
  payload: unknown,
  template: McpTemplateInput,
): TemplateResolutionResult {
  if (!isRecord(payload) || !Array.isArray(payload.environmentVariables)) {
    return { ok: false, error: "Template environment variables are invalid" }
  }

  const providedValues = new Map<string, string>()
  const templateKeys = new Set(template.environmentVariables.map(({ key }) => key))
  for (const configuredVariable of payload.environmentVariables) {
    if (!isRecord(configuredVariable)) {
      return { ok: false, error: "Template environment variables are invalid" }
    }
    const key = trimmedString(configuredVariable.key)
    const value = typeof configuredVariable.value === "string" ? configuredVariable.value : null
    if (!key || value === null || !templateKeys.has(key)) {
      return { ok: false, error: "Template environment variables do not match the selected template" }
    }
    if (providedValues.has(key)) {
      return { ok: false, error: "Template environment variable keys must be unique" }
    }
    providedValues.set(key, value)
  }

  const environmentVariables: Array<{ key: string; value: string; secret: boolean }> = []
  for (const variable of template.environmentVariables) {
    const value = providedValues.get(variable.key) || variable.defaultValue || ""
    if (variable.required && !value) {
      return { ok: false, error: `${variable.key} is required by the selected MCP template` }
    }
    if (value) environmentVariables.push({ key: variable.key, value, secret: variable.secret })
  }

  return {
    ok: true,
    payload: {
      ...payload,
      arguments: template.arguments,
      command: template.command,
      creationMethod: "template",
      description: template.description,
      environmentVariables,
      image: template.image,
      path: template.path,
      port: template.port,
      templateKey: template.templateKey,
    },
  }
}

function trimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}
