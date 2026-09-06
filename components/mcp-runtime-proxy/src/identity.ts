import { execFile } from "node:child_process"
import { createPrivateKey, createPublicKey, X509Certificate } from "node:crypto"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import https from "node:https"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { runtimeProxyLogger, type RuntimeProxyLogger } from "./logger.ts"

const execFileAsync = promisify(execFile)
const DEFAULT_REFRESH_SECONDS = 24 * 60 * 60
const DEFAULT_RETRY_SECONDS = 5 * 60
const DEFAULT_ZTS_URL = "https://athenz-zts-server.athenz:4443/zts/v1"
const KUBERNETES_SERVICE_ACCOUNT_DIR = "/var/run/secrets/kubernetes.io/serviceaccount"
const SERVICE_CERTIFICATE_FILE = "service.cert.pem"
const SERVICE_PRIVATE_KEY_FILE = "service.key.pem"

export type ServiceIdentityConfig = {
  bootstrapPrivateKeyPath: string
  dnsDomain: string
  instanceId: string
  keyId: string
  kubernetesApiHost: string
  kubernetesApiPort: number
  namespace: string
  projectedCertificatePath: string
  refreshSeconds: number
  retrySeconds: number
  secretName: string
  serviceDomain: string
  serviceName: string
  ztsCaPath: string
  ztsUrl: URL
}

type RefreshDependencies = {
  issueCertificate?: typeof issueServiceCertificate
  patchSecret?: typeof patchKubernetesIdentitySecret
  waitForProjection?: typeof waitForCertificateProjection
}

export function serviceIdentityConfigFromEnvironment(
  environment: Record<string, string | undefined> = process.env,
): ServiceIdentityConfig | undefined {
  const serviceDomain = environment.ATHENZ_SERVICE_DOMAIN?.trim()
  const serviceName = environment.ATHENZ_SERVICE_NAME?.trim()
  if (!serviceDomain && !serviceName) return undefined
  if (!serviceDomain || !serviceName) {
    throw new Error("ATHENZ_SERVICE_DOMAIN and ATHENZ_SERVICE_NAME must be configured together")
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(serviceDomain)) {
    throw new Error("ATHENZ_SERVICE_DOMAIN is invalid")
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(serviceName)) {
    throw new Error("ATHENZ_SERVICE_NAME is invalid")
  }

  const ztsUrl = new URL(environment.ATHENZ_ZTS_URL ?? DEFAULT_ZTS_URL)
  if (ztsUrl.protocol !== "https:") throw new Error("ATHENZ_ZTS_URL must use HTTPS")
  const secretName = requiredEnvironment(environment, "KUBERNETES_IDENTITY_SECRET_NAME")
  if (!/^[a-z0-9](?:[-a-z0-9.]*[a-z0-9])?$/.test(secretName) || secretName.length > 253) {
    throw new Error("KUBERNETES_IDENTITY_SECRET_NAME is invalid")
  }

  return {
    bootstrapPrivateKeyPath: environment.ATHENZ_BOOTSTRAP_PRIVATE_KEY_PATH
      ?? `/var/run/athenz-bootstrap/${SERVICE_PRIVATE_KEY_FILE}`,
    dnsDomain: environment.ATHENZ_ZTS_DNS_DOMAIN ?? "zts.athenz.cloud",
    instanceId: requiredEnvironment(environment, "POD_NAME"),
    keyId: environment.ATHENZ_SERVICE_KEY_ID ?? "idthw-hub-generated",
    kubernetesApiHost: requiredEnvironment(environment, "KUBERNETES_SERVICE_HOST"),
    kubernetesApiPort: positiveInteger(
      environment.KUBERNETES_SERVICE_PORT_HTTPS
      ?? environment.KUBERNETES_SERVICE_PORT
      ?? "443",
      "Kubernetes API port",
    ),
    namespace: requiredEnvironment(environment, "POD_NAMESPACE"),
    projectedCertificatePath: environment.ATHENZ_PUBLISHED_CERT_PATH
      ?? `/var/run/athenz-identity/${SERVICE_CERTIFICATE_FILE}`,
    refreshSeconds: positiveInteger(
      environment.ATHENZ_IDENTITY_REFRESH_SECONDS ?? String(DEFAULT_REFRESH_SECONDS),
      "ATHENZ_IDENTITY_REFRESH_SECONDS",
    ),
    retrySeconds: positiveInteger(
      environment.ATHENZ_IDENTITY_RETRY_SECONDS ?? String(DEFAULT_RETRY_SECONDS),
      "ATHENZ_IDENTITY_RETRY_SECONDS",
    ),
    secretName,
    serviceDomain,
    serviceName,
    ztsCaPath: environment.ATHENZ_ZTS_CA_PATH ?? "/var/run/athenz/ca.crt",
    ztsUrl,
  }
}

export async function startServiceIdentityManager(
  config: ServiceIdentityConfig,
  logger: RuntimeProxyLogger = runtimeProxyLogger,
  dependencies: RefreshDependencies = {},
) {
  await refreshServiceIdentity(config, dependencies)
  logger.info("service_identity_ready", {
    keyId: config.keyId,
    refreshSeconds: config.refreshSeconds,
    servicePrincipal: `${config.serviceDomain}.${config.serviceName}`,
  })

  let stopped = false
  let timer: NodeJS.Timeout | undefined
  const schedule = (seconds: number) => {
    timer = setTimeout(async () => {
      try {
        await refreshServiceIdentity(config, dependencies)
        logger.info("service_identity_refreshed", {
          keyId: config.keyId,
          nextRefreshSeconds: config.refreshSeconds,
          servicePrincipal: `${config.serviceDomain}.${config.serviceName}`,
        })
        if (!stopped) schedule(config.refreshSeconds)
      } catch (error) {
        logger.error("service_identity_refresh_failed", {
          message: error instanceof Error ? error.message : "certificate refresh failed",
          retrySeconds: config.retrySeconds,
          servicePrincipal: `${config.serviceDomain}.${config.serviceName}`,
        })
        if (!stopped) schedule(config.retrySeconds)
      }
    }, seconds * 1000)
  }
  schedule(config.refreshSeconds)

  return {
    stop() {
      stopped = true
      if (timer) clearTimeout(timer)
    },
  }
}

export async function refreshServiceIdentity(
  config: ServiceIdentityConfig,
  dependencies: RefreshDependencies = {},
) {
  const certificateDirectory = await mkdtemp(join(tmpdir(), "mcp-runtime-identity-"))
  const certificatePath = join(certificateDirectory, SERVICE_CERTIFICATE_FILE)
  try {
    await (dependencies.issueCertificate ?? issueServiceCertificate)(config, certificatePath)
    const [certificate, privateKey] = await Promise.all([
      readFile(certificatePath, "utf8"),
      readFile(config.bootstrapPrivateKeyPath, "utf8"),
    ])
    assertCertificateMatchesPrivateKey(certificate, privateKey)
    await (dependencies.patchSecret ?? patchKubernetesIdentitySecret)(config, certificate, privateKey)
    await (dependencies.waitForProjection ?? waitForCertificateProjection)(config, certificate)
  } finally {
    await rm(certificateDirectory, { force: true, recursive: true })
  }
}

export function serviceCertificateCommandArguments(
  config: ServiceIdentityConfig,
  certificatePath: string,
) {
  return [
    "-zts", config.ztsUrl.toString().replace(/\/$/, ""),
    "-domain", config.serviceDomain,
    "-service", config.serviceName,
    "-provider", "sys.auth.zts",
    "-instance", config.instanceId,
    "-dns-domain", config.dnsDomain,
    "-private-key", config.bootstrapPrivateKeyPath,
    "-key-version", config.keyId,
    "-cert-file", certificatePath,
    "-cacert", config.ztsCaPath,
  ]
}

export function identitySecretPatch(certificate: string, privateKey: string) {
  return {
    data: {
      [SERVICE_CERTIFICATE_FILE]: Buffer.from(certificate, "utf8").toString("base64"),
      [SERVICE_PRIVATE_KEY_FILE]: Buffer.from(privateKey, "utf8").toString("base64"),
    },
  }
}

async function issueServiceCertificate(config: ServiceIdentityConfig, certificatePath: string) {
  try {
    await execFileAsync(
      "zts-svccert",
      serviceCertificateCommandArguments(config, certificatePath),
      { maxBuffer: 64 * 1024, timeout: 60_000 },
    )
  } catch {
    throw new Error("ZTS service certificate issuance failed")
  }
}

async function patchKubernetesIdentitySecret(
  config: ServiceIdentityConfig,
  certificate: string,
  privateKey: string,
) {
  const [token, ca] = await Promise.all([
    readFile(join(KUBERNETES_SERVICE_ACCOUNT_DIR, "token"), "utf8"),
    readFile(join(KUBERNETES_SERVICE_ACCOUNT_DIR, "ca.crt")),
  ])
  const body = JSON.stringify(identitySecretPatch(certificate, privateKey))
  const requestPath = [
    "/api/v1/namespaces",
    encodeURIComponent(config.namespace),
    "secrets",
    encodeURIComponent(config.secretName),
  ].join("/")

  await new Promise<void>((resolve, reject) => {
    const request = https.request({
      ca,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token.trim()}`,
        "Content-Length": Buffer.byteLength(body),
        "Content-Type": "application/merge-patch+json",
      },
      host: config.kubernetesApiHost,
      method: "PATCH",
      path: requestPath,
      port: config.kubernetesApiPort,
      rejectUnauthorized: true,
      timeout: 10_000,
    }, (response) => {
      let responseBytes = 0
      response.on("data", (chunk: Buffer) => {
        responseBytes += chunk.length
        if (responseBytes > 64 * 1024) response.destroy(new Error("Kubernetes API response exceeded the limit"))
      })
      response.on("end", () => {
        const status = response.statusCode ?? 0
        if (status >= 200 && status < 300) resolve()
        else reject(new Error(`Kubernetes API returned HTTP ${status || "unknown"} while publishing the service identity`))
      })
      response.on("error", reject)
    })
    request.on("error", reject)
    request.on("timeout", () => request.destroy(new Error("Timed out while publishing the service identity")))
    request.end(body)
  })
}

async function waitForCertificateProjection(config: ServiceIdentityConfig, expectedCertificate: string) {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    try {
      if (await readFile(config.projectedCertificatePath, "utf8") === expectedCertificate) return
    } catch {
      // The projected Secret may not be visible immediately after the API update.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  throw new Error("Timed out waiting for the refreshed service identity projection")
}

function assertCertificateMatchesPrivateKey(certificate: string, privateKey: string) {
  try {
    const parsedCertificate = new X509Certificate(certificate)
    if (Date.parse(parsedCertificate.validTo) <= Date.now()) {
      throw new Error("issued certificate is already expired")
    }
    const certificatePublicKey = parsedCertificate.publicKey.export({
      format: "der",
      type: "spki",
    })
    const privateKeyPublicKey = createPublicKey(createPrivateKey(privateKey)).export({
      format: "der",
      type: "spki",
    })
    if (!certificatePublicKey.equals(privateKeyPublicKey)) {
      throw new Error("issued certificate does not match the generated private key")
    }
  } catch (error) {
    throw new Error(
      error instanceof Error && [
        "issued certificate does not match the generated private key",
        "issued certificate is already expired",
      ].includes(error.message)
        ? error.message
        : "ZTS returned an invalid service certificate",
    )
  }
}

function positiveInteger(value: string, field: string) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${field} must be a positive integer`)
  return parsed
}

function requiredEnvironment(environment: Record<string, string | undefined>, name: string) {
  const value = environment[name]?.trim()
  if (!value) throw new Error(`${name} is required for managed service identity`)
  return value
}
