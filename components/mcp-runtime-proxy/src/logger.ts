export type LogFields = Record<string, unknown>

export type RuntimeProxyLogger = {
  error(event: string, fields?: LogFields): void
  info(event: string, fields?: LogFields): void
  warn(event: string, fields?: LogFields): void
}

export function createRuntimeProxyLogger(now: () => Date = () => new Date()): RuntimeProxyLogger {
  return {
    error: (event, fields = {}) => write("error", event, fields, now),
    info: (event, fields = {}) => write("info", event, fields, now),
    warn: (event, fields = {}) => write("warn", event, fields, now),
  }
}

export const runtimeProxyLogger = createRuntimeProxyLogger()

function write(
  level: "error" | "info" | "warn",
  event: string,
  fields: LogFields,
  now: () => Date,
) {
  const line = JSON.stringify({
    timestamp: now().toISOString(),
    level,
    component: "mcp-runtime-proxy",
    event,
    ...fields,
  })
  if (level === "error") console.error(line)
  else if (level === "warn") console.warn(line)
  else console.log(line)
}
