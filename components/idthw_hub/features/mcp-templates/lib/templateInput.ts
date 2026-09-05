import type {
  McpTemplateEnvironmentVariable,
  McpTemplateInput,
} from "../types.ts"

const DNS_LABEL_PATTERN = /^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/
const ENVIRONMENT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

type ValidationResult =
  | { ok: true; input: McpTemplateInput }
  | { ok: false; error: string }

export function validateMcpTemplate(payload: unknown): ValidationResult {
  if (!isRecord(payload)) return invalid("Invalid MCP template request")

  const project = trimmedString(payload.project)
  const name = trimmedString(payload.name)
  const templateKey = trimmedString(payload.templateKey)
  const image = trimmedString(payload.image)
  const port = trimmedString(payload.port)
  const path = trimmedString(payload.path)
  const command = trimmedString(payload.command)
  const argument = trimmedString(payload.argument)
  const documentation = trimmedString(payload.documentation)
  const description = trimmedString(payload.description)

  if (!project || !DNS_LABEL_PATTERN.test(project)) {
    return invalid("Project must be a lowercase Kubernetes DNS name")
  }
  if (!templateKey || !DNS_LABEL_PATTERN.test(templateKey)) {
    return invalid("Template key name must be a lowercase Kubernetes DNS name")
  }
  if (!name || name.length > 128 || /[\r\n\t]/.test(name)) return invalid("Template name is invalid")
  if (!image || image.length > 512 || /\s/.test(image)) return invalid("Container image URL is invalid")

  const numericPort = Number(port)
  if (!port || !Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
    return invalid("Target port must be an integer from 1 to 65535")
  }
  if (!path || path.length > 2048 || !path.startsWith("/")) {
    return invalid("MCP path must start with /")
  }
  if (command === null || command.length > 4096) return invalid("Container command is invalid")
  if (argument === null || argument.length > 4096) return invalid("Container argument is invalid")
  if (payload.transport !== "streamable-http") return invalid("Transport is invalid")
  if (payload.visibility !== "project") return invalid("Visibility is invalid")
  if (documentation === null || !isOptionalHttpUrl(documentation)) return invalid("Documentation URL is invalid")
  if (description === null || description.length > 2000) return invalid("Description is invalid")

  const environmentVariables = validateEnvironmentVariables(payload.environmentVariables)
  if (!environmentVariables.ok) return environmentVariables

  return {
    ok: true,
    input: {
      argument,
      command,
      description,
      documentation,
      environmentVariables: environmentVariables.variables,
      image,
      name,
      path,
      port,
      project,
      templateKey,
      transport: "streamable-http",
      visibility: "project",
    },
  }
}

function validateEnvironmentVariables(value: unknown):
  | { ok: true; variables: McpTemplateEnvironmentVariable[] }
  | { ok: false; error: string } {
  if (!Array.isArray(value) || value.length > 50) return invalid("Environment variables are invalid")

  const variables: McpTemplateEnvironmentVariable[] = []
  const keys = new Set<string>()
  for (const [index, configuredVariable] of value.entries()) {
    if (!isRecord(configuredVariable)) return invalid(`Environment variable ${index + 1} is invalid`)
    const key = trimmedString(configuredVariable.key)
    const description = trimmedString(configuredVariable.description)
    const defaultValue = typeof configuredVariable.defaultValue === "string"
      ? configuredVariable.defaultValue
      : null
    const { required, secret } = configuredVariable
    if (
      key === null
      || description === null
      || defaultValue === null
      || (required !== true && required !== false)
      || (secret !== true && secret !== false)
    ) {
      return invalid(`Environment variable ${index + 1} is invalid`)
    }
    if (!key && !description && !defaultValue) continue
    if (!key || !ENVIRONMENT_KEY_PATTERN.test(key)) {
      return invalid(`Environment variable ${index + 1} key is invalid`)
    }
    if (description.length > 512) return invalid(`Environment variable ${index + 1} description is too long`)
    if (defaultValue.length > 32768) return invalid(`Environment variable ${index + 1} default is too long`)
    if (secret && defaultValue) {
      return invalid(`Secret environment variable ${index + 1} cannot have a default value`)
    }
    if (keys.has(key)) return invalid("Environment variable keys must be unique")
    keys.add(key)
    variables.push({
      key,
      description,
      required,
      secret,
      ...(secret ? {} : { defaultValue }),
    })
  }

  return { ok: true, variables }
}

function isOptionalHttpUrl(value: string) {
  if (!value) return true
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

function trimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : null
}

function invalid(error: string): { ok: false; error: string } {
  return { ok: false, error }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}
