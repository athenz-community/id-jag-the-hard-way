export type McpToolSchemaProperty = {
  type?: string | string[]
  description?: string
}

export type McpToolInputSchema = {
  type?: string
  properties?: Record<string, McpToolSchemaProperty>
  required?: string[]
  additionalProperties?: boolean
}

export type McpTool = {
  name: string
  title?: string
  description?: string
  inputSchema?: McpToolInputSchema
}

export type McpToolsResult = {
  endpoint: string
  tools: McpTool[]
  error?: string
}
