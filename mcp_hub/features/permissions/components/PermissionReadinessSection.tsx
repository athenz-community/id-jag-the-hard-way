import { CheckCircle2, CircleX, TriangleAlert } from "lucide-react"
import type { McpTool, McpToolsResult } from "@/features/catalog/types/tools"
import { PermissionRequestDialog } from "@/features/permissions/components/PermissionRequestDialog"
import type {
  PermissionCheckStatus,
  PermissionReadiness,
  PermissionReadinessGroup,
} from "@/features/permissions/types/permissions"

type PermissionDisplayStatus = PermissionReadiness["status"] | "unconfigured"

const STATUS_COPY: Record<PermissionCheckStatus, { label: string; summary: string }> = {
  ready: {
    label: "Permission ready",
    summary: "All required permissions are ready",
  },
  missing: {
    label: "Permission required",
    summary: "Some required permissions are missing",
  },
  unavailable: {
    label: "Could not verify",
    summary: "Some permissions could not be verified",
  },
}

export function PermissionReadinessSection({
  readiness,
  toolsResult,
}: {
  readiness: PermissionReadiness | null
  toolsResult: McpToolsResult
}) {
  const evaluatedReadiness = readiness?.status === "configuration-error" ? undefined : readiness
  const serverGroups = evaluatedReadiness?.groups.filter((group) => group.kind === "server") ?? []
  const toolGroups = new Map(
    evaluatedReadiness?.groups
      .filter((group) => group.kind === "tool" && group.toolName)
      .map((group) => [group.toolName as string, group]) ?? [],
  )
  const hasUnconfiguredTool = toolsResult.tools.some((tool) => !toolGroups.has(tool.name))
  const status = sectionStatus(readiness, toolsResult, hasUnconfiguredTool)

  return (
    <div className="permission-readiness-section" aria-labelledby="permission-readiness-heading">
      <PermissionHeading status={status} />

      {readiness?.status === "configuration-error" ? (
        <div className="permission-config-error" role="alert">
          <TriangleAlert size={18} aria-hidden="true" />
          <div>
            <strong>Permission preset configuration error</strong>
            <p>{readiness.message}</p>
          </div>
        </div>
      ) : null}

      {serverGroups.length > 0 ? (
        <div className="permission-readiness-groups">
          {serverGroups.map((group) => (
            <ServerPermissionGroup group={group} key={`${group.kind}:${group.label}`} />
          ))}
        </div>
      ) : null}

      <div className="permission-tools-panel">
        <div className="permission-tools-heading">
          <div>
            <span>Available tools</span>
            <h3>Tools</h3>
          </div>
          <strong>{toolsResult.tools.length} tools</strong>
        </div>

        {toolsResult.error ? (
          <div className="permission-tools-load-error" role="status">
            <TriangleAlert size={17} aria-hidden="true" />
            <span>Available tools could not be loaded: {toolsResult.error}</span>
          </div>
        ) : null}

        {toolsResult.tools.length > 0 ? (
          <div className="permission-tool-list">
            {toolsResult.tools.map((tool, index) => (
              <ToolPermissionRow
                group={toolGroups.get(tool.name)}
                key={`${tool.name}:${index}`}
                tool={tool}
              />
            ))}
          </div>
        ) : toolsResult.error ? null : (
          <div className="permission-tools-empty">This MCP server returned no tools.</div>
        )}
      </div>
    </div>
  )
}

function ServerPermissionGroup({ group }: { group: PermissionReadinessGroup }) {
  const status = groupStatus(group)

  return (
    <div className="permission-server-row" data-status={status}>
      <PermissionStatusIcon status={status} />
      <div className="permission-tool-identity">
        <span>Shared execution access</span>
        <strong>{group.label}</strong>
      </div>
      <PermissionRequestDialog
        requirements={group.requirements}
        subject={group.label}
        triggerLabel={status === "ready" ? "View permissions" : status === "missing" ? "Request permission" : "View requirements"}
      />
    </div>
  )
}

function ToolPermissionRow({
  group,
  tool,
}: {
  group?: PermissionReadinessGroup
  tool: McpTool
}) {
  if (!group) {
    return (
      <div className="permission-tool-row" data-status="unconfigured">
        <span className="permission-status-icon" aria-hidden="true"><TriangleAlert size={19} /></span>
        <ToolIdentity tool={tool} />
        <PermissionRequestDialog
          configurationMissing
          requirements={[]}
          subject={`Tool: ${tool.name}`}
          triggerLabel="No configuration"
        />
      </div>
    )
  }

  const status = groupStatus(group)
  return (
    <div className="permission-tool-row" data-status={status}>
      <PermissionStatusIcon status={status} />
      <ToolIdentity tool={tool} />
      <PermissionRequestDialog
        requirements={group.requirements}
        subject={`Tool: ${tool.name}`}
        triggerLabel={status === "ready" ? "View permissions" : status === "missing" ? "Request permission" : "View requirements"}
      />
    </div>
  )
}

function ToolIdentity({ tool }: { tool: McpTool }) {
  return (
    <div className="permission-tool-identity">
      <strong>{tool.name}</strong>
    </div>
  )
}

function PermissionStatusIcon({ status }: { status: PermissionCheckStatus }) {
  return (
    <span className="permission-status-icon" aria-hidden="true">
      {status === "ready"
        ? <CheckCircle2 size={19} />
        : status === "missing"
          ? <CircleX size={19} />
          : <TriangleAlert size={19} />}
    </span>
  )
}

function PermissionHeading({ status }: { status: PermissionDisplayStatus }) {
  const summary = status === "configuration-error"
    ? "Preset cannot be evaluated"
    : status === "unconfigured"
      ? "Permission configuration needed"
      : STATUS_COPY[status].summary

  return (
    <div className="permission-readiness-heading">
      <div className="permission-heading-step">
        <span className="step-marker">1</span>
        <div>
          <h3 id="permission-readiness-heading" className="section-title">
            Check your permissions
          </h3>
          <p className="section-copy">
            All tools are visible. Checkmarks show which protected calls you can make; for other tools, open Request permission to view the required access.
          </p>
        </div>
      </div>
      <span className="permission-summary" data-status={status}>{summary}</span>
    </div>
  )
}

function groupStatus(group: PermissionReadinessGroup): PermissionCheckStatus {
  const statuses = group.requirements.map(({ status }) => status)
  if (statuses.includes("unavailable")) return "unavailable"
  if (statuses.includes("missing")) return "missing"
  return "ready"
}

function sectionStatus(
  readiness: PermissionReadiness | null,
  toolsResult: McpToolsResult,
  hasUnconfiguredTool: boolean,
): PermissionDisplayStatus {
  if (readiness?.status === "configuration-error") return "configuration-error"
  if (readiness?.status === "missing") return "missing"
  if (readiness?.status === "unavailable" || toolsResult.error) return "unavailable"
  if (!readiness || hasUnconfiguredTool) return "unconfigured"
  return "ready"
}
