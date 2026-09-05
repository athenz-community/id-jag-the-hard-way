"use client"

import { Pencil } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { athenzServiceName } from "@/features/registration/lib/athenzServices"
import { buildMcpKubernetesManifest } from "@/features/registration/lib/kubernetesManifest"
import { useMcpCreateDraft } from "../McpCreateDraftContext"

function valueOrFallback(value: string) {
  return value || "Not provided"
}

export function ConfirmSummary({
  project,
  cancelHref,
  successHref,
  sourceHref,
  configurationHref,
}: {
  project: string
  cancelHref: string
  successHref: string
  sourceHref: string
  configurationHref: string
}) {
  const { draft, resetDraft } = useMcpCreateDraft()
  const router = useRouter()
  const [createError, setCreateError] = useState("")
  const [isCreating, setIsCreating] = useState(false)
  const configuredEnvironmentVariables = draft.environmentVariables.filter(({ key, value }) => key || value)
  const kubernetesManifest = buildMcpKubernetesManifest({
    project,
    accessManagement: draft.accessManagement,
    argument: draft.argument,
    command: draft.command,
    environmentVariables: draft.environmentVariables,
    image: draft.image,
    mcpKeyName: draft.mcpKeyName,
    path: draft.path,
    port: draft.port,
    serverName: draft.serverName,
    serviceAccount: draft.hubServiceAccountName,
  })

  async function createMcpServer() {
    setCreateError("")
    setIsCreating(true)

    try {
      const response = await fetch("/api/mcp-servers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accessManagement: draft.accessManagement,
          argument: draft.argument,
          command: draft.command,
          environmentVariables: draft.environmentVariables.map(({ key, value, secret }) => ({ key, value, secret })),
          image: draft.image,
          mcpKeyName: draft.mcpKeyName,
          path: draft.path,
          port: draft.port,
          project,
          serverName: draft.serverName,
          serviceAccount: draft.hubServiceAccountName,
        }),
      })
      const payload = await response.json() as { error?: unknown }
      if (!response.ok) {
        throw new Error(typeof payload.error === "string" ? payload.error : "Unable to create MCP server")
      }

      resetDraft()
      router.replace(successHref)
      router.refresh()
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Unable to create MCP server")
      setIsCreating(false)
    }
  }

  return (
    <div className="mcp-create-form">
      <section className="mcp-confirm-section">
        <div className="mcp-confirm-heading">
          <h2>Source</h2>
          <Link className="table-action" href={sourceHref} aria-label="Edit Source"><Pencil size={16} /></Link>
        </div>
        <dl className="mcp-confirm-list">
          <div><dt>Creation method</dt><dd>Direct setup</dd></div>
          <div><dt>Source</dt><dd>Container registry</dd></div>
          <div><dt>Container image URL</dt><dd>{valueOrFallback(draft.image)}</dd></div>
          <div><dt>Target port</dt><dd>{valueOrFallback(draft.port)}</dd></div>
          <div><dt>Protocol</dt><dd>Streamable HTTP</dd></div>
          <div>
            <dt>Additional settings</dt>
            <dd>
              <dl className="mcp-confirm-nested-list">
                <div><dt>Path</dt><dd>{valueOrFallback(draft.path)}</dd></div>
                <div><dt>Container command</dt><dd>{valueOrFallback(draft.command)}</dd></div>
                <div><dt>Container argument</dt><dd>{valueOrFallback(draft.argument)}</dd></div>
              </dl>
            </dd>
          </div>
        </dl>
      </section>

      <section className="mcp-confirm-section">
        <div className="mcp-confirm-heading">
          <h2>Configuration</h2>
          <Link className="table-action" href={configurationHref} aria-label="Edit Configuration"><Pencil size={16} /></Link>
        </div>
        <dl className="mcp-confirm-list">
          <div><dt>Name</dt><dd>{valueOrFallback(draft.serverName)}</dd></div>
          <div><dt>MCP key name</dt><dd>{valueOrFallback(draft.mcpKeyName)}</dd></div>
          <div><dt>Visibility</dt><dd>Personal</dd></div>
          <div>
            <dt>Environment variables</dt>
            <dd>
              {configuredEnvironmentVariables.length > 0 ? (
                <table className="mcp-confirm-env-table">
                  <thead><tr><th>Key</th><th>Value</th><th>Secret</th></tr></thead>
                  <tbody>
                    {configuredEnvironmentVariables.map((variable) => (
                      <tr key={variable.id}>
                        <td>{valueOrFallback(variable.key)}</td>
                        <td>{variable.secret ? "••••••••" : valueOrFallback(variable.value)}</td>
                        <td>{variable.secret ? "Yes" : "No"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : "Not configured"}
            </dd>
          </div>
          <div><dt>VPC</dt><dd>{valueOrFallback(draft.vpc)}</dd></div>
          <div><dt>VPC network</dt><dd>{valueOrFallback(draft.vpcNetwork)}</dd></div>
          <div><dt>Access management</dt><dd>{draft.accessManagement === "hub" ? "Hub-managed access" : "Server-managed access"}</dd></div>
          <div><dt>IAM service account</dt><dd>{valueOrFallback(athenzServiceName(draft.hubServiceAccountName))}</dd></div>
        </dl>
      </section>

      <section className="mcp-confirm-section">
        <div className="mcp-confirm-heading">
          <h2>Kubernetes manifest</h2>
        </div>
        <p className="mcp-confirm-manifest-copy">
          Preview of the Kubernetes resources the Hub will create. Secret values are redacted.
        </p>
        <pre className="mcp-confirm-manifest"><code>{kubernetesManifest}</code></pre>
      </section>

      {createError ? (
        <p className="mcp-create-service-warning" role="alert">{createError}</p>
      ) : null}

      <div className="mcp-create-actions">
        <Link className="button" href={cancelHref} style={{ textDecoration: "none" }} onClick={resetDraft}>Cancel</Link>
        <Link className="button" href={configurationHref} style={{ textDecoration: "none" }}>Prev</Link>
        <button
          className="button mcp-create-primary"
          type="button"
          disabled={isCreating}
          aria-busy={isCreating}
          onClick={() => void createMcpServer()}
        >
          {isCreating ? "Creating..." : "Create"}
        </button>
      </div>
    </div>
  )
}
