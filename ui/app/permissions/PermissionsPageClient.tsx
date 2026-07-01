"use client"

import { useEffect, useState } from "react"

type PermissionKind = "get" | "post" | "delete"

type PermissionState = {
  enabled: boolean
  toggling: boolean
  toggle: () => Promise<void>
}

const permissionMeta: Record<PermissionKind, {
  apiPath: string
  aiApiPath: string
  title: string
  targetLabel: string
  policyLine: string
  aiPolicyLine: string
  accent: string
  tint: string
  tabTint: string
}> = {
  get: {
    apiPath: "/api/permissions/direct-docs",
    aiApiPath: "/api/permissions/ai-agent-role?permission=get",
    title: "GET",
    targetLabel: "get:docs",
    policyLine: "ALLOW get api:role.docs-getter api:docs",
    aiPolicyLine: "ALLOW zts.jag_exchange api:role.jag-exchanging-ai-agents api:role.docs-getter",
    accent: "#1D4ED8",
    tint: "#DBEAFE",
    tabTint: "#EFF6FF",
  },
  post: {
    apiPath: "/api/permissions/direct-posts",
    aiApiPath: "/api/permissions/ai-agent-role?permission=post",
    title: "POST",
    targetLabel: "post:docs",
    policyLine: "ALLOW post api:role.docs-poster api:docs",
    aiPolicyLine: "ALLOW zts.jag_exchange api:role.jag-exchanging-ai-agents api:role.docs-poster",
    accent: "#B45309",
    tint: "#FEF3C7",
    tabTint: "#FFFBEB",
  },
  delete: {
    apiPath: "/api/permissions/direct-deletes",
    aiApiPath: "/api/permissions/ai-agent-role?permission=delete",
    title: "DELETE",
    targetLabel: "delete:docs",
    policyLine: "ALLOW delete api:role.docs-deleter api:docs",
    aiPolicyLine: "ALLOW zts.jag_exchange api:role.jag-exchanging-ai-agents api:role.docs-deleter",
    accent: "#BE185D",
    tint: "#FCE7F3",
    tabTint: "#FDF2F8",
  },
}

function NodeBox({
  x,
  y,
  label,
  image,
  circleImage = false,
  fill = "var(--surface)",
}: {
  x: number
  y: number
  label: string
  image?: string
  circleImage?: boolean
  fill?: string
}) {
  const boxWidth = 140
  const boxHeight = 108
  const imageSize = 48
  const imageLabelGap = 8
  const labelHeight = 12
  const imageGroupHeight = imageSize + imageLabelGap + labelHeight
  const imageX = x + (boxWidth - imageSize) / 2
  const imageY = y + (boxHeight - imageGroupHeight) / 2
  const labelY = image ? imageY + imageSize + imageLabelGap : y + boxHeight / 2
  const clipId = `clip-${x}-${y}`
  const cx = imageX + imageSize / 2
  const cy = imageY + imageSize / 2
  const r = imageSize / 2

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={boxWidth}
        height={boxHeight}
        rx="16"
        fill={fill}
        stroke="var(--border)"
        strokeWidth="1.5"
      />
      {image && circleImage && (
        <>
          <defs>
            <clipPath id={clipId}>
              <circle cx={cx} cy={cy} r={r} />
            </clipPath>
          </defs>
          <image
            href={image}
            x={imageX}
            y={imageY}
            width={imageSize}
            height={imageSize}
            preserveAspectRatio="xMidYMid slice"
            clipPath={`url(#${clipId})`}
          />
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border)" strokeWidth="1.5" />
        </>
      )}
      {image && !circleImage && (
        <image
          href={image}
          x={imageX}
          y={imageY}
          width={imageSize}
          height={imageSize}
          preserveAspectRatio="xMidYMid meet"
        />
      )}
      <text
        x={x + boxWidth / 2}
        y={labelY}
        textAnchor="middle"
        dominantBaseline={image ? "hanging" : "middle"}
        fill="var(--text-primary)"
        fontSize="12"
        fontWeight="600"
      >
        {label}
      </text>
    </g>
  )
}

function Arrow({
  x1,
  x2,
  y,
  color = "var(--line-green)",
  onClick,
}: {
  x1: number
  x2: number
  y: number
  color?: string
  onClick: () => void
}) {
  return (
    <g onClick={onClick} style={{ cursor: "pointer" }}>
      <rect x={x1 - 4} y={y - 12} width={x2 - x1 + 8} height={24} fill="transparent" />
      <path d={`M ${x1} ${y} H ${x2}`} stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path
        d={`M ${x2 - 8} ${y - 6} L ${x2} ${y} L ${x2 - 8} ${y + 6}`}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  )
}

function StatusChip({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <span
      style={{
        fontSize: "0.65rem",
        fontWeight: 700,
        padding: "2px 7px",
        borderRadius: 999,
        background: enabled ? "#ECFDF5" : "#FEF2F2",
        color: enabled ? "var(--line-green)" : "#ef4444",
        whiteSpace: "nowrap",
      }}
    >
      {label} {enabled ? "✓" : "✕"}
    </span>
  )
}

type DialogState =
  | { type: "info"; label: string }
  | { type: "confirm-ai-agent"; permission: PermissionKind; currentlyEnabled: boolean; onConfirm: () => void | Promise<void> }
  | { type: "confirm-direct-policy"; permission: PermissionKind; currentlyEnabled: boolean; onConfirm: () => void | Promise<void> }

function PermissionDialog({ state, onClose }: { state: DialogState; onClose: () => void }) {
  if (state.type === "info") {
    return (
      <div
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}
        onClick={onClose}
      >
        <div
          style={{ background: "var(--surface)", border: "1.5px solid var(--border)", borderRadius: 16, padding: 28, maxWidth: 360, width: "90%", boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}
          onClick={(e) => e.stopPropagation()}
        >
          <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>Permission info</h2>
          <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", marginBottom: 24 }}>
            <strong style={{ color: "var(--text-primary)" }}>{state.label}</strong>
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button onClick={onClose} style={{ padding: "8px 18px", borderRadius: 8, fontSize: "0.875rem", border: "1.5px solid var(--border)", background: "transparent", color: "var(--text-primary)", cursor: "pointer" }}>
              Close
            </button>
          </div>
        </div>
      </div>
    )
  }

  const action = state.currentlyEnabled ? "Revoke" : "Allow"
  let title: string
  let detail: string
  let target: string

  if (state.type === "confirm-direct-policy") {
    const meta = permissionMeta[state.permission]
    title = `${action} direct ${meta.targetLabel} permission?`
    detail = state.currentlyEnabled
      ? `This will remove the Athenz policy that lets human.idjag-learner directly call ${meta.targetLabel}.`
      : `This will recreate the Athenz policy that lets human.idjag-learner directly call ${meta.targetLabel}.`
    target = meta.policyLine
  } else {
    const meta = permissionMeta[state.permission]
    title = `${action} AI agent permission?`
    detail = state.currentlyEnabled
      ? `This will remove the zts.jag_exchange policy that lets AI agents exchange into ${meta.targetLabel}.`
      : `This will recreate the zts.jag_exchange policy that lets AI agents exchange into ${meta.targetLabel}.`
    target = meta.aiPolicyLine
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}
      onClick={onClose}
    >
      <div
        style={{ background: "var(--surface)", border: "1.5px solid var(--border)", borderRadius: 16, padding: 28, maxWidth: 390, width: "90%", boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>
          {title}
        </h2>
        <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", marginBottom: 8 }}>
          {detail}
        </p>
        <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: 24, fontFamily: "monospace" }}>
          {target}
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "8px 18px", borderRadius: 8, fontSize: "0.875rem", border: "1.5px solid var(--border)", background: "transparent", color: "var(--text-primary)", cursor: "pointer" }}>
            Cancel
          </button>
          <button
            onClick={() => {
              void state.onConfirm()
              onClose()
            }}
            style={{ padding: "8px 18px", borderRadius: 8, fontSize: "0.875rem", border: "none", background: state.currentlyEnabled ? "#ef4444" : "var(--line-green)", color: "#fff", cursor: "pointer", fontWeight: 600 }}
          >
            {action}
          </button>
        </div>
      </div>
    </div>
  )
}

function usePermission(apiPath: string): PermissionState {
  const [enabled, setEnabled] = useState<boolean>(true)
  const [toggling, setToggling] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(apiPath, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((data: { enabled?: unknown } | null) => {
        if (!cancelled && data && typeof data.enabled === "boolean") setEnabled(data.enabled)
      })
      .catch(() => { })
    return () => { cancelled = true }
  }, [apiPath])

  async function toggle() {
    if (toggling) return
    const next = !enabled
    setToggling(true)
    setEnabled(next)
    try {
      const response = await fetch(apiPath, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      })
      if (!response.ok) { setEnabled(!next); return }
      const data = (await response.json()) as { enabled?: unknown }
      if (typeof data.enabled === "boolean") setEnabled(data.enabled)
    } catch {
      setEnabled(!next)
    } finally {
      setToggling(false)
    }
  }

  return { enabled, toggling, toggle }
}

function PermissionCard({
  permission,
  directPermission,
  aiAgentPermission,
  setDialog,
}: {
  permission: PermissionKind
  directPermission: PermissionState
  aiAgentPermission: PermissionState
  setDialog: (dialog: DialogState) => void
}) {
  const meta = permissionMeta[permission]
  const directColor = directPermission.enabled ? "var(--line-green)" : "#ef4444"
  const aiArrowColor = aiAgentPermission.enabled ? "var(--line-green)" : "#ef4444"
  const downstreamArrowColor = aiAgentPermission.enabled && directPermission.enabled ? "var(--line-green)" : "#ef4444"

  function openDirectDialog() {
    if (directPermission.toggling) return
    setDialog({
      type: "confirm-direct-policy",
      permission,
      currentlyEnabled: directPermission.enabled,
      onConfirm: directPermission.toggle,
    })
  }

  return (
    <div
      className="rounded-2xl p-4"
      style={{
        background: "var(--surface)",
        border: "1.5px solid var(--border)",
        borderTop: `4px solid ${meta.accent}`,
        boxShadow: "0 10px 28px rgba(15, 23, 42, 0.08), 0 2px 6px rgba(15, 23, 42, 0.05)",
      }}
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="rounded-full px-2 py-0.5 text-xs font-bold"
            style={{ background: meta.tint, color: meta.accent }}
          >
            {meta.title}
          </span>
          <span className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>
            {meta.targetLabel}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <StatusChip label="AI" enabled={aiAgentPermission.enabled} />
          <StatusChip label="direct" enabled={directPermission.enabled} />
        </div>
      </div>
      <svg className="block h-auto w-full" viewBox="0 0 770 280" fill="none" aria-label={`${meta.targetLabel} permission flow diagram`}>
        <rect x={0} y={0} width={770} height={280} fill={meta.tint} opacity={0.45} />

        {/* Row 1: human.idjag-learner and get:docs, connected by direct arrow */}
        <NodeBox x={0} y={10} label="human.idjag-learner" image="/mlajkim.png" circleImage fill={meta.tint} />
        <NodeBox x={630} y={10} label={meta.targetLabel} fill={meta.tint} />

        {/* Row 2: AI and MCP */}
        <NodeBox x={200} y={155} label="AI" image="/ai-agent.png" fill={meta.tint} />
        <NodeBox x={420} y={155} label="MCP" image="/mcp.png" fill={meta.tint} />

        {/* Direct arrow: human → get:docs (straight, top row) */}
        <g
          role="button"
          tabIndex={0}
          aria-pressed={directPermission.enabled}
          aria-label={`Toggle direct ${meta.targetLabel} policy`}
          onClick={openDirectDialog}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault()
              openDirectDialog()
            }
          }}
          style={{ cursor: directPermission.toggling ? "wait" : "pointer", opacity: directPermission.toggling ? 0.55 : 1 }}
        >
          <rect x={140} y={52} width={490} height={24} fill="transparent" />
          <path d="M 155 64 H 315" stroke={directColor} strokeWidth="2" strokeLinecap="round" />
          <path d="M 455 64 H 622" stroke={directColor} strokeWidth="2" strokeLinecap="round" />
          <path d="M 614 58 L 622 64 L 614 70" fill="none" stroke={directColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="315" y="54" width="140" height="20" rx="10" fill={directPermission.enabled ? meta.tint : "#FEF2F2"} stroke={directColor} strokeWidth="1.5" />
          <text x="385" y="64" textAnchor="middle" dominantBaseline="middle" fill={directColor} fontSize="12" fontWeight="700">
            direct {meta.targetLabel}
          </text>
        </g>

        {/* human → AI (elbow: down then right) */}
        <g
          onClick={() => setDialog({ type: "confirm-ai-agent", permission, currentlyEnabled: aiAgentPermission.enabled, onConfirm: aiAgentPermission.toggle })}
          style={{ cursor: "pointer" }}
        >
          <rect x={58} y={118} width={154} height={103} fill="transparent" />
          <path d="M 70 118 V 209 H 192" stroke={aiArrowColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <path d="M 184 203 L 192 209 L 184 215" fill="none" stroke={aiArrowColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </g>

        {/* AI → MCP */}
        <Arrow x1={340} x2={420} y={209} color={downstreamArrowColor} onClick={() => setDialog({ type: "info", label: `AI → MCP (${meta.title.toLowerCase()} token exchange)` })} />

        {/* MCP → get:docs (elbow: right then up) */}
        <g
          onClick={() => setDialog({ type: "info", label: `MCP → ${meta.targetLabel} (API call)` })}
          style={{ cursor: "pointer" }}
        >
          <rect x={558} y={118} width={154} height={103} fill="transparent" />
          <path d="M 560 209 H 700 V 126" stroke={downstreamArrowColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <path d="M 694 134 L 700 126 L 706 134" fill="none" stroke={downstreamArrowColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </svg>
    </div>
  )
}

function AdminLoginScreen({ onLogin }: { onLogin: () => void }) {
  const [id, setId] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState(false)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (id === "admin" && password === "admin") {
      onLogin()
    } else {
      setError(true)
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6" style={{ background: "#F7F8FA" }}>
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-1">
          <span
            className="inline-block text-xs font-bold tracking-widest px-2 py-0.5 rounded mb-2"
            style={{ background: "#ef4444", color: "#fff" }}
          >
            🔒 ADMIN ONLY
          </span>
          <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>Permission Control Panel</h1>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>Sign in to manage Athenz policies</p>
        </div>
        <form
          onSubmit={handleSubmit}
          className="rounded-2xl p-6 space-y-4"
          style={{ background: "#fff", boxShadow: "var(--shadow-sm)", border: "1px solid var(--border)" }}
        >
          <div className="space-y-1.5">
            <label className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>ID</label>
            <input
              type="text"
              value={id}
              onChange={(e) => { setId(e.target.value); setError(false) }}
              autoComplete="username"
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{ border: "1px solid var(--border)", background: "#F7F8FA", color: "var(--text-primary)" }}
              placeholder="admin"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(false) }}
              autoComplete="current-password"
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{ border: "1px solid var(--border)", background: "#F7F8FA", color: "var(--text-primary)" }}
              placeholder="••••••••"
            />
          </div>
          {error && (
            <p className="text-xs" style={{ color: "#ef4444" }}>Invalid ID or password.</p>
          )}
          <button
            type="submit"
            className="w-full rounded-lg py-2 text-sm font-semibold transition-opacity hover:opacity-80"
            style={{ background: "#ef4444", color: "#fff" }}
          >
            Sign in
          </button>
        </form>
      </div>
    </main>
  )
}

export default function PermissionsPageClient() {
  const [loggedIn, setLoggedIn] = useState(false)
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [focused, setFocused] = useState<PermissionKind>("delete")
  const [pressed, setPressed] = useState<PermissionKind | null>(null)
  const [popKey, setPopKey] = useState(0)
  const directGet = usePermission(permissionMeta.get.apiPath)
  const directPost = usePermission(permissionMeta.post.apiPath)
  const directDelete = usePermission(permissionMeta.delete.apiPath)
  const aiGet = usePermission(permissionMeta.get.aiApiPath)
  const aiPost = usePermission(permissionMeta.post.aiApiPath)
  const aiDelete = usePermission(permissionMeta.delete.aiApiPath)
  const directPermissions: Record<PermissionKind, PermissionState> = {
    get: directGet,
    post: directPost,
    delete: directDelete,
  }
  const aiPermissions: Record<PermissionKind, PermissionState> = {
    get: aiGet,
    post: aiPost,
    delete: aiDelete,
  }

  const focusedMeta = permissionMeta[focused]

  if (!loggedIn) return <AdminLoginScreen onLogin={() => setLoggedIn(true)} />

  return (
    <main className="min-h-screen p-6 md:p-10" style={{ background: focusedMeta.tint, transition: "background 300ms ease" }}>
      <div className="mx-auto w-full max-w-[818px] space-y-6">

        {/* Header */}
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>Permission Control Panel</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
            Athenz policy evaluation for{" "}
            <code className="rounded px-1" style={{ background: "var(--border)", color: "var(--text-primary)" }}>
              human.idjag-learner
            </code>
            {" "}— changes take effect immediately across all AI agents.
          </p>
        </div>

        <div className="-mt-3">
          <span
            className="inline-flex items-center gap-1.5 font-bold px-3 py-1 rounded-lg"
            style={{ background: "#ef4444", color: "#fff", fontSize: "0.75rem", letterSpacing: "0.08em" }}
          >
            🔒 ADMIN ONLY
          </span>
        </div>

        {/* Stacked card deck — active card on top, others peek as tabs below */}
        {(() => {
          const kinds = ["get", "post", "delete"] as const
          const PEEK = 40
          const rest = kinds.filter((k) => k !== focused)
          return (
            <div style={{ position: "relative", paddingBottom: rest.length * PEEK }}>
              <div key={`${focused}-${popKey}`} className="permission-card-pop">
                <PermissionCard
                  permission={focused}
                  directPermission={directPermissions[focused]}
                  aiAgentPermission={aiPermissions[focused]}
                  setDialog={setDialog}
                />
              </div>
              {rest.map((kind, i) => {
                const meta = permissionMeta[kind]
                const directEnabled = directPermissions[kind].enabled
                const aiEnabled = aiPermissions[kind].enabled
                const isPressed = pressed === kind
                return (
                  <button
                    key={kind}
                    type="button"
                    onMouseDown={() => setPressed(kind)}
                    onMouseLeave={() => setPressed(null)}
                    onMouseUp={() => setPressed(null)}
                    onTouchStart={() => setPressed(kind)}
                    onTouchEnd={() => setPressed(null)}
                    onClick={() => {
                      setPressed(kind)
                      setFocused(kind)
                      setPopKey((current) => current + 1)
                      window.setTimeout(() => setPressed(null), 130)
                    }}
                    style={{
                      position: "absolute",
                      bottom: (rest.length - 1 - i) * PEEK,
                      left: 0, right: 0,
                      height: PEEK,
                      background: meta.tabTint,
                      border: "1.5px solid var(--border)",
                      borderLeft: `5px solid ${meta.accent}`,
                      borderTop: "none",
                      borderRadius: "0 0 16px 16px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "0 20px",
                      boxShadow: isPressed ? "0 1px 2px rgba(15, 23, 42, 0.08)" : "0 5px 14px rgba(15, 23, 42, 0.08)",
                      transform: isPressed ? "translateY(2px) scale(0.997)" : "translateY(0) scale(1)",
                      transition: "transform 120ms ease, box-shadow 120ms ease, background 120ms ease",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 7, height: 7, borderRadius: 999, background: meta.accent }} />
                      <span style={{ fontSize: "0.75rem", fontWeight: 800, color: "var(--text-primary)" }}>
                        {meta.title}
                      </span>
                      <span style={{ fontSize: "0.72rem", fontWeight: 600, color: "var(--text-muted)" }}>
                        {meta.targetLabel}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <StatusChip label="AI" enabled={aiEnabled} />
                      <StatusChip label="direct" enabled={directEnabled} />
                    </div>
                  </button>
                )
              })}
            </div>
          )
        })()}

        <div>
          <a href="/docs" className="text-xs underline" style={{ color: "var(--text-muted)" }}>
            ← Exit Admin Panel
          </a>
        </div>
      </div>

      {dialog && <PermissionDialog state={dialog} onClose={() => setDialog(null)} />}
    </main>
  )
}
