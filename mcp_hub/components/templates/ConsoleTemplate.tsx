import type { ReactNode } from "react"
import { AppBar } from "@/components/organisms/AppBar"
import { SideBar } from "@/components/organisms/SideBar"

export function ConsoleTemplate({ children }: { children: ReactNode }) {
  return (
    <main className="console-shell">
      <AppBar />

      <div className="app-body">
        <SideBar />

        <section className="main-content">{children}</section>
      </div>
    </main>
  )
}
