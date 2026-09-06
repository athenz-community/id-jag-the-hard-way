"use client"

import { ExternalLink, Plus, RefreshCw, Trash2 } from "lucide-react"
import Link from "next/link"
import { useCallback, useEffect, useRef, useState } from "react"
import { athenzServiceName } from "@/features/registration/lib/athenzServices"
import { useMcpCreateDraft } from "../McpCreateDraftContext"
import { McpServerIdentityFields } from "./McpServerIdentityFields"

export function ConfigurationForm({
  project,
  athenzServicesHref,
  cancelHref,
  sourceHref,
  confirmHref,
  mode = "create",
}: {
  project: string
  athenzServicesHref: string
  cancelHref: string
  sourceHref: string
  confirmHref: string
  mode?: "create" | "edit"
}) {
  const { draft, setDraft, resetDraft } = useMcpCreateDraft()
  const hubServiceDomain = `mcp-hub.mcps.${project}`
  const isEditing = mode === "edit"
  const usesTemplate = draft.creationMethod === "template"
  const usesTemplateValues = usesTemplate && !isEditing
  const requiresServiceAccount = draft.accessManagement === "hub"
  const templateRequirementsReady = !usesTemplateValues || (
    Boolean(draft.selectedTemplate)
    && draft.templateEnvironmentVariables.every((variable) => !variable.required || Boolean(variable.value))
  )
  const environmentVariablesReady = usesTemplateValues || draft.environmentVariables.every((variable) => {
    if (!variable.key && !variable.value) return true
    return Boolean(variable.key && (variable.value || (variable.secret && variable.hasExistingSecret)))
  })
  const canContinue = templateRequirementsReady
    && environmentVariablesReady
    && (!requiresServiceAccount || Boolean(draft.hubServiceAccountName))
  const [serviceAccounts, setServiceAccounts] = useState<string[]>([])
  const [serviceAccountError, setServiceAccountError] = useState("")
  const [serviceAccountsLoading, setServiceAccountsLoading] = useState(false)
  const serviceAccountsLoaded = useRef(false)

  const refreshServiceAccounts = useCallback(async () => {
    setServiceAccountsLoading(true)
    setServiceAccountError("")

    try {
      const [responseResult] = await Promise.allSettled([
        fetch(`/api/athenz/services?project=${encodeURIComponent(project)}`, { cache: "no-store" }),
        new Promise((resolve) => setTimeout(resolve, 500)),
      ])
      if (responseResult.status === "rejected") throw responseResult.reason

      const response = responseResult.value
      const payload = await response.json() as { error?: unknown; services?: unknown }
      if (!response.ok || !Array.isArray(payload.services) || !payload.services.every((value) => typeof value === "string")) {
        throw new Error(typeof payload.error === "string" ? payload.error : "Unable to load service accounts")
      }

      const services = payload.services as string[]
      setServiceAccounts(services)
      setDraft((currentDraft) => isEditing || services.includes(currentDraft.hubServiceAccountName)
        ? currentDraft
        : { ...currentDraft, hubServiceAccountName: "" })
    } catch (error) {
      setServiceAccountError(error instanceof Error ? error.message : "Unable to load service accounts")
    } finally {
      setServiceAccountsLoading(false)
    }
  }, [isEditing, project, setDraft])

  useEffect(() => {
    if (serviceAccountsLoaded.current) return
    serviceAccountsLoaded.current = true
    void refreshServiceAccounts()
  }, [refreshServiceAccounts])

  function updateEnvironmentVariable(
    id: number,
    update: Partial<{ key: string; value: string; secret: boolean }>,
  ) {
    setDraft((currentDraft) => ({
      ...currentDraft,
      environmentVariables: currentDraft.environmentVariables.map((variable) => (
        variable.id === id
          ? {
              ...variable,
              ...update,
              hasExistingSecret: update.key !== undefined && update.key !== variable.key
                ? false
                : variable.hasExistingSecret,
            }
          : variable
      )),
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
              value: "",
              secret: false,
            },
          ],
        })
  }

  function updateTemplateEnvironmentVariable(id: number, value: string) {
    setDraft((currentDraft) => ({
      ...currentDraft,
      templateEnvironmentVariables: currentDraft.templateEnvironmentVariables.map((variable) => (
        variable.id === id ? { ...variable, value } : variable
      )),
    }))
  }

  function deleteEnvironmentVariable(id: number) {
    setDraft((currentDraft) => ({
      ...currentDraft,
      environmentVariables: currentDraft.environmentVariables.filter((variable) => variable.id !== id),
    }))
  }

  return (
    <form className="mcp-create-form">
      <McpServerIdentityFields mcpKeyReadOnly={isEditing} />

      {isEditing ? (
        <div className="mcp-create-field">
          <label htmlFor="mcp-description">Description</label>
          <textarea
            id="mcp-description"
            className="filter-select"
            rows={4}
            maxLength={2000}
            value={draft.description}
            onChange={(event) => setDraft((currentDraft) => ({ ...currentDraft, description: event.target.value }))}
          />
        </div>
      ) : null}

      <fieldset className="mcp-create-fieldset">
        <legend>Visibility <span aria-label="required">*</span></legend>
        <p className="mcp-create-field-copy">Visibility cannot be changed after the MCP server is created.</p>
        <div className="mcp-create-choice-list">
          <label className={`mcp-create-choice ${isEditing ? "disabled" : ""}`}>
            <input
              name="visibility"
              type="radio"
              value="personal"
              checked={draft.visibility === "personal"}
              disabled={isEditing}
              onChange={() => setDraft((currentDraft) => ({ ...currentDraft, visibility: "personal" }))}
            />
            <span>
              <strong>Personal</strong>
              <small>Instance for personal use only. Accessible only by the creator.</small>
            </span>
          </label>
          <label className={`mcp-create-choice ${usesTemplate && !isEditing ? "" : "disabled"}`}>
            <input
              name="visibility"
              type="radio"
              value="project"
              checked={draft.visibility === "project"}
              disabled={isEditing || !usesTemplate}
              onChange={() => setDraft((currentDraft) => ({ ...currentDraft, visibility: "project" }))}
            />
            <span>
              <strong>Project</strong>
              <small>Instance shared at the project level. Accessible by project members.</small>
            </span>
          </label>
        </div>
        {!usesTemplate && !isEditing ? (
          <p className="mcp-create-notice">When creating an MCP server without a template, its visibility can only be set to Personal.</p>
        ) : null}
      </fieldset>

      <fieldset className="mcp-create-fieldset">
        <legend>Environment variables</legend>
        <p className="mcp-create-field-copy">
          {usesTemplateValues
            ? "Provide the runtime values defined by the selected MCP template."
            : isEditing
              ? "Update runtime values. Leave an existing secret value blank to keep it unchanged."
              : "The entered values enable the MCP server to connect to its upstream APIs."}
        </p>
        {usesTemplateValues ? (
          draft.templateEnvironmentVariables.length > 0 ? (
            <div className="mcp-create-env-table-wrap mcp-template-server-env-table-wrap">
              <table className="mcp-create-env-table mcp-template-server-env-table">
                <thead>
                  <tr>
                    <th>Key</th>
                    <th>Secret</th>
                    <th>Required</th>
                    <th>Description</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {draft.templateEnvironmentVariables.map((variable, index) => (
                    <tr key={variable.id}>
                      <td><code>{variable.key}</code></td>
                      <td><input type="checkbox" checked={variable.secret} readOnly aria-label={`${variable.key} is secret`} /></td>
                      <td><input type="checkbox" checked={variable.required} readOnly aria-label={`${variable.key} is required`} /></td>
                      <td>{variable.description || "Not provided"}</td>
                      <td>
                        <input
                          className="filter-select"
                          type={variable.secret ? "password" : "text"}
                          required={variable.required}
                          aria-label={`Template environment value ${index + 1}`}
                          value={variable.value}
                          onChange={(event) => updateTemplateEnvironmentVariable(variable.id, event.target.value)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mcp-create-notice">This template does not require environment variables.</p>
          )
        ) : (
          <>
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
                  {draft.environmentVariables.map((variable, index) => (
                    <tr key={variable.id}>
                      <td>
                        <input
                          className="filter-select"
                          aria-label={`Environment variable key ${index + 1}`}
                          value={variable.key}
                          onChange={(event) => updateEnvironmentVariable(variable.id, { key: event.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          className="filter-select"
                          type={variable.secret ? "password" : "text"}
                          placeholder={variable.secret && variable.hasExistingSecret ? "Leave blank to keep current value" : undefined}
                          aria-label={`Environment variable value ${index + 1}`}
                          value={variable.value}
                          onChange={(event) => updateEnvironmentVariable(variable.id, { value: event.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Store environment variable ${index + 1} as secret`}
                          checked={variable.secret}
                          onChange={(event) => updateEnvironmentVariable(variable.id, { secret: event.target.checked })}
                        />
                      </td>
                      <td>
                        <button
                          className="table-action"
                          type="button"
                          aria-label={`Delete environment variable ${index + 1}`}
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
          </>
        )}
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
        <legend>Access management</legend>
        <p className="mcp-create-field-copy">Choose how access to this MCP server is managed.</p>
        <div className="mcp-create-choice-list">
          <label className="mcp-create-choice">
            <input
              name="accessManagement"
              type="radio"
              value="hub"
              checked={draft.accessManagement === "hub"}
              onChange={() => setDraft((currentDraft) => ({ ...currentDraft, accessManagement: "hub" }))}
            />
            <span>
              <strong>Hub-managed access (Recommended)</strong>
              <small>Users sign in once. The Hub records each tool&apos;s required permissions and shows the signed-in user&apos;s current access.</small>
            </span>
          </label>
          <label className="mcp-create-choice">
            <input
              name="accessManagement"
              type="radio"
              value="server"
              checked={draft.accessManagement === "server"}
              onChange={() => setDraft((currentDraft) => ({ ...currentDraft, accessManagement: "server" }))}
            />
            <span>
              <strong>Server-managed access</strong>
              <small>Use the MCP server&apos;s existing authentication and permission model.</small>
            </span>
          </label>
        </div>
      </fieldset>

      <fieldset className="mcp-create-fieldset">
        <legend>IAM service account {requiresServiceAccount ? <span aria-label="required">*</span> : null}</legend>
        <p className="mcp-create-field-copy">
          Select a service from{" "}
          <Link
            className="permission-dialog-role-link"
            href={athenzServicesHref}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${hubServiceDomain} services in Athenz`}
          >
            <code>{hubServiceDomain}</code>
            <ExternalLink size={12} aria-hidden="true" />
          </Link>.
        </p>
        <div className="mcp-create-inline-fields">
          <select
            className="filter-select mcp-create-service-account"
            value={draft.hubServiceAccountName}
            aria-label="IAM service account"
            onChange={(event) => setDraft((currentDraft) => ({ ...currentDraft, hubServiceAccountName: event.target.value }))}
          >
            <option value="">
              {serviceAccountsLoading
                ? "Loading service accounts..."
                : serviceAccountError
                  ? "Unable to load service accounts"
                  : serviceAccounts.length === 0
                    ? "No service accounts found"
                    : "Select a service account"}
            </option>
            {(draft.hubServiceAccountName && !serviceAccounts.includes(draft.hubServiceAccountName)
              ? [draft.hubServiceAccountName, ...serviceAccounts]
              : serviceAccounts).map((serviceAccount) => (
              <option value={serviceAccount} key={serviceAccount}>{athenzServiceName(serviceAccount)}</option>
            ))}
          </select>
          <button className="button" type="button" disabled={serviceAccountsLoading} onClick={refreshServiceAccounts}>
            <RefreshCw size={14} />
            {serviceAccountsLoading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        {serviceAccountError ? (
          <p className="mcp-create-service-warning" role="alert">{serviceAccountError}</p>
        ) : null}
        {requiresServiceAccount && !draft.hubServiceAccountName ? (
          <p className="mcp-create-service-warning" role="alert">Hub-managed access requires an IAM service account.</p>
        ) : null}
        <div className="mcp-create-service-actions">
          <button className="button" type="button" disabled>Configure automatic token retrieval</button>
        </div>
      </fieldset>

      <div className="mcp-create-actions">
        <Link className="button" href={cancelHref} style={{ textDecoration: "none" }} onClick={resetDraft}>Cancel</Link>
        <Link className="button" href={sourceHref} style={{ textDecoration: "none" }}>Prev</Link>
        {canContinue ? (
          <Link className="button mcp-create-primary" href={confirmHref}>Next</Link>
        ) : (
          <button className="button" type="button" disabled>Next</button>
        )}
      </div>
    </form>
  )
}
