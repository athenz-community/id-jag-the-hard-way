"use client"

import { createContext, type Dispatch, type ReactNode, type SetStateAction, useContext, useState } from "react"

type McpCreateEnvironmentVariable = {
  id: number
  key: string
  value: string
  secret: boolean
}

type McpCreateDraft = {
  image: string
  port: string
  path: string
  command: string
  argument: string
  serverName: string
  mcpKeyName: string
  mcpKeyWasCustomized: boolean
  showMcpKeyWarning: boolean
  environmentVariables: McpCreateEnvironmentVariable[]
  vpc: string
  vpcNetwork: string
  accessManagement: "hub" | "server"
  hubServiceAccountName: string
}

const INITIAL_DRAFT: McpCreateDraft = {
  image: "",
  port: "8080",
  path: "/mcp",
  command: "",
  argument: "",
  serverName: "",
  mcpKeyName: "",
  mcpKeyWasCustomized: false,
  showMcpKeyWarning: false,
  environmentVariables: [{ id: 1, key: "", value: "", secret: false }],
  vpc: "default-vpc",
  vpcNetwork: "default-vpc-network",
  accessManagement: "hub",
  hubServiceAccountName: "",
}

const McpCreateDraftContext = createContext<{
  draft: McpCreateDraft
  setDraft: Dispatch<SetStateAction<McpCreateDraft>>
  resetDraft: () => void
} | null>(null)

export function McpCreateDraftProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<McpCreateDraft>(INITIAL_DRAFT)

  return (
    <McpCreateDraftContext.Provider value={{ draft, setDraft, resetDraft: () => setDraft(INITIAL_DRAFT) }}>
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
