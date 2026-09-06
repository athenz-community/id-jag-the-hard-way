"use client"

import { AlertTriangle, MoreHorizontal, Pencil, Plus, Trash2, X } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useId, useRef, useState } from "react"

export function ResourceActionMenu({
  createServerHref,
  deleteEndpoint,
  editHref,
  resourceKind,
  resourceName,
}: {
  createServerHref?: string
  deleteEndpoint: string
  editHref: string
  resourceKind: "MCP server" | "MCP template"
  resourceName: string
}) {
  const router = useRouter()
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 })
  const [confirmation, setConfirmation] = useState("")
  const [deleteError, setDeleteError] = useState("")
  const [isDeleting, setIsDeleting] = useState(false)
  const confirmationMatches = confirmation === resourceName

  useEffect(() => {
    function closeMenuOnOutsideClick(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    function closeMenu() {
      setMenuOpen(false)
    }
    document.addEventListener("mousedown", closeMenuOnOutsideClick)
    window.addEventListener("resize", closeMenu)
    window.addEventListener("scroll", closeMenu, true)
    return () => {
      document.removeEventListener("mousedown", closeMenuOnOutsideClick)
      window.removeEventListener("resize", closeMenu)
      window.removeEventListener("scroll", closeMenu, true)
    }
  }, [])

  function toggleMenu() {
    if (menuOpen) {
      setMenuOpen(false)
      return
    }
    const bounds = triggerRef.current?.getBoundingClientRect()
    if (bounds) {
      const menuHeight = createServerHref ? 124 : 92
      setMenuPosition({
        left: Math.max(8, bounds.right - 184),
        top: Math.max(8, Math.min(window.innerHeight - menuHeight, bounds.bottom + 4)),
      })
    }
    setMenuOpen(true)
  }

  function openDeleteDialog() {
    setMenuOpen(false)
    setConfirmation("")
    setDeleteError("")
    dialogRef.current?.showModal()
  }

  function closeDeleteDialog() {
    if (isDeleting) return
    dialogRef.current?.close()
  }

  async function deleteResource() {
    if (!confirmationMatches || isDeleting) return
    setDeleteError("")
    setIsDeleting(true)

    try {
      const response = await fetch(deleteEndpoint, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation }),
      })
      const payload = await response.json() as { error?: unknown }
      if (!response.ok) {
        throw new Error(typeof payload.error === "string" ? payload.error : `Unable to delete ${resourceKind}`)
      }

      dialogRef.current?.close()
      router.refresh()
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : `Unable to delete ${resourceKind}`)
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <>
      <div className="resource-action-menu" ref={menuRef}>
        <button
          ref={triggerRef}
          className="table-action"
          type="button"
          aria-label={`Open actions for ${resourceName}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={toggleMenu}
        >
          <MoreHorizontal size={16} aria-hidden="true" />
        </button>
        {menuOpen ? (
          <div className="resource-action-menu-panel" role="menu" style={menuPosition}>
            {createServerHref ? (
              <Link href={createServerHref} role="menuitem" onClick={() => setMenuOpen(false)}>
                <Plus size={14} aria-hidden="true" />
                Create MCP server
              </Link>
            ) : null}
            <Link href={editHref} role="menuitem" onClick={() => setMenuOpen(false)}>
              <Pencil size={14} aria-hidden="true" />
              Modify
            </Link>
            <button type="button" role="menuitem" className="danger" onClick={openDeleteDialog}>
              <Trash2 size={14} aria-hidden="true" />
              Delete
            </button>
          </div>
        ) : null}
      </div>

      <dialog
        className="permission-request-dialog resource-delete-dialog"
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onCancel={(event) => {
          if (isDeleting) event.preventDefault()
        }}
        onClose={() => {
          setConfirmation("")
          setDeleteError("")
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeDeleteDialog()
        }}
      >
        <div className="permission-dialog-card">
          <div className="permission-dialog-head resource-delete-dialog-head">
            <h3 id={titleId}>Delete {resourceKind}?</h3>
            <button
              className="permission-dialog-close"
              type="button"
              aria-label="Close deletion dialog"
              disabled={isDeleting}
              onClick={closeDeleteDialog}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>

          <div className="resource-delete-dialog-body">
            <div className="resource-delete-warning" id={descriptionId}>
              <AlertTriangle size={20} aria-hidden="true" />
              <div>
                <strong>This action cannot be undone.</strong>
                <p>
                  {resourceKind === "MCP server"
                    ? "This permanently deletes the Kubernetes Deployment, Service, and dedicated environment Secret for this MCP server."
                    : "This permanently deletes the Kubernetes Secret that stores this MCP template."}
                </p>
              </div>
            </div>

            <div className="resource-delete-confirmation">
              <label htmlFor={`${titleId}-confirmation`}>
                To confirm deletion, enter <code>{resourceName}</code> in the text input field.
              </label>
              <input
                id={`${titleId}-confirmation`}
                className="resource-delete-confirmation-input"
                autoComplete="off"
                autoFocus
                value={confirmation}
                disabled={isDeleting}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </div>
            {deleteError ? <p className="resource-delete-error" role="alert">{deleteError}</p> : null}
          </div>

          <div className="permission-dialog-actions">
            <button className="button" type="button" disabled={isDeleting} onClick={closeDeleteDialog}>Cancel</button>
            <button
              className="button resource-delete-button"
              type="button"
              disabled={!confirmationMatches || isDeleting}
              aria-busy={isDeleting}
              onClick={() => void deleteResource()}
            >
              <Trash2 size={14} aria-hidden="true" />
              {isDeleting ? "Deleting..." : "Delete"}
            </button>
          </div>
        </div>
      </dialog>
    </>
  )
}
