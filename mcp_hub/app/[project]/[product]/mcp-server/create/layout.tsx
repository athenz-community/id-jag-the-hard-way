import type { ReactNode } from "react"
import { McpCreateDraftProvider } from "./McpCreateDraftContext"

export default function CreateMcpServerLayout({ children }: { children: ReactNode }) {
  return <McpCreateDraftProvider>{children}</McpCreateDraftProvider>
}
