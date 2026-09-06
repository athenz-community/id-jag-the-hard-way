import { EditMcpTemplatePage } from "../EditMcpTemplatePage"

export const dynamic = "force-dynamic"

export default function EditMcpTemplateConfirmRoute({
  params,
}: {
  params: Promise<{ project: string; product: string; templateKey: string }>
}) {
  return <EditMcpTemplatePage activeStep="confirm" params={params} />
}
