import path from "node:path"
import {
  kubectlArgs,
  runKubectlCommand,
  type KubectlRunner,
} from "../../kubernetes/api/kubectl.ts"
import {
  MCP_RUNTIME_PROXY_CA_CONFIG_MAP,
  type McpKubernetesResourceOptions,
} from "../lib/kubernetesManifest.ts"

const IMAGE_PULL_POLICIES = new Set(["Always", "IfNotPresent", "Never"])
const PROJECT_PATTERN = /^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/

export async function ensureMcpRuntimeProxyTrust(
  project: string,
  runKubectl: KubectlRunner = runKubectlCommand,
) {
  if (!PROJECT_PATTERN.test(project)) throw new Error("Managed MCP project is invalid")
  const caPath = process.env.MCP_HUB_ATHENZ_CA_PATH
    ?? path.join(process.env.MCP_HUB_CERT_DIR ?? path.join(process.cwd(), "certs"), "ca.crt")
  const rendered = await runKubectl(kubectlArgs([
    "create",
    "configmap",
    MCP_RUNTIME_PROXY_CA_CONFIG_MAP,
    "--namespace",
    project,
    `--from-file=ca.crt=${caPath}`,
    "--dry-run=client",
    "--output=yaml",
  ]))
  if (!rendered.stdout.trim()) throw new Error("Unable to render the MCP Runtime Proxy trust bundle")
  await runKubectl(kubectlArgs(["apply", "-f", "-"]), rendered.stdout)
}

export function runtimeProxyResourceOptions(): McpKubernetesResourceOptions {
  const image = process.env.MCP_HUB_RUNTIME_PROXY_IMAGE?.trim()
  const configuredPullPolicy = process.env.MCP_HUB_RUNTIME_PROXY_IMAGE_PULL_POLICY?.trim()
  if (configuredPullPolicy && !IMAGE_PULL_POLICIES.has(configuredPullPolicy)) {
    throw new Error("MCP Hub Runtime Proxy image pull policy is invalid")
  }
  return {
    runtimeProxyImage: image || undefined,
    runtimeProxyImagePullPolicy: configuredPullPolicy as McpKubernetesResourceOptions["runtimeProxyImagePullPolicy"],
  }
}
