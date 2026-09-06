import { readFile } from "node:fs/promises"
import https from "node:https"
import path from "node:path"
import { managedMcpAccessDomain } from "../lib/kubernetesManifest.ts"

const ACCESSOR_ROLE = "accessor"
const DEFAULT_GATEWAY_PRINCIPAL = "mcp-hub.mcp-gateway"
const DEFAULT_SIGNED_IN_USER_DOMAIN = "human"
const DEFAULT_ZMS_URL = "https://localhost:4443/zms/v1"
const EXCHANGER_ROLE = "accessor-jag-exchanger"
const EXCHANGE_POLICY = "accessor-jag-exchanger_zts_jag_exchange_role_accessor"
const SOURCE_EXCHANGER_ROLE = "accessor-source-exchanger"
const SOURCE_EXCHANGE_POLICY = "accessor-source-exchanger_zts_token_source_exchange"
const MAX_RESPONSE_BYTES = 256 * 1024
const PRINCIPAL_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/

export type ZmsRequest = (
  method: "GET" | "PUT",
  requestPath: string,
  body?: unknown,
) => Promise<{ body: string; status: number }>

export type McpManagedAccessReport = {
  accessorMemberAdded: boolean
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

export async function ensureMcpManagedAccess(
  project: string,
  username: string,
  serviceAccount: string,
  configuredRequest?: ZmsRequest,
): Promise<McpManagedAccessReport> {
  if (!/^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/.test(project)) {
    throw new Error("Managed MCP project is invalid")
  }

  const domain = managedMcpAccessDomain(project)
  const serviceName = serviceNameInDomain(serviceAccount, domain)
  const userDomain = process.env.MCP_HUB_PERMISSION_SIGNED_IN_USER_DOMAIN ?? DEFAULT_SIGNED_IN_USER_DOMAIN
  const userPrincipal = `${userDomain}.${username}`
  const gatewayPrincipal = process.env.MCP_HUB_GATEWAY_PRINCIPAL ?? DEFAULT_GATEWAY_PRINCIPAL
  for (const principal of [userPrincipal, gatewayPrincipal]) {
    if (!PRINCIPAL_PATTERN.test(principal)) throw new Error("Managed MCP Athenz principal is invalid")
  }

  const requestZms = configuredRequest ?? await createZmsRequest()
  await requireDomain(requestZms, domain)
  await requireService(requestZms, domain, serviceName, serviceAccount)
  const roleCreated = await ensureRole(requestZms, domain, ACCESSOR_ROLE)
  const accessorMemberAdded = await ensureRoleMember(requestZms, domain, ACCESSOR_ROLE, userPrincipal)
  const exchangerRoleCreated = await ensureRole(requestZms, domain, EXCHANGER_ROLE)
  const exchangerMemberAdded = await ensureRoleMember(requestZms, domain, EXCHANGER_ROLE, gatewayPrincipal)
  const exchangePolicyCreated = await ensureExchangePolicy(requestZms, domain)
  const sourceExchangerRoleCreated = await ensureRole(requestZms, domain, SOURCE_EXCHANGER_ROLE)
  const sourceExchangerMemberAdded = await ensureRoleMember(
    requestZms,
    domain,
    SOURCE_EXCHANGER_ROLE,
    serviceAccount,
  )

  return {
    accessorMemberAdded,
    exchangePolicyCreated,
    exchangerMemberAdded,
    exchangerRoleCreated,
    roleCreated,
    sourceExchangerMemberAdded,
    sourceExchangerRoleCreated,
  }
}

export async function ensureMcpSourceExchangeAccess(
  project: string,
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
  const serviceName = serviceNameInDomain(serviceAccount, domain)
  const requestZms = configuredRequest ?? await createZmsRequest()
  await requireDomain(requestZms, domain)
  await requireService(requestZms, domain, serviceName, serviceAccount)
  const sourceExchangerRoleCreated = await ensureRole(requestZms, domain, SOURCE_EXCHANGER_ROLE)
  const sourceExchangerMemberAdded = await ensureRoleMember(
    requestZms,
    domain,
    SOURCE_EXCHANGER_ROLE,
    serviceAccount,
  )
  const policyUpdated = await ensureSourceExchangePolicy(requestZms, domain, audiences)
  return { policyUpdated, sourceExchangerMemberAdded, sourceExchangerRoleCreated }
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

async function ensureExchangePolicy(requestZms: ZmsRequest, domain: string) {
  const policyPath = `/domain/${encodeURIComponent(domain)}/policy/${encodeURIComponent(EXCHANGE_POLICY)}`
  const role = `${domain}:role.${EXCHANGER_ROLE}`
  const resource = `${domain}:role.${ACCESSOR_ROLE}`
  const existing = await requestZms("GET", policyPath)
  if (existing.status === 200) {
    if (!policyContains(existing.body, role, resource, "zts.jag_exchange")) {
      throw new Error("Managed MCP exchange policy exists without the required assertion")
    }
    return false
  }
  if (existing.status !== 404) throw unexpectedStatus("checking managed MCP exchange policy", existing.status)

  const created = await requestZms("PUT", policyPath, {
    name: `${domain}:policy.${EXCHANGE_POLICY}`,
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
  targetDomains: string[],
) {
  const policyPath = `/domain/${encodeURIComponent(domain)}/policy/${encodeURIComponent(SOURCE_EXCHANGE_POLICY)}`
  const role = `${domain}:role.${SOURCE_EXCHANGER_ROLE}`
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
    name: `${domain}:policy.${SOURCE_EXCHANGE_POLICY}`,
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
