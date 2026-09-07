"use client"

import { Plus, Trash2 } from "lucide-react"
import Link from "next/link"
import { McpIconPicker } from "@/features/mcp-servers/components/McpIconPicker"
import type { McpIconOption } from "@/features/mcp-servers/lib/mcpIcons"
import { ToolPermissionAuthoring } from "@/features/permissions/components/ToolPermissionAuthoring"
import {
  TEMPLATE_MCP_IAM_MEMBER,
  validateToolPermissionDraft,
} from "@/features/permissions/lib/toolPermissionDraft"
import { useMcpTemplateDraft } from "../McpTemplateDraftContext"
import { McpTemplateIdentityFields } from "./McpTemplateIdentityFields"

export function ConfigurationForm({
  project,
  cancelHref,
  sourceHref,
  referenceHref,
  iconOptions,
  templateKeyReadOnly = false,
}: {
  project: string
  cancelHref: string
  sourceHref: string
  referenceHref: string
  iconOptions: McpIconOption[]
  templateKeyReadOnly?: boolean
}) {
  const { draft, setDraft, resetDraft } = useMcpTemplateDraft()
  const hubServiceDomain = `mcp-hub.mcps.${project}`
  const toolPermissionValidation = validateToolPermissionDraft(
    draft.toolPermissions,
    true,
    TEMPLATE_MCP_IAM_MEMBER,
  )

  function updateEnvironmentVariable(
    id: number,
    update: Partial<{
      key: string
      description: string
      required: boolean
      secret: boolean
      defaultValue: string
    }>,
  ) {
    setDraft((currentDraft) => ({
      ...currentDraft,
      environmentVariables: currentDraft.environmentVariables.map((variable) => {
        if (variable.id !== id) return variable
        const updated = { ...variable, ...update }
        return updated.secret ? { ...updated, defaultValue: "" } : updated
      }),
    }))
  }

  function addEnvironmentVariable() {
    setDraft((currentDraft) => currentDraft.environmentVariables.length >= 50
      ? currentDraft
      : {
          ...currentDraft,
          environmentVariables: [
            ...currentDraft.environmentVariables,
            {
              id: Math.max(0, ...currentDraft.environmentVariables.map(({ id }) => id)) + 1,
              key: "",
              description: "",
              required: true,
              secret: false,
              defaultValue: "",
            },
          ],
        })
  }

  function deleteEnvironmentVariable(id: number) {
    setDraft((currentDraft) => ({
      ...currentDraft,
      environmentVariables: currentDraft.environmentVariables.filter((variable) => variable.id !== id),
    }))
  }

  return (
    <form className="mcp-create-form" autoComplete="off">
      <McpTemplateIdentityFields templateKeyReadOnly={templateKeyReadOnly} />

      <McpIconPicker
        iconOptions={iconOptions}
        name={draft.name}
        onChange={(iconId) => setDraft((currentDraft) => ({ ...currentDraft, iconId }))}
        resourceKind="MCP template"
        value={draft.iconId}
      />

      <fieldset className="mcp-create-fieldset">
        <legend>Environment variables</legend>
        <p className="mcp-create-field-copy">
          Define values required by the image. Secret values are never stored in a template; users provide them when creating an MCP server.
        </p>
        <div className="mcp-create-env-table-wrap mcp-template-env-table-wrap">
          <table className="mcp-create-env-table mcp-template-env-table">
            <thead>
              <tr>
                <th>Key <span>*</span></th>
                <th>Secret</th>
                <th>Required</th>
                <th>Description</th>
                <th>Default value</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {draft.environmentVariables.map((variable, index) => (
                <tr key={variable.id}>
                  <td>
                    <input
                      className="filter-select"
                      aria-label={`Template environment key ${index + 1}`}
                      value={variable.key}
                      onChange={(event) => updateEnvironmentVariable(variable.id, { key: event.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Template environment secret ${index + 1}`}
                      checked={variable.secret}
                      onChange={(event) => updateEnvironmentVariable(variable.id, { secret: event.target.checked })}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Template environment required ${index + 1}`}
                      checked={variable.required}
                      onChange={(event) => updateEnvironmentVariable(variable.id, { required: event.target.checked })}
                    />
                  </td>
                  <td>
                    <input
                      className="filter-select"
                      aria-label={`Template environment description ${index + 1}`}
                      value={variable.description}
                      onChange={(event) => updateEnvironmentVariable(variable.id, { description: event.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="filter-select"
                      aria-label={`Template environment default ${index + 1}`}
                      placeholder={variable.secret ? "Provided during server creation" : undefined}
                      disabled={variable.secret}
                      value={variable.defaultValue}
                      onChange={(event) => updateEnvironmentVariable(variable.id, { defaultValue: event.target.value })}
                    />
                  </td>
                  <td>
                    <button
                      className="table-action"
                      type="button"
                      aria-label={`Delete template environment variable ${index + 1}`}
                      disabled={draft.environmentVariables.length === 1}
                      onClick={() => deleteEnvironmentVariable(variable.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          className="button"
          type="button"
          disabled={draft.environmentVariables.length >= 50}
          onClick={addEnvironmentVariable}
        >
          <Plus size={14} />
          Add environment variable
        </button>
      </fieldset>

      <ToolPermissionAuthoring
        accessAudience={hubServiceDomain}
        description="Define required Athenz roles as template defaults when you already know the MCP tool names. This stores requirements; it does not grant downstream role membership. Providers can review them during server creation and modify them later after live tool discovery."
        tools={draft.toolPermissions}
        validationError={toolPermissionValidation.ok ? undefined : toolPermissionValidation.error}
        onChange={(toolPermissions) => setDraft((currentDraft) => ({ ...currentDraft, toolPermissions }))}
      />

      <div className="mcp-create-actions">
        <Link className="button" href={cancelHref} style={{ textDecoration: "none" }} onClick={resetDraft}>Cancel</Link>
        <Link className="button" href={sourceHref} style={{ textDecoration: "none" }}>Prev</Link>
        {toolPermissionValidation.ok ? (
          <Link className="button mcp-create-primary" href={referenceHref}>Next</Link>
        ) : (
          <button className="button" type="button" disabled>Next</button>
        )}
      </div>
    </form>
  )
}
