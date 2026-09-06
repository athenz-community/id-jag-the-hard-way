export type McpTemplateEnvironmentVariable = {
  key: string
  description: string
  required: boolean
  secret: boolean
  defaultValue?: string
}

export type McpTemplateInput = {
  project: string
  name: string
  templateKey: string
  iconId: string
  image: string
  port: string
  path: string
  command: string
  arguments: string[]
  transport: "streamable-http"
  environmentVariables: McpTemplateEnvironmentVariable[]
  visibility: "project"
  documentation: string
  description: string
}

export type McpTemplateSummary = {
  key: string
  name: string
  iconId: string
  project: string
  visibility: "Project"
}

export type McpTemplateListResponse = {
  templates: McpTemplateSummary[]
  error?: string
}

export type McpTemplateDetailResponse = {
  template?: McpTemplateInput
  error?: string
}
