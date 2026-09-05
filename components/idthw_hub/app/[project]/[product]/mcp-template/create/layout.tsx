import type { ReactNode } from "react"
import { McpTemplateDraftProvider } from "./McpTemplateDraftContext"

export default function CreateMcpTemplateLayout({ children }: { children: ReactNode }) {
  return <McpTemplateDraftProvider>{children}</McpTemplateDraftProvider>
}
