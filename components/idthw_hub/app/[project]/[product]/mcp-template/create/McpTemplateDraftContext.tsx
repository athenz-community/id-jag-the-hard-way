"use client"

import { createContext, type Dispatch, type ReactNode, type SetStateAction, useContext, useState } from "react"

export type McpTemplateEnvironmentVariableDraft = {
  id: number
  key: string
  description: string
  required: boolean
  secret: boolean
  defaultValue: string
}

type McpTemplateDraft = {
  image: string
  port: string
  path: string
  command: string
  argument: string
  name: string
  templateKey: string
  templateKeyWasCustomized: boolean
  showTemplateKeyWarning: boolean
  environmentVariables: McpTemplateEnvironmentVariableDraft[]
  visibility: "project"
  documentation: string
  description: string
}

const INITIAL_DRAFT: McpTemplateDraft = {
  image: "",
  port: "8080",
  path: "/mcp",
  command: "",
  argument: "",
  name: "",
  templateKey: "",
  templateKeyWasCustomized: false,
  showTemplateKeyWarning: false,
  environmentVariables: [
    { id: 1, key: "", description: "", required: true, secret: false, defaultValue: "" },
  ],
  visibility: "project",
  documentation: "",
  description: "",
}

const McpTemplateDraftContext = createContext<{
  draft: McpTemplateDraft
  setDraft: Dispatch<SetStateAction<McpTemplateDraft>>
  resetDraft: () => void
} | null>(null)

export function McpTemplateDraftProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<McpTemplateDraft>(INITIAL_DRAFT)

  return (
    <McpTemplateDraftContext.Provider value={{ draft, setDraft, resetDraft: () => setDraft(INITIAL_DRAFT) }}>
      {children}
    </McpTemplateDraftContext.Provider>
  )
}

export function useMcpTemplateDraft() {
  const context = useContext(McpTemplateDraftContext)

  if (!context) {
    throw new Error("useMcpTemplateDraft must be used within McpTemplateDraftProvider")
  }

  return context
}
