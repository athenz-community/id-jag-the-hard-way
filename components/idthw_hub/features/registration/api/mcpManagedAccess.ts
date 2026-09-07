import { readFile } from "node:fs/promises"
import https from "node:https"
import path from "node:path"
import {
  managedMcpAccessDomain,
  managedMcpAccessRole,
} from "../lib/kubernetesManifest.ts"

const DEFAULT_GATEWAY_PRINCIPAL = "mcp-hub.mcp-gateway"
const DEFAULT_SIGNED_IN_USER_DOMAIN = "human"
const DEFAULT_ZMS_URL = "https://localhost:4443/zms/v1"
const MAX_RESPONSE_BYTES = 256 * 1024
const PRINCIPAL_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/

export type ZmsRequest = (
  method: "DELETE" | "GET" | "PUT",
  requestPath: string,
  body?: unknown,
) => Promise<{ body: string; status: number }>

export type McpManagedAccessReport = {
  exchangePolicyCreated: boolean
  exchangerMemberAdded: boolean
  exchangerRoleCreated: boolean
  roleCreated: boolean
  sourceExchangerMemberAdded: boolean
  sourceExchangerRoleCreated: boolean
}

export type McpSourceExchangeReport = {
  policyUpdated: boolean
  sourceExchangerMemberAdded: boolean
  sourceExchangerRoleCreated: boolean
}

export type McpManagedAccessDeletionReport = {
  policiesDeleted: string[]
  rolesDeleted: string[]
}

export async function ensureMcpManagedAccess(
  project: string,
  mcpKeyName: string,
  serviceAccount: string,
  configuredRequest?: ZmsRequest,
): Promise<McpManagedAccessReport> {
  if (!/^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/.test(project)) {
    throw new Error("Managed MCP project is invalid")
  }

  const domain = managedMcpAccessDomain(project)
  const names = managedAccessNames(mcpKeyName)
  const serviceName = serviceNameInDomain(serviceAccount, domain)
  const gatewayPrincipal = process.env.MCP_HUB_GATEWAY_PRINCIPAL ?? DEFAULT_GATEWAY_PRINCIPAL
  if (!PRINCIPAL_PATTERN.test(gatewayPrincipal)) throw new Error("Managed MCP Athenz principal is invalid")

  const requestZms = configuredRequest ?? await createZmsRequest()
  await requireDomain(requestZms, domain)
  await requireService(requestZms, domain, serviceName, serviceAccount)
  const roleCreated = await ensureRole(requestZms, domain, names.accessorRole)
  const exchangerRoleCreated = await ensureRole(requestZms, domain, names.exchangerRole)
  const exchangerMemberAdded = await ensureRoleMember(
    requestZms,
    domain,
    names.exchangerRole,
    gatewayPrincipal,
  )
  const exchangePolicyCreated = await ensureExchangePolicy(requestZms, domain, names)
  const sourceExchangerRoleCreated = await ensureRole(requestZms, domain, names.sourceExchangerRole)
  const sourceExchangerMemberAdded = await ensureRoleMember(
    requestZms,
    domain,
    names.sourceExchangerRole,
    serviceAccount,
  )

  return {
    exchangePolicyCreated,
    exchangerMemberAdded,
    exchangerRoleCreated,
    roleCreated,
    sourceExchangerMemberAdded,
    sourceExchangerRoleCreated,
  }
}

export async function ensureMcpManagedAccessorMember(
  project: string,
  mcpKeyName: string,
  username: string,
  configuredRequest?: ZmsRequest,
) {
  if (!/^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/.test(project)) {
    throw new Error("Managed MCP project is invalid")
  }

  const userDomain = process.env.MCP_HUB_PERMISSION_SIGNED_IN_USER_DOMAIN ?? DEFAULT_SIGNED_IN_USER_DOMAIN
  const userPrincipal = `${userDomain}.${username}`
  if (!PRINCIPAL_PATTERN.test(userPrincipal)) throw new Error("Managed MCP Athenz principal is invalid")

  const domain = managedMcpAccessDomain(project)
  const names = managedAccessNames(mcpKeyName)
  const requestZms = configuredRequest ?? await createZmsRequest()
  await requireDomain(requestZms, domain)
  await ensureRole(requestZms, domain, names.accessorRole)
  return ensureRoleMember(requestZms, domain, names.accessorRole, userPrincipal)
}

export async function ensureMcpSourceExchangeAccess(
  project: string,
  mcpKeyName: string,
  serviceAccount: string,
  targetDomains: string[],
  configuredRequest?: ZmsRequest,
): Promise<McpSourceExchangeReport> {
  if (!/^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/.test(project)) {
    throw new Error("Managed MCP project is invalid")
  }
  const audiences = [...new Set(targetDomains.map((domain) => domain.trim()).filter(Boolean))].sort()
  if (audiences.length === 0) throw new Error("Managed MCP source exchange requires an audience domain")
  for (const audience of audiences) {
    if (!PRINCIPAL_PATTERN.test(audience)) {
      throw new Error(`Managed MCP source-exchange audience ${JSON.stringify(audience)} is invalid`)
    }
  }

  const domain = managedMcpAccessDomain(project)
  const names = managedAccessNames(mcpKeyName)
  const serviceName = serviceNameInDomain(serviceAccount, domain)
  const requestZms = configuredRequest ?? await createZmsRequest()
  await requireDomain(requestZms, domain)
  await requireService(requestZms, domain, serviceName, serviceAccount)
  const sourceExchangerRoleCreated = await ensureRole(requestZms, domain, names.sourceExchangerRole)
  const sourceExchangerMemberAdded = await ensureRoleMember(
    requestZms,
    domain,
    names.sourceExchangerRole,
    serviceAccount,
  )
  const policyUpdated = await ensureSourceExchangePolicy(requestZms, domain, names, audiences)
  return { policyUpdated, sourceExchangerMemberAdded, sourceExchangerRoleCreated }
}

export async function deleteMcpManagedAccess(
  project: string,
  mcpKeyName: string,
  configuredRequest?: ZmsRequest,
): Promise<McpManagedAccessDeletionReport> {
  if (!/^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/.test(project)) {
    throw new Error("Managed MCP project is invalid")
  }

  const domain = managedMcpAccessDomain(project)
  const names = managedAccessNames(mcpKeyName)
  const requestZms = configuredRequest ?? await createZmsRequest()
  const domainResponse = await requestZms("GET", `/domain/${encodeURIComponent(domain)}`)
  if (domainResponse.status === 404) return { policiesDeleted: [], rolesDeleted: [] }
  if (domainResponse.status !== 200) {
    throw unexpectedStatus("checking the managed MCP domain before access cleanup", domainResponse.status)
  }

  const policiesDeleted: string[] = []
  for (const policy of [names.exchangePolicy, names.sourceExchangePolicy]) {
    if (await deleteZmsEntity(requestZms, domain, "policy", policy)) policiesDeleted.push(policy)
  }

  const rolesDeleted: string[] = []
  for (const role of [names.exchangerRole, names.sourceExchangerRole, names.accessorRole]) {
    if (await deleteZmsEntity(requestZms, domain, "role", role)) rolesDeleted.push(role)
  }
  return { policiesDeleted, rolesDeleted }
}

async function requireDomain(requestZms: ZmsRequest, domain: string) {
  const response = await requestZms("GET", `/domain/${encodeURIComponent(domain)}`)
  if (response.status === 200) return
  if (response.status === 404) throw new Error(`Athenz domain ${domain} does not exist`)
  throw unexpectedStatus("checking the managed MCP domain", response.status)
}

async function requireService(
  requestZms: ZmsRequest,
  domain: string,
  serviceName: string,
  serviceAccount: string,
) {
  const response = await requestZms(
    "GET",
    `/domain/${encodeURIComponent(domain)}/service/${encodeURIComponent(serviceName)}`,
  )
  if (response.status === 200) return
  if (response.status === 404) throw new Error(`Athenz service account ${serviceAccount} does not exist`)
  throw unexpectedStatus("checking the managed MCP service account", response.status)
}

async function ensureRole(requestZms: ZmsRequest, domain: string, role: string) {
  const rolePath = `/domain/${encodeURIComponent(domain)}/role/${encodeURIComponent(role)}`
  const existing = await requestZms("GET", rolePath)
  if (existing.status === 200) return false
  if (existing.status !== 404) throw unexpectedStatus(`checking managed MCP ${role} role`, existing.status)

  const created = await requestZms("PUT", rolePath, { name: `${domain}:role.${role}` })
  if (!isSuccess(created.status) && created.status !== 409) {
    throw unexpectedStatus(`creating managed MCP ${role} role`, created.status)
  }

  const verified = await requestZms("GET", rolePath)
  if (verified.status !== 200) throw unexpectedStatus(`verifying managed MCP ${role} role`, verified.status)
  return isSuccess(created.status)
}

async function deleteZmsEntity(
  requestZms: ZmsRequest,
  domain: string,
  kind: "policy" | "role",
  name: string,
) {
  const entityPath = `/domain/${encodeURIComponent(domain)}/${kind}/${encodeURIComponent(name)}`
  const existing = await requestZms("GET", entityPath)
  if (existing.status === 404) return false
  if (existing.status !== 200) {
    throw unexpectedStatus(`checking managed MCP ${kind} ${name} before deletion`, existing.status)
  }

  const deleted = await requestZms("DELETE", entityPath)
  if (!isSuccess(deleted.status) && deleted.status !== 404) {
    throw unexpectedStatus(`deleting managed MCP ${kind} ${name}`, deleted.status)
  }
  const verified = await requestZms("GET", entityPath)
  if (verified.status !== 404) {
    throw unexpectedStatus(`verifying managed MCP ${kind} ${name} deletion`, verified.status)
  }
  return deleted.status !== 404
}

async function ensureRoleMember(
  requestZms: ZmsRequest,
  domain: string,
  role: string,
  member: string,
) {
  const rolePath = `/domain/${encodeURIComponent(domain)}/role/${encodeURIComponent(role)}`
  const existing = await requestZms("GET", rolePath)
  if (existing.status !== 200) throw unexpectedStatus(`checking managed MCP ${role} membership`, existing.status)
  if (roleContains(existing.body, member)) return false

  const memberPath = `${rolePath}/member/${encodeURIComponent(member)}`
  const added = await requestZms("PUT", memberPath, { memberName: member, roleName: role })
  if (!isSuccess(added.status) && added.status !== 409) {
    throw unexpectedStatus(`adding managed MCP ${role} member`, added.status)
  }

  const verified = await requestZms("GET", rolePath)
  if (verified.status !== 200 || !roleContains(verified.body, member)) {
    throw new Error(`Unable to verify managed MCP ${role} membership`)
  }
  return isSuccess(added.status)
}

async function ensureExchangePolicy(
  requestZms: ZmsRequest,
  domain: string,
  names: ManagedAccessNames,
) {
  const policyPath = `/domain/${encodeURIComponent(domain)}/policy/${encodeURIComponent(names.exchangePolicy)}`
  const role = `${domain}:role.${names.exchangerRole}`
  const resource = `${domain}:role.${names.accessorRole}`
  const existing = await requestZms("GET", policyPath)
  if (existing.status === 200) {
    const assertions = policyAssertions(existing.body, "managed MCP exchange policy")
    if (assertions.some((current) => sameAssertion(current, {
      action: "zts.jag_exchange",
      resource,
      role,
    }))) return false

    const updated = await requestZms("PUT", policyPath, {
      name: `${domain}:policy.${names.exchangePolicy}`,
      assertions: [...assertions, { role, resource, action: "zts.jag_exchange" }],
    })
    if (!isSuccess(updated.status) && updated.status !== 409) {
      throw unexpectedStatus("repairing managed MCP exchange policy", updated.status)
    }
    const verified = await requestZms("GET", policyPath)
    if (
      verified.status !== 200
      || !policyContains(verified.body, role, resource, "zts.jag_exchange")
    ) {
      throw new Error("Unable to verify repaired managed MCP exchange policy")
    }
    return isSuccess(updated.status)
  }
  if (existing.status !== 404) throw unexpectedStatus("checking managed MCP exchange policy", existing.status)

  const created = await requestZms("PUT", policyPath, {
    name: `${domain}:policy.${names.exchangePolicy}`,
    assertions: [{ role, resource, action: "zts.jag_exchange" }],
  })
  if (!isSuccess(created.status) && created.status !== 409) {
    throw unexpectedStatus("creating managed MCP exchange policy", created.status)
  }

  const verified = await requestZms("GET", policyPath)
  if (
    verified.status !== 200
    || !policyContains(verified.body, role, resource, "zts.jag_exchange")
  ) {
    throw new Error("Unable to verify managed MCP exchange policy")
  }
  return isSuccess(created.status)
}

async function ensureSourceExchangePolicy(
  requestZms: ZmsRequest,
  domain: string,
  names: ManagedAccessNames,
  targetDomains: string[],
) {
  const policyPath = `/domain/${encodeURIComponent(domain)}/policy/${encodeURIComponent(names.sourceExchangePolicy)}`
  const role = `${domain}:role.${names.sourceExchangerRole}`
  const desired = targetDomains.map((targetDomain) => ({
    action: "zts.token_source_exchange",
    resource: `${domain}:${targetDomain}`,
    role,
  }))
  const existing = await requestZms("GET", policyPath)
  let assertions: Array<{ action: string; resource: string; role: string }> = []
  if (existing.status === 200) {
    assertions = policyAssertions(existing.body, "managed MCP source-exchange policy")
    if (desired.every((assertion) => assertions.some((current) => sameAssertion(current, assertion)))) {
      return false
    }
  } else if (existing.status !== 404) {
    throw unexpectedStatus("checking managed MCP source-exchange policy", existing.status)
  }

  for (const assertion of desired) {
    if (!assertions.some((current) => sameAssertion(current, assertion))) assertions.push(assertion)
  }
  const updated = await requestZms("PUT", policyPath, {
    name: `${domain}:policy.${names.sourceExchangePolicy}`,
    assertions,
  })
  if (!isSuccess(updated.status) && updated.status !== 409) {
    throw unexpectedStatus("updating managed MCP source-exchange policy", updated.status)
  }

  const verified = await requestZms("GET", policyPath)
  if (verified.status !== 200) {
    throw unexpectedStatus("verifying managed MCP source-exchange policy", verified.status)
  }
  const verifiedAssertions = policyAssertions(verified.body, "managed MCP source-exchange policy")
  if (!desired.every((assertion) => verifiedAssertions.some((current) => sameAssertion(current, assertion)))) {
    throw new Error("Unable to verify managed MCP source-exchange policy")
  }
  return isSuccess(updated.status)
}

type ManagedAccessNames = {
  accessorRole: string
  exchangePolicy: string
  exchangerRole: string
  sourceExchangePolicy: string
  sourceExchangerRole: string
}

function managedAccessNames(mcpKeyName: string): ManagedAccessNames {
  const accessorRole = managedMcpAccessRole(mcpKeyName)
  const exchangerRole = `${accessorRole}-jag-exchanger`
  const sourceExchangerRole = `${accessorRole}-source-exchanger`
  return {
    accessorRole,
    exchangePolicy: `${exchangerRole}_zts_jag_exchange_role_${accessorRole}`,
    exchangerRole,
    sourceExchangePolicy: `${sourceExchangerRole}_zts_token_source_exchange`,
    sourceExchangerRole,
  }
}

function policyAssertions(body: string, resource: string) {
  const payload = parseRecord(body, resource)
  if (!Array.isArray(payload.assertions)) throw new Error(`ZMS returned an invalid ${resource}`)
  return payload.assertions.map((value) => {
    if (!isRecord(value)
      || typeof value.action !== "string"
      || typeof value.resource !== "string"
      || typeof value.role !== "string") {
      throw new Error(`ZMS returned an invalid ${resource}`)
    }
    return { action: value.action, resource: value.resource, role: value.role }
  })
}

function sameAssertion(
  left: { action: string; resource: string; role: string },
  right: { action: string; resource: string; role: string },
) {
  return left.action === right.action && left.resource === right.resource && left.role === right.role
}

function roleContains(body: string, member: string) {
  const payload = parseRecord(body, "managed MCP role")
  const roleMembers = Array.isArray(payload.roleMembers) ? payload.roleMembers : []
  const members = Array.isArray(payload.members) ? payload.members : []
  return roleMembers.some((value) => (
    isRecord(value) && value.memberName === member
  )) || members.includes(member)
}

function policyContains(body: string, role: string, resource: string, action: string) {
  const payload = parseRecord(body, "managed MCP policy")
  const assertions = Array.isArray(payload.assertions) ? payload.assertions : []
  return assertions.some((value) => isRecord(value)
    && value.role === role
    && value.resource === resource
    && value.action === action)
}

export async function createZmsRequest(): Promise<ZmsRequest> {
  const zmsUrl = new URL((process.env.MCP_HUB_ZMS_URL ?? DEFAULT_ZMS_URL).replace(/\/+$/, ""))
  if (zmsUrl.protocol !== "https:") throw new Error(`Unsupported ZMS protocol ${zmsUrl.protocol}`)

  const [cert, key, ca] = await Promise.all([
    readFile(/* turbopackIgnore: true */ certFilePath("MCP_HUB_ATHENZ_CERT_PATH", "mcp-hub-ui.crt")),
    readFile(/* turbopackIgnore: true */ certFilePath("MCP_HUB_ATHENZ_KEY_PATH", "mcp-hub-ui.key")),
    readFile(/* turbopackIgnore: true */ certFilePath("MCP_HUB_ATHENZ_CA_PATH", "ca.crt")),
  ])
  const servername = process.env.MCP_HUB_ZMS_TLS_SERVER_NAME

  return (method, requestPath, requestBody) => new Promise((resolve, reject) => {
    const endpoint = new URL(`${zmsUrl.toString().replace(/\/$/, "")}${requestPath}`)
    const encodedBody = requestBody === undefined ? undefined : JSON.stringify(requestBody)
    const headers: Record<string, string | number> = {
      Accept: "application/json",
      "Y-Audit-Ref": "MCP Hub managed access provisioning",
    }
    if (encodedBody !== undefined) {
      headers["Content-Type"] = "application/json"
      headers["Content-Length"] = Buffer.byteLength(encodedBody)
    }
    if (servername) headers.Host = endpoint.port ? `${servername}:${endpoint.port}` : servername

    const request = https.request(endpoint, {
      method,
      ca,
      cert,
      key,
      rejectUnauthorized: process.env.MCP_HUB_ZMS_REJECT_UNAUTHORIZED === "true",
      servername,
      headers,
      timeout: 5000,
    }, (response) => {
      let body = ""
      let responseBytes = 0
      response.setEncoding("utf8")
      response.on("data", (chunk: string) => {
        responseBytes += Buffer.byteLength(chunk)
        if (responseBytes > MAX_RESPONSE_BYTES) {
          response.destroy(new Error("ZMS managed access response exceeded the size limit"))
          return
        }
        body += chunk
      })
      response.on("end", () => resolve({ body, status: response.statusCode ?? 0 }))
      response.on("error", reject)
    })
    request.on("timeout", () => request.destroy(new Error("Timed out while configuring managed MCP access")))
    request.on("error", reject)
    request.end(encodedBody)
  })
}

export function serviceNameInDomain(serviceAccount: string, domain: string) {
  const prefix = `${domain}.`
  const serviceName = serviceAccount.startsWith(prefix) ? serviceAccount.slice(prefix.length) : ""
  if (!serviceName || !PRINCIPAL_PATTERN.test(serviceName)) {
    throw new Error(`Athenz service account must belong to ${domain}`)
  }
  return serviceName
}

function certFilePath(envName: string, fileName: string) {
  const configuredPath = process.env[envName]
  if (configuredPath) return configuredPath
  const configuredDir = process.env.MCP_HUB_CERT_DIR
  if (configuredDir) return path.join(/* turbopackIgnore: true */ configuredDir, fileName)
  return path.join(process.cwd(), "certs", fileName)
}

function parseRecord(body: string, resource: string) {
  try {
    const value = JSON.parse(body) as unknown
    if (isRecord(value)) return value
  } catch {
    // Use the stable error below without including the ZMS response body.
  }
  throw new Error(`ZMS returned an invalid ${resource}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function isSuccess(status: number) {
  return status >= 200 && status < 300
}

function unexpectedStatus(operation: string, status: number) {
  return new Error(`ZMS returned HTTP ${status || "unknown"} while ${operation}`)
}
