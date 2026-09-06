import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  kubectlArgs,
  runKubectlCommand,
  type KubectlRunner,
} from "../../kubernetes/api/kubectl.ts"
import {
  buildMcpKubernetesResources,
  MCP_MANAGED_IDENTITY_ANNOTATION,
  type McpEnvironmentVariable,
  type McpKubernetesManifestInput,
} from "../lib/kubernetesManifest.ts"
import { normalizeMcpIconId } from "../../mcp-servers/lib/mcpIcons.ts"
import {
  exchangeHelperRequirements,
  parseAthenzRole,
  parseToolPermissionSettings,
} from "../../permissions/lib/permissionPreset.ts"
import type {
  ConfiguredPermissionRequirement,
  ToolPermissionSettings,
} from "../../permissions/types/permissions.ts"
import { runtimeProxyResourceOptions } from "./mcpRuntimeProxy.ts"
import {
  ensureMcpSourceExchangeAccess,
  type ZmsRequest,
} from "./mcpManagedAccess.ts"

const ANNOTATION_ACCESS_MANAGEMENT = "mcp.idthw.dev/access-management"
const ANNOTATION_ACCESS_AUDIENCE = "mcp.idthw.dev/access-audience"
const ANNOTATION_ACCESS_SCOPE = "mcp.idthw.dev/access-scope"
const ANNOTATION_ALIAS = "mcp.idthw.dev/alias"
const ANNOTATION_CREATION_METHOD = "mcp.idthw.dev/creation-method"
const ANNOTATION_DESCRIPTION = "mcp.idthw.dev/description"
const ANNOTATION_ICON = "mcp.idthw.dev/icon"
const ANNOTATION_IAM_SERVICE_ACCOUNT = "mcp.idthw.dev/iam-service-account"
const ANNOTATION_ID = "mcp.idthw.dev/id"
const ANNOTATION_PATH = "mcp.idthw.dev/path"
const ANNOTATION_TEMPLATE_KEY = "mcp.idthw.dev/template-key"
const ANNOTATION_TOOL_PERMISSIONS = "mcp.idthw.dev/tool-permissions"
const ANNOTATION_VISIBILITY = "mcp.idthw.dev/visibility"
const LABEL_PART_OF = "app.kubernetes.io/part-of"
const LABEL_PROJECT = "mcp.idthw.dev/project"

type KubernetesDeployment = {
  metadata?: {
    name?: string
    namespace?: string
    labels?: Record<string, string>
    annotations?: Record<string, string>
  }
  spec?: {
    template?: {
      spec?: {
        containers?: KubernetesContainer[]
      }
    }
  }
}

type KubernetesContainer = {
  name?: string
  image?: string
  command?: unknown
  args?: unknown
  ports?: Array<{ containerPort?: unknown }>
  env?: KubernetesEnvironmentVariable[]
}

type KubernetesEnvironmentVariable = {
  name?: string
  value?: unknown
  valueFrom?: {
    secretKeyRef?: {
      name?: string
      key?: string
    }
  }
}

export class McpResourceNotFoundError extends Error {}

export type McpServerConfiguration = McpKubernetesManifestInput

export async function getMcpServerConfiguration(
  project: string,
  mcpKeyName: string,
  runKubectl: KubectlRunner = runKubectlCommand,
): Promise<McpServerConfiguration> {
  const deployment = await readMcpDeployment(project, mcpKeyName, runKubectl)
  return configurationFromDeployment(deployment, project, mcpKeyName)
}

export function configurationFromDeployment(
  deployment: KubernetesDeployment,
  project: string,
  mcpKeyName: string,
): McpServerConfiguration {
  const metadata = deployment.metadata ?? {}
  const labels = metadata.labels ?? {}
  const annotations = metadata.annotations ?? {}
  if (
    metadata.name !== mcpKeyName
    || metadata.namespace !== project
    || labels[LABEL_PART_OF] !== "mcp-hub"
    || labels[LABEL_PROJECT] !== project
    || (annotations[ANNOTATION_ID] ?? mcpKeyName) !== mcpKeyName
  ) {
    throw new McpResourceNotFoundError("MCP server not found")
  }

  const containers = deployment.spec?.template?.spec?.containers ?? []
  const container = containers.find(({ name }) => name === mcpKeyName)
  if (!container?.image) throw new Error("MCP server deployment has no managed container")

  const command = stringArray(container.command, "command")
  if (command.length > 1) throw new Error("MCP server container command is not editable by the Hub")
  const args = stringArray(container.args, "arguments")
  const port = container.ports?.[0]?.containerPort
  if (!Number.isInteger(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error("MCP server deployment has no valid container port")
  }

  const environmentVariables = (container.env ?? []).map(environmentVariableFromDeployment)
  const accessManagement = annotations[ANNOTATION_ACCESS_MANAGEMENT] === "server"
    ? "server"
    : containers.some(({ name }) => name === "mcp-runtime-proxy") ? "hub" : "server"
  const creationMethod = annotations[ANNOTATION_CREATION_METHOD] === "template" ? "template" : "direct"
  const visibility = annotations[ANNOTATION_VISIBILITY] === "project" ? "project" : "personal"

  return {
    accessManagement,
    arguments: args,
    command: command[0] ?? "",
    creationMethod,
    description: annotations[ANNOTATION_DESCRIPTION] ?? "",
    environmentVariables,
    iconId: normalizeMcpIconId(annotations[ANNOTATION_ICON]),
    image: container.image,
    mcpKeyName,
    path: annotations[ANNOTATION_PATH] ?? "/mcp",
    port: String(port),
    project,
    serverName: annotations[ANNOTATION_ALIAS] ?? mcpKeyName,
    serviceAccount: annotations[ANNOTATION_IAM_SERVICE_ACCOUNT] ?? "",
    templateKey: creationMethod === "template" ? annotations[ANNOTATION_TEMPLATE_KEY] ?? "" : "",
    visibility,
  }
}

function environmentVariableFromDeployment(variable: KubernetesEnvironmentVariable): McpEnvironmentVariable {
  if (!variable.name) throw new Error("MCP server deployment has an invalid environment variable")
  if (typeof variable.value === "string") {
    return { key: variable.name, value: variable.value, secret: false }
  }
  const secretKeyRef = variable.valueFrom?.secretKeyRef
  if (secretKeyRef?.name && secretKeyRef.key) {
    return { key: variable.name, value: "", secret: true, preserveExistingSecret: true }
  }
  throw new Error(`Environment variable ${variable.name} uses an unsupported value source`)
}

export async function updateMcpResources(
  input: McpKubernetesManifestInput,
  runKubectl: KubectlRunner = runKubectlCommand,
) {
  const currentDeployment = await readMcpDeployment(input.project, input.mcpKeyName, runKubectl)
  const existing = configurationFromDeployment(currentDeployment, input.project, input.mcpKeyName)
  assertImmutableSettings(input, existing)
  const update = buildMcpResourceUpdate(input, currentDeployment)
  const patchDirectory = await mkdtemp(join(tmpdir(), "idthw-mcp-server-patch-"))

  try {
    const deploymentPatchPath = join(patchDirectory, "deployment-patch.json")
    const servicePatchPath = join(patchDirectory, "service-patch.json")
    await Promise.all([
      writeFile(deploymentPatchPath, JSON.stringify(update.deploymentPatch), { encoding: "utf8", mode: 0o600 }),
      writeFile(servicePatchPath, JSON.stringify(update.servicePatch), { encoding: "utf8", mode: 0o600 }),
    ])

    const deploymentPatchArgs = [
      "patch",
      `deployment/${input.mcpKeyName}`,
      "--namespace",
      input.project,
      "--type=merge",
      "--patch-file",
      deploymentPatchPath,
    ]
    const servicePatchArgs = [
      "patch",
      `service/${input.mcpKeyName}`,
      "--namespace",
      input.project,
      "--type=merge",
      "--patch-file",
      servicePatchPath,
    ]

    let secretOperation: { dryRunArgs: string[]; applyArgs: string[] } | null = null
    if (Object.keys(update.newSecretValues).length > 0) {
      secretOperation = await prepareSecretOperation(input, update.newSecretValues, patchDirectory, runKubectl)
    }

    if (secretOperation) await runKubectl(kubectlArgs(secretOperation.dryRunArgs))
    await runKubectl(kubectlArgs([...deploymentPatchArgs, "--dry-run=server"]))
    await runKubectl(kubectlArgs([...servicePatchArgs, "--dry-run=server"]))

    if (secretOperation) await runKubectl(kubectlArgs(secretOperation.applyArgs))
    await runKubectl(kubectlArgs(deploymentPatchArgs))
    await runKubectl(kubectlArgs(servicePatchArgs))
  } finally {
    await rm(patchDirectory, { recursive: true, force: true })
  }
}

export async function updateMcpToolPermissions(
  project: string,
  mcpKeyName: string,
  toolName: string,
  requirements: ConfiguredPermissionRequirement[],
  runKubectl: KubectlRunner = runKubectlCommand,
  configuredZmsRequest?: ZmsRequest,
) {
  const deployment = await readMcpDeployment(project, mcpKeyName, runKubectl)
  const configuration = configurationFromDeployment(deployment, project, mcpKeyName)
  const helperRequirements = requirements.filter(({ includeExchangeHelpers }) => includeExchangeHelpers)
  const serviceAccount = configuration.serviceAccount
  if (helperRequirements.length > 0 && (!serviceAccount || configuration.accessManagement !== "hub")) {
    throw new Error("Exchange helpers require a Hub-managed IAM service account")
  }
  for (const requirement of helperRequirements) {
    if (!serviceAccount) throw new Error("Exchange helpers require a Hub-managed IAM service account")
    if (requirement.exchangeHelperRequirements) continue
    exchangeHelperRequirements(
      [requirement],
      serviceAccount,
      process.env.MCP_HUB_GATEWAY_PRINCIPAL ?? "mcp-hub.mcp-gateway",
    )
  }
  const directAudienceRequirements = requirements.filter(({ member }) => member === "<signed_in_user>")
  if (directAudienceRequirements.length > 0 && serviceAccount && configuration.accessManagement === "hub") {
    await ensureMcpSourceExchangeAccess(
      project,
      serviceAccount,
      directAudienceRequirements.map(({ role }) => parseAthenzRole(role).domain),
      configuredZmsRequest,
    )
  }
  const current = storedToolPermissionSettings(deployment.metadata?.annotations?.[ANNOTATION_TOOL_PERMISSIONS])
  const settings = parseToolPermissionSettings({
    version: 1,
    tools: {
      ...current?.tools,
      [toolName]: {
        requirements,
      },
    },
  })
  const serialized = JSON.stringify(settings)
  if (Buffer.byteLength(serialized) > 128 * 1024) {
    throw new Error("Tool permission settings exceed the Kubernetes annotation size limit")
  }

  const patchDirectory = await mkdtemp(join(tmpdir(), "idthw-mcp-permissions-patch-"))
  try {
    const patchPath = join(patchDirectory, "deployment-patch.json")
    await writeFile(patchPath, JSON.stringify({
      metadata: {
        annotations: { [ANNOTATION_TOOL_PERMISSIONS]: serialized },
      },
    }), { encoding: "utf8", mode: 0o600 })
    const args = [
      "patch",
      `deployment/${mcpKeyName}`,
      "--namespace",
      project,
      "--type=merge",
      "--patch-file",
      patchPath,
    ]
    await runKubectl(kubectlArgs([...args, "--dry-run=server"]))
    await runKubectl(kubectlArgs(args))
  } finally {
    await rm(patchDirectory, { recursive: true, force: true })
  }

  return settings
}

export async function deleteMcpResources(
  project: string,
  mcpKeyName: string,
  runKubectl: KubectlRunner = runKubectlCommand,
) {
  const deployment = await readMcpDeployment(project, mcpKeyName, runKubectl)
  configurationFromDeployment(deployment, project, mcpKeyName)
  const deleteArgs = [
    "delete",
    `deployment/${mcpKeyName}`,
    `service/${mcpKeyName}`,
    `secret/${mcpKeyName}-env`,
  ]
  if (
    deployment.metadata?.annotations?.[MCP_MANAGED_IDENTITY_ANNOTATION]
    === `${mcpKeyName}-athenz-identity`
  ) {
    deleteArgs.push(
      `secret/${mcpKeyName}-athenz-bootstrap`,
      `secret/${mcpKeyName}-athenz-identity`,
      `serviceaccount/${mcpKeyName}-runtime-proxy`,
      `role/${mcpKeyName}-runtime-proxy-identity`,
      `rolebinding/${mcpKeyName}-runtime-proxy-identity`,
    )
  }
  deleteArgs.push("--namespace", project, "--ignore-not-found", "--wait=true")
  await runKubectl(kubectlArgs([...deleteArgs, "--dry-run=server"]))
  await runKubectl(kubectlArgs(deleteArgs))
}

export function buildMcpResourceUpdate(
  input: McpKubernetesManifestInput,
  currentDeployment: KubernetesDeployment,
) {
  const resources = buildMcpKubernetesResources(input, {
    ...runtimeProxyResourceOptions(),
    managedServiceIdentity: Boolean(
      currentDeployment.metadata?.annotations?.[MCP_MANAGED_IDENTITY_ANNOTATION],
    ),
    managedServiceKeyId: managedServiceKeyIdFromDeployment(currentDeployment),
  })
  const desiredDeployment = resources.find(({ kind }) => kind === "Deployment") as Record<string, unknown> | undefined
  const desiredService = resources.find(({ kind }) => kind === "Service") as Record<string, unknown> | undefined
  if (!desiredDeployment || !desiredService) throw new Error("Unable to build MCP server update")

  const desiredMetadata = desiredDeployment.metadata as { labels: Record<string, string>; annotations: Record<string, string> }
  const desiredSpec = desiredDeployment.spec as {
    template: {
      metadata: { labels: Record<string, string> }
      spec: {
        automountServiceAccountToken?: boolean
        containers: KubernetesContainer[]
        securityContext?: unknown
        serviceAccountName?: string
        volumes?: unknown[]
      }
    }
  }
  const desiredMainContainer = desiredSpec.template.spec.containers.find(({ name }) => name === input.mcpKeyName)
  const currentMainContainer = currentDeployment.spec?.template?.spec?.containers?.find(({ name }) => name === input.mcpKeyName)
  if (!desiredMainContainer || !currentMainContainer) throw new Error("MCP server deployment has no managed container")

  const existingSecretReferences = new Map(
    (currentMainContainer.env ?? [])
      .filter(({ name, valueFrom }) => name && valueFrom?.secretKeyRef?.name && valueFrom.secretKeyRef.key)
      .map((variable) => [variable.name as string, variable.valueFrom as NonNullable<KubernetesEnvironmentVariable["valueFrom"]>]),
  )
  desiredMainContainer.env = input.environmentVariables
    .filter(({ key, value, preserveExistingSecret }) => key && (value || preserveExistingSecret))
    .map((configured) => {
      if (configured.preserveExistingSecret) {
        const existingReference = existingSecretReferences.get(configured.key)
        if (!existingReference?.secretKeyRef) {
          throw new Error(`Environment variable ${configured.key} has no existing secret value`)
        }
        return { name: configured.key, valueFrom: existingReference }
      }
      if (configured.secret) {
        return {
          name: configured.key,
          valueFrom: { secretKeyRef: { name: `${input.mcpKeyName}-env`, key: configured.key } },
        }
      }
      return { name: configured.key, value: configured.value }
    })

  const optionalAnnotations = [
    ANNOTATION_ACCESS_AUDIENCE,
    ANNOTATION_ACCESS_SCOPE,
    ANNOTATION_DESCRIPTION,
    ANNOTATION_ICON,
    ANNOTATION_IAM_SERVICE_ACCOUNT,
    ANNOTATION_TEMPLATE_KEY,
    MCP_MANAGED_IDENTITY_ANNOTATION,
  ]
  const annotations: Record<string, string | null> = { ...desiredMetadata.annotations }
  for (const annotation of optionalAnnotations) {
    if (!(annotation in annotations)) annotations[annotation] = null
  }

  return {
    deploymentPatch: {
      metadata: { labels: desiredMetadata.labels, annotations },
      spec: {
        template: {
          metadata: {
            labels: desiredSpec.template.metadata.labels,
            annotations: { "mcp.idthw.dev/updated-at": new Date().toISOString() },
          },
          spec: {
            automountServiceAccountToken: desiredSpec.template.spec.automountServiceAccountToken ?? null,
            containers: desiredSpec.template.spec.containers,
            securityContext: desiredSpec.template.spec.securityContext ?? null,
            serviceAccountName: desiredSpec.template.spec.serviceAccountName ?? null,
            volumes: desiredSpec.template.spec.volumes ?? null,
          },
        },
      },
    },
    servicePatch: {
      metadata: desiredService.metadata,
      spec: desiredService.spec,
    },
    newSecretValues: Object.fromEntries(
      input.environmentVariables
        .filter(({ secret, value }) => secret && value)
        .map(({ key, value }) => [key, value]),
    ),
  }
}

function managedServiceKeyIdFromDeployment(deployment: KubernetesDeployment) {
  if (!deployment.metadata?.annotations?.[MCP_MANAGED_IDENTITY_ANNOTATION]) return undefined
  const runtimeProxy = deployment.spec?.template?.spec?.containers?.find(({ name }) => name === "mcp-runtime-proxy")
  const keyId = runtimeProxy?.env?.find(({ name }) => name === "ATHENZ_SERVICE_KEY_ID")?.value
  if (keyId === undefined) return "idthw-hub-generated"
  if (typeof keyId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(keyId)) {
    throw new Error("MCP Runtime Proxy has an invalid Athenz service key ID")
  }
  return keyId
}

async function prepareSecretOperation(
  input: McpKubernetesManifestInput,
  stringData: Record<string, string>,
  patchDirectory: string,
  runKubectl: KubectlRunner,
) {
  const secretName = `${input.mcpKeyName}-env`
  const result = await runKubectl(kubectlArgs([
    "get",
    `secret/${secretName}`,
    "--namespace",
    input.project,
    "--ignore-not-found",
    "-o",
    "name",
  ]))
  const secretPath = join(patchDirectory, "secret.json")
  if (result.stdout.trim()) {
    await writeFile(secretPath, JSON.stringify({ stringData }), { encoding: "utf8", mode: 0o600 })
    const args = [
      "patch",
      `secret/${secretName}`,
      "--namespace",
      input.project,
      "--type=merge",
      "--patch-file",
      secretPath,
    ]
    return { dryRunArgs: [...args, "--dry-run=server"], applyArgs: args }
  }

  await writeFile(secretPath, JSON.stringify({
    apiVersion: "v1",
    kind: "Secret",
    metadata: { name: secretName, namespace: input.project },
    type: "Opaque",
    stringData,
  }), { encoding: "utf8", mode: 0o600 })
  return {
    dryRunArgs: ["create", "--dry-run=server", "-f", secretPath],
    applyArgs: ["create", "-f", secretPath],
  }
}

async function readMcpDeployment(project: string, mcpKeyName: string, runKubectl: KubectlRunner) {
  const result = await runKubectl(kubectlArgs([
    "get",
    `deployment/${mcpKeyName}`,
    "--namespace",
    project,
    "--ignore-not-found",
    "-o",
    "json",
  ]))
  if (!result.stdout.trim()) throw new McpResourceNotFoundError("MCP server not found")

  try {
    return JSON.parse(result.stdout) as KubernetesDeployment
  } catch {
    throw new Error("MCP server deployment data is invalid")
  }
}

function storedToolPermissionSettings(value: string | undefined): ToolPermissionSettings | undefined {
  if (!value) return undefined
  try {
    return parseToolPermissionSettings(JSON.parse(value) as unknown)
  } catch (error) {
    throw new Error(
      `Stored MCP tool permissions are invalid: ${error instanceof Error ? error.message : "invalid JSON"}`,
    )
  }
}

function assertImmutableSettings(input: McpKubernetesManifestInput, existing: McpKubernetesManifestInput) {
  if (
    input.project !== existing.project
    || input.mcpKeyName !== existing.mcpKeyName
    || input.creationMethod !== existing.creationMethod
    || input.visibility !== existing.visibility
    || input.templateKey !== existing.templateKey
  ) {
    throw new Error("MCP server identity and creation settings cannot be changed")
  }
}

function stringArray(value: unknown, field: string) {
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`MCP server container ${field} is invalid`)
  }
  return value
}
