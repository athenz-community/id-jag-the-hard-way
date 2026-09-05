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
}: {
  project: string
  athenzServicesHref: string
  cancelHref: string
  sourceHref: string
  confirmHref: string
}) {
  const { draft, setDraft, resetDraft } = useMcpCreateDraft()
  const hubServiceDomain = `mcp-hub.mcps.${project}`
  const requiresServiceAccount = draft.accessManagement === "hub"
  const canContinue = !requiresServiceAccount || Boolean(draft.hubServiceAccountName)
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
      setDraft((currentDraft) => services.includes(currentDraft.hubServiceAccountName)
        ? currentDraft
        : { ...currentDraft, hubServiceAccountName: "" })
    } catch (error) {
      setServiceAccountError(error instanceof Error ? error.message : "Unable to load service accounts")
    } finally {
      setServiceAccountsLoading(false)
    }
  }, [project, setDraft])

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
        variable.id === id ? { ...variable, ...update } : variable
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

  function deleteEnvironmentVariable(id: number) {
    setDraft((currentDraft) => ({
      ...currentDraft,
      environmentVariables: currentDraft.environmentVariables.filter((variable) => variable.id !== id),
    }))
  }

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
        <legend>Environment variables</legend>
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
            {serviceAccounts.map((serviceAccount) => (
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
