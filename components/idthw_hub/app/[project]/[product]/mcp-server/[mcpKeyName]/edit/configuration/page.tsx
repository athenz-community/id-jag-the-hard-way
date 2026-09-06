import { EditMcpServerPage } from "../EditMcpServerPage"

export const dynamic = "force-dynamic"

export default function EditMcpServerConfigurationRoute({
  params,
}: {
  params: Promise<{ project: string; product: string; mcpKeyName: string }>
}) {
  return <EditMcpServerPage activeStep="configuration" params={params} />
}
