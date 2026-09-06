import type { McpServerStatus } from "@/features/catalog/types/catalog"

const STATUS_LABELS: Record<McpServerStatus, string> = {
  active: "Active",
  "in-progress": "In progress",
  unhealthy: "Unhealthy",
}

export function McpServerStatusBadge({
  status,
  message,
  compact = false,
}: {
  status: McpServerStatus
  message: string
  compact?: boolean
}) {
  return (
    <span
      className={`status-badge${compact ? " compact" : ""}`}
      data-status={status}
      title={message}
    >
      {STATUS_LABELS[status]}
    </span>
  )
}
