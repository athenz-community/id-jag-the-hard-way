"use client"

import Link from "next/link"
import { ContainerArgumentsField } from "@/features/registration/components/ContainerArgumentsField"
import { ContainerImageField } from "../../create/ContainerImageField"
import { useMcpCreateDraft } from "../../create/McpCreateDraftContext"

export function EditSourceForm({
  cancelHref,
  configurationHref,
}: {
  cancelHref: string
  configurationHref: string
}) {
  const { draft, setDraft, resetDraft } = useMcpCreateDraft()
  const numericPort = Number(draft.port)
  const canContinue = Boolean(
    draft.image.trim()
    && draft.path.trim().startsWith("/")
    && Number.isInteger(numericPort)
    && numericPort >= 1
    && numericPort <= 65535,
  )

  return (
    <form className="mcp-create-form" autoComplete="off">
      <fieldset className="mcp-create-fieldset">
        <legend>Creation method</legend>
        <p className="mcp-create-field-copy">The creation method cannot be changed after deployment.</p>
        <div className="mcp-create-choice-list">
          <label className="mcp-create-choice disabled">
            <input type="radio" checked disabled readOnly />
            <span>
              <strong>{draft.creationMethod === "template" ? "MCP template" : "Direct setup"}</strong>
              <small>{draft.creationMethod === "template"
                ? `Created from template ${draft.selectedTemplateKey}. Runtime values can be updated below.`
                : "Created directly from a container image."}</small>
            </span>
          </label>
        </div>
      </fieldset>

      <fieldset className="mcp-create-fieldset">
        <legend>Source</legend>
        <div className="mcp-create-choice-list">
          <label className="mcp-create-choice source-choice disabled">
            <input type="radio" checked disabled readOnly />
            <span>
              <strong>Container registry</strong>
              <small>Update the image used by the deployed MCP server.</small>
            </span>
          </label>
        </div>
      </fieldset>

      <ContainerImageField />

      <div className="mcp-create-field">
        <label htmlFor="mcp-port">Target port <span aria-label="required">*</span></label>
        <p>Enter the internal port on the container that receives traffic.</p>
        <input
          id="mcp-port"
          className="filter-select"
          name="port"
          type="number"
          min="1"
          max="65535"
          required
          value={draft.port}
          onChange={(event) => setDraft((currentDraft) => ({ ...currentDraft, port: event.target.value }))}
        />
      </div>

      <fieldset className="mcp-create-fieldset">
        <legend>Protocol</legend>
        <div className="mcp-create-choice-list">
          <label className="mcp-create-choice disabled">
            <input type="radio" checked disabled readOnly />
            <span>
              <strong>Streamable HTTP</strong>
              <small>The deployed protocol cannot be changed.</small>
            </span>
          </label>
        </div>
      </fieldset>

      <details className="mcp-create-additional" open>
        <summary>Additional settings</summary>
        <div className="mcp-create-field">
          <label htmlFor="mcp-path">Path <span aria-label="required">*</span></label>
          <input
            id="mcp-path"
            className="filter-select"
            name="path"
            required
            value={draft.path}
            onChange={(event) => setDraft((currentDraft) => ({ ...currentDraft, path: event.target.value }))}
          />
        </div>
        <div className="mcp-create-field">
          <label htmlFor="mcp-command">Container command</label>
          <p>Leave blank to use the entry point set in the container image.</p>
          <input
            id="mcp-command"
            className="filter-select"
            name="command"
            value={draft.command}
            onChange={(event) => setDraft((currentDraft) => ({ ...currentDraft, command: event.target.value }))}
          />
        </div>
        <ContainerArgumentsField
          idPrefix="mcp"
          containerArguments={draft.containerArguments}
          onChange={(containerArguments) => setDraft((currentDraft) => ({ ...currentDraft, containerArguments }))}
        />
      </details>

      <div className="mcp-create-actions">
        <Link className="button" href={cancelHref} style={{ textDecoration: "none" }} onClick={resetDraft}>Cancel</Link>
        {canContinue ? (
          <Link className="button mcp-create-primary" href={configurationHref}>Next</Link>
        ) : (
          <button className="button" type="button" disabled>Next</button>
        )}
      </div>
    </form>
  )
}
