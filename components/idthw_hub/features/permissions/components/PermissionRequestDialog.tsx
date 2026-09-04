"use client"

import { ExternalLink, RefreshCw, ShieldQuestion, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useId, useRef, useTransition } from "react"
import type { PermissionRequirementCheck } from "@/features/permissions/types/permissions"

type PageScrollLock = {
  bodyStyle: string | null
  scrollY: number
}

export function PermissionRequestDialog({
  configurationMissing = false,
  requirements,
  subject,
  triggerLabel = "Request permission",
}: {
  configurationMissing?: boolean
  requirements: PermissionRequirementCheck[]
  subject: string
  triggerLabel?: string
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const pageScrollLockRef = useRef<PageScrollLock | null>(null)
  const titleId = useId()
  const router = useRouter()
  const [isRefreshing, startRefresh] = useTransition()
  const permissionsReady = requirements.length > 0 && requirements.every(({ status }) => status === "ready")

  const unlockPageScroll = useCallback(() => {
    const lock = pageScrollLockRef.current
    if (!lock) return

    if (lock.bodyStyle === null) {
      document.body.removeAttribute("style")
    } else {
      document.body.setAttribute("style", lock.bodyStyle)
    }
    pageScrollLockRef.current = null
    window.scrollTo(0, lock.scrollY)
  }, [])

  const openDialog = useCallback(() => {
    const dialog = dialogRef.current
    if (!dialog || dialog.open) return

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
  }, [])

  useEffect(() => unlockPageScroll, [unlockPageScroll])

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
            {configurationMissing
              ? "MCP Hub has no permission preset for this tool, so your access cannot be checked yet."
              : permissionsReady
              ? "You already have the required permissions below. Select a role to review its membership in Athenz."
              : "Review all required permissions below. Select a missing role to register access in Athenz; MCP Hub does not submit requests yet."}
          </p>

          {configurationMissing ? (
            <div className="permission-dialog-requirements">
              <div className="permission-dialog-empty">
                <strong>No permission configuration found</strong>
                <p>Add this tool and its required Athenz roles to the MCP Hub permission-presets YAML.</p>
              </div>
            </div>
          ) : (
            <div className="permission-dialog-requirements">
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
                    <tr key={`${requirement.member}:${requirement.role}`}>
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
            </div>
          )}

          <div className="permission-dialog-actions">
            <form method="dialog">
              <button className="button" type="submit">Close</button>
            </form>
            <button
              className="button"
              type="button"
              disabled={isRefreshing}
              onClick={() => startRefresh(() => router.refresh())}
            >
              <RefreshCw className={isRefreshing ? "permission-refresh-icon spinning" : "permission-refresh-icon"} size={14} aria-hidden="true" />
              {isRefreshing ? "Refreshing..." : "Refresh permissions"}
            </button>
            {!permissionsReady && !configurationMissing ? <button className="button primary" type="button" disabled>Submit request</button> : null}
          </div>
        </div>
      </dialog>
    </>
  )
}
