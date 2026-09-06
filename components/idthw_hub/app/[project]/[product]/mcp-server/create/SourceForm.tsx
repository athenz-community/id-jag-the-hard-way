"use client"

import Link from "next/link"
import { useCallback, useEffect, useRef, useState } from "react"
import type { McpTemplateDetailResponse, McpTemplateSummary } from "@/features/mcp-templates/types"
import { ContainerArgumentsField } from "@/features/registration/components/ContainerArgumentsField"
import { ContainerImageField } from "./ContainerImageField"
import { useMcpCreateDraft } from "./McpCreateDraftContext"

export function SourceForm({
  project,
  templates,
  templateListError,
  initialTemplateKey,
  cancelHref,
  configurationHref,
}: {
  project: string
  templates: McpTemplateSummary[]
  templateListError?: string
  initialTemplateKey?: string
  cancelHref: string
  configurationHref: string
}) {
  const { draft, setDraft, resetDraft } = useMcpCreateDraft()
  const [templateError, setTemplateError] = useState(templateListError ?? "")
  const [templateLoading, setTemplateLoading] = useState(false)
  const initializedFromTemplateAction = useRef(false)
  const usesTemplate = draft.creationMethod === "template"
  const canContinue = !usesTemplate || Boolean(draft.selectedTemplate)

  const loadTemplate = useCallback(async (templateKey: string) => {
    setTemplateLoading(true)
    setTemplateError("")
    try {
      const response = await fetch(
        `/api/mcp-templates/${encodeURIComponent(templateKey)}?project=${encodeURIComponent(project)}`,
        { cache: "no-store" },
      )
      const payload = await response.json() as McpTemplateDetailResponse
      if (!response.ok || !payload.template) {
        throw new Error(payload.error ?? "Unable to load MCP template")
      }

      const template = payload.template
      setDraft((currentDraft) => {
        if (currentDraft.selectedTemplateKey !== templateKey) return currentDraft
        return {
          ...currentDraft,
          iconId: template.iconId,
          selectedTemplate: template,
          templateEnvironmentVariables: template.environmentVariables.map((variable, index) => ({
            id: index + 1,
            key: variable.key,
            description: variable.description,
            required: variable.required,
            secret: variable.secret,
            value: variable.secret ? "" : variable.defaultValue ?? "",
          })),
        }
      })
    } catch (error) {
      setTemplateError(error instanceof Error ? error.message : "Unable to load MCP template")
      setDraft((currentDraft) => currentDraft.selectedTemplateKey === templateKey
        ? { ...currentDraft, iconId: "", selectedTemplateKey: "", selectedTemplate: null, templateEnvironmentVariables: [] }
        : currentDraft)
    } finally {
      setTemplateLoading(false)
    }
  }, [project, setDraft])

  useEffect(() => {
    if (initializedFromTemplateAction.current || !initialTemplateKey) return
    initializedFromTemplateAction.current = true

    setDraft((currentDraft) => ({
      ...currentDraft,
      creationMethod: "template",
      iconId: "",
      selectedTemplateKey: initialTemplateKey,
      selectedTemplate: null,
      templateEnvironmentVariables: [],
    }))
    void loadTemplate(initialTemplateKey)
  }, [initialTemplateKey, loadTemplate, setDraft])

  function selectCreationMethod(creationMethod: "direct" | "template") {
    setTemplateError(templateListError ?? "")
    setDraft((currentDraft) => ({
      ...currentDraft,
      creationMethod,
      visibility: creationMethod === "direct" ? "personal" : currentDraft.visibility,
    }))
  }

  function selectTemplate(templateKey: string) {
    setDraft((currentDraft) => ({
      ...currentDraft,
      iconId: "",
      selectedTemplateKey: templateKey,
      selectedTemplate: null,
      templateEnvironmentVariables: [],
    }))
    if (templateKey) void loadTemplate(templateKey)
  }

  return (
    <form className="mcp-create-form">
      <fieldset className="mcp-create-fieldset">
        <legend>Creation method <span aria-label="required">*</span></legend>
        <div className="mcp-create-choice-list">
          <label className="mcp-create-choice">
            <input
              name="creation-method"
              type="radio"
              value="mcp-template"
              checked={usesTemplate}
              onChange={() => selectCreationMethod("template")}
            />
            <span>
              <strong>MCP template</strong>
              <small>Create an MCP server from a template registered in this project.</small>
            </span>
          </label>
          <label className="mcp-create-choice">
            <input
              name="creation-method"
              type="radio"
              value="direct-setup"
              checked={!usesTemplate}
              onChange={() => selectCreationMethod("direct")}
            />
            <span>
              <strong>Direct setup</strong>
              <small>Create an MCP server without a template. For development or testing purposes.</small>
            </span>
          </label>
          <label className="mcp-create-choice disabled">
            <input name="creation-method" type="radio" value="openapi-spec" disabled />
            <span>
              <strong>OpenAPI spec</strong>
              <small>Convert an existing REST API into MCP tools from an OpenAPI specification.</small>
            </span>
          </label>
        </div>
      </fieldset>

      {usesTemplate ? (
        <>
          <div className="mcp-create-field">
            <label htmlFor="mcp-template">MCP template name <span aria-label="required">*</span></label>
            <p>Select a project template to create an MCP server.</p>
            <select
              id="mcp-template"
              className="filter-select"
              value={draft.selectedTemplateKey}
              disabled={templateLoading}
              onChange={(event) => selectTemplate(event.target.value)}
            >
              <option value="">
                {templates.length === 0 ? "No MCP templates found" : "Select an MCP template"}
              </option>
              {templates.map((template) => (
                <option value={template.key} key={template.key}>{template.name}</option>
              ))}
            </select>
            {templateLoading ? <p className="mcp-create-field-status" role="status">Loading template...</p> : null}
            {templateError ? <p className="mcp-create-service-warning" role="alert">{templateError}</p> : null}
            {draft.selectedTemplate ? (
              <div className="mcp-create-template-summary">
                <strong>{draft.selectedTemplate.name}</strong>
                <span>{draft.selectedTemplate.description || "No description provided."}</span>
                <code>{draft.selectedTemplate.templateKey}</code>
              </div>
            ) : null}
          </div>

          {draft.selectedTemplate ? (
            <div className="mcp-template-source-preview">
              <fieldset className="mcp-create-fieldset">
                <legend>Source</legend>
                <div className="mcp-create-choice-list">
                  <label className="mcp-create-choice source-choice disabled">
                    <input type="radio" checked disabled readOnly />
                    <span>
                      <strong>Container registry</strong>
                      <small>Defined by the selected MCP template.</small>
                    </span>
                  </label>
                </div>
              </fieldset>

              <div className="mcp-create-field">
                <label htmlFor="mcp-template-image">Container image URL</label>
                <p>Defined by the selected MCP template.</p>
                <input
                  id="mcp-template-image"
                  className="filter-select mcp-template-key-readonly"
                  value={draft.selectedTemplate.image}
                  readOnly
                />
              </div>

              <div className="mcp-create-field">
                <label htmlFor="mcp-template-port">Target port</label>
                <p>Defined by the selected MCP template.</p>
                <input
                  id="mcp-template-port"
                  className="filter-select mcp-template-key-readonly"
                  type="number"
                  value={draft.selectedTemplate.port}
                  readOnly
                />
              </div>

              <fieldset className="mcp-create-fieldset">
                <legend>Protocol</legend>
                <div className="mcp-create-choice-list">
                  <label className="mcp-create-choice disabled">
                    <input type="radio" checked disabled readOnly />
                    <span>
                      <strong>Streamable HTTP</strong>
                      <small>Defined by the selected MCP template.</small>
                    </span>
                  </label>
                </div>
              </fieldset>

              <details className="mcp-create-additional" open>
                <summary>Additional settings</summary>
                <div className="mcp-create-field">
                  <label htmlFor="mcp-template-path">Path</label>
                  <input
                    id="mcp-template-path"
                    className="filter-select mcp-template-key-readonly"
                    value={draft.selectedTemplate.path}
                    readOnly
                  />
                </div>
                <div className="mcp-create-field">
                  <label htmlFor="mcp-template-command">Container command</label>
                  <p>Defined by the selected MCP template.</p>
                  <input
                    id="mcp-template-command"
                    className="filter-select mcp-template-key-readonly"
                    value={draft.selectedTemplate.command}
                    placeholder="Not provided"
                    readOnly
                  />
                </div>
                <div className="mcp-create-field">
                  <label htmlFor="mcp-template-arguments">Container arguments</label>
                  <p>Defined by the selected MCP template.</p>
                  <textarea
                    id="mcp-template-arguments"
                    className="filter-select mcp-create-arguments-textarea mcp-template-key-readonly"
                    rows={7}
                    value={draft.selectedTemplate.arguments.join("\n")}
                    placeholder="Not provided"
                    readOnly
                  />
                </div>
              </details>
            </div>
          ) : null}
        </>
      ) : (
        <>
          <fieldset className="mcp-create-fieldset">
            <legend>Source <span aria-label="required">*</span></legend>
            <div className="mcp-create-choice-list">
              <label className="mcp-create-choice source-choice">
                <input name="source" type="radio" value="container-registry" defaultChecked />
                <span>
                  <strong>Container registry</strong>
                  <small>Specify the container image stored in your container registry.</small>
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
            <legend>Protocol <span aria-label="required">*</span></legend>
            <div className="mcp-create-choice-list">
              <label className="mcp-create-choice">
                <input name="protocol" type="radio" value="streamable-http" defaultChecked />
                <span>
                  <strong>Streamable HTTP</strong>
                  <small>Stream data over standard HTTP with flexible formats such as JSON or logs.</small>
                </span>
              </label>
              <label className="mcp-create-choice disabled">
                <input name="protocol" type="radio" value="sse" disabled />
                <span>
                  <strong>SSE (Server-Sent Events)</strong>
                  <small>Receive real-time event streams over a browser-friendly, one-way connection.</small>
                </span>
              </label>
            </div>
          </fieldset>

          <details className="mcp-create-additional">
            <summary>Additional setting</summary>
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
              <p>Enter a command or leave blank to use the entry point set in the container image.</p>
              <input
                id="mcp-command"
                className="filter-select"
                name="command"
                placeholder="e.g. /bin/server"
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
        </>
      )}

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
