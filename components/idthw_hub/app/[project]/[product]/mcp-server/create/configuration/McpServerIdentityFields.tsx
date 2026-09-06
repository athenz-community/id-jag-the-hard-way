"use client"

import { normalizeMcpKeyName } from "@/features/mcp-servers/lib/mcpKeyName"
import { useMcpCreateDraft } from "../McpCreateDraftContext"

export function McpServerIdentityFields({ mcpKeyReadOnly = false }: { mcpKeyReadOnly?: boolean }) {
  const { draft, setDraft } = useMcpCreateDraft()

  function updateServerName(nextServerName: string) {
    setDraft((currentDraft) => {
      const resetCustomization = nextServerName.length === 0
      return {
        ...currentDraft,
        serverName: nextServerName,
        mcpKeyName: resetCustomization || !currentDraft.mcpKeyWasCustomized
          ? normalizeMcpKeyName(nextServerName)
          : currentDraft.mcpKeyName,
        mcpKeyWasCustomized: resetCustomization ? false : currentDraft.mcpKeyWasCustomized,
        showMcpKeyWarning: resetCustomization ? false : currentDraft.mcpKeyWasCustomized,
      }
    })
  }

  function updateMcpKeyName(nextMcpKeyName: string) {
    setDraft((currentDraft) => ({
      ...currentDraft,
      mcpKeyName: normalizeMcpKeyName(nextMcpKeyName),
      mcpKeyWasCustomized: true,
      showMcpKeyWarning: false,
    }))
  }

  return (
    <>
      <div className="mcp-create-field">
        <label htmlFor="mcp-name">MCP server name <span aria-label="required">*</span></label>
        <input
          id="mcp-name"
          className="filter-select"
          name="name"
          autoComplete="off"
          required
          value={draft.serverName}
          onChange={(event) => updateServerName(event.target.value)}
        />
      </div>

      <div className="mcp-create-field">
        <label htmlFor="mcp-key-name">MCP key name <span aria-label="required">*</span></label>
        <p>{mcpKeyReadOnly
          ? "The MCP key identifies the deployed Kubernetes resources and cannot be changed."
          : "Automatically follows the MCP server name using lowercase letters and replacing spaces with hyphens. Must be unique."}</p>
        <input
          id="mcp-key-name"
          className="filter-select"
          name="mcp-key-name"
          autoComplete="off"
          required
          readOnly={mcpKeyReadOnly}
          value={draft.mcpKeyName}
          onChange={mcpKeyReadOnly ? undefined : (event) => updateMcpKeyName(event.target.value)}
        />
        {draft.showMcpKeyWarning ? (
          <p className="mcp-create-field-warning" role="status">
            MCP key name was customized, so it was not updated. Review it after changing the MCP server name.
          </p>
        ) : null}
      </div>
    </>
  )
}
