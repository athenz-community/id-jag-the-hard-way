"use client"

import { Pencil } from "lucide-react"
import Link from "next/link"
import { athenzServiceName } from "@/features/registration/lib/athenzServices"
import { buildMcpKubernetesManifest } from "@/features/registration/lib/kubernetesManifest"
import { useMcpCreateDraft } from "../McpCreateDraftContext"

function valueOrFallback(value: string) {
  return value || "Not provided"
}

export function ConfirmSummary({
  project,
  cancelHref,
  sourceHref,
  configurationHref,
}: {
  project: string
  cancelHref: string
  sourceHref: string
  configurationHref: string
}) {
  const { draft, resetDraft } = useMcpCreateDraft()
  const hasEnvironmentVariable = Boolean(draft.environmentKey || draft.environmentValue)
  const kubernetesManifest = buildMcpKubernetesManifest({
    project,
    accessManagement: draft.accessManagement,
    argument: draft.argument,
    command: draft.command,
    environmentKey: draft.environmentKey,
    environmentSecret: draft.environmentSecret,
    environmentValue: draft.environmentValue,
    image: draft.image,
    mcpKeyName: draft.mcpKeyName,
    path: draft.path,
    port: draft.port,
    serverName: draft.serverName,
    serviceAccount: draft.hubServiceAccountName,
  })

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
            <dt>Environment variable</dt>
            <dd>
              {hasEnvironmentVariable ? (
                <table className="mcp-confirm-env-table">
                  <thead><tr><th>Key</th><th>Value</th><th>Secret</th></tr></thead>
                  <tbody>
                    <tr>
                      <td>{valueOrFallback(draft.environmentKey)}</td>
                      <td>{draft.environmentSecret ? "••••••••" : valueOrFallback(draft.environmentValue)}</td>
                      <td>{draft.environmentSecret ? "Yes" : "No"}</td>
                    </tr>
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
          Preview of the Namespace, Deployment, and Service the Hub will apply when Create is enabled. Secret values are redacted.
        </p>
        <pre className="mcp-confirm-manifest"><code>{kubernetesManifest}</code></pre>
      </section>

      <div className="mcp-create-actions">
        <Link className="button" href={cancelHref} style={{ textDecoration: "none" }} onClick={resetDraft}>Cancel</Link>
        <Link className="button" href={configurationHref} style={{ textDecoration: "none" }}>Prev</Link>
        <button className="button" type="button" disabled>Create</button>
      </div>
    </div>
  )
}
