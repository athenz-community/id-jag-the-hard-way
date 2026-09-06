"use client"

import { Pencil } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { buildMcpTemplateManifest } from "@/features/mcp-templates/lib/kubernetesTemplate"
import { useMcpTemplateDraft } from "../McpTemplateDraftContext"

function valueOrFallback(value: string) {
  return value || "Not provided"
}

export function ConfirmSummary({
  project,
  cancelHref,
  successHref,
  sourceHref,
  configurationHref,
  referenceHref,
}: {
  project: string
  cancelHref: string
  successHref: string
  sourceHref: string
  configurationHref: string
  referenceHref: string
}) {
  const { draft, resetDraft } = useMcpTemplateDraft()
  const router = useRouter()
  const [createError, setCreateError] = useState("")
  const [isCreating, setIsCreating] = useState(false)
  const configuredEnvironmentVariables = draft.environmentVariables.filter(({ key, description, defaultValue }) => (
    key || description || defaultValue
  ))
  const containerArguments = draft.containerArguments.map(({ value }) => value.trim()).filter(Boolean)
  const templateInput = {
    arguments: containerArguments,
    command: draft.command,
    description: draft.description,
    documentation: draft.documentation,
    environmentVariables: draft.environmentVariables.map((variable) => ({
      key: variable.key,
      description: variable.description,
      required: variable.required,
      secret: variable.secret,
      defaultValue: variable.secret ? "" : variable.defaultValue,
    })),
    image: draft.image,
    name: draft.name,
    path: draft.path,
    port: draft.port,
    project,
    templateKey: draft.templateKey,
    transport: "streamable-http" as const,
    visibility: draft.visibility,
  }
  const kubernetesManifest = buildMcpTemplateManifest(templateInput)

  async function createMcpTemplate() {
    setCreateError("")
    setIsCreating(true)

    try {
      const response = await fetch("/api/mcp-templates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(templateInput),
      })
      const payload = await response.json() as { error?: unknown }
      if (!response.ok) {
        throw new Error(typeof payload.error === "string" ? payload.error : "Unable to create MCP template")
      }

      resetDraft()
      router.replace(successHref)
      router.refresh()
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Unable to create MCP template")
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
                <div>
                  <dt>Container arguments</dt>
                  <dd>
                    {containerArguments.length > 0 ? (
                      <ol className="mcp-confirm-argument-list">
                        {containerArguments.map((argument, index) => <li key={`${index}-${argument}`}>{argument}</li>)}
                      </ol>
                    ) : "Not provided"}
                  </dd>
                </div>
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
          <div><dt>Template name</dt><dd>{valueOrFallback(draft.name)}</dd></div>
          <div><dt>Template key name</dt><dd>{valueOrFallback(draft.templateKey)}</dd></div>
          <div>
            <dt>Environment variables</dt>
            <dd>
              {configuredEnvironmentVariables.length > 0 ? (
                <table className="mcp-confirm-env-table mcp-template-confirm-env-table">
                  <thead>
                    <tr><th>Key</th><th>Secret</th><th>Required</th><th>Description</th><th>Default value</th></tr>
                  </thead>
                  <tbody>
                    {configuredEnvironmentVariables.map((variable) => (
                      <tr key={variable.id}>
                        <td>{valueOrFallback(variable.key)}</td>
                        <td>{variable.secret ? "Yes" : "No"}</td>
                        <td>{variable.required ? "Yes" : "No"}</td>
                        <td>{valueOrFallback(variable.description)}</td>
                        <td>{variable.secret ? "Provided during server creation" : valueOrFallback(variable.defaultValue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : "Not configured"}
            </dd>
          </div>
        </dl>
      </section>

      <section className="mcp-confirm-section">
        <div className="mcp-confirm-heading">
          <h2>Reference info</h2>
          <Link className="table-action" href={referenceHref} aria-label="Edit Reference info"><Pencil size={16} /></Link>
        </div>
        <dl className="mcp-confirm-list">
          <div><dt>Visibility</dt><dd>Project</dd></div>
          <div><dt>Documentation</dt><dd>{valueOrFallback(draft.documentation)}</dd></div>
          <div><dt>Description</dt><dd>{valueOrFallback(draft.description)}</dd></div>
        </dl>
      </section>

      <section className="mcp-confirm-section">
        <div className="mcp-confirm-heading">
          <h2>Kubernetes manifest</h2>
        </div>
        <p className="mcp-confirm-manifest-copy">
          Preview of the Kubernetes Secret the Hub will create. Secret environment values are not stored in the template.
        </p>
        <pre className="mcp-confirm-manifest"><code>{kubernetesManifest}</code></pre>
      </section>

      {createError ? <p className="mcp-create-service-warning" role="alert">{createError}</p> : null}

      <div className="mcp-create-actions">
        <Link className="button" href={cancelHref} style={{ textDecoration: "none" }} onClick={resetDraft}>Cancel</Link>
        <Link className="button" href={referenceHref} style={{ textDecoration: "none" }}>Prev</Link>
        <button
          className="button mcp-create-primary"
          type="button"
          disabled={isCreating}
          aria-busy={isCreating}
          onClick={() => void createMcpTemplate()}
        >
          {isCreating ? "Creating..." : "Create"}
        </button>
      </div>
    </div>
  )
}
