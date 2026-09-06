"use client"

import { createContext, type Dispatch, type ReactNode, type SetStateAction, useContext, useState } from "react"
import type { McpTemplateInput } from "@/features/mcp-templates/types"
import { toolPermissionDraftFromSettings } from "@/features/permissions/lib/toolPermissionDraft"
import type { ToolPermissionDraft } from "@/features/permissions/types/permissions"
import type { McpServerConfiguration } from "@/features/registration/api/mcpResources"

type McpCreateEnvironmentVariable = {
  id: number
  key: string
  value: string
  secret: boolean
  hasExistingSecret?: boolean
}

export type McpCreateTemplateEnvironmentVariable = {
  id: number
  key: string
  description: string
  required: boolean
  secret: boolean
  value: string
}

export type McpCreateDraft = {
  creationMethod: "direct" | "template"
  image: string
  port: string
  path: string
  command: string
  containerArguments: Array<{ id: number; value: string }>
  serverName: string
  description: string
  iconId: string
  mcpKeyName: string
  mcpKeyWasCustomized: boolean
  showMcpKeyWarning: boolean
  environmentVariables: McpCreateEnvironmentVariable[]
  selectedTemplateKey: string
  selectedTemplate: McpTemplateInput | null
  templateEnvironmentVariables: McpCreateTemplateEnvironmentVariable[]
  visibility: "personal" | "project"
  vpc: string
  vpcNetwork: string
  accessManagement: "hub" | "server"
  hubServiceAccountName: string
  toolPermissions: ToolPermissionDraft[]
}

const INITIAL_DRAFT: McpCreateDraft = {
  creationMethod: "direct",
  image: "",
  port: "8080",
  path: "/mcp",
  command: "",
  containerArguments: [{ id: 1, value: "" }],
  serverName: "",
  description: "",
  iconId: "",
  mcpKeyName: "",
  mcpKeyWasCustomized: false,
  showMcpKeyWarning: false,
  environmentVariables: [{ id: 1, key: "", value: "", secret: false }],
  selectedTemplateKey: "",
  selectedTemplate: null,
  templateEnvironmentVariables: [],
  visibility: "personal",
  vpc: "default-vpc",
  vpcNetwork: "default-vpc-network",
  accessManagement: "hub",
  hubServiceAccountName: "",
  toolPermissions: [],
}

function draftFromServer(server: McpServerConfiguration): McpCreateDraft {
  return {
    creationMethod: server.creationMethod,
    image: server.image,
    port: server.port,
    path: server.path,
    command: server.command,
    containerArguments: server.arguments.length > 0
      ? server.arguments.map((value, index) => ({ id: index + 1, value }))
      : [{ id: 1, value: "" }],
    serverName: server.serverName,
    description: server.description,
    iconId: server.iconId,
    mcpKeyName: server.mcpKeyName,
    mcpKeyWasCustomized: true,
    showMcpKeyWarning: false,
    environmentVariables: server.environmentVariables.length > 0
      ? server.environmentVariables.map((variable, index) => ({
          id: index + 1,
          key: variable.key,
          value: variable.value,
          secret: variable.secret,
          hasExistingSecret: variable.preserveExistingSecret,
        }))
      : [{ id: 1, key: "", value: "", secret: false }],
    selectedTemplateKey: server.templateKey,
    selectedTemplate: null,
    templateEnvironmentVariables: [],
    visibility: server.visibility,
    vpc: "default-vpc",
    vpcNetwork: "default-vpc-network",
    accessManagement: server.accessManagement,
    hubServiceAccountName: server.serviceAccount,
    toolPermissions: toolPermissionDraftFromSettings(server.toolPermissions, server.serviceAccount),
  }
}

const McpCreateDraftContext = createContext<{
  draft: McpCreateDraft
  initialDraft: McpCreateDraft
  setDraft: Dispatch<SetStateAction<McpCreateDraft>>
  resetDraft: () => void
} | null>(null)

export function McpCreateDraftProvider({
  children,
  initialServer,
}: {
  children: ReactNode
  initialServer?: McpServerConfiguration
}) {
  const [initialDraft] = useState(() => initialServer ? draftFromServer(initialServer) : INITIAL_DRAFT)
  const [draft, setDraft] = useState<McpCreateDraft>(initialDraft)

  return (
    <McpCreateDraftContext.Provider value={{ draft, initialDraft, setDraft, resetDraft: () => setDraft(initialDraft) }}>
      {children}
    </McpCreateDraftContext.Provider>
  )
}

export function useMcpCreateDraft() {
  const context = useContext(McpCreateDraftContext)

  if (!context) {
    throw new Error("useMcpCreateDraft must be used within McpCreateDraftProvider")
  }

  return context
}
