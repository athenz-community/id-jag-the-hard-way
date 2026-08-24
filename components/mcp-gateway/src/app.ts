import express from "express"
import { createInternalRouter, type InternalRouterDependencies } from "./routes/internal.js"
import oauthRouter from "./routes/oauth.js"
import { createProtectedRouter, type ProtectedRouterDependencies } from "./routes/protected.js"

export function createApp(
  dependencies: Partial<ProtectedRouterDependencies> = {},
  internalDependencies: Partial<InternalRouterDependencies> = {},
) {
  const app = express()
  app.disable("x-powered-by")
  app.use((_request, response, next) => {
    response.setHeader("x-content-type-options", "nosniff")
    response.setHeader("referrer-policy", "no-referrer")
    next()
  })
  app.use(express.json({ limit: "1mb" }))
  app.use(express.urlencoded({ extended: false, limit: "1mb" }))

  app.get("/", (_request, response) => {
    response.json({ name: "mcp-gateway", phase: "authenticated-forwarding" })
  })
  app.get("/health", (_request, response) => {
    response.json({ status: "ok" })
  })
  app.use(createInternalRouter(internalDependencies))
  app.use(oauthRouter)
  app.use(createProtectedRouter(dependencies))

  return app
}
