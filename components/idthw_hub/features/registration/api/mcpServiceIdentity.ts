import { generateKeyPairSync } from "node:crypto"
import {
  createZmsRequest,
  serviceNameInDomain,
  type ZmsRequest,
} from "./mcpManagedAccess.ts"
import { managedMcpAccessDomain } from "../lib/kubernetesManifest.ts"
import { mcpServiceKeyId } from "../lib/mcpServiceKeyId.ts"

const CERTIFICATE_PROVIDER_POLICY = "zts_instance_launch_provider"
const CERTIFICATE_PROVIDER_ROLE = "zts_instance_launch_provider"
const CERTIFICATE_PROVIDER_SERVICE = "sys.auth.zts"
const PUBLIC_KEY_PATTERN = /^[A-Za-z0-9._-]+$/

export type GeneratedMcpServiceIdentity = {
  privateKeyPem: string
  publicKeyYBase64: string
}

export function generateMcpServiceIdentity(): GeneratedMcpServiceIdentity {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
    publicKeyEncoding: { format: "pem", type: "spki" },
  })
  return {
    privateKeyPem: privateKey,
    publicKeyYBase64: Buffer.from(publicKey, "utf8")
      .toString("base64")
      .replaceAll("+", ".")
      .replaceAll("/", "_")
      .replaceAll("=", "-"),
  }
}

export async function registerMcpServicePublicKey(
  project: string,
  serviceAccount: string,
  mcpKeyName: string,
  publicKeyYBase64: string,
  configuredRequest?: ZmsRequest,
) {
  if (!PUBLIC_KEY_PATTERN.test(publicKeyYBase64)) {
    throw new Error("Generated MCP service public key is invalid")
  }

  const domain = managedMcpAccessDomain(project)
  const serviceName = serviceNameInDomain(serviceAccount, domain)
  const keyId = mcpServiceKeyId(mcpKeyName)
  const keyPath = [
    "/domain",
    encodeURIComponent(domain),
    "service",
    encodeURIComponent(serviceName),
    "publickey",
    encodeURIComponent(keyId),
  ].join("/")
  const requestZms = configuredRequest ?? await createZmsRequest()
  const current = await requestZms("GET", keyPath)
  if (current.status === 200 && publicKeyMatches(current.body, keyId, publicKeyYBase64)) return false
  if (current.status !== 200 && current.status !== 404) {
    throw new Error(`ZMS returned HTTP ${current.status || "unknown"} while checking the generated MCP service key`)
  }

  const updated = await requestZms("PUT", keyPath, {
    id: keyId,
    key: publicKeyYBase64,
  })
  if (updated.status < 200 || updated.status >= 300) {
    throw new Error(`ZMS returned HTTP ${updated.status || "unknown"} while registering the generated MCP service key`)
  }

  const verified = await requestZms("GET", keyPath)
  if (verified.status !== 200 || !publicKeyMatches(verified.body, keyId, publicKeyYBase64)) {
    throw new Error("Unable to verify the generated MCP service key")
  }
  return true
}

export async function ensureMcpServiceCertificateProvider(
  project: string,
  serviceAccount: string,
  configuredRequest?: ZmsRequest,
) {
  const domain = managedMcpAccessDomain(project)
  const serviceName = serviceNameInDomain(serviceAccount, domain)
  const requestZms = configuredRequest ?? await createZmsRequest()
  if (await certificateProviderIsReady(requestZms, domain, serviceName)) return false

  const response = await requestZms("PUT", `/domain/${encodeURIComponent(domain)}/template`, {
    params: [{ name: "service", value: serviceName }],
    templateNames: ["zts_instance_launch_provider"],
  })
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`ZMS returned HTTP ${response.status || "unknown"} while enabling MCP service certificate issuance`)
  }
  if (!await certificateProviderIsReady(requestZms, domain, serviceName)) {
    throw new Error("Unable to verify MCP service certificate issuance")
  }
  return true
}

function publicKeyMatches(body: string, expectedKeyId: string, expectedKey: string) {
  try {
    const value = JSON.parse(body) as unknown
    return Boolean(
      value
      && typeof value === "object"
      && !Array.isArray(value)
      && (value as Record<string, unknown>).id === expectedKeyId
      && (value as Record<string, unknown>).key === expectedKey,
    )
  } catch {
    return false
  }
}

async function certificateProviderIsReady(
  requestZms: ZmsRequest,
  domain: string,
  serviceName: string,
) {
  const [role, policy] = await Promise.all([
    requestZms(
      "GET",
      `/domain/${encodeURIComponent(domain)}/role/${encodeURIComponent(CERTIFICATE_PROVIDER_ROLE)}`,
    ),
    requestZms(
      "GET",
      `/domain/${encodeURIComponent(domain)}/policy/${encodeURIComponent(CERTIFICATE_PROVIDER_POLICY)}`,
    ),
  ])
  if (role.status === 404 || policy.status === 404) return false
  if (role.status !== 200 || policy.status !== 200) {
    throw new Error("Unable to check MCP service certificate issuance")
  }

  try {
    const roleValue = JSON.parse(role.body) as unknown
    const policyValue = JSON.parse(policy.body) as unknown
    if (!isRecord(roleValue) || !isRecord(policyValue)) return false
    const roleMembers = Array.isArray(roleValue.roleMembers) ? roleValue.roleMembers : []
    const members = Array.isArray(roleValue.members) ? roleValue.members : []
    const assertions = Array.isArray(policyValue.assertions) ? policyValue.assertions : []
    const hasProvider = roleMembers.some((member) => (
      isRecord(member) && member.memberName === CERTIFICATE_PROVIDER_SERVICE
    )) || members.includes(CERTIFICATE_PROVIDER_SERVICE)
    const hasLaunchAccess = assertions.some((assertion) => (
      isRecord(assertion)
      && assertion.action === "launch"
      && assertion.resource === `${domain}:service.${serviceName}`
      && assertion.role === `${domain}:role.${CERTIFICATE_PROVIDER_ROLE}`
    ))
    return hasProvider && hasLaunchAccess
  } catch {
    return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}
