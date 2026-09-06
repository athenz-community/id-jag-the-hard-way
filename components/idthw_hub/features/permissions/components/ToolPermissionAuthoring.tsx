"use client"

import { Plus, Trash2 } from "lucide-react"
import type { Dispatch, SetStateAction } from "react"
import { PermissionEditor } from "./PermissionRequestDialog"
import { emptyEditablePermissionRequirement } from "../lib/toolPermissionDraft"
import type {
  EditablePermissionRequirement,
  ToolPermissionDraft,
} from "../types/permissions"

export function ToolPermissionAuthoring({
  accessAudience,
  description,
  helperPreviewServicePrincipal,
  servicePrincipal,
  tools,
  validationError,
  onChange,
}: {
  accessAudience?: string
  description: string
  helperPreviewServicePrincipal?: string
  servicePrincipal?: string
  tools: ToolPermissionDraft[]
  validationError?: string
  onChange: (tools: ToolPermissionDraft[]) => void
}) {
  const updateTool = (id: number, values: Partial<ToolPermissionDraft>) => {
    onChange(tools.map((tool) => tool.id === id ? { ...tool, ...values } : tool))
  }

  const addTool = () => {
    if (tools.length >= 100) return
    onChange([
      ...tools,
      {
        id: Math.max(0, ...tools.map(({ id }) => id)) + 1,
        requirements: [emptyEditablePermissionRequirement()],
        toolName: "",
      },
    ])
  }

  return (
    <fieldset className="mcp-create-fieldset mcp-tool-permission-authoring">
      <legend>Tool permissions (optional)</legend>
      <p className="mcp-create-field-copy">{description}</p>
      {tools.length === 0 ? (
        <div className="permission-dialog-empty neutral mcp-tool-permission-empty">
          <strong>No tool permissions configured</strong>
          <p>Add a tool now only when you already know its MCP tool name and downstream Athenz role.</p>
        </div>
      ) : (
        <div className="mcp-tool-permission-list">
          {tools.map((tool, index) => (
            <section className="mcp-tool-permission-group" key={tool.id}>
              <div className="mcp-tool-permission-head">
                <label className="permission-editor-field">
                  <span>MCP tool name</span>
                  <input
                    required
                    placeholder="get_k8s_docs"
                    value={tool.toolName}
                    onChange={(event) => updateTool(tool.id, { toolName: event.target.value })}
                  />
                </label>
                <button
                  className="permission-editor-remove"
                  type="button"
                  aria-label={`Remove tool permission ${index + 1}`}
                  onClick={() => onChange(tools.filter(({ id }) => id !== tool.id))}
                >
                  <Trash2 size={15} aria-hidden="true" />
                </button>
              </div>
              <PermissionEditor
                accessAudience={accessAudience}
                helperPreviewServicePrincipal={helperPreviewServicePrincipal}
                requirements={tool.requirements}
                servicePrincipal={servicePrincipal}
                setRequirements={permissionSetter(tool, updateTool)}
              />
            </section>
          ))}
        </div>
      )}
      {validationError ? <p className="mcp-create-service-warning" role="alert">{validationError}</p> : null}
      <button className="button" type="button" disabled={tools.length >= 100} onClick={addTool}>
        <Plus size={14} aria-hidden="true" />
        Add tool permission
      </button>
    </fieldset>
  )
}

function permissionSetter(
  tool: ToolPermissionDraft,
  updateTool: (id: number, values: Partial<ToolPermissionDraft>) => void,
): Dispatch<SetStateAction<EditablePermissionRequirement[]>> {
  return (value) => {
    const requirements = typeof value === "function" ? value(tool.requirements) : value
    updateTool(tool.id, { requirements })
  }
}
