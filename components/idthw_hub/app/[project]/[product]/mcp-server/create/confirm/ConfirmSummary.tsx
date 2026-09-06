"use client"

import { Pencil } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { McpIconPreview } from "@/features/mcp-servers/components/McpIconPicker"
import type { McpIconOption } from "@/features/mcp-servers/lib/mcpIcons"
import { athenzServiceName } from "@/features/registration/lib/athenzServices"
import { buildMcpKubernetesManifest } from "@/features/registration/lib/kubernetesManifest"
import { type McpCreateDraft, useMcpCreateDraft } from "../McpCreateDraftContext"

function valueOrFallback(value: string) {
  return value || "Not provided"
}

function normalizedArguments(draft: McpCreateDraft) {
  return draft.containerArguments.map(({ value }) => value.trim()).filter(Boolean)
}

function formattedEnvironmentVariables(draft: McpCreateDraft) {
  return draft.environmentVariables
    .filter(({ key, value, hasExistingSecret }) => key || value || hasExistingSecret)
    .map((variable) => {
      const value = variable.secret
        ? variable.value
          ? "New secret value provided"
          : variable.hasExistingSecret ? "Stored secret value (unchanged)" : "Not provided"
        : valueOrFallback(variable.value)
      return `${variable.key || "Missing key"}\nSecret: ${variable.secret ? "Yes" : "No"}\nValue: ${value}`
    })
    .join("\n\n")
}

function changedServerFields(before: McpCreateDraft, after: McpCreateDraft) {
  const fields = [
    ["Container image URL", before.image, after.image],
    ["Target port", before.port, after.port],
    ["Path", before.path, after.path],
    ["Container command", before.command, after.command],
    ["Container arguments", normalizedArguments(before).join("\n"), normalizedArguments(after).join("\n")],
    ["MCP server name", before.serverName, after.serverName],
    ["Description", before.description, after.description],
    ["Icon", before.iconId, after.iconId],
    ["Environment variables", formattedEnvironmentVariables(before), formattedEnvironmentVariables(after)],
    ["Access management", before.accessManagement, after.accessManagement],
    ["IAM service account", before.hubServiceAccountName, after.hubServiceAccountName],
  ]
  return fields
    .filter(([, beforeValue, afterValue]) => beforeValue !== afterValue)
    .map(([field, beforeValue, afterValue]) => ({ field, beforeValue, afterValue }))
}

export function ConfirmSummary({
  project,
  cancelHref,
  successHref,
  sourceHref,
  configurationHref,
  mode = "create",
  originalMcpKeyName,
  iconOptions,
}: {
  project: string
  cancelHref: string
  successHref: string
  sourceHref: string
  configurationHref: string
  mode?: "create" | "edit"
  originalMcpKeyName?: string
  iconOptions: McpIconOption[]
}) {
  const { draft, initialDraft, resetDraft } = useMcpCreateDraft()
  const router = useRouter()
  const [createError, setCreateError] = useState("")
  const [isCreating, setIsCreating] = useState(false)
  const isEditing = mode === "edit"
  const usesTemplate = draft.creationMethod === "template"
  const selectedTemplate = draft.selectedTemplate
  const runtime = !isEditing && usesTemplate && selectedTemplate
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
        description: draft.description,
        image: draft.image,
        path: draft.path,
        port: draft.port,
      }
  const environmentVariables = !isEditing && usesTemplate ? draft.templateEnvironmentVariables : draft.environmentVariables
  const configuredEnvironmentVariables = environmentVariables.filter((variable) => (
    variable.key
    || variable.value
    || ("hasExistingSecret" in variable && variable.hasExistingSecret)
  ))
  const containerArguments = runtime.arguments.map((argument) => argument.trim()).filter(Boolean)
  const changes = changedServerFields(initialDraft, draft)
  const manifestEnvironmentVariables = environmentVariables.map((variable) => ({
    ...variable,
    value: variable.secret && !variable.value && "hasExistingSecret" in variable && variable.hasExistingSecret
      ? "<preserve-existing-secret>"
      : variable.value,
  }))
  const kubernetesManifest = buildMcpKubernetesManifest({
    project,
    accessManagement: draft.accessManagement,
    arguments: containerArguments,
    command: runtime.command,
    creationMethod: draft.creationMethod,
    description: runtime.description,
    environmentVariables: manifestEnvironmentVariables,
    iconId: draft.iconId,
    image: runtime.image,
    mcpKeyName: draft.mcpKeyName,
    path: runtime.path,
    port: runtime.port,
    serverName: draft.serverName,
    serviceAccount: draft.hubServiceAccountName,
    templateKey: usesTemplate ? draft.selectedTemplateKey : "",
    visibility: draft.visibility,
  })

  async function saveMcpServer() {
    setCreateError("")
    setIsCreating(true)

    try {
      const endpoint = isEditing
        ? `/api/mcp-servers/${encodeURIComponent(originalMcpKeyName ?? draft.mcpKeyName)}?project=${encodeURIComponent(project)}`
        : "/api/mcp-servers"
      const response = await fetch(endpoint, {
        method: isEditing ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accessManagement: draft.accessManagement,
          arguments: containerArguments,
          command: runtime.command,
          creationMethod: draft.creationMethod,
          description: runtime.description,
          environmentVariables: environmentVariables.map(({ key, value, secret }) => ({ key, value, secret })),
          iconId: draft.iconId,
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
        throw new Error(typeof payload.error === "string"
          ? payload.error
          : `Unable to ${isEditing ? "update" : "create"} MCP server`)
      }

      resetDraft()
      router.replace(successHref)
      router.refresh()
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : `Unable to ${isEditing ? "update" : "create"} MCP server`)
      setIsCreating(false)
    }
  }

  return (
    <div className="mcp-create-form">
      {isEditing ? (
        <section className="mcp-confirm-section">
          <div className="mcp-confirm-heading">
            <h2>Changes</h2>
          </div>
          {changes.length > 0 ? (
            <>
              <p className="mcp-confirm-manifest-copy">Only fields changed from the deployed MCP server are shown.</p>
              <div className="mcp-template-change-table-wrap">
                <table className="mcp-template-change-table">
                  <thead>
                    <tr><th>Field</th><th>Before</th><th>After</th></tr>
                  </thead>
                  <tbody>
                    {changes.map(({ field, beforeValue, afterValue }) => (
                      <tr key={field}>
                        <th scope="row">{field}</th>
                        <td>
                          <div className="mcp-template-change-value before">
                            {field === "Icon"
                              ? <McpIconPreview iconOptions={iconOptions} name={initialDraft.serverName} value={beforeValue} />
                              : valueOrFallback(beforeValue)}
                          </div>
                        </td>
                        <td>
                          <div className="mcp-template-change-value after">
                            {field === "Icon"
                              ? <McpIconPreview iconOptions={iconOptions} name={draft.serverName} value={afterValue} />
                              : valueOrFallback(afterValue)}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="mcp-confirm-manifest-copy">No changes have been made to this MCP server.</p>
          )}
        </section>
      ) : null}

      <section className="mcp-confirm-section">
        <div className="mcp-confirm-heading">
          <h2>Source</h2>
          <Link className="table-action" href={sourceHref} aria-label="Edit Source"><Pencil size={16} /></Link>
        </div>
        <dl className="mcp-confirm-list">
          <div><dt>Creation method</dt><dd>{usesTemplate ? "MCP template" : "Direct setup"}</dd></div>
          {!isEditing && usesTemplate ? (
            <>
              <div><dt>MCP template name</dt><dd>{valueOrFallback(selectedTemplate?.name ?? "")}</dd></div>
              <div><dt>Template key</dt><dd>{valueOrFallback(draft.selectedTemplateKey)}</dd></div>
            </>
          ) : (
            <>
              <div><dt>Source</dt><dd>Container registry</dd></div>
              {isEditing && usesTemplate ? (
                <div><dt>Template key</dt><dd>{valueOrFallback(draft.selectedTemplateKey)}</dd></div>
              ) : null}
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
          {isEditing ? <div><dt>Description</dt><dd>{valueOrFallback(draft.description)}</dd></div> : null}
          <div><dt>MCP key name</dt><dd>{valueOrFallback(draft.mcpKeyName)}</dd></div>
          <div>
            <dt>Icon</dt>
            <dd><McpIconPreview iconOptions={iconOptions} name={draft.serverName} value={draft.iconId} /></dd>
          </div>
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
          Preview of the Kubernetes resources the Hub will {isEditing ? "update" : "create"}. Secret values are redacted.
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
          disabled={isCreating || (isEditing && changes.length === 0)}
          aria-busy={isCreating}
          onClick={() => void saveMcpServer()}
        >
          {isCreating
            ? (isEditing ? "Updating..." : "Creating...")
            : (isEditing ? "Update" : "Create")}
        </button>
      </div>
    </div>
  )
}
