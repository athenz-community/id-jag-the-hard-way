import "server-only"

import { readFile } from "node:fs/promises"
import https from "node:https"
import path from "node:path"
import { athenzUserPrincipal } from "@/features/auth/lib/session"
import type {
  CostAccountableDomain,
  GenAIAdministratorRole,
  GenAIManagedRole,
} from "@/features/genai/types/access"

const ADMIN_RESPONSIBILITIES: ReadonlyArray<{
  managedRole: GenAIManagedRole
  membershipRole: string
  role: GenAIAdministratorRole
}> = [
  {
    role: "cost-accountable-admins",
    membershipRole: "cost-accountable-admins",
    managedRole: "gen-ai-users-managers",
  },
  {
    role: "cost-accountable-admins",
    membershipRole: "pm-cost-approval-officer-lv5",
    managedRole: "gen-ai-users-manager",
  },
  {
    role: "gen-ai-users-managers",
    membershipRole: "gen-ai-users-managers",
    managedRole: "gen-ai-users",
  },
  {
    role: "gen-ai-users-managers",
    membershipRole: "gen-ai-users-manager",
    managedRole: "gen-ai-users",
  },
]
const ADMIN_ROLE_NAMES = new Set<string>(
  ADMIN_RESPONSIBILITIES.map(({ membershipRole }) => membershipRole),
)
const DEFAULT_ATHENZ_UI_URL = "http://localhost:3000"
const DEFAULT_ZMS_URL = "https://localhost:4443/zms/v1"
const DEFAULT_SERVICE_DOMAIN_PREFIX = "gen-ai.services."
const MAX_RESPONSE_BYTES = 1024 * 1024

export async function fetchCostAccountableDomains(
  username: string,
): Promise<CostAccountableDomain[]> {
  const principal = athenzUserPrincipal(username)
  const zmsUrl = (process.env.MCP_HUB_ZMS_URL ?? DEFAULT_ZMS_URL).replace(/\/+$/, "")
  const athenzUiUrl = (process.env.MCP_HUB_ATHENZ_UI_URL ?? DEFAULT_ATHENZ_UI_URL).replace(/\/+$/, "")
  const endpoint = new URL(`${zmsUrl}/role`)
  endpoint.searchParams.set("principal", principal)

  try {
    const tls = await loadZmsCredentials()
    const response = await requestZms(endpoint, tls)
    if (response.status === 404) return []
    if (response.status !== 200) {
      throw new Error(`ZMS returned HTTP ${response.status}`)
    }

    const domains = costAccountableDomains(JSON.parse(response.body))
    return Promise.all(domains.map(async ({ domain, heldRoles, service }) => ({
      domain,
      service,
      responsibilities: await Promise.all(responsibilitiesFor(heldRoles)
        .map(async ({ managedRole, role }) => ({
          manageUrl: `${athenzUiUrl}/domain/${encodeURIComponent(domain)}/role/${encodeURIComponent(managedRole)}/members`,
          managedRole,
          role,
          members: await fetchRoleMembers(
            zmsUrl,
            domain,
            managedRole,
            [],
            tls,
          ),
        }))),
    })))
  } catch {
    // This panel is supplemental. Fail closed so an unavailable or malformed
    // ZMS response never presents a user as a Gen AI administrator.
    return []
  }
}

type AdminDomainIdentity = Pick<CostAccountableDomain, "domain" | "service"> & {
  heldRoles: string[]
}

export function costAccountableDomains(payload: unknown): AdminDomainIdentity[] {
  if (!isRecord(payload) || !Array.isArray(payload.memberRoles)) {
    throw new Error("ZMS returned an invalid member role response")
  }

  const domains = new Map<string, Set<string>>()
  for (const membership of payload.memberRoles) {
    const parsed = parseMembership(membership)
    if (
      !parsed
      || !isGenAIServiceDomain(parsed.domain)
      || !ADMIN_ROLE_NAMES.has(parsed.role)
    ) continue
    const heldRoles = domains.get(parsed.domain) ?? new Set<string>()
    heldRoles.add(parsed.role)
    domains.set(parsed.domain, heldRoles)
  }

  return [...domains.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([domain, heldRoles]) => ({
      domain,
      heldRoles: [...heldRoles].sort(),
      service: serviceFromDomain(domain),
    }))
}

function responsibilitiesFor(heldRoles: string[]) {
  const responsibilities = new Map<GenAIAdministratorRole, typeof ADMIN_RESPONSIBILITIES[number]>()
  for (const responsibility of ADMIN_RESPONSIBILITIES) {
    if (
      heldRoles.includes(responsibility.membershipRole)
      && !responsibilities.has(responsibility.role)
    ) {
      responsibilities.set(responsibility.role, responsibility)
    }
  }
  return [...responsibilities.values()]
}

function parseMembership(membership: unknown) {
  if (!isRecord(membership)) return undefined

  const domainName = stringValue(membership.domainName)
  const roleName = stringValue(membership.roleName)
  if (!roleName) return undefined

  const roleMarker = ":role."
  const roleMarkerIndex = roleName.indexOf(roleMarker)
  if (roleMarkerIndex < 0) {
    return domainName ? { domain: domainName, role: roleName } : undefined
  }

  const scopedDomain = roleName.slice(0, roleMarkerIndex)
  const scopedRole = roleName.slice(roleMarkerIndex + roleMarker.length)
  if (!scopedDomain || !scopedRole || (domainName && domainName !== scopedDomain)) return undefined
  return { domain: scopedDomain, role: scopedRole }
}

function serviceFromDomain(domain: string) {
  const prefix = serviceDomainPrefix()
  if (prefix && domain.startsWith(prefix) && domain.length > prefix.length) {
    return domain.slice(prefix.length)
  }

  return domain.split(".").at(-1) ?? domain
}

function isGenAIServiceDomain(domain: string) {
  const prefix = serviceDomainPrefix()
  return !prefix || (domain.startsWith(prefix) && domain.length > prefix.length)
}

function serviceDomainPrefix() {
  return process.env.MCP_HUB_GENAI_SERVICE_DOMAIN_PREFIX ?? DEFAULT_SERVICE_DOMAIN_PREFIX
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

async function loadZmsCredentials() {
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

type ZmsCredentials = Awaited<ReturnType<typeof loadZmsCredentials>>

async function fetchRoleMembers(
  zmsUrl: string,
  domain: string,
  role: string,
  fallbackMembers: string[],
  tls: ZmsCredentials,
) {
  const endpoint = new URL(
    `${zmsUrl}/domain/${encodeURIComponent(domain)}/role/${encodeURIComponent(role)}`,
  )

  try {
    const response = await requestZms(endpoint, tls)
    if (response.status !== 200) return fallbackMembers
    const payload = JSON.parse(response.body)
    if (!isRecord(payload) || !Array.isArray(payload.roleMembers)) return fallbackMembers

    const members = new Set<string>()
    for (const roleMember of payload.roleMembers) {
      if (!isRecord(roleMember)) continue
      const memberName = stringValue(roleMember.memberName)
      if (memberName) members.add(memberName)
    }
    return members.size > 0
      ? [...members].sort((left, right) => left.localeCompare(right))
      : fallbackMembers
  } catch {
    return fallbackMembers
  }
}

function requestZms(
  endpoint: URL,
  tls: ZmsCredentials,
): Promise<{ body: string; status: number }> {
  if (endpoint.protocol !== "https:") {
    return Promise.reject(new Error(`Unsupported ZMS protocol ${endpoint.protocol}`))
  }

  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      Accept: "application/json",
    }
    if (tls.servername) {
      headers.Host = endpoint.port
        ? `${tls.servername}:${endpoint.port}`
        : tls.servername
    }

    const request = https.request(
      endpoint,
      {
        method: "GET",
        ...tls,
        headers,
        timeout: 3000,
      },
      (response) => {
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
        response.on("end", () => resolve({
          body,
          status: response.statusCode ?? 0,
        }))
        response.on("error", reject)
      },
    )

    request.on("timeout", () => {
      request.destroy(new Error("Timed out while listing Athenz member roles"))
    })
    request.on("error", reject)
    request.end()
  })
}

function certFilePath(envName: string, fileName: string) {
  const configuredPath = process.env[envName]
  if (configuredPath) return configuredPath

  const configuredDir = process.env.MCP_HUB_CERT_DIR
  if (configuredDir) return path.join(/* turbopackIgnore: true */ configuredDir, fileName)

  return path.join(process.cwd(), "certs", fileName)
}
