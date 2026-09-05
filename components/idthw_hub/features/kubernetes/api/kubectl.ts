import { spawn } from "node:child_process"

const KUBECTL_TIMEOUT_MS = 15_000
const MAX_COMMAND_OUTPUT_BYTES = 32_768

export type KubectlResult = {
  stdout: string
  stderr: string
}

export type KubectlRunner = (args: string[], stdin?: string) => Promise<KubectlResult>

export function kubectlArgs(args: string[]) {
  const connectionArgs: string[] = []
  const server = process.env.MCP_HUB_KUBECTL_SERVER
  const tlsServerName = process.env.MCP_HUB_KUBECTL_TLS_SERVER_NAME
  if (server) connectionArgs.push("--server", server)
  if (tlsServerName) connectionArgs.push("--tls-server-name", tlsServerName)
  return [...connectionArgs, ...args]
}

export function runKubectlCommand(args: string[], stdin?: string): Promise<KubectlResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("kubectl", args, {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: KUBECTL_TIMEOUT_MS,
    })
    let stdout = ""
    let stderr = ""
    let outputExceeded = false

    const appendOutput = (current: string, chunk: Buffer) => {
      const next = current + chunk.toString("utf8")
      if (Buffer.byteLength(next) > MAX_COMMAND_OUTPUT_BYTES) {
        outputExceeded = true
        child.kill()
        return current
      }
      return next
    }

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = appendOutput(stdout, chunk)
    })
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = appendOutput(stderr, chunk)
    })
    child.on("error", (error) => reject(error))
    child.on("close", (code, signal) => {
      if (outputExceeded) {
        reject(new KubectlCommandError("kubectl output exceeded the limit", stderr))
      } else if (code === 0) {
        resolve({ stdout, stderr })
      } else {
        reject(new KubectlCommandError(
          `kubectl exited with code ${code ?? "unknown"}${signal ? ` (${signal})` : ""}`,
          stderr,
        ))
      }
    })

    child.stdin.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "EPIPE") reject(error)
    })
    child.stdin.end(stdin)
  })
}

export class KubectlCommandError extends Error {
  readonly stderr: string

  constructor(message: string, stderr: string) {
    super(message)
    this.stderr = stderr
  }
}

export function isKubectlAlreadyExists(error: unknown) {
  return error instanceof KubectlCommandError && /alreadyexists|already exists/i.test(error.stderr)
}
