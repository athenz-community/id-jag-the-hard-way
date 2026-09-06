"use client"

import { CheckCircle2, ChevronDown, ChevronRight, CircleX, TriangleAlert } from "lucide-react"
import { useState } from "react"
import type { McpTool, McpToolsResult } from "@/features/catalog/types/tools"
import { PermissionRequestDialog } from "@/features/permissions/components/PermissionRequestDialog"
import type {
  PermissionCheckStatus,
  PermissionReadiness,
  PermissionReadinessGroup,
} from "@/features/permissions/types/permissions"

const COLLAPSED_TOOL_COUNT = 5

export function PermissionReadinessSection({
  accessAudience,
  mcpKeyName,
  project,
  servicePrincipal,
  readiness,
  toolsResult,
}: {
  accessAudience?: string
  mcpKeyName: string
  project: string
  servicePrincipal?: string
  readiness: PermissionReadiness | null
  toolsResult: McpToolsResult
}) {
  const [toolsExpanded, setToolsExpanded] = useState(false)
  const evaluatedReadiness = readiness?.status === "configuration-error" ? undefined : readiness
  const toolGroups = new Map(
    evaluatedReadiness?.groups
      .filter((group) => group.toolName)
      .map((group) => [group.toolName as string, group]) ?? [],
  )
  const sharedGroup = evaluatedReadiness?.groups.find((group) => !group.toolName)

  return (
    <div className="permission-readiness-section" aria-labelledby="permission-readiness-heading">
      <PermissionHeading />

      {readiness?.status === "configuration-error" ? (
        <div className="permission-config-error" role="alert">
          <TriangleAlert size={18} aria-hidden="true" />
          <div>
            <strong>Permission preset configuration error</strong>
            <p>{readiness.message}</p>
          </div>
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

        {toolsResult.tools.length > COLLAPSED_TOOL_COUNT ? (
          <>
            <ToolPermissionList
              accessAudience={accessAudience}
              mcpKeyName={mcpKeyName}
              project={project}
              servicePrincipal={servicePrincipal}
              sharedGroup={sharedGroup}
              toolGroups={toolGroups}
              tools={toolsExpanded ? toolsResult.tools : toolsResult.tools.slice(0, COLLAPSED_TOOL_COUNT)}
            />
            <button
              className="permission-tools-toggle"
              type="button"
              aria-expanded={toolsExpanded}
              onClick={() => setToolsExpanded((expanded) => !expanded)}
            >
              {toolsExpanded
                ? <ChevronDown size={15} aria-hidden="true" />
                : <ChevronRight size={15} aria-hidden="true" />}
              {toolsExpanded ? "Collapse tools" : "Expand tools"}
            </button>
          </>
        ) : toolsResult.tools.length > 0 ? (
          <ToolPermissionList
            accessAudience={accessAudience}
            mcpKeyName={mcpKeyName}
            project={project}
            servicePrincipal={servicePrincipal}
            sharedGroup={sharedGroup}
            toolGroups={toolGroups}
            tools={toolsResult.tools}
          />
        ) : toolsResult.error ? null : (
          <div className="permission-tools-empty">This MCP server returned no tools.</div>
        )}
      </div>
    </div>
  )
}

function ToolPermissionList({
  accessAudience,
  mcpKeyName,
  project,
  servicePrincipal,
  sharedGroup,
  toolGroups,
  tools,
}: {
  accessAudience?: string
  mcpKeyName: string
  project: string
  servicePrincipal?: string
  sharedGroup?: PermissionReadinessGroup
  toolGroups: Map<string, PermissionReadinessGroup>
  tools: McpTool[]
}) {
  return (
    <div className="permission-tool-list">
      {tools.map((tool, index) => (
        <ToolPermissionRow
          accessAudience={accessAudience}
          group={toolGroups.get(tool.name) ?? sharedGroup}
          key={`${tool.name}:${index}`}
          mcpKeyName={mcpKeyName}
          project={project}
          servicePrincipal={servicePrincipal}
          tool={tool}
        />
      ))}
    </div>
  )
}

function ToolPermissionRow({
  accessAudience,
  group,
  mcpKeyName,
  project,
  servicePrincipal,
  tool,
}: {
  accessAudience?: string
  group?: PermissionReadinessGroup
  mcpKeyName: string
  project: string
  servicePrincipal?: string
  tool: McpTool
}) {
  if (!group) {
    return (
      <div className="permission-tool-row" data-status="unconfigured">
        <span className="permission-status-icon" aria-hidden="true"><TriangleAlert size={19} /></span>
        <ToolIdentity tool={tool} />
        <PermissionRequestDialog
          accessAudience={accessAudience}
          configurationMissing
          mcpKeyName={mcpKeyName}
          project={project}
          policies={[]}
          servicePrincipal={servicePrincipal}
          requirements={[]}
          subject={`Tool: ${tool.name}`}
          toolName={tool.name}
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
        accessAudience={accessAudience}
        mcpKeyName={mcpKeyName}
        project={project}
        policies={group.policies}
        servicePrincipal={servicePrincipal}
        requirements={group.requirements}
        subject={`Tool: ${tool.name}`}
        toolName={tool.name}
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

function PermissionHeading() {
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
    </div>
  )
}

function groupStatus(group: PermissionReadinessGroup): PermissionCheckStatus {
  const statuses = [
    ...group.requirements.map(({ status }) => status),
    ...group.policies.map(({ status }) => status),
  ]
  if (statuses.includes("unavailable")) return "unavailable"
  if (statuses.includes("missing")) return "missing"
  return "ready"
}
