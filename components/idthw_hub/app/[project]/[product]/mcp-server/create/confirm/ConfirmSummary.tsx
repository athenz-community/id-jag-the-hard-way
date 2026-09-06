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
  const usesTemplate = draft.creationMethod === "template"
  const selectedTemplate = draft.selectedTemplate
  const runtime = usesTemplate && selectedTemplate
    ? {
        arguments: selectedTemplate.arguments,
        command: selectedTemplate.command,
        description: selectedTemplate.description,
        image: selectedTemplate.image,
        path: selectedTemplate.path,
        port: selectedTemplate.port,
      }
    : {
        arguments: draft.containerArguments.map(({ value }) => value).filter(Boolean),
        command: draft.command,
        description: "",
        image: draft.image,
        path: draft.path,
        port: draft.port,
      }
  const environmentVariables = usesTemplate ? draft.templateEnvironmentVariables : draft.environmentVariables
  const configuredEnvironmentVariables = environmentVariables.filter(({ key, value }) => key || value)
  const kubernetesManifest = buildMcpKubernetesManifest({
    project,
    accessManagement: draft.accessManagement,
    arguments: runtime.arguments,
    command: runtime.command,
    creationMethod: draft.creationMethod,
    description: runtime.description,
    environmentVariables,
    image: runtime.image,
    mcpKeyName: draft.mcpKeyName,
    path: runtime.path,
    port: runtime.port,
    serverName: draft.serverName,
    serviceAccount: draft.hubServiceAccountName,
    templateKey: usesTemplate ? draft.selectedTemplateKey : "",
    visibility: draft.visibility,
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
          arguments: runtime.arguments,
          command: runtime.command,
          creationMethod: draft.creationMethod,
          description: runtime.description,
          environmentVariables: environmentVariables.map(({ key, value, secret }) => ({ key, value, secret })),
          image: runtime.image,
          mcpKeyName: draft.mcpKeyName,
          path: runtime.path,
          port: runtime.port,
          project,
          serverName: draft.serverName,
          serviceAccount: draft.hubServiceAccountName,
          templateKey: usesTemplate ? draft.selectedTemplateKey : "",
          visibility: draft.visibility,
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
          <div><dt>Creation method</dt><dd>{usesTemplate ? "MCP template" : "Direct setup"}</dd></div>
          {usesTemplate ? (
            <>
              <div><dt>MCP template name</dt><dd>{valueOrFallback(selectedTemplate?.name ?? "")}</dd></div>
              <div><dt>Template key</dt><dd>{valueOrFallback(draft.selectedTemplateKey)}</dd></div>
            </>
          ) : (
            <>
              <div><dt>Source</dt><dd>Container registry</dd></div>
              <div><dt>Container image URL</dt><dd>{valueOrFallback(runtime.image)}</dd></div>
              <div><dt>Target port</dt><dd>{valueOrFallback(runtime.port)}</dd></div>
              <div><dt>Protocol</dt><dd>Streamable HTTP</dd></div>
              <div>
                <dt>Additional settings</dt>
                <dd>
                  <dl className="mcp-confirm-nested-list">
                    <div><dt>Path</dt><dd>{valueOrFallback(runtime.path)}</dd></div>
                    <div><dt>Container command</dt><dd>{valueOrFallback(runtime.command)}</dd></div>
                    <div>
                      <dt>Container arguments</dt>
                      <dd>
                        {runtime.arguments.length > 0 ? (
                          <ol className="mcp-confirm-argument-list">
                            {runtime.arguments.map((argument, index) => <li key={`${index}-${argument}`}>{argument}</li>)}
                          </ol>
                        ) : "Not provided"}
                      </dd>
                    </div>
                  </dl>
                </dd>
              </div>
            </>
          )}
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
          <div><dt>Visibility</dt><dd>{draft.visibility === "project" ? "Project" : "Personal"}</dd></div>
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
