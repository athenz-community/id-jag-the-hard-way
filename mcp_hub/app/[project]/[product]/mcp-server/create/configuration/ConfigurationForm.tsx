"use client"

import { Plus, Trash2 } from "lucide-react"
import Link from "next/link"
import { useMcpCreateDraft } from "../McpCreateDraftContext"
import { McpServerIdentityFields } from "./McpServerIdentityFields"

export function ConfigurationForm({
  cancelHref,
  sourceHref,
}: {
  cancelHref: string
  sourceHref: string
}) {
  const { draft, setDraft, resetDraft } = useMcpCreateDraft()

  return (
    <form className="mcp-create-form">
      <McpServerIdentityFields />

      <fieldset className="mcp-create-fieldset">
        <legend>Visibility <span aria-label="required">*</span></legend>
        <p className="mcp-create-field-copy">Visibility cannot be changed after the MCP server is created.</p>
        <div className="mcp-create-choice-list">
          <label className="mcp-create-choice">
            <input name="visibility" type="radio" value="personal" defaultChecked disabled />
            <span>
              <strong>Personal</strong>
              <small>Instance for personal use only. Accessible only by the creator.</small>
            </span>
          </label>
          <label className="mcp-create-choice disabled">
            <input name="visibility" type="radio" value="project" disabled />
            <span>
              <strong>Project</strong>
              <small>Instance shared at the project level. Accessible by project members.</small>
            </span>
          </label>
        </div>
        <p className="mcp-create-notice">When creating an MCP server without a template, its visibility can only be set to Personal.</p>
      </fieldset>

      <fieldset className="mcp-create-fieldset">
        <legend>Environment variable</legend>
        <p className="mcp-create-field-copy">The entered values enable the MCP server to connect to its upstream APIs.</p>
        <div className="mcp-create-env-table-wrap">
          <table className="mcp-create-env-table">
            <thead>
              <tr>
                <th>Key <span>*</span></th>
                <th>Value <span>*</span></th>
                <th>Secret</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <input
                    className="filter-select"
                    aria-label="Environment variable key"
                    value={draft.environmentKey}
                    onChange={(event) => setDraft((currentDraft) => ({ ...currentDraft, environmentKey: event.target.value }))}
                  />
                </td>
                <td>
                  <input
                    className="filter-select"
                    aria-label="Environment variable value"
                    value={draft.environmentValue}
                    onChange={(event) => setDraft((currentDraft) => ({ ...currentDraft, environmentValue: event.target.value }))}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    aria-label="Store as secret"
                    checked={draft.environmentSecret}
                    onChange={(event) => setDraft((currentDraft) => ({ ...currentDraft, environmentSecret: event.target.checked }))}
                  />
                </td>
                <td>
                  <button className="table-action" type="button" aria-label="Delete environment variable" disabled>
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <button className="button" type="button" aria-label="Add environment variable" disabled><Plus size={14} /></button>
      </fieldset>

      <fieldset className="mcp-create-fieldset">
        <legend>VPC network</legend>
        <div className="mcp-create-inline-fields">
          <select
            className="filter-select"
            aria-label="VPC"
            value={draft.vpc}
            onChange={(event) => setDraft((currentDraft) => ({ ...currentDraft, vpc: event.target.value }))}
          >
            <option value="default-vpc">default-vpc</option>
          </select>
          <select
            className="filter-select"
            aria-label="VPC network"
            value={draft.vpcNetwork}
            onChange={(event) => setDraft((currentDraft) => ({ ...currentDraft, vpcNetwork: event.target.value }))}
          >
            <option value="default-vpc-network">default-vpc-network</option>
          </select>
        </div>
      </fieldset>

      <fieldset className="mcp-create-fieldset">
        <legend>IAM service account</legend>
        <select className="filter-select mcp-create-service-account" defaultValue="" aria-label="IAM service account" disabled>
          <option value="">Select a service account</option>
        </select>
        <div className="mcp-create-service-actions">
          <button className="button" type="button" disabled>Assign role</button>
          <button className="button" type="button" disabled>Configure automatic token retrieval</button>
        </div>
      </fieldset>

      <div className="mcp-create-actions">
        <Link className="button" href={cancelHref} style={{ textDecoration: "none" }} onClick={resetDraft}>Cancel</Link>
        <Link className="button" href={sourceHref} style={{ textDecoration: "none" }}>Prev</Link>
        <button className="button" type="button" disabled>Next</button>
      </div>
    </form>
  )
}
