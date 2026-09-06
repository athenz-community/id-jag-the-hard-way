import { EditMcpTemplatePage } from "../EditMcpTemplatePage"

export const dynamic = "force-dynamic"

export default function EditMcpTemplateConfigurationRoute({
  params,
}: {
  params: Promise<{ project: string; product: string; templateKey: string }>
}) {
  return <EditMcpTemplatePage activeStep="configuration" params={params} />
}
