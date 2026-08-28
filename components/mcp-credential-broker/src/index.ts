#!/usr/bin/env node

import path from "node:path"
import { fileURLToPath } from "node:url"
import { ServerType, startStdioServer } from "mcp-proxy"
import open from "open"
import { createAuthenticatedFetch } from "./authenticatedFetch.js"
import { discoverOAuthEndpoints, performAuthorizationCodeLogin } from "./oauth.js"
import { defaultCacheDirectory, SharedSessionStore } from "./sharedSession.js"

const PACKAGE_VERSION = "0.1.0"

type CliOptions = {
  target?: URL
  allowInsecureHttp: boolean
  help: boolean
  version: boolean
}

export async function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  if (options.help) {
    process.stdout.write(helpText())
    return
  }
  if (options.version) {
    process.stdout.write(`${PACKAGE_VERSION}\n`)
    return
  }
  if (!options.target) throw new Error("Missing MCP Gateway route URL")

  const endpoints = await discoverOAuthEndpoints(options.target, {
    allowInsecureHttp: options.allowInsecureHttp,
  })
  const sessionStore = new SharedSessionStore(defaultCacheDirectory(), {
    onWait: () => console.error("Another MCP connector is authenticating; waiting for the shared Gateway session..."),
  })
  const acquireCredential = () => performAuthorizationCodeLogin(endpoints, {
    openBrowser: async (url) => {
      console.error("Opening the browser for MCP Gateway sign-in...")
      await open(url, { wait: false })
    },
  })
  const authenticatedFetch = createAuthenticatedFetch({
    endpoints,
    sessionStore,
    acquireCredential,
  })

  await sessionStore.getOrCreate(endpoints.issuer, acquireCredential)
  await startStdioServer({
    serverType: ServerType.HTTPStream,
    url: options.target.toString(),
    transportOptions: { fetch: authenticatedFetch },
  })
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    allowInsecureHttp: process.env.IDTHW_MCP_ALLOW_INSECURE_HTTP === "true",
    help: false,
    version: false,
  }

  for (const argument of argv) {
    if (argument === "--allow-insecure-http") {
      options.allowInsecureHttp = true
    } else if (argument === "--help" || argument === "-h") {
      options.help = true
    } else if (argument === "--version" || argument === "-v") {
      options.version = true
    } else if (argument.startsWith("-")) {
      throw new Error(`Unknown option: ${argument}`)
    } else if (!options.target) {
      options.target = new URL(argument)
    } else {
      throw new Error(`Unexpected argument: ${argument}`)
    }
  }
  return options
}

function helpText() {
  return [
    "Usage: idthw-mcp-connect [--allow-insecure-http] <gateway-route-url>",
    "",
    "Connect one stdio MCP entry to an IDTHW MCP Gateway route.",
    "The first process opens browser authentication; concurrent entries reuse the shared session.",
    "",
    "Environment:",
    "  IDTHW_MCP_CREDENTIAL_CACHE_DIR  Override the private shared credential directory.",
    "  IDTHW_MCP_ALLOW_INSECURE_HTTP   Set to true only for non-TLS development Gateways.",
    "",
  ].join("\n")
}

const invokedAsProgram = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (invokedAsProgram) {
  run().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`MCP credential broker: ${message}`)
    process.exitCode = 1
  })
}
