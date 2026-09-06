import type { McpEnvironmentVariable, McpKubernetesManifestInput } from "./kubernetesManifest"

const DNS_LABEL_PATTERN = /^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/
const ENVIRONMENT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

type ValidationResult =
  | { ok: true; input: McpKubernetesManifestInput }
  | { ok: false; error: string }

export function validateMcpRegistration(payload: unknown): ValidationResult {
  if (!isRecord(payload)) return invalid("Invalid registration request")

  const project = trimmedString(payload.project)
  const mcpKeyName = trimmedString(payload.mcpKeyName)
  const serverName = trimmedString(payload.serverName)
  const image = trimmedString(payload.image)
  const path = trimmedString(payload.path)
  const port = trimmedString(payload.port)
  const command = trimmedString(payload.command)
  const containerArguments = validateContainerArguments(payload)
  const serviceAccount = trimmedString(payload.serviceAccount)
  const creationMethod = payload.creationMethod ?? "direct"
  const description = trimmedString(payload.description ?? "")
  const templateKey = trimmedString(payload.templateKey ?? "")
  const visibility = payload.visibility ?? "personal"

  if (!project || !DNS_LABEL_PATTERN.test(project)) {
    return invalid("Project must be a lowercase Kubernetes DNS name")
  }
  if (!mcpKeyName || !DNS_LABEL_PATTERN.test(mcpKeyName)) {
    return invalid("MCP key name must be a lowercase Kubernetes DNS name")
  }
  if (!serverName || serverName.length > 128) return invalid("MCP server name is required")
  if (!image || image.length > 512 || /\s/.test(image)) return invalid("Container image URL is invalid")
  if (!path || path.length > 2048 || !path.startsWith("/")) {
    return invalid("MCP path must start with /")
  }

  const numericPort = Number(port)
  if (!port || !Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
    return invalid("Target port must be an integer from 1 to 65535")
  }
  if (command === null || command.length > 4096) return invalid("Container command is invalid")
  if (!containerArguments.ok) return containerArguments
  if (creationMethod !== "direct" && creationMethod !== "template") {
    return invalid("Creation method is invalid")
  }
  if (description === null || description.length > 2000) return invalid("Description is invalid")
  if (templateKey === null) return invalid("MCP template key is invalid")
  if (creationMethod === "template" && (!templateKey || !DNS_LABEL_PATTERN.test(templateKey))) {
    return invalid("MCP template key is invalid")
  }
  if (creationMethod === "direct" && templateKey) return invalid("Direct setup cannot reference an MCP template")
  if (visibility !== "personal" && visibility !== "project") return invalid("Visibility is invalid")
  if (creationMethod === "direct" && visibility !== "personal") {
    return invalid("Direct setup visibility must be Personal")
  }
  const environmentVariables = validateEnvironmentVariables(payload.environmentVariables)
  if (!environmentVariables.ok) return environmentVariables
  if (payload.accessManagement !== "hub" && payload.accessManagement !== "server") {
    return invalid("Access management setting is invalid")
  }
  if (serviceAccount === null) return invalid("IAM service account is invalid")

  const serviceDomain = `mcp-hub.mcps.${project}`
  if (payload.accessManagement === "hub" && !serviceAccount) {
    return invalid("Hub-managed access requires an IAM service account")
  }
  if (serviceAccount && !isServiceInDomain(serviceAccount, serviceDomain)) {
    return invalid(`IAM service account must belong to ${serviceDomain}`)
  }

  return {
    ok: true,
    input: {
      accessManagement: payload.accessManagement,
      arguments: containerArguments.arguments,
      command,
      creationMethod,
      description,
      environmentVariables: environmentVariables.variables,
      image,
      mcpKeyName,
      path,
      port,
      project,
      serverName,
      serviceAccount,
      templateKey,
      visibility,
    },
  }
}

function validateContainerArguments(payload: Record<string, unknown>):
  | { ok: true; arguments: string[] }
  | { ok: false; error: string } {
  if (payload.arguments === undefined) {
    const legacyArgument = trimmedString(payload.argument)
    if (legacyArgument === null || legacyArgument.length > 4096) {
      return invalid("Container arguments are invalid")
    }
    return { ok: true, arguments: legacyArgument ? [legacyArgument] : [] }
  }
  if (!Array.isArray(payload.arguments) || payload.arguments.length > 50) {
    return invalid("Container arguments are invalid")
  }

  const containerArguments: string[] = []
  for (const argument of payload.arguments) {
    if (typeof argument !== "string") {
      return invalid("Container arguments are invalid")
    }
    const normalizedArgument = argument.trim()
    if (normalizedArgument.length > 4096) return invalid("Container arguments are invalid")
    if (normalizedArgument) containerArguments.push(normalizedArgument)
  }
  return { ok: true, arguments: containerArguments }
}

function validateEnvironmentVariables(value: unknown):
  | { ok: true; variables: McpEnvironmentVariable[] }
  | { ok: false; error: string } {
  if (!Array.isArray(value) || value.length > 50) {
    return invalid("Environment variables are invalid")
  }

  const variables: McpEnvironmentVariable[] = []
  const keys = new Set<string>()
  for (const [index, configuredVariable] of value.entries()) {
    if (!isRecord(configuredVariable)) return invalid(`Environment variable ${index + 1} is invalid`)
    const key = trimmedString(configuredVariable.key)
    const variableValue = typeof configuredVariable.value === "string" ? configuredVariable.value : null
    const secret = configuredVariable.secret
    if (key === null || variableValue === null || (secret !== true && secret !== false)) {
      return invalid(`Environment variable ${index + 1} is invalid`)
    }
    if (!key && !variableValue) continue
    if (!key || !variableValue) {
      return invalid(`Environment variable ${index + 1} key and value must be provided together`)
    }
    if (!ENVIRONMENT_KEY_PATTERN.test(key)) {
      return invalid(`Environment variable ${index + 1} key is invalid`)
    }
    if (variableValue.length > 32768) {
      return invalid(`Environment variable ${index + 1} value is too long`)
    }
    if (keys.has(key)) return invalid("Environment variable keys must be unique")
    keys.add(key)
    variables.push({ key, value: variableValue, secret })
  }

  return { ok: true, variables }
}

function isServiceInDomain(serviceAccount: string, domain: string) {
  const serviceName = serviceAccount.slice(domain.length + 1)
  return serviceAccount.startsWith(`${domain}.`)
    && serviceName.length > 0
    && serviceName.length <= 255
    && /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(serviceName)
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
