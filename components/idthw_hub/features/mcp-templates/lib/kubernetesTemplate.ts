import { stringify } from "yaml"
import type { McpTemplateInput } from "../types.ts"

const TEMPLATE_NAMESPACE = "mcp-hub"
const TEMPLATE_PREFIX = "mcp-template-"
const TEMPLATE_DATA_KEY = "template.json"

export function buildStoredMcpTemplate(input: McpTemplateInput) {
  return {
    version: 1,
    ...input,
    ...(input.toolPermissions ? { toolPermissions: input.toolPermissions } : {}),
    environmentVariables: input.environmentVariables.map((variable) => ({
      key: variable.key,
      description: variable.description,
      required: variable.required,
      secret: variable.secret,
      ...(variable.secret ? {} : { defaultValue: variable.defaultValue ?? "" }),
    })),
  }
}

export function buildMcpTemplateSecret(input: McpTemplateInput) {
  return {
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      name: `${TEMPLATE_PREFIX}${input.templateKey}`,
      namespace: TEMPLATE_NAMESPACE,
      labels: {
        "app.kubernetes.io/part-of": "mcp-hub",
        "mcp.idthw.dev/resource": "mcp-template",
        "mcp.idthw.dev/template-key": input.templateKey,
        "mcp.idthw.dev/project": input.project,
      },
      annotations: {
        "mcp.idthw.dev/template-name": input.name,
        ...(input.iconId ? { "mcp.idthw.dev/icon": input.iconId } : {}),
      },
    },
    type: "Opaque",
    stringData: {
      [TEMPLATE_DATA_KEY]: JSON.stringify(buildStoredMcpTemplate(input), null, 2),
    },
  }
}

export function buildMcpTemplatePatch(input: McpTemplateInput) {
  const secret = buildMcpTemplateSecret(input)
  return {
    ...secret,
    metadata: {
      ...secret.metadata,
      annotations: {
        ...secret.metadata.annotations,
        "mcp.idthw.dev/icon": input.iconId || null,
      },
    },
  }
}

export function buildMcpTemplateManifest(input: McpTemplateInput) {
  return stringify(buildMcpTemplateSecret(input), { lineWidth: 0 }).trimEnd()
}
