"use client"

import { Fragment, useState } from "react"
import { Activity, Bot, Home } from "lucide-react"
import Link from "next/link"
import { consoleHref, displayProduct } from "@/components/navigation/consoleRoute"
import type { GenAIUsageResponse, ModelTokenUsage, UserUsage } from "@/features/genai/types/usage"

const DEFAULT_MODEL = "gemma4:26b"
const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  "gemma4:26b": { input: 0.1, output: 0.3 },
  "gemma4:31b": { input: 0.12, output: 0.36 },
}
const FALLBACK_PRICE = { input: 0.1, output: 0.3 }
const MODEL_CHART_COLORS = ["#3f7fe0", "#7256c8", "#35a99a", "#e58b48", "#d45f8d", "#6f879f"]
const SERVICE_CODE_BUDGETS = [
  { serviceCode: "athenz", label: "Athenz", budget: 0.0024, fractionDigits: 5 },
  { serviceCode: "spire", label: "Spire", budget: 0.004, fractionDigits: 3 },
]

type DailyModelUsage = ModelTokenUsage & {
  date: string
  lastUsage: string
}

type SystemCodeUsage = {
  dailyEstimatedCost: number
  name: string
}

type DailyModelDetail = {
  cost: number
  date: string
  input: number
  lastUsage: string
  model: string
  output: number
  requests: number
  total: number
}

type ChartTooltip = {
  color: string
  detail: DailyModelDetail
  left: number
  placement: "left" | "right"
  top: number
}

export function MonitoringDashboard({
  project,
  product,
  user,
  usage,
}: {
  project: string
  product: string
  user: string
  usage: GenAIUsageResponse
}) {
  const dashboard = buildDashboardData(usage, user)

  return (
    <>
      <GenAIBreadcrumb project={project} product={product} current="Monitoring Dashboard" />
      <div className="genai-page-head">
        <div>
          <span className="genai-eyebrow">Gen AI</span>
          <h1 className="page-title">Monitoring Dashboard</h1>
          <p>Daily model usage for <strong>{user}</strong>, grouped by associated system code.</p>
        </div>
      </div>

      {usage.error ? (
        <div className="genai-notice" role="status">
          <Activity size={16} aria-hidden="true" />
          Live usage is unavailable: {usage.error}. The dashboard will populate when the local GenAI proxy is running.
        </div>
      ) : null}

      <DashboardPanel title="Token usage by model" subtitle="Daily combined input + output tokens for the last 30 days (JST)">
        <TokenUsageChart days={dashboard.days} />
      </DashboardPanel>

      <DashboardPanel title={`Cost incurred by ${user}`} subtitle="Estimated daily model cost in USD for the last 30 days (JST)">
        <CostIncurredChart days={dashboard.days} />
      </DashboardPanel>

      <SpendingLimits systemCodes={dashboard.systemCodes} />
    </>
  )
}

function SpendingLimits({ systemCodes }: { systemCodes: SystemCodeUsage[] }) {
  const rows = SERVICE_CODE_BUDGETS.flatMap((limit) => {
    const usage = systemCodes.find((item) => item.name.toLowerCase() === limit.serviceCode)
    if (!usage) return []

    const spent = usage.dailyEstimatedCost
    const usedPercent = limit.budget > 0 ? (spent / limit.budget) * 100 : 0
    return [{
      ...limit,
      spent,
      usedPercent,
      barPercent: Math.min(usedPercent, 100),
      remaining: Math.max(limit.budget - spent, 0),
    }]
  })

  return (
    <section className="dashboard-panel spending-panel">
      <div className="dashboard-panel-head spending-panel-head">
        <div>
          <h2>Service Code Spending Limits</h2>
          <p>Today&apos;s estimated model spend. Daily limits reset at 00:00 JST.</p>
        </div>
        <div className="budget-legend" aria-label="Budget chart legend">
          <span><i className="budget-spent-key" />Budget spent</span>
          <span><i className="budget-remaining-key" />Budget remaining</span>
        </div>
      </div>
      <div className="spending-chart">
        {rows.map((row) => (
          <article className="spending-row" key={row.serviceCode}>
            <div className="spending-label">
              <span className="service-avatar">{row.label.slice(0, 1)}</span>
              <span>
                <strong>{row.label}</strong>
                <small>{row.serviceCode} · daily local limit</small>
              </span>
            </div>
            <div className="spending-bar-column">
              <div className="spending-values">
                <strong>{formatCurrency(row.spent)} spent</strong>
                <span>{formatPercent(row.usedPercent)} of {formatBudget(row.budget, row.fractionDigits)}</span>
              </div>
              <div
                className="spending-bar"
                role="img"
                aria-label={`${row.label}: ${formatPercent(row.usedPercent)} of ${formatBudget(row.budget, row.fractionDigits)} spent`}
              >
                <span
                  className={`spending-bar-used ${row.spent > 0 ? "has-spend" : ""}`}
                  style={{ width: `${row.barPercent}%` }}
                />
                <span className="spending-bar-remaining" />
              </div>
              <div className="spending-axis" aria-hidden="true">
                <span>0%</span><span>20%</span><span>40%</span><span>60%</span><span>80%</span><span>100%</span>
              </div>
            </div>
            <div className="spending-summary">
              <span>Remaining</span>
              <strong>{formatCurrency(row.remaining)}</strong>
              <small>Limit {formatBudget(row.budget, row.fractionDigits)}</small>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

export function GenAIBreadcrumb({ project, product, current }: { project: string; product: string; current: string }) {
  const monitoringHref = consoleHref({ project, product, section: "monitoring" })
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <Link href={monitoringHref} aria-label="Gen AI home"><Home size={14} aria-hidden="true" /></Link>
      <Link href={monitoringHref}>{displayProduct(product)}</Link>
      <span>/</span>
      <strong>{current}</strong>
    </nav>
  )
}

function DashboardPanel({
  title,
  subtitle,
  className = "",
  children,
}: {
  title: string
  subtitle: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <section className={`dashboard-panel ${className}`}>
      <div className="dashboard-panel-head">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
      </div>
      {children}
    </section>
  )
}

function TokenUsageChart({ days }: { days: DailyModelUsage[] }) {
  return (
    <DailyModelChart
      ariaLabel="Daily combined token usage grouped by model"
      days={days}
      formatAxis={(value) => formatCompact(Math.round(value))}
      formatValue={(value) => `${formatCompact(value)} tokens`}
      minimumMax={1}
      valueFor={(day) => day.total}
    />
  )
}

function CostIncurredChart({ days }: { days: DailyModelUsage[] }) {
  return (
    <DailyModelChart
      ariaLabel="Daily estimated cost incurred grouped by model"
      days={days}
      formatAxis={formatCurrency}
      formatValue={(value) => `${formatCurrency(value)} incurred`}
      minimumMax={Number.EPSILON}
      valueFor={estimatedCost}
    />
  )
}

function DailyModelChart({
  ariaLabel,
  days,
  formatAxis,
  formatValue,
  minimumMax,
  valueFor,
}: {
  ariaLabel: string
  days: DailyModelUsage[]
  formatAxis: (value: number) => string
  formatValue: (value: number) => string
  minimumMax: number
  valueFor: (day: DailyModelUsage) => number
}) {
  const [tooltip, setTooltip] = useState<ChartTooltip>()
  const daily = aggregateModelDays(days, valueFor)
  const visibleDates = new Set(daily.map((item) => item.date))
  const visibleDays = days.filter((item) => visibleDates.has(item.date))
  const models = [...new Set(visibleDays.map((item) => item.model))].sort()
  const modelTotals = new Map(models.map((model) => [
    model,
    visibleDays.filter((item) => item.model === model).reduce((sum, item) => sum + valueFor(item), 0),
  ]))
  const dailyDetails = aggregateDailyModelDetails(visibleDays)
  const max = Math.max(
    ...daily.map((item) => [...item.totals.values()].reduce((sum, value) => sum + value, 0)),
    minimumMax,
  )
  const width = 760
  const height = 238
  const left = 58
  const bottom = 38
  const plotHeight = height - bottom - 18
  const plotWidth = width - left - 18
  const groupWidth = plotWidth / Math.max(daily.length, 1)
  const barWidth = Math.min(34, groupWidth * 0.58)

  function showTooltip(target: SVGRectElement, clientX: number, clientY: number, detail: DailyModelDetail, color: string) {
    const wrapper = target.closest(".chart-wrap")
    if (!wrapper) return

    const bounds = wrapper.getBoundingClientRect()
    const tooltipWidth = 252
    const tooltipHeight = 148
    const pointerX = clientX - bounds.left
    const pointerY = clientY - bounds.top
    let left = pointerX + 9
    let top = pointerY - 22
    let placement: ChartTooltip["placement"] = "right"
    if (left + tooltipWidth > bounds.width - 8) {
      left = pointerX - tooltipWidth - 9
      placement = "left"
    }
    if (top + tooltipHeight > bounds.height - 8) top = bounds.height - tooltipHeight - 8

    setTooltip({
      color,
      detail,
      left: Math.max(8, left),
      placement,
      top: Math.max(8, top),
    })
  }

  if (visibleDays.length === 0) return <EmptyChart />

  return (
    <div className="chart-wrap">
      <svg className="usage-svg" role="img" aria-label={ariaLabel} viewBox={`0 0 ${width} ${height}`}>
        {[0, 0.5, 1].map((ratio) => {
          const y = 18 + plotHeight * (1 - ratio)
          return (
            <Fragment key={ratio}>
              <line x1={left} x2={width - 18} y1={y} y2={y} className="chart-grid-line" />
              <text x={left - 10} y={y + 4} textAnchor="end" className="chart-axis-label">{formatAxis(max * ratio)}</text>
            </Fragment>
          )
        })}
        {daily.map((item, index) => {
          const center = left + groupWidth * index + groupWidth / 2
          let stackedHeight = 0
          return (
            <g key={item.date}>
              {models.map((model, modelIndex) => {
                const value = item.totals.get(model) ?? 0
                const segmentHeight = (value / max) * plotHeight
                const y = 18 + plotHeight - stackedHeight - segmentHeight
                const detail = dailyDetails.get(dailyModelKey(item.date, model))
                const tooltip = formatChartTooltip(detail)
                const color = MODEL_CHART_COLORS[modelIndex % MODEL_CHART_COLORS.length]
                stackedHeight += segmentHeight
                return (
                  <rect
                    aria-label={tooltip.replaceAll("\n", ", ")}
                    className="chart-data-segment"
                    fill={color}
                    height={segmentHeight}
                    key={model}
                    onBlur={() => setTooltip(undefined)}
                    onFocus={(event) => {
                      if (!detail) return
                      const bounds = event.currentTarget.getBoundingClientRect()
                      showTooltip(event.currentTarget, bounds.left + bounds.width / 2, bounds.top, detail, color)
                    }}
                    onPointerEnter={(event) => {
                      if (detail) showTooltip(event.currentTarget, event.clientX, event.clientY, detail, color)
                    }}
                    onPointerLeave={() => setTooltip(undefined)}
                    onPointerMove={(event) => {
                      if (detail) showTooltip(event.currentTarget, event.clientX, event.clientY, detail, color)
                    }}
                    rx="2"
                    tabIndex={detail ? 0 : -1}
                    width={barWidth}
                    x={center - barWidth / 2}
                    y={y}
                  />
                )
              })}
              {index === 0 || index === daily.length - 1 || index % 5 === 0 ? (
                <text x={center} y={height - 14} textAnchor="middle" className="chart-date-label">{item.date.slice(5)}</text>
              ) : null}
            </g>
          )
        })}
      </svg>
      <div className="chart-legend model-chart-legend">
        {models.map((model, index) => (
          <span className="model-legend-item" key={model}>
            <i style={{ backgroundColor: MODEL_CHART_COLORS[index % MODEL_CHART_COLORS.length] }} />
            {model} · {formatValue(modelTotals.get(model) ?? 0)}
          </span>
        ))}
      </div>
      {tooltip ? <ChartTooltipBox tooltip={tooltip} /> : null}
    </div>
  )
}

function ChartTooltipBox({ tooltip }: { tooltip: ChartTooltip }) {
  const { color, detail, left, placement, top } = tooltip
  const textColor = contrastTextColor(color)
  const style = {
    backgroundColor: color,
    color: textColor,
    left,
    top,
    "--chart-tooltip-color": color,
    "--chart-tooltip-text": textColor,
  } as React.CSSProperties
  return (
    <div className={`chart-tooltip-box tooltip-${placement}`} role="tooltip" style={style}>
      <div><strong>model</strong>={detail.model}</div>
      <div><strong>datetime</strong>={formatDisplayDate(detail.date)} {detail.lastUsage} JST</div>
      <div><strong>requests</strong>={formatInteger(detail.requests)}</div>
      <div><strong>input tokens</strong>={formatInteger(detail.input)}</div>
      <div><strong>output tokens</strong>={formatInteger(detail.output)}</div>
      <div><strong>total tokens</strong>={formatInteger(detail.total)}</div>
      <div><strong>Cost (USD)</strong>={formatCurrency(detail.cost)}</div>
    </div>
  )
}

function EmptyChart() {
  return (
    <div className="empty-chart">
      <Bot size={22} aria-hidden="true" />
      No model usage has been recorded yet.
    </div>
  )
}

function buildDashboardData(usage: GenAIUsageResponse, user: string) {
  const days: DailyModelUsage[] = []
  const systemCodes: SystemCodeUsage[] = []
  const today = currentJstDate()

  for (const project of usage.projects) {
    const entries = project.users.filter((entry) => entry.sub === user)
    if (!entries.length) continue

    let dailyProjectCost = 0
    for (const entry of entries) {
      for (const token of normalizedModels(entry)) {
        days.push({ ...token, date: entry.date, lastUsage: entry.last_usage })
        if (entry.date === today) dailyProjectCost += estimatedCost(token)
      }
    }

    systemCodes.push({
      dailyEstimatedCost: dailyProjectCost,
      name: project.project,
    })
  }

  return {
    days: days.sort((left, right) => left.date.localeCompare(right.date) || left.model.localeCompare(right.model)),
    systemCodes: systemCodes.sort((left, right) => left.name.localeCompare(right.name)),
  }
}

function normalizedModels(entry: UserUsage): ModelTokenUsage[] {
  return entry.tokens?.length
    ? entry.tokens
    : [{ model: DEFAULT_MODEL, requests: entry.requests, input: entry.input_tokens, output: entry.output_tokens, total: entry.total_tokens }]
}

function aggregateModelDays(days: DailyModelUsage[], valueFor: (day: DailyModelUsage) => number) {
  const dates = lastJstDates(30)
  const map = new Map(dates.map((date) => [date, { date, totals: new Map<string, number>() }]))
  for (const day of days) {
    const value = map.get(day.date)
    if (!value) continue
    value.totals.set(day.model, (value.totals.get(day.model) ?? 0) + valueFor(day))
  }
  return [...map.values()]
}

function aggregateDailyModelDetails(days: DailyModelUsage[]) {
  const map = new Map<string, DailyModelDetail>()
  for (const day of days) {
    const key = dailyModelKey(day.date, day.model)
    const detail = map.get(key) ?? {
      cost: 0,
      date: day.date,
      input: 0,
      lastUsage: day.lastUsage,
      model: day.model,
      output: 0,
      requests: 0,
      total: 0,
    }
    detail.cost += estimatedCost(day)
    detail.input += day.input
    detail.lastUsage = detail.lastUsage.localeCompare(day.lastUsage) >= 0 ? detail.lastUsage : day.lastUsage
    detail.output += day.output
    detail.requests += day.requests
    detail.total += day.total
    map.set(key, detail)
  }
  return map
}

function dailyModelKey(date: string, model: string) {
  return `${date}\u0000${model}`
}

function formatChartTooltip(detail: DailyModelDetail | undefined) {
  if (!detail) return "No usage recorded"
  return [
    `Model: ${detail.model}`,
    `Last usage (JST): ${detail.date} ${detail.lastUsage}`,
    `Requests: ${formatInteger(detail.requests)}`,
    `Input tokens: ${formatInteger(detail.input)}`,
    `Output tokens: ${formatInteger(detail.output)}`,
    `Total tokens: ${formatInteger(detail.total)}`,
    `Cost (USD): ${formatCurrency(detail.cost)}`,
  ].join("\n")
}

function lastJstDates(count: number) {
  const end = new Date(`${currentJstDate()}T00:00:00.000Z`)
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(end)
    date.setUTCDate(end.getUTCDate() - (count - index - 1))
    return date.toISOString().slice(0, 10)
  })
}

function estimatedCost(model: Pick<ModelTokenUsage, "model" | "input" | "output">) {
  const price = MODEL_PRICES[model.model] ?? FALLBACK_PRICE
  return (model.input * price.input + model.output * price.output) / 1_000_000
}

function currentJstDate() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function formatCompact(value: number) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value)
}

function formatInteger(value: number) {
  return new Intl.NumberFormat("en-US").format(value)
}

function formatDisplayDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${value}T00:00:00.000Z`))
}

function contrastTextColor(hex: string) {
  const red = Number.parseInt(hex.slice(1, 3), 16)
  const green = Number.parseInt(hex.slice(3, 5), 16)
  const blue = Number.parseInt(hex.slice(5, 7), 16)
  return (red * 299 + green * 587 + blue * 114) / 1000 >= 150 ? "#172033" : "#ffffff"
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value)
}

function formatBudget(value: number, fractionDigits: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value)
}

function formatPercent(value: number) {
  if (value === 0) return "0%"
  if (value < 0.01) return "<0.01%"
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)}%`
}
