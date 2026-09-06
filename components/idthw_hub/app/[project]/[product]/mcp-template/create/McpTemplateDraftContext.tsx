"use client"

import { createContext, type Dispatch, type ReactNode, type SetStateAction, useContext, useState } from "react"
import type { McpTemplateInput } from "@/features/mcp-templates/types"

export type McpTemplateEnvironmentVariableDraft = {
  id: number
  key: string
  description: string
  required: boolean
  secret: boolean
  defaultValue: string
}

export type McpTemplateDraft = {
  iconId: string
  image: string
  port: string
  path: string
  command: string
  containerArguments: Array<{ id: number; value: string }>
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
  iconId: "",
  image: "",
  port: "8080",
  path: "/mcp",
  command: "",
  containerArguments: [{ id: 1, value: "" }],
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

function draftFromTemplate(template: McpTemplateInput): McpTemplateDraft {
  return {
    iconId: template.iconId,
    image: template.image,
    port: template.port,
    path: template.path,
    command: template.command,
    containerArguments: template.arguments.length > 0
      ? template.arguments.map((value, index) => ({ id: index + 1, value }))
      : [{ id: 1, value: "" }],
    name: template.name,
    templateKey: template.templateKey,
    templateKeyWasCustomized: true,
    showTemplateKeyWarning: false,
    environmentVariables: template.environmentVariables.length > 0
      ? template.environmentVariables.map((variable, index) => ({
          id: index + 1,
          key: variable.key,
          description: variable.description,
          required: variable.required,
          secret: variable.secret,
          defaultValue: variable.secret ? "" : (variable.defaultValue ?? ""),
        }))
      : [{ id: 1, key: "", description: "", required: true, secret: false, defaultValue: "" }],
    visibility: template.visibility,
    documentation: template.documentation,
    description: template.description,
  }
}

const McpTemplateDraftContext = createContext<{
  draft: McpTemplateDraft
  initialDraft: McpTemplateDraft
  setDraft: Dispatch<SetStateAction<McpTemplateDraft>>
  resetDraft: () => void
} | null>(null)

export function McpTemplateDraftProvider({
  children,
  initialTemplate,
}: {
  children: ReactNode
  initialTemplate?: McpTemplateInput
}) {
  const [initialDraft] = useState(() => initialTemplate ? draftFromTemplate(initialTemplate) : INITIAL_DRAFT)
  const [draft, setDraft] = useState<McpTemplateDraft>(initialDraft)

  return (
    <McpTemplateDraftContext.Provider value={{ draft, initialDraft, setDraft, resetDraft: () => setDraft(initialDraft) }}>
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
