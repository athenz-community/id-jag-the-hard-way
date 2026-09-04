import type { ReactNode } from "react"
import { AppBar } from "@/components/organisms/AppBar"
import { SideBar } from "@/components/organisms/SideBar"
import { requireHubSession } from "@/features/auth/lib/session"

export async function ConsoleTemplate({ children }: { children: ReactNode }) {
  const session = await requireHubSession()

  return (
    <main className="console-shell">
      <AppBar user={{
        name: session.user.name,
        email: session.user.email,
        username: session.user.username,
        subject: session.user.subject,
      }} accounts={session.accounts} />

      <div className="app-body">
        <SideBar />

        <section className="main-content">{children}</section>
      </div>
    </main>
  )
}
