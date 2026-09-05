import { createRuntimeProxyServer } from "./proxy.ts"

const port = parsePort(process.env.PORT ?? "8082")
const target = new URL(process.env.MCP_TARGET_URL ?? "http://127.0.0.1:8080")
const server = createRuntimeProxyServer(target)

server.listen(port, "0.0.0.0", () => {
  console.log(`mcp-runtime-proxy listening on 0.0.0.0:${port}`)
  console.log(`forwarding MCP requests to ${target.origin}${target.pathname}`)
})

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
  })
}

function parsePort(value: string) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid PORT ${JSON.stringify(value)}`)
  }
  return parsed
}
