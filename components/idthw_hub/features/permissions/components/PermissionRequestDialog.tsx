"use client"

import { ExternalLink, Plus, RefreshCw, ShieldQuestion, Trash2, X } from "lucide-react"
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
import type { PermissionRequirementCheck } from "@/features/permissions/types/permissions"

const SIGNED_IN_USER_MEMBER = "<signed_in_user>"

type PageScrollLock = {
  bodyStyle: string | null
  scrollY: number
}

type EditableRequirement = {
  label: string
  member: string
  memberType: "service" | "signed-in-user"
  role: string
}

export function PermissionRequestDialog({
  configurationMissing = false,
  mcpKeyName,
  project,
  requirements,
  subject,
  toolName,
  triggerLabel = "Request permission",
}: {
  configurationMissing?: boolean
  mcpKeyName: string
  project: string
  requirements: PermissionRequirementCheck[]
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
  const toolRequirements = requirements.filter(({ source }) => source === "tool")
  const managedRequirements = requirements.filter(({ source }) => source === "managed")
  const [draftRequirements, setDraftRequirements] = useState<EditableRequirement[]>(
    () => editableRequirements(toolRequirements),
  )
  const permissionsReady = requirements.length > 0 && requirements.every(({ status }) => status === "ready")

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
    setDraftRequirements(editableRequirements(toolRequirements))
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
  }, [toolRequirements])

  useEffect(() => unlockPageScroll, [unlockPageScroll])

  const beginEditing = () => {
    setSaveError(null)
    const configured = editableRequirements(toolRequirements)
    setDraftRequirements(configured.length > 0 ? configured : [emptyRequirement()])
    setIsEditing(true)
  }

  const saveToolPermissions = async () => {
    setSaveError(null)
    const requirements = draftRequirements.map((requirement) => ({
      label: requirement.label.trim(),
      member: requirement.memberType === "signed-in-user"
        ? SIGNED_IN_USER_MEMBER
        : requirement.member.trim(),
      role: requirement.role.trim(),
    }))
    if (requirements.some(({ label, member, role }) => !label || !member || !role)) {
      setSaveError("Complete the access description, member, and role for every permission.")
      return
    }

    setIsSaving(true)
    try {
      const response = await fetch(
        `/api/mcp-servers/${encodeURIComponent(mcpKeyName)}/permissions?project=${encodeURIComponent(project)}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ toolName, requirements }),
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
            Tool permissions define custom downstream access for this operation. MCP access is maintained automatically by the Hub. Saving updates the required-role settings but does not change Athenz membership.
          </p>

          <PermissionSection
            description="Custom Athenz role memberships required to execute this tool. These settings are editable."
            eyebrow="Custom access"
            title="Tool permissions"
          >
            {isEditing ? (
              <PermissionEditor requirements={draftRequirements} setRequirements={setDraftRequirements} />
            ) : toolRequirements.length > 0 ? (
              <PermissionTable requirements={toolRequirements} />
            ) : (
              <div className="permission-dialog-empty neutral">
                <strong>No tool permissions configured</strong>
                <p>Add the downstream user or service-account roles required by this tool.</p>
              </div>
            )}
            {saveError ? <p className="permission-dialog-save-error" role="alert">{saveError}</p> : null}
          </PermissionSection>

          <PermissionSection
            description="Default server-access roles generated from this MCP server's Hub-managed access configuration."
            eyebrow="Managed defaults"
            title="MCP access"
          >
            {managedRequirements.length > 0 ? (
              <PermissionTable requirements={managedRequirements} />
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
  description,
  eyebrow,
  title,
}: {
  children: ReactNode
  description: string
  eyebrow: string
  title: string
}) {
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

function PermissionTable({ requirements }: { requirements: PermissionRequirementCheck[] }) {
  return (
    <table className="permission-dialog-table">
      <thead>
        <tr>
          <th scope="col">Required access</th>
          <th scope="col">Status</th>
          <th scope="col">Member</th>
          <th scope="col">Role</th>
        </tr>
      </thead>
      <tbody>
        {requirements.map((requirement) => (
          <tr key={`${requirement.source}:${requirement.member}:${requirement.role}`}>
            <td>{requirement.label}</td>
            <td>
              <span className="permission-dialog-status" data-status={requirement.status}>
                {requirement.status === "ready" ? "Available" : requirement.status === "missing" ? "Missing" : "Could not verify"}
              </span>
            </td>
            <td><code>{requirement.member}</code></td>
            <td>
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
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function PermissionEditor({
  requirements,
  setRequirements,
}: {
  requirements: EditableRequirement[]
  setRequirements: Dispatch<SetStateAction<EditableRequirement[]>>
}) {
  const update = (index: number, values: Partial<EditableRequirement>) => {
    setRequirements((current) => current.map((requirement, currentIndex) => (
      currentIndex === index ? { ...requirement, ...values } : requirement
    )))
  }

  return (
    <div className="permission-editor">
      {requirements.map((requirement, index) => (
        <div className="permission-editor-row" key={index}>
          <label className="permission-editor-field permission-editor-label-field">
            <span>Required access</span>
            <input
              required
              value={requirement.label}
              placeholder="Signed-in user can call the downstream API"
              onChange={(event) => update(index, { label: event.target.value })}
            />
          </label>
          <label className="permission-editor-field">
            <span>Member type</span>
            <select
              value={requirement.memberType}
              onChange={(event) => update(index, {
                member: event.target.value === "signed-in-user" ? SIGNED_IN_USER_MEMBER : "",
                memberType: event.target.value as EditableRequirement["memberType"],
              })}
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
                value={requirement.member}
                placeholder="domain.service"
                onChange={(event) => update(index, { member: event.target.value })}
              />
            )}
          </label>
          <label className="permission-editor-field permission-editor-role-field">
            <span>Role</span>
            <input
              required
              value={requirement.role}
              placeholder="domain:role.role-name"
              onChange={(event) => update(index, { role: event.target.value })}
            />
          </label>
          <button
            className="permission-editor-remove"
            type="button"
            aria-label={`Remove permission ${index + 1}`}
            onClick={() => setRequirements((current) => current.filter((_, currentIndex) => currentIndex !== index))}
          >
            <Trash2 size={15} aria-hidden="true" />
          </button>
        </div>
      ))}
      <button
        className="button permission-editor-add"
        type="button"
        onClick={() => setRequirements((current) => [...current, emptyRequirement()])}
      >
        <Plus size={14} aria-hidden="true" />
        Add permission
      </button>
    </div>
  )
}

function editableRequirements(requirements: PermissionRequirementCheck[]): EditableRequirement[] {
  return requirements.map(({ configuredMember, label, role }) => ({
    label,
    member: configuredMember,
    memberType: configuredMember === SIGNED_IN_USER_MEMBER ? "signed-in-user" : "service",
    role,
  }))
}

function emptyRequirement(): EditableRequirement {
  return {
    label: "",
    member: SIGNED_IN_USER_MEMBER,
    memberType: "signed-in-user",
    role: "",
  }
}
