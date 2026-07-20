import { createGenAIProxy } from "./server.ts"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { createTokenVerifier } from "./auth.ts"

const port = parsePort(process.env.PORT ?? "64443")
const host = process.env.HOST ?? "0.0.0.0"
const ollamaBaseUrl = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434"
const publicKeyPath = process.env.ATHENZ_PUBLIC_KEY_PATH
  ?? fileURLToPath(new URL("../../athenz_dist/keys/zts.public.pem", import.meta.url))

const authenticate = createTokenVerifier({ publicKey: readFileSync(publicKeyPath) })
const server = createGenAIProxy({ authenticate, ollamaBaseUrl })

server.listen(port, host, () => {
  console.log(`genai-proxy listening on http://${host}:${port}`)
  console.log(`forwarding Ollama API requests to ${ollamaBaseUrl}`)
  console.log(`validating Athenz ATs with ${publicKeyPath}`)
  console.log("required audience: gen-ai.services.<project>; required scope: gen-ai-users")
})

function parsePort(value: string) {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be an integer from 1 to 65535, got ${value}`)
  }
  return port
}
