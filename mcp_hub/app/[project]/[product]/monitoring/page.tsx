import { ConsoleTemplate } from "@/components/templates/ConsoleTemplate"
import { athenzUserPrincipal, requireHubSession } from "@/features/auth/lib/session"
import { MonitoringDashboard } from "@/features/genai/components/MonitoringDashboard"
import { fetchGenAIUsage } from "@/features/genai/lib/fetchUsage"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function MonitoringRoute({ params }: { params: Promise<{ project: string; product: string }> }) {
  const session = await requireHubSession()
  const { project, product } = await params
  const usage = await fetchGenAIUsage(session.user.username)

  return (
    <ConsoleTemplate>
      <MonitoringDashboard
        project={project}
        product={product}
        user={athenzUserPrincipal(session.user.username)}
        usage={usage}
      />
    </ConsoleTemplate>
  )
}
