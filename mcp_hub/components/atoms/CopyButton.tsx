"use client"

import { Check, Copy } from "lucide-react"
import { useState } from "react"

export function CopyButton({
  value,
  className = "",
  label,
}: {
  value: string
  className?: string
  label: string
}) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  return (
    <button
      className={`copy-button ${className}`}
      type="button"
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
      onClick={handleCopy}
    >
      {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
    </button>
  )
}
