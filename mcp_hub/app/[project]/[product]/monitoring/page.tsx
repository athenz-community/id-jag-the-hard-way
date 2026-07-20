import { CURRENT_USER } from "@/components/navigation/consoleRoute"
import { ConsoleTemplate } from "@/components/templates/ConsoleTemplate"
import { MonitoringDashboard } from "@/features/genai/components/MonitoringDashboard"
import { fetchGenAIUsage } from "@/features/genai/lib/fetchUsage"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function MonitoringRoute({ params }: { params: Promise<{ project: string; product: string }> }) {
  const { project, product } = await params
  const usage = await fetchGenAIUsage()

  return <ConsoleTemplate><MonitoringDashboard project={project} product={product} user={CURRENT_USER} usage={usage} /></ConsoleTemplate>
}
