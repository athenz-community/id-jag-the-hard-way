import "server-only"

import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import https from "node:https"
import path from "node:path"
import { promisify } from "node:util"
import { parse } from "yaml"
import {
  mergeToolPermissionSettings,
  parseAthenzRole,
  parseToolPermissionSettings,
  permissionPresetFromToolSettings,
  toolPermissionSettingsForServer,
  withManagedAccessRequirements,
  withExpectedExchangePolicies,
} from "@/features/permissions/lib/permissionPreset"
import {
  parseZmsPolicy,
  parseZmsPolicyList,
  policyAssertionKey,
} from "@/features/permissions/lib/zmsPolicy"
import type {
  PermissionCheckStatus,
  PermissionReadiness,
  PermissionReadinessGroup,
} from "@/features/permissions/types/permissions"

const execFileAsync = promisify(execFile)
const DEFAULT_ATHENZ_UI_URL = "http://localhost:3000"
const DEFAULT_CONFIG_MAP_KEY = "permission-presets.yaml"
const DEFAULT_CONFIG_MAP_NAME = "mcp-hub-permission-presets"
const DEFAULT_CONFIG_MAP_NAMESPACE = "mcp-hub"
const DEFAULT_SIGNED_IN_USER_DOMAIN = "human"
const DEFAULT_ZMS_URL = "https://localhost:4443/zms/v1"
const MAX_RESPONSE_BYTES = 1024 * 1024

type KubernetesConfigMap = {
  data?: Record<string, string>
}

type ZmsCredentials = {
  ca: Buffer
  cert: Buffer
  key: Buffer
  rejectUnauthorized: boolean
  servername?: string
}

export async function fetchPermissionReadiness(
  serverId: string,
  username: string,
  routeAccessScope?: string,
  routeAccessAudience?: string,
  toolPermissionOverrides?: unknown,
  servicePrincipal?: string,
): Promise<PermissionReadiness | null> {
  let preset
  try {
    const configuredPreset = await readPermissionPresetConfigMap()
    const signedInPrincipal = signedInAthenzPrincipal(username)
    const configuredSettings = toolPermissionSettingsForServer(configuredPreset, serverId)
    const overrideSettings = toolPermissionOverrides === undefined
      ? undefined
      : parseToolPermissionSettings(toolPermissionOverrides)
    const settings = mergeToolPermissionSettings(configuredSettings, overrideSettings)
    preset = settings
      ? permissionPresetFromToolSettings(settings, serverId, signedInPrincipal, {
        gatewayPrincipal: process.env.MCP_HUB_GATEWAY_PRINCIPAL ?? "mcp-hub.mcp-gateway",
        servicePrincipal,
      })
      : undefined
    preset = withManagedAccessRequirements(
      preset,
      serverId,
      routeAccessScope,
      signedInPrincipal,
      process.env.MCP_HUB_GATEWAY_PRINCIPAL ?? "mcp-hub.mcp-gateway",
      servicePrincipal,
    )
    preset = withExpectedExchangePolicies(preset, routeAccessAudience)
  } catch (error) {
    return {
      status: "configuration-error",
      message: error instanceof Error ? error.message : "Permission preset could not be loaded",
    }
  }

  if (!preset) return null

  const zmsUrl = (process.env.MCP_HUB_ZMS_URL ?? DEFAULT_ZMS_URL).replace(/\/+$/, "")
  const athenzUiUrl = (process.env.MCP_HUB_ATHENZ_UI_URL ?? DEFAULT_ATHENZ_UI_URL).replace(/\/+$/, "")
  let tls: ZmsCredentials
  try {
    tls = await loadZmsCredentials()
  } catch {
    return {
      groups: preset.groups.map((group) => ({
        ...group,
        policies: (group.policies ?? []).map((policy) => ({
          ...policy,
          roleUrl: rolePoliciesUrl(athenzUiUrl, policy.role),
          status: "unavailable",
        })),
        requirements: group.requirements.map((requirement) => ({
          ...requirement,
          roleUrl: roleMembersUrl(athenzUiUrl, requirement.role),
          status: "unavailable",
        })),
      })),
      status: "unavailable",
    }
  }

  const roleLookups = new Map<string, Promise<Set<string>>>()
  const policyLookups = new Map<string, Promise<Set<string>>>()
  for (const group of preset.groups) {
    for (const requirement of group.requirements) {
      if (!roleLookups.has(requirement.member)) {
        roleLookups.set(requirement.member, fetchPrincipalRoles(zmsUrl, requirement.member, tls))
      }
    }
    for (const policy of group.policies ?? []) {
      const domain = parseAthenzRole(policy.role).domain
      if (!policyLookups.has(domain)) {
        policyLookups.set(domain, fetchDomainPolicyAssertions(zmsUrl, domain, tls))
      }
    }
  }

  const groups: PermissionReadinessGroup[] = await Promise.all(preset.groups.map(async (group) => {
    const requirements = await Promise.all(group.requirements.map(async (requirement) => {
      let status: PermissionCheckStatus
      try {
        const roles = await roleLookups.get(requirement.member)
        status = roles?.has(requirement.role) ? "ready" : "missing"
      } catch {
        status = "unavailable"
      }
      return {
        ...requirement,
        roleUrl: roleMembersUrl(athenzUiUrl, requirement.role),
        status,
      }
    }))
    const policies = await Promise.all((group.policies ?? []).map(async (policy) => {
      let status: PermissionCheckStatus
      try {
        const domain = parseAthenzRole(policy.role).domain
        const assertions = await policyLookups.get(domain)
        status = assertions?.has(policyAssertionKey(policy)) ? "ready" : "missing"
      } catch {
        status = "unavailable"
      }
      return {
        ...policy,
        roleUrl: rolePoliciesUrl(athenzUiUrl, policy.role),
        status,
      }
    }))
    return { ...group, policies, requirements }
  }))

  const statuses = groups.flatMap(({ policies, requirements }) => [
    ...requirements.map(({ status }) => status),
    ...policies.map(({ status }) => status),
  ])
  const status: PermissionCheckStatus = statuses.includes("unavailable")
    ? "unavailable"
    : statuses.includes("missing")
      ? "missing"
      : "ready"

  return { groups, status }
}

export async function readPermissionPresetConfigMap() {
  const namespace = process.env.MCP_HUB_PERMISSION_CONFIG_MAP_NAMESPACE ?? DEFAULT_CONFIG_MAP_NAMESPACE
  const name = process.env.MCP_HUB_PERMISSION_CONFIG_MAP_NAME ?? DEFAULT_CONFIG_MAP_NAME
  const key = process.env.MCP_HUB_PERMISSION_CONFIG_MAP_KEY ?? DEFAULT_CONFIG_MAP_KEY
  const configMap = process.env.KUBERNETES_SERVICE_HOST
    ? await readConfigMapFromInClusterApi(namespace, name)
    : await readConfigMapFromKubectl(namespace, name)
  const rawPreset = configMap.data?.[key]
  if (!rawPreset) throw new Error(`ConfigMap ${namespace}/${name} is missing data key ${key}`)

  try {
    return parse(rawPreset, { maxAliasCount: 50 }) as unknown
  } catch {
    throw new Error(`ConfigMap ${namespace}/${name} data key ${key} is not valid YAML`)
  }
}

async function readConfigMapFromKubectl(namespace: string, name: string) {
  const kubectlArgs = ["get", "configmap", name, "-n", namespace, "-o", "json"]
  const server = process.env.MCP_HUB_KUBECTL_SERVER
  const tlsServerName = process.env.MCP_HUB_KUBECTL_TLS_SERVER_NAME
  if (server) kubectlArgs.unshift("--server", server)
  if (tlsServerName) kubectlArgs.unshift("--tls-server-name", tlsServerName)

  try {
    const { stdout } = await execFileAsync("kubectl", kubectlArgs, {
      maxBuffer: MAX_RESPONSE_BYTES,
      timeout: 5000,
    })
    return JSON.parse(stdout) as KubernetesConfigMap
  } catch {
    throw new Error(`Unable to read permission ConfigMap ${namespace}/${name}`)
  }
}

async function readConfigMapFromInClusterApi(namespace: string, name: string) {
  const host = process.env.KUBERNETES_SERVICE_HOST
  if (!host) throw new Error("KUBERNETES_SERVICE_HOST is not set")
  const port = process.env.KUBERNETES_SERVICE_PORT_HTTPS ?? process.env.KUBERNETES_SERVICE_PORT ?? "443"
  const [token, ca] = await Promise.all([
    readFile("/var/run/secrets/kubernetes.io/serviceaccount/token", "utf8"),
    readFile("/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"),
  ])
  const requestPath = `/api/v1/namespaces/${encodeURIComponent(namespace)}/configmaps/${encodeURIComponent(name)}`

  return requestJson<KubernetesConfigMap>({
    ca,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    host,
    path: requestPath,
    port,
  })
}

async function fetchPrincipalRoles(zmsUrl: string, principal: string, tls: ZmsCredentials) {
  const endpoint = new URL(`${zmsUrl}/role`)
  endpoint.searchParams.set("principal", principal)
  const response = await requestZms(endpoint, tls)
  if (response.status === 404) return new Set<string>()
  if (response.status !== 200) throw new Error(`ZMS returned HTTP ${response.status}`)

  const payload = JSON.parse(response.body) as unknown
  if (!isRecord(payload) || !Array.isArray(payload.memberRoles)) {
    throw new Error("ZMS returned an invalid member role response")
  }

  const roles = new Set<string>()
  for (const membership of payload.memberRoles) {
    if (!isRecord(membership)) throw new Error("ZMS returned an invalid role membership")
    const domainName = nonEmptyString(membership.domainName)
    const roleName = nonEmptyString(membership.roleName)
    if (!roleName) throw new Error("ZMS role membership is missing roleName")

    if (roleName.includes(":role.")) {
      const parsed = parseAthenzRole(roleName)
      if (domainName && domainName !== parsed.domain) {
        throw new Error("ZMS role membership domain does not match roleName")
      }
      roles.add(roleName)
      continue
    }

    if (!domainName) throw new Error("ZMS role membership is missing domainName")
    const scopedRole = `${domainName}:role.${roleName}`
    parseAthenzRole(scopedRole)
    roles.add(scopedRole)
  }
  return roles
}

async function fetchDomainPolicyAssertions(
  zmsUrl: string,
  domain: string,
  tls: ZmsCredentials,
) {
  const listEndpoint = new URL(`${zmsUrl}/domain/${encodeURIComponent(domain)}/policy`)
  const listResponse = await requestZms(listEndpoint, tls)
  if (listResponse.status === 404) return new Set<string>()
  if (listResponse.status !== 200) throw new Error(`ZMS returned HTTP ${listResponse.status}`)

  const listed = parseZmsPolicyList(listResponse.body)
  const detailAssertions = await Promise.all(listed.names.map(async (listedName) => {
    const policyName = simplePolicyName(domain, listedName)
    const endpoint = new URL(
      `${zmsUrl}/domain/${encodeURIComponent(domain)}/policy/${encodeURIComponent(policyName)}`,
    )
    const response = await requestZms(endpoint, tls)
    if (response.status === 404) return []
    if (response.status !== 200) throw new Error(`ZMS returned HTTP ${response.status}`)
    return parseZmsPolicy(response.body)
  }))

  return new Set(
    [...listed.assertions, ...detailAssertions.flat()].map(policyAssertionKey),
  )
}

function simplePolicyName(domain: string, name: string) {
  const prefix = `${domain}:policy.`
  return name.startsWith(prefix) ? name.slice(prefix.length) : name
}

async function loadZmsCredentials(): Promise<ZmsCredentials> {
  const [cert, key, ca] = await Promise.all([
    readFile(/* turbopackIgnore: true */ certFilePath("MCP_HUB_ATHENZ_CERT_PATH", "mcp-hub-ui.crt")),
    readFile(/* turbopackIgnore: true */ certFilePath("MCP_HUB_ATHENZ_KEY_PATH", "mcp-hub-ui.key")),
    readFile(/* turbopackIgnore: true */ certFilePath("MCP_HUB_ATHENZ_CA_PATH", "ca.crt")),
  ])
  return {
    cert,
    key,
    ca,
    rejectUnauthorized: process.env.MCP_HUB_ZMS_REJECT_UNAUTHORIZED === "true",
    servername: process.env.MCP_HUB_ZMS_TLS_SERVER_NAME,
  }
}

function requestZms(endpoint: URL, tls: ZmsCredentials): Promise<{ body: string; status: number }> {
  if (endpoint.protocol !== "https:") {
    return Promise.reject(new Error(`Unsupported ZMS protocol ${endpoint.protocol}`))
  }

  const headers: Record<string, string> = { Accept: "application/json" }
  if (tls.servername) {
    headers.Host = endpoint.port ? `${tls.servername}:${endpoint.port}` : tls.servername
  }

  return new Promise((resolve, reject) => {
    const request = https.request(endpoint, {
      method: "GET",
      ...tls,
      headers,
      timeout: 3000,
    }, (response) => {
      let body = ""
      let responseBytes = 0
      response.setEncoding("utf8")
      response.on("data", (chunk: string) => {
        responseBytes += Buffer.byteLength(chunk)
        if (responseBytes > MAX_RESPONSE_BYTES) {
          response.destroy(new Error("ZMS member role response exceeded the size limit"))
          return
        }
        body += chunk
      })
      response.on("end", () => resolve({ body, status: response.statusCode ?? 0 }))
      response.on("error", reject)
    })

    request.on("timeout", () => request.destroy(new Error("Timed out while listing Athenz roles")))
    request.on("error", reject)
    request.end()
  })
}

function requestJson<T>({
  ca,
  headers,
  host,
  path: requestPath,
  port,
}: {
  ca: Buffer
  headers: Record<string, string>
  host: string
  path: string
  port: string
}): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = https.request({ ca, headers, host, method: "GET", path: requestPath, port }, (response) => {
      let body = ""
      let responseBytes = 0
      response.setEncoding("utf8")
      response.on("data", (chunk: string) => {
        responseBytes += Buffer.byteLength(chunk)
        if (responseBytes > MAX_RESPONSE_BYTES) {
          response.destroy(new Error("Kubernetes ConfigMap response exceeded the size limit"))
          return
        }
        body += chunk
      })
      response.on("end", () => {
        if (!response.statusCode || response.statusCode >= 400) {
          reject(new Error(`Kubernetes API returned HTTP ${response.statusCode ?? "unknown"}`))
          return
        }
        try {
          resolve(JSON.parse(body) as T)
        } catch (error) {
          reject(error)
        }
      })
      response.on("error", reject)
    })
    request.on("error", reject)
    request.end()
  })
}

function roleMembersUrl(athenzUiUrl: string, role: string) {
  const parsed = parseAthenzRole(role)
  return `${athenzUiUrl}/domain/${encodeURIComponent(parsed.domain)}/role/${encodeURIComponent(parsed.role)}/members`
}

function rolePoliciesUrl(athenzUiUrl: string, role: string) {
  const parsed = parseAthenzRole(role)
  return `${athenzUiUrl}/domain/${encodeURIComponent(parsed.domain)}/role/${encodeURIComponent(parsed.role)}/policy`
}

function signedInAthenzPrincipal(username: string) {
  const domain = process.env.MCP_HUB_PERMISSION_SIGNED_IN_USER_DOMAIN ?? DEFAULT_SIGNED_IN_USER_DOMAIN
  return `${domain}.${username}`
}

function certFilePath(envName: string, fileName: string) {
  const configuredPath = process.env[envName]
  if (configuredPath) return configuredPath
  const configuredDir = process.env.MCP_HUB_CERT_DIR
  if (configuredDir) return path.join(/* turbopackIgnore: true */ configuredDir, fileName)
  return path.join(process.cwd(), "certs", fileName)
}

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}
