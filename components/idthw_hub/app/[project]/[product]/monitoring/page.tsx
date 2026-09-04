import { ConsoleTemplate } from "@/components/templates/ConsoleTemplate"
import { athenzUserPrincipal, requireHubSession } from "@/features/auth/lib/session"
import { MonitoringDashboard } from "@/features/genai/components/MonitoringDashboard"
import { fetchCostAccountableDomains } from "@/features/genai/lib/fetchCostAccountableDomains"
import { fetchGenAIUsage } from "@/features/genai/lib/fetchUsage"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function MonitoringRoute({ params }: { params: Promise<{ project: string; product: string }> }) {
  const session = await requireHubSession()
  const { project, product } = await params
  const user = athenzUserPrincipal(session.user.username)
  const [usage, costAccountableDomains] = await Promise.all([
    fetchGenAIUsage(session.user.username),
    fetchCostAccountableDomains(session.user.username),
  ])

  return (
    <ConsoleTemplate>
      <MonitoringDashboard
        costAccountableDomains={costAccountableDomains}
        project={project}
        product={product}
        user={user}
        usage={usage}
      />
    </ConsoleTemplate>
  )
}
