"use client"

import Link from "next/link"
import { useMcpTemplateDraft } from "../McpTemplateDraftContext"

export function ReferenceForm({
  project,
  cancelHref,
  configurationHref,
  confirmHref,
}: {
  project: string
  cancelHref: string
  configurationHref: string
  confirmHref: string
}) {
  const { draft, setDraft, resetDraft } = useMcpTemplateDraft()

  return (
    <form className="mcp-create-form">
      <fieldset className="mcp-create-fieldset">
        <legend>Visibility <span aria-label="required">*</span></legend>
        <div className="mcp-create-choice-list">
          <label className="mcp-create-choice">
            <input name="visibility" type="radio" value="project" checked={draft.visibility === "project"} readOnly />
            <span>
              <strong>Project</strong>
              <small>Available only to members of {project}.</small>
            </span>
          </label>
          <label className="mcp-create-choice disabled">
            <input name="visibility" type="radio" value="public" disabled />
            <span>
              <strong>Public</strong>
              <small>Public template approval is not available yet.</small>
            </span>
          </label>
        </div>
      </fieldset>

      <div className="mcp-create-field mcp-template-reference-field">
        <label htmlFor="template-documentation">Documentation</label>
        <p>Enter a link to the template documentation, including specifications and usage guides.</p>
        <input
          id="template-documentation"
          className="filter-select"
          name="documentation"
          type="url"
          placeholder="https://example.com/docs"
          value={draft.documentation}
          onChange={(event) => setDraft((currentDraft) => ({ ...currentDraft, documentation: event.target.value }))}
        />
      </div>

      <div className="mcp-create-field mcp-template-description-field">
        <label htmlFor="template-description">Description</label>
        <p>Describe what MCP servers created from this template provide.</p>
        <textarea
          id="template-description"
          className="filter-select"
          name="description"
          rows={4}
          value={draft.description}
          onChange={(event) => setDraft((currentDraft) => ({ ...currentDraft, description: event.target.value }))}
        />
      </div>

      <div className="mcp-create-actions">
        <Link className="button" href={cancelHref} style={{ textDecoration: "none" }} onClick={resetDraft}>Cancel</Link>
        <Link className="button" href={configurationHref} style={{ textDecoration: "none" }}>Prev</Link>
        <Link className="button mcp-create-primary" href={confirmHref}>Next</Link>
      </div>
    </form>
  )
}
