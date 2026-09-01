#!/usr/bin/env node

import { ServerType, startStdioServer } from "mcp-proxy"
import open from "open"
import { createAuthenticatedFetch } from "./authenticatedFetch.js"
import {
  discoverOAuthEndpoints,
  performAuthorizationCodeLogin,
  prepareIdentityProviderLogout,
  revokeGatewayCredential,
} from "./oauth.js"
import { defaultCacheDirectory, SharedSessionStore } from "./sharedSession.js"

const PACKAGE_VERSION = "0.1.3"

type CliOptions = {
  target?: URL
  allowInsecureHttp: boolean
  help: boolean
  idpLogout: boolean
  logout: boolean
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
  if (options.logout) {
    if (options.target) throw new Error("--logout does not accept an MCP Gateway route URL")
    await logout(options.allowInsecureHttp, options.idpLogout)
    return
  }
  if (options.idpLogout) throw new Error("--idp requires --logout")
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
    idpLogout: false,
    logout: false,
    version: false,
  }

  for (const argument of argv) {
    if (argument === "--allow-insecure-http") {
      options.allowInsecureHttp = true
    } else if (argument === "--logout") {
      options.logout = true
    } else if (argument === "--idp") {
      options.idpLogout = true
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
    "       idthw-mcp-connect [--allow-insecure-http] --logout [--idp]",
    "",
    "Connect one stdio MCP entry to an IDTHW MCP Gateway route.",
    "The first process opens browser authentication; concurrent entries reuse the shared session.",
    "",
    "Options:",
    "  --logout                    Revoke and clear all cached shared Gateway sessions.",
    "  --idp                       With --logout, also open browser sign-out for the identity provider.",
    "  --allow-insecure-http        Permit non-TLS development Gateways.",
    "  -h, --help                   Show this help.",
    "  -v, --version                Show the package version.",
    "",
    "Environment:",
    "  IDTHW_MCP_CREDENTIAL_CACHE_DIR  Override the private shared credential directory.",
    "  IDTHW_MCP_ALLOW_INSECURE_HTTP   Set to true only for non-TLS development Gateways.",
    "",
  ].join("\n")
}

async function logout(allowInsecureHttp: boolean, idpLogout: boolean) {
  const sessionStore = new SharedSessionStore(defaultCacheDirectory())
  const credentials = await sessionStore.clearAll()
  if (credentials.length === 0) {
    process.stdout.write("No cached MCP Gateway sessions found.\n")
    return
  }

  const results = await Promise.allSettled(
    credentials.map(async (credential) => {
      if (!idpLogout) {
        await revokeGatewayCredential(credential, { allowInsecureHttp })
        return
      }

      const logoutUrl = await prepareIdentityProviderLogout(credential, { allowInsecureHttp })
      console.error("Opening the browser for identity-provider sign-out...")
      await open(logoutUrl, { wait: false })
    }),
  )
  const failed = results.filter((result) => result.status === "rejected").length
  if (failed > 0) {
    throw new Error(
      `Cleared ${credentials.length} local Gateway ${plural(credentials.length, "session")}, but failed to complete ${failed} remote ${idpLogout ? "identity-provider sign-out" : "revocation"}${failed === 1 ? "" : "s"}`,
    )
  }

  process.stdout.write(
    `Signed out of ${credentials.length} shared MCP Gateway ${plural(credentials.length, "session")}`
    + `${idpLogout ? " and opened identity-provider sign-out" : ""}.\n`,
  )
}

function plural(count: number, noun: string) {
  return count === 1 ? noun : `${noun}s`
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`MCP credential broker: ${message}`)
  process.exitCode = 1
})
