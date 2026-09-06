import { Check } from "lucide-react"
import Link from "next/link"

export type McpTemplateStep = "source" | "configuration" | "reference" | "confirm"

const STEPS: Array<{ id: McpTemplateStep; label: string }> = [
  { id: "source", label: "Source" },
  { id: "configuration", label: "Configuration" },
  { id: "reference", label: "Reference info" },
  { id: "confirm", label: "Confirm" },
]

export function McpTemplateCreateSteps({
  activeStep,
  sourceHref,
  configurationHref,
  referenceHref,
  mode = "register",
}: {
  activeStep: McpTemplateStep
  sourceHref: string
  configurationHref?: string
  referenceHref?: string
  mode?: "register" | "edit"
}) {
  const activeIndex = STEPS.findIndex((step) => step.id === activeStep)

  return (
    <nav className="mcp-create-step-panel" aria-label={`Template ${mode} steps`}>
      <ol className="mcp-create-steps">
        {STEPS.map((step, index) => {
          const isActive = step.id === activeStep
          const isFinished = index < activeIndex
          const href = step.id === "source"
            ? sourceHref
            : step.id === "configuration"
              ? configurationHref
              : step.id === "reference"
                ? referenceHref
                : undefined
          const className = `mcp-create-step ${isActive ? "active" : ""} ${isFinished ? "finished" : ""}`
          const content = (
            <>
              <span className="mcp-create-step-number">
                {isFinished ? <Check size={18} aria-hidden="true" /> : index + 1}
              </span>
              <span>{step.label}</span>
            </>
          )

          return (
            <li className={className} aria-current={isActive ? "step" : undefined} key={step.id}>
              {isFinished && href ? (
                <Link href={href}>{content}</Link>
              ) : (
                <button type="button" disabled={!isActive}>{content}</button>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
