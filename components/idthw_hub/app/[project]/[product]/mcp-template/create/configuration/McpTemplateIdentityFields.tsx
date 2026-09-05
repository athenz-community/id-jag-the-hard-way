"use client"

import { normalizeMcpKeyName } from "@/features/mcp-servers/lib/mcpKeyName"
import { useMcpTemplateDraft } from "../McpTemplateDraftContext"

export function McpTemplateIdentityFields() {
  const { draft, setDraft } = useMcpTemplateDraft()

  function updateTemplateName(nextName: string) {
    setDraft((currentDraft) => {
      const resetCustomization = nextName.length === 0
      return {
        ...currentDraft,
        name: nextName,
        templateKey: resetCustomization || !currentDraft.templateKeyWasCustomized
          ? normalizeMcpKeyName(nextName)
          : currentDraft.templateKey,
        templateKeyWasCustomized: resetCustomization ? false : currentDraft.templateKeyWasCustomized,
        showTemplateKeyWarning: resetCustomization ? false : currentDraft.templateKeyWasCustomized,
      }
    })
  }

  function updateTemplateKey(nextTemplateKey: string) {
    setDraft((currentDraft) => ({
      ...currentDraft,
      templateKey: normalizeMcpKeyName(nextTemplateKey),
      templateKeyWasCustomized: true,
      showTemplateKeyWarning: false,
    }))
  }

  return (
    <>
      <div className="mcp-create-field">
        <label htmlFor="template-name">Template name <span aria-label="required">*</span></label>
        <input
          id="template-name"
          className="filter-select"
          name="name"
          required
          value={draft.name}
          onChange={(event) => updateTemplateName(event.target.value)}
        />
      </div>

      <div className="mcp-create-field">
        <label htmlFor="template-key">Template key name <span aria-label="required">*</span></label>
        <p>Automatically follows the template name using lowercase letters and replacing spaces with hyphens. Must be unique.</p>
        <input
          id="template-key"
          className="filter-select"
          name="template-key"
          required
          value={draft.templateKey}
          onChange={(event) => updateTemplateKey(event.target.value)}
        />
        {draft.showTemplateKeyWarning ? (
          <p className="mcp-create-field-warning" role="status">
            Template key name was customized, so it was not updated. Review it after changing the template name.
          </p>
        ) : null}
        <p>Stored as <code>mcp-hub/mcp-template-{draft.templateKey || "template-key"}</code>.</p>
      </div>
    </>
  )
}
