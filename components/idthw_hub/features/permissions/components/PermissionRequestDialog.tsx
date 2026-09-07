"use client"

import { ChevronDown, ExternalLink, Plus, RefreshCw, ShieldQuestion, Trash2, X } from "lucide-react"
import { useRouter } from "next/navigation"
import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from "react"
import {
  exchangeHelperRequirements,
  exchangePolicyRules,
} from "@/features/permissions/lib/permissionPreset"
import {
  configuredRequirementsFromDraft,
  emptyEditablePermissionRequirement,
  SIGNED_IN_USER_MEMBER,
} from "@/features/permissions/lib/toolPermissionDraft"
import type {
  EditableExchangeHelperRequirement,
  EditableExchangePolicyRule,
  EditablePermissionRequirement,
  PermissionPolicyRequirementCheck,
  PermissionRequirementCheck,
} from "@/features/permissions/types/permissions"

type PageScrollLock = {
  bodyStyle: string | null
  scrollY: number
}

type EditableRequirement = EditablePermissionRequirement

export function PermissionRequestDialog({
  accessAudience,
  configurationMissing = false,
  mcpKeyName,
  policies,
  project,
  requirements,
  servicePrincipal,
  subject,
  toolName,
  triggerLabel = "Request permission",
}: {
  accessAudience?: string
  configurationMissing?: boolean
  mcpKeyName: string
  policies: PermissionPolicyRequirementCheck[]
  project: string
  requirements: PermissionRequirementCheck[]
  servicePrincipal?: string
  subject: string
  toolName: string
  triggerLabel?: string
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const pageScrollLockRef = useRef<PageScrollLock | null>(null)
  const titleId = useId()
  const router = useRouter()
  const [isRefreshing, startRefresh] = useTransition()
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const toolRequirements = requirements.filter(({ source }) => source !== "managed")
  const configuredToolRequirements = requirements.filter(({ source }) => source === "tool")
  const configuredHelperRequirements = requirements.filter(({ source }) => source === "helper")
  const managedRequirements = requirements.filter(({ source }) => source === "managed")
  const toolPolicies = policies.filter(({ source }) => source === "helper")
  const managedPolicies = policies.filter(({ source }) => source === "managed")
  const [draftRequirements, setDraftRequirements] = useState<EditableRequirement[]>(
    () => editableRequirements(
      configuredToolRequirements,
      configuredHelperRequirements,
      toolPolicies,
      servicePrincipal,
    ),
  )
  const permissionsReady = requirements.length > 0
    && [...requirements, ...policies].every(({ status }) => status === "ready")
  const managedDefaultsMissing = [...managedRequirements, ...managedPolicies]
    .some(({ status }) => status === "missing")

  const unlockPageScroll = useCallback(() => {
    const lock = pageScrollLockRef.current
    if (!lock) return

    if (lock.bodyStyle === null) document.body.removeAttribute("style")
    else document.body.setAttribute("style", lock.bodyStyle)
    pageScrollLockRef.current = null
    window.scrollTo(0, lock.scrollY)
  }, [])

  const openDialog = useCallback(() => {
    const dialog = dialogRef.current
    if (!dialog || dialog.open) return

    setIsEditing(false)
    setSaveError(null)
    setDraftRequirements(editableRequirements(
      configuredToolRequirements,
      configuredHelperRequirements,
      toolPolicies,
      servicePrincipal,
    ))
    const scrollY = window.scrollY
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
    const bodyPaddingRight = Number.parseFloat(window.getComputedStyle(document.body).paddingRight) || 0
    pageScrollLockRef.current = {
      bodyStyle: document.body.getAttribute("style"),
      scrollY,
    }
    document.body.style.position = "fixed"
    document.body.style.inset = `-${scrollY}px 0 auto`
    document.body.style.width = "100%"
    document.body.style.overflow = "hidden"
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${bodyPaddingRight + scrollbarWidth}px`
    dialog.showModal()
  }, [
    configuredHelperRequirements,
    configuredToolRequirements,
    servicePrincipal,
    setDraftRequirements,
    toolPolicies,
  ])

  useEffect(() => unlockPageScroll, [unlockPageScroll])

  const beginEditing = () => {
    setSaveError(null)
    const configured = editableRequirements(
      configuredToolRequirements,
      configuredHelperRequirements,
      toolPolicies,
      servicePrincipal,
    )
    setDraftRequirements(configured.length > 0 ? configured : [emptyEditablePermissionRequirement()])
    setIsEditing(true)
  }

  const saveToolPermissions = async () => {
    setSaveError(null)
    const requirements = configuredRequirementsFromDraft(
      draftRequirements,
      Boolean(servicePrincipal),
      servicePrincipal,
    )
    if (draftRequirements.some(({ audience, member, memberType, role }) => (
      !audience.trim() || !role.trim() || (memberType === "service" && !member.trim())
    ))) {
      setSaveError("Complete the audience, required role, and any static service-account member.")
      return
    }
    const invalidHelper = requirements.some((requirement) => requirement.exchangeHelperRequirements
      ?.some(({ label, member, policies, role }) => (
        !label || !member || !role || policies?.some(({ action, resource }) => !action || !resource)
      )))
    if (invalidHelper) {
      setSaveError("Complete the access description, member, role, and any configured policy action and resource for every helper permission.")
      return
    }

    setIsSaving(true)
    try {
      const response = await fetch(
        `/api/mcp-servers/${encodeURIComponent(mcpKeyName)}/permissions?project=${encodeURIComponent(project)}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            toolName,
            requirements,
          }),
        },
      )
      const payload = await response.json() as { error?: unknown }
      if (!response.ok) {
        throw new Error(typeof payload.error === "string" ? payload.error : "Unable to save tool permissions")
      }
      setIsEditing(false)
      startRefresh(() => router.refresh())
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Unable to save tool permissions")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <>
      <button
        className="button permission-request-button"
        type="button"
        aria-haspopup="dialog"
        onClick={openDialog}
      >
        <ShieldQuestion size={14} aria-hidden="true" />
        {triggerLabel}
      </button>

      <dialog
        className="permission-request-dialog"
        ref={dialogRef}
        aria-labelledby={titleId}
        onClose={unlockPageScroll}
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close()
        }}
      >
        <div className="permission-dialog-card">
          <div className="permission-dialog-head">
            <div>
              <span>{configurationMissing ? "Permission configuration" : permissionsReady ? "Permission details" : "Permission request"}</span>
              <h3 id={titleId}>{subject}</h3>
            </div>
            <form method="dialog">
              <button className="permission-dialog-close" type="submit" aria-label="Close permission dialog">
                <X size={18} aria-hidden="true" />
              </button>
            </form>
          </div>

          <p className="permission-dialog-copy">
            Tool permissions define downstream access for this operation. Saving a signed-in-user audience also updates the Hub-managed source-exchange policy, but does not add downstream role members.
          </p>

          <PermissionSection
            description="Start with the required audience and role. The generated exchange permissions are required for delegated access and remain editable per direct access."
            eyebrow="Custom access"
            title="Tool permissions"
          >
            {isEditing ? (
              <PermissionEditor
                accessAudience={accessAudience}
                requirements={draftRequirements}
                servicePrincipal={servicePrincipal}
                setRequirements={setDraftRequirements}
              />
            ) : toolRequirements.length > 0 || toolPolicies.length > 0 ? (
              <PermissionTable policies={toolPolicies} requirements={toolRequirements} />
            ) : (
              <div className="permission-dialog-empty neutral">
                <strong>No tool permissions configured</strong>
                <p>Add the downstream user or service-account roles required by this tool.</p>
              </div>
            )}
            {saveError ? <p className="permission-dialog-save-error" role="alert">{saveError}</p> : null}
          </PermissionSection>

          <PermissionSection
            collapsible
            defaultExpanded={managedDefaultsMissing}
            description="Default server-access roles generated from this MCP server's Hub-managed access configuration."
            eyebrow="Managed defaults"
            title="MCP access"
          >
            {managedRequirements.length > 0 ? (
              <PermissionTable policies={managedPolicies} requirements={managedRequirements} />
            ) : (
              <div className="permission-dialog-empty neutral">
                <strong>No Hub-managed MCP access</strong>
                <p>This server does not currently publish a managed MCP access scope.</p>
              </div>
            )}
          </PermissionSection>

          <div className="permission-dialog-actions">
            <form method="dialog">
              <button className="button" type="submit">Close</button>
            </form>
            <button
              className="button"
              type="button"
              disabled={isRefreshing || isSaving}
              onClick={() => startRefresh(() => router.refresh())}
            >
              <RefreshCw className={isRefreshing ? "permission-refresh-icon spinning" : "permission-refresh-icon"} size={14} aria-hidden="true" />
              {isRefreshing ? "Refreshing..." : "Refresh permissions"}
            </button>
            {isEditing ? (
              <>
                <button
                  className="button"
                  type="button"
                  disabled={isSaving}
                  onClick={() => {
                    setIsEditing(false)
                    setSaveError(null)
                  }}
                >
                  Cancel
                </button>
                <button className="button primary" type="button" disabled={isSaving} onClick={saveToolPermissions}>
                  {isSaving ? "Saving..." : "Save tool permissions"}
                </button>
              </>
            ) : (
              <button className="button primary" type="button" onClick={beginEditing}>Edit tool permissions</button>
            )}
          </div>
        </div>
      </dialog>
    </>
  )
}

function PermissionSection({
  children,
  collapsible = false,
  defaultExpanded = false,
  description,
  eyebrow,
  title,
}: {
  children: ReactNode
  collapsible?: boolean
  defaultExpanded?: boolean
  description: string
  eyebrow: string
  title: string
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)

  if (collapsible) {
    return (
      <details
        className="permission-dialog-section permission-dialog-section-collapsible"
        open={isExpanded}
        onToggle={(event) => setIsExpanded(event.currentTarget.open)}
      >
        <summary className="permission-dialog-section-head permission-dialog-section-summary">
          <div>
            <span>{eyebrow}</span>
            <h4>{title}</h4>
          </div>
          <p>{description}</p>
          <ChevronDown className="permission-dialog-section-chevron" size={16} aria-hidden="true" />
        </summary>
        <div className="permission-dialog-requirements">{children}</div>
      </details>
    )
  }

  return (
    <section className="permission-dialog-section">
      <div className="permission-dialog-section-head">
        <div>
          <span>{eyebrow}</span>
          <h4>{title}</h4>
        </div>
        <p>{description}</p>
      </div>
      <div className="permission-dialog-requirements">{children}</div>
    </section>
  )
}

function PermissionTable({
  policies,
  requirements,
}: {
  policies: PermissionPolicyRequirementCheck[]
  requirements: PermissionRequirementCheck[]
}) {
  const policiesByRole = new Map<string, PermissionPolicyRequirementCheck[]>()
  for (const policy of policies) {
    policiesByRole.set(policy.role, [...(policiesByRole.get(policy.role) ?? []), policy])
  }

  return (
    <table className="permission-dialog-table">
      <thead>
        <tr>
          <th scope="col">Required access</th>
          <th scope="col">Status</th>
          <th scope="col">Member</th>
          <th scope="col">Role</th>
          <th scope="col">Action</th>
          <th scope="col">Resource</th>
        </tr>
      </thead>
      <tbody>
        {requirements.map((requirement) => {
          const matchingPolicies = policiesByRole.get(requirement.role) ?? []
          const rowStatus = combinedPermissionStatus(requirement.status, matchingPolicies)
          const membershipMissing = requirement.status === "missing"

          return (
            <tr
              className={requirement.source === "helper" ? "permission-dialog-helper-row" : undefined}
              data-status={rowStatus}
              key={`${requirement.source}:${requirement.toolRequirementIndex ?? "managed"}:${requirement.member}:${requirement.role}`}
            >
              <td>
                {requirement.source === "helper" ? (
                  <span className="permission-helper-badge">Helper</span>
                ) : requirement.source === "tool" ? (
                  <span className="permission-direct-badge">Direct access</span>
                ) : null}
                {requirement.label}
              </td>
              <td>
                <span className="permission-dialog-status" data-status={rowStatus}>
                  {combinedStatusLabel(requirement.status, matchingPolicies)}
                </span>
              </td>
              <td className={membershipMissing ? "permission-dialog-missing-value" : undefined}>
                <code>{requirement.member}</code>
              </td>
              <td className={membershipMissing ? "permission-dialog-missing-value" : undefined}>
                <a
                  className="permission-dialog-role-link"
                  href={requirement.roleUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open ${requirement.role} in Athenz`}
                >
                  <code>{requirement.role}</code>
                  <ExternalLink size={12} aria-hidden="true" />
                </a>
              </td>
              {matchingPolicies.length > 0 ? (
                <>
                  <td>
                    <div className="permission-dialog-rule-values">
                      {matchingPolicies.map((policy) => (
                        <code
                          className={policy.status === "missing" ? "permission-dialog-missing-value" : undefined}
                          key={`${policy.action}:${policy.resource}`}
                        >
                          {policy.action}
                        </code>
                      ))}
                    </div>
                  </td>
                  <td>
                    <div className="permission-dialog-rule-values">
                      {matchingPolicies.map((policy) => (
                        <code
                          className={policy.status === "missing" ? "permission-dialog-missing-value" : undefined}
                          key={`${policy.action}:${policy.resource}`}
                        >
                          {policy.resource}
                        </code>
                      ))}
                    </div>
                  </td>
                </>
              ) : (
                <>
                  <td className="permission-dialog-empty-value">—</td>
                  <td className="permission-dialog-empty-value">—</td>
                </>
              )}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function combinedPermissionStatus(
  membershipStatus: PermissionRequirementCheck["status"],
  policies: PermissionPolicyRequirementCheck[],
) {
  if (membershipStatus === "missing" || policies.some(({ status }) => status === "missing")) return "missing"
  if (membershipStatus === "unavailable" || policies.some(({ status }) => status === "unavailable")) return "unavailable"
  return "ready"
}

function combinedStatusLabel(
  membershipStatus: PermissionRequirementCheck["status"],
  policies: PermissionPolicyRequirementCheck[],
) {
  if (policies.length === 0) return statusLabel(membershipStatus)
  const policyMissing = policies.some(({ status }) => status === "missing")
  if (membershipStatus === "missing" && policyMissing) return "Membership and policy missing"
  if (membershipStatus === "missing") return "Membership missing"
  if (policyMissing) return "Policy missing"
  return statusLabel(combinedPermissionStatus(membershipStatus, policies))
}

function statusLabel(status: PermissionRequirementCheck["status"]) {
  return status === "ready" ? "Available" : status === "missing" ? "Not available" : "Could not verify"
}

export function PermissionEditor({
  accessAudience,
  helperPreviewServicePrincipal,
  requirements,
  servicePrincipal,
  setRequirements,
}: {
  accessAudience?: string
  helperPreviewServicePrincipal?: string
  requirements: EditableRequirement[]
  servicePrincipal?: string
  setRequirements: Dispatch<SetStateAction<EditableRequirement[]>>
}) {
  const update = (index: number, values: Partial<EditableRequirement>) => {
    setRequirements((current) => current.map((requirement, currentIndex) => (
      currentIndex === index ? { ...requirement, ...values } : requirement
    )))
  }

  return (
    <div className="permission-editor">
      {requirements.map((requirement, requirementIndex) => (
        <div className="permission-editor-group" key={requirementIndex}>
          <div className="permission-editor-row">
            <label className="permission-editor-field">
              <span>Audience (Athenz domain)</span>
              <input
                required
                autoComplete="off"
                value={requirement.audience}
                placeholder="api"
                onChange={(event) => update(requirementIndex, { audience: event.target.value })}
              />
            </label>
            <label className="permission-editor-field permission-editor-role-field">
              <span>Required role</span>
              <input
                required
                autoComplete="off"
                value={requirement.role}
                placeholder="docs-getter"
                onChange={(event) => update(requirementIndex, { role: event.target.value })}
              />
            </label>
            <label className="permission-editor-field permission-editor-label-field">
              <span>Description (optional)</span>
              <input
                autoComplete="off"
                value={requirement.label}
                placeholder="Signed-in user can call the downstream API"
                onChange={(event) => update(requirementIndex, { label: event.target.value })}
              />
            </label>
            <label className="permission-editor-field">
              <span>Member type</span>
              <select
                value={requirement.memberType}
                onChange={(event) => {
                  const memberType = event.target.value as EditableRequirement["memberType"]
                  update(requirementIndex, {
                    exchangeHelpersCustomized: false,
                    helperRequirements: [],
                    member: memberType === "signed-in-user" ? SIGNED_IN_USER_MEMBER : "",
                    memberType,
                  })
                }}
              >
                <option value="signed-in-user">Signed-in user</option>
                <option value="service">Static service account</option>
              </select>
            </label>
            <label className="permission-editor-field">
              <span>Member</span>
              {requirement.memberType === "signed-in-user" ? (
                <input disabled value="Current signed-in user" />
              ) : (
                <input
                  required
                  autoComplete="off"
                  value={requirement.member}
                  placeholder="domain.service"
                  onChange={(event) => update(requirementIndex, { member: event.target.value })}
                />
              )}
            </label>
            <button
              className="permission-editor-remove"
              type="button"
              aria-label={`Remove permission ${requirementIndex + 1}`}
              onClick={() => setRequirements((current) => (
                current.filter((_, currentIndex) => currentIndex !== requirementIndex)
              ))}
            >
              <Trash2 size={15} aria-hidden="true" />
            </button>
          </div>
          {requirement.memberType === "signed-in-user" ? (
            <ExchangeHelperEditor
              accessAudience={accessAudience}
              helperPreviewServicePrincipal={helperPreviewServicePrincipal}
              requirement={requirement}
              requirementIndex={requirementIndex}
              servicePrincipal={servicePrincipal}
              setRequirements={setRequirements}
            />
          ) : null}
        </div>
      ))}
      <button
        className="permission-inline-add permission-editor-add"
        type="button"
        onClick={() => setRequirements((current) => [...current, emptyEditablePermissionRequirement()])}
      >
        <Plus size={12} aria-hidden="true" />
        Add permission
      </button>
    </div>
  )
}

function ExchangeHelperEditor({
  accessAudience,
  helperPreviewServicePrincipal,
  requirement,
  requirementIndex,
  servicePrincipal,
  setRequirements,
}: {
  accessAudience?: string
  helperPreviewServicePrincipal?: string
  requirement: EditableRequirement
  requirementIndex: number
  servicePrincipal?: string
  setRequirements: Dispatch<SetStateAction<EditableRequirement[]>>
}) {
  const directRoleConfigured = Boolean(requirement.audience.trim() && requirement.role.trim())
  const directRoleWasConfiguredOnMount = useRef(directRoleConfigured)
  const hasAutoExpanded = useRef(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const effectiveServicePrincipal = servicePrincipal ?? helperPreviewServicePrincipal
  const templateMcpBinding = Boolean(
    !servicePrincipal && helperPreviewServicePrincipal && !requirement.exchangeHelpersCustomized,
  )
  const derivedHelperRequirements = previewExchangeHelperRequirements(
    requirement,
    effectiveServicePrincipal,
    accessAudience,
  )
  const displayedHelperRequirements = requirement.exchangeHelpersCustomized
    ? requirement.helperRequirements
    : derivedHelperRequirements
  const helperRoleCount = displayedHelperRequirements.filter((helper) => helper.role.trim()).length
  const helperPolicyCount = displayedHelperRequirements.reduce(
    (count, helper) => count + helper.policies.filter((policy) => (
      policy.action.trim() && policy.resource.trim()
    )).length,
    0,
  )
  const helperCountLabel = [
    helperRoleCount > 0 ? `${helperRoleCount} ${helperRoleCount === 1 ? "Role" : "Roles"}` : "",
    helperPolicyCount > 0 ? `${helperPolicyCount} ${helperPolicyCount === 1 ? "Policy" : "Policies"}` : "",
  ].filter(Boolean).join(" & ")
  const updateRequirement = (values: Partial<EditableRequirement>) => {
    setRequirements((current) => current.map((item, index) => (
      index === requirementIndex ? { ...item, ...values } : item
    )))
  }
  const updateHelper = (helperIndex: number, values: Partial<EditableExchangeHelperRequirement>) => {
    updateRequirement({
      exchangeHelpersCustomized: true,
      helperRequirements: displayedHelperRequirements.map((helper, index) => (
        index === helperIndex ? { ...helper, ...values } : helper
      )),
    })
  }
  const updateHelperPolicy = (
    helperIndex: number,
    policyIndex: number,
    values: Partial<EditableExchangePolicyRule>,
  ) => {
    const helper = displayedHelperRequirements[helperIndex]
    updateHelper(helperIndex, {
      policies: helper.policies.map((policy, index) => (
        index === policyIndex ? { ...policy, ...values } : policy
      )),
    })
  }
  const removeHelperPolicy = (helperIndex: number, policyIndex: number) => {
    const helper = displayedHelperRequirements[helperIndex]
    updateHelper(helperIndex, {
      policies: helper.policies.filter((_, index) => index !== policyIndex),
    })
  }
  const addHelperPolicy = (helperIndex: number) => {
    const helper = displayedHelperRequirements[helperIndex]
    updateHelper(helperIndex, {
      policies: [...helper.policies, emptyExchangePolicy()],
    })
  }
  const removeHelper = (helperIndex: number) => {
    updateRequirement({
      exchangeHelpersCustomized: true,
      helperRequirements: displayedHelperRequirements.filter((_, index) => index !== helperIndex),
    })
  }
  const addHelper = () => {
    updateRequirement({
      exchangeHelpersCustomized: true,
      helperRequirements: [...displayedHelperRequirements, emptyHelperRequirement()],
    })
  }

  useEffect(() => {
    if (
      !directRoleWasConfiguredOnMount.current
      && directRoleConfigured
      && !hasAutoExpanded.current
    ) {
      hasAutoExpanded.current = true
      setIsExpanded(true)
    }
  }, [directRoleConfigured])

  return (
    <details
      className="permission-helper-settings"
      open={isExpanded}
      onToggle={(event) => setIsExpanded(event.currentTarget.open)}
    >
      <summary className="permission-helper-summary">
        <span className="permission-helper-heading">
          <strong>
            Token-exchange helper permissions{helperCountLabel ? ` (${helperCountLabel})` : ""}
          </strong>
        </span>
        <span className="permission-helper-toggle-label">
          <span className="permission-helper-expand-label">Expand helper permissions</span>
          <span className="permission-helper-collapse-label">Collapse helper permissions</span>
        </span>
        <ChevronDown className="permission-helper-chevron" size={15} aria-hidden="true" />
      </summary>
      <p className="permission-helper-description">{templateMcpBinding
        ? "Generated from the direct role. The MCP IAM account is resolved during server creation."
        : "Each indented helper keeps its role membership and optional exchange policy together."}</p>
      {!effectiveServicePrincipal ? (
        <p className="permission-helper-note">Helpers require a Hub-managed MCP IAM account.</p>
      ) : (
        <div className="permission-helper-preview">
          {displayedHelperRequirements.map((helper, helperIndex) => (
            <div className="permission-helper-preview-row" key={helperIndex}>
              <div className="permission-helper-membership-row">
                <label className="permission-editor-field">
                  <span>Required access</span>
                  <input
                    required
                    autoComplete="off"
                    value={helper.label}
                    onChange={(event) => updateHelper(helperIndex, { label: event.target.value })}
                  />
                </label>
                <label className="permission-editor-field">
                  <span>Member type</span>
                  <select
                    value={helper.memberType}
                    onChange={(event) => {
                      const memberType = event.target.value as EditableExchangeHelperRequirement["memberType"]
                      updateHelper(helperIndex, {
                        member: helperMember(memberType, effectiveServicePrincipal),
                        memberType,
                      })
                    }}
                  >
                    <option value="gateway">MCP Gateway service</option>
                    <option value="mcp-service">MCP IAM account</option>
                    <option value="custom">Custom service account</option>
                  </select>
                </label>
                <label className="permission-editor-field">
                  <span>Member</span>
                  <input
                    required
                    autoComplete="off"
                    disabled={helper.memberType !== "custom"}
                    value={!servicePrincipal
                      && helper.memberType === "mcp-service"
                      && helper.member === helperPreviewServicePrincipal
                      ? "Selected during MCP server creation"
                      : helper.member}
                    placeholder="domain.service"
                    onChange={(event) => updateHelper(helperIndex, { member: event.target.value })}
                  />
                </label>
                <label className="permission-editor-field">
                  <span>Role</span>
                  <input
                    required
                    autoComplete="off"
                    value={helper.role}
                    onChange={(event) => updateHelper(helperIndex, { role: event.target.value })}
                  />
                </label>
                <button
                  className="permission-editor-remove"
                  type="button"
                  aria-label={`Remove helper permission ${helperIndex + 1}`}
                  onClick={() => removeHelper(helperIndex)}
                >
                  <Trash2 size={15} aria-hidden="true" />
                </button>
              </div>
              {helper.policies.map((policy, policyIndex) => (
                <div className="permission-helper-policy-row" key={policyIndex}>
                  <span className="permission-helper-row-label">Policy</span>
                  <label className="permission-editor-field permission-helper-effect-field">
                    <span>Effect</span>
                    <select
                      value={policy.effect}
                      onChange={(event) => updateHelperPolicy(helperIndex, policyIndex, {
                        effect: event.target.value as EditableExchangePolicyRule["effect"],
                      })}
                    >
                      <option value="ALLOW">Allow</option>
                      <option value="DENY">Deny</option>
                    </select>
                  </label>
                  <label className="permission-editor-field">
                    <span>Action</span>
                    <input
                      required
                      autoComplete="off"
                      value={policy.action}
                      placeholder="zts.jag_exchange"
                      onChange={(event) => updateHelperPolicy(helperIndex, policyIndex, { action: event.target.value })}
                    />
                  </label>
                  <label className="permission-editor-field permission-helper-resource-field">
                    <span>Resource</span>
                    <input
                      required
                      autoComplete="off"
                      value={policy.resource}
                      placeholder="domain:role.role-name"
                      onChange={(event) => updateHelperPolicy(helperIndex, policyIndex, { resource: event.target.value })}
                    />
                  </label>
                  <button
                    className="permission-editor-remove"
                    type="button"
                    aria-label={`Remove policy ${policyIndex + 1} from helper ${helperIndex + 1}`}
                    onClick={() => removeHelperPolicy(helperIndex, policyIndex)}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                </div>
              ))}
              <div className="permission-helper-policy-actions">
                <button
                  className="permission-inline-add"
                  type="button"
                  onClick={() => addHelperPolicy(helperIndex)}
                >
                  <Plus size={12} aria-hidden="true" />
                  Add policy
                </button>
              </div>
            </div>
          ))}
          <div className="permission-helper-actions">
            <button className="permission-inline-add permission-helper-add" type="button" onClick={addHelper}>
              <Plus size={12} aria-hidden="true" />
              Add helper permission
            </button>
            {displayedHelperRequirements.length === 0 ? (
              <button
                className="button permission-helper-reset"
                type="button"
                disabled={derivedHelperRequirements.length === 0}
                onClick={() => updateRequirement({
                  exchangeHelpersCustomized: false,
                  helperRequirements: derivedHelperRequirements,
                })}
              >
                Generate default helpers
              </button>
            ) : requirement.exchangeHelpersCustomized ? (
              <button
                className="button permission-helper-reset"
                type="button"
                disabled={derivedHelperRequirements.length === 0}
                onClick={() => updateRequirement({
                  exchangeHelpersCustomized: false,
                  helperRequirements: derivedHelperRequirements,
                })}
              >
                Reset to defaults
              </button>
            ) : null}
          </div>
        </div>
      )}
    </details>
  )
}

function previewExchangeHelperRequirements(
  requirement: EditableRequirement,
  servicePrincipal?: string,
  sourceAudience?: string,
) {
  if (!servicePrincipal || !sourceAudience) return []
  try {
    const targetRole = configuredRole(requirement.audience, requirement.role)
    const policiesByRole = new Map<string, EditableExchangePolicyRule[]>()
    for (const policy of exchangePolicyRules(targetRole, sourceAudience)) {
      policiesByRole.set(policy.role, [
        ...(policiesByRole.get(policy.role) ?? []),
        { action: policy.action, effect: policy.effect, resource: policy.resource },
      ])
    }
    return exchangeHelperRequirements(
      [{
        label: requirement.label || "Required role membership",
        member: SIGNED_IN_USER_MEMBER,
        role: targetRole,
      }],
      servicePrincipal,
    ).map((helper) => {
      return {
        ...helper,
        memberType: helperMemberType(helper.member, servicePrincipal),
        policies: policiesByRole.get(helper.role) ?? [],
      }
    })
  } catch {
    return []
  }
}

function editableRequirements(
  requirements: PermissionRequirementCheck[],
  helperRequirements: PermissionRequirementCheck[],
  helperPolicies: PermissionPolicyRequirementCheck[],
  servicePrincipal?: string,
): EditableRequirement[] {
  return requirements.map((requirement, index) => {
    const parsedRole = editableRole(requirement.role)
    const toolRequirementIndex = requirement.toolRequirementIndex ?? index
    return {
      audience: parsedRole.audience,
      exchangeHelpersCustomized: requirement.exchangeHelpersCustomized === true
        || requirement.includeExchangeHelpers === false,
      helperRequirements: helperRequirements
        .filter((helper) => helper.toolRequirementIndex === toolRequirementIndex)
        .map(({ exchangePolicies, label, member, role }) => {
          const checkedPolicies = helperPolicies.filter((policy) => (
            policy.toolRequirementIndex === toolRequirementIndex && policy.role === role
          ))
          return {
            label,
            member,
            memberType: helperMemberType(member, servicePrincipal),
            policies: (checkedPolicies.length > 0 ? checkedPolicies : exchangePolicies ?? [])
              .map(({ action, effect, resource }) => ({ action, effect, resource })),
            role,
          }
        }),
      label: requirement.label,
      member: requirement.configuredMember,
      memberType: requirement.configuredMember === SIGNED_IN_USER_MEMBER ? "signed-in-user" : "service",
      role: parsedRole.role,
    }
  })
}

function helperMemberType(
  member: string,
  servicePrincipal?: string,
): EditableExchangeHelperRequirement["memberType"] {
  if (member === "mcp-hub.mcp-gateway") return "gateway"
  if (servicePrincipal && member === servicePrincipal) return "mcp-service"
  return "custom"
}

function helperMember(
  memberType: EditableExchangeHelperRequirement["memberType"],
  servicePrincipal?: string,
) {
  if (memberType === "gateway") return "mcp-hub.mcp-gateway"
  if (memberType === "mcp-service") return servicePrincipal ?? ""
  return ""
}

function emptyHelperRequirement(): EditableExchangeHelperRequirement {
  return {
    label: "",
    member: "",
    memberType: "custom",
    policies: [emptyExchangePolicy()],
    role: "",
  }
}

function emptyExchangePolicy(): EditableExchangePolicyRule {
  return {
    action: "",
    effect: "ALLOW",
    resource: "",
  }
}

function configuredRole(audience: string, role: string) {
  return `${audience.trim()}:role.${role.trim()}`
}

function editableRole(role: string) {
  const marker = ":role."
  const markerIndex = role.indexOf(marker)
  return markerIndex > 0
    ? { audience: role.slice(0, markerIndex), role: role.slice(markerIndex + marker.length) }
    : { audience: "", role }
}
