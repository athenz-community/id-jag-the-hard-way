import { EditMcpServerPage } from "./EditMcpServerPage"

export const dynamic = "force-dynamic"

export default function EditMcpServerSourceRoute({
  params,
}: {
  params: Promise<{ project: string; product: string; mcpKeyName: string }>
}) {
  return <EditMcpServerPage activeStep="source" params={params} />
}
