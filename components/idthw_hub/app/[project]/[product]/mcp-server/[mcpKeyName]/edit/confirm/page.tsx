import { EditMcpServerPage } from "../EditMcpServerPage"

export const dynamic = "force-dynamic"

export default function EditMcpServerConfirmRoute({
  params,
}: {
  params: Promise<{ project: string; product: string; mcpKeyName: string }>
}) {
  return <EditMcpServerPage activeStep="confirm" params={params} />
}
