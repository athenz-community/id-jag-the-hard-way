import express from "express";
import cors from "cors";
import { PORT, UPSTREAM_BASE_URL, PUBLIC_BASE_URL, corsOptions, ZTS_URL } from "./config/env.js";
import healthRouter from "./routes/health.js";
import openapiRouter from "./routes/openapi.js";
import oauthRouter from "./routes/oauth.js";
import { proxyMiddleware } from "./middlewares/proxy.js";

const app = express();

app.use(cors(corsOptions));

app.use((req, res, next) => {
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// OAuth routes need both JSON and URL-encoded bodies
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));

// MCP/proxy requests use raw body so they can be forwarded as-is
app.use((req, _res, next) => {
  const ct = req.headers["content-type"] ?? "";
  if (ct.startsWith("application/x-www-form-urlencoded") || ct.startsWith("application/json")) {
    return next();
  }
  express.raw({ type: "*/*", limit: "50mb" })(req, _res, next);
});

app.use("/health", healthRouter);
app.use("/openapi.json", openapiRouter);

// OAuth2 AS endpoints (must be before proxyMiddleware)
app.use(oauthRouter);

app.use(proxyMiddleware);

app.listen(Number(PORT), "0.0.0.0", () => {
  console.log(`🚀 OpenWebUI OpenAPI Gateway listening on 0.0.0.0:${PORT}`);
  console.log(`🔗 Upstream API: ${UPSTREAM_BASE_URL}`);
  console.log(`🌍 Public Base URL: ${PUBLIC_BASE_URL}`);
  console.log(`🔑 Athenz ZTS Endpoint: ${ZTS_URL}`);
});
