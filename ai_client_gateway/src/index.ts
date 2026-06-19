import express from "express";
import cors from "cors";
import { PORT, UPSTREAM_BASE_URL, PUBLIC_BASE_URL, corsOptions, ZTS_URL } from "./config/env.js";
import healthRouter from "./routes/health.js";
import openapiRouter from "./routes/openapi.js";
import { proxyMiddleware } from "./middlewares/proxy.js";

const app = express();

app.use(cors(corsOptions));

app.use((req, res, next) => {
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.raw({ type: "*/*", limit: "50mb" }));

app.use("/health", healthRouter);
app.use("/openapi.json", openapiRouter);

app.use(proxyMiddleware);

app.listen(Number(PORT), "0.0.0.0", () => {
  console.log(`🚀 OpenWebUI OpenAPI Gateway listening on 0.0.0.0:${PORT}`);
  console.log(`🔗 Upstream API: ${UPSTREAM_BASE_URL}`);
  console.log(`🌍 Public Base URL: ${PUBLIC_BASE_URL}`);
  console.log(`🔑 Athenz ZTS Endpoint: ${ZTS_URL}`);
});
