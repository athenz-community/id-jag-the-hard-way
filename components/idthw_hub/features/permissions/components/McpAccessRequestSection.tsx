"use client"

import { CheckCircle2, LoaderCircle, Sparkles } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import type { PermissionCheckStatus, PermissionReadiness } from "@/features/permissions/types/permissions"
import { managedMcpAccessScope } from "@/features/registration/lib/kubernetesManifest"

type RequestState = "idle" | "requesting" | "approved" | "error"

export function McpAccessRequestSection({
  currentAccessScope,
  displayName,
  mcpKeyName,
  onApproved,
  project,
  readiness,
  username,
}: {
  currentAccessScope?: string
  displayName: string
  mcpKeyName: string
  onApproved?: () => void
  project: string
  readiness: PermissionReadiness | null
  username: string
}) {
  const router = useRouter()
  const expectedAccessScope = managedMcpAccessScope(project, mcpKeyName)
  const initiallyApproved = managedMcpAccessIsApproved(
    currentAccessScope,
    expectedAccessScope,
    readiness,
  )
  const [requestState, setRequestState] = useState<RequestState>("idle")
  const [progress, setProgress] = useState(initiallyApproved ? 10 : 0)
  const [requestError, setRequestError] = useState("")
  const approved = initiallyApproved || requestState === "approved"

  async function requestAccess() {
    setRequestState("requesting")
    setRequestError("")
    setProgress(3)
    const progressTimer = window.setInterval(() => {
      setProgress((current) => Math.min(current + 1, 9))
    }, 140)

    try {
      const [response] = await Promise.all([
        fetch(
          `/api/mcp-servers/${encodeURIComponent(mcpKeyName)}/access?project=${encodeURIComponent(project)}`,
          { method: "POST" },
        ),
        new Promise((resolve) => window.setTimeout(resolve, 900)),
      ])
      const payload = await response.json().catch(() => ({})) as {
        checksCompleted?: unknown
        error?: unknown
      }
      if (!response.ok) {
        throw new Error(typeof payload.error === "string" ? payload.error : "Unable to request MCP access")
      }

      setProgress(typeof payload.checksCompleted === "number" ? payload.checksCompleted : 10)
      setRequestState("approved")
      onApproved?.()
      router.refresh()
    } catch (error) {
      setRequestState("error")
      setRequestError(error instanceof Error ? error.message : "Unable to request MCP access")
    } finally {
      window.clearInterval(progressTimer)
    }
  }

  return (
    <section className="mcp-access-request" data-status={approved ? "approved" : requestState} aria-labelledby="mcp-access-request-heading">
      <div className="mcp-access-request-step">
        <span className="step-marker">1</span>
        <div className="mcp-access-request-content">
          <span className="config-eyebrow">MCP Hub-managed access</span>
          <h3 id="mcp-access-request-heading">
            {approved ? `You are approved to use ${displayName}` : "Request access to this MCP server"}
          </h3>
          <p>
            {approved
              ? "MCP Hub verified your membership and this server's managed token-exchange setup."
              : `${username}, request access before connecting your MCP client. MCP Hub will add your account to this server's access role and verify its managed token-exchange setup.`}
          </p>

          {requestState === "requesting" ? (
            <div className="mcp-access-request-progress" role="status" aria-live="polite">
              <LoaderCircle className="spinning" size={16} aria-hidden="true" />
              <span>{progress} of 10 managed-access checks completed</span>
            </div>
          ) : approved ? (
            <div className="mcp-access-request-result" role="status">
              <CheckCircle2 size={17} aria-hidden="true" />
              <span>10 of 10 checks completed. You can continue with permission verification and client setup.</span>
            </div>
          ) : (
            <div className="mcp-access-request-actions">
              <button className="button primary mcp-access-request-button" type="button" onClick={requestAccess}>
                <Sparkles className="mcp-access-request-sparkle" size={16} aria-hidden="true" />
                Request MCP access
              </button>
            </div>
          )}

          {requestError ? <p className="mcp-access-request-error" role="alert">{requestError}</p> : null}
        </div>
      </div>
    </section>
  )
}

export function managedMcpAccessIsApproved(
  currentAccessScope: string | undefined,
  expectedAccessScope: string,
  readiness: PermissionReadiness | null,
) {
  return currentAccessScope === expectedAccessScope && managedAccessStatus(readiness) === "ready"
}

function managedAccessStatus(readiness: PermissionReadiness | null): PermissionCheckStatus {
  if (!readiness || readiness.status === "configuration-error") return "unavailable"
  const statuses = readiness.groups.flatMap((group) => [
    ...group.requirements
      .filter(({ source }) => source === "managed")
      .map(({ status }) => status),
    ...group.policies
      .filter(({ source }) => source === "managed")
      .map(({ status }) => status),
  ])
  if (statuses.length === 0 || statuses.includes("unavailable")) return "unavailable"
  if (statuses.includes("missing")) return "missing"
  return "ready"
}
