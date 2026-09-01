import express from "express";
import cors from "cors";
import chalk from "chalk";
import {
  PORT,
  UPSTREAM_BASE_URL,
  PUBLIC_BASE_URL,
  corsOptions,
} from "./config/env";
import openapiRouter from "./routes/openapi";
import mcpRouter from "./routes/mcp";
import { toolsRegistry } from "./config/registry";
import { mcpLogger } from "./middleware/logger";

const app = express();

app.use(cors(corsOptions));
app.use(express.json({ limit: "50mb" }));

app.use(mcpLogger);

app.use((req, res, next) => {
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use("/openapi.json", openapiRouter);
app.use("/mcp", mcpRouter);

toolsRegistry.forEach((tool) => {
  app[tool.method](tool.path.replace(/\{([^}]+)\}/g, ":$1"), async (req, res) => {
    try {
      await tool.handler(req, res, tool.scope);
    } catch (error: any) {
      console.error(`${chalk.bgRed.white.bold(" [Handler Error] ")} ${tool.operationId}:`, error);
      res.status(500).json({ error: error.message });
    }
  });
});

app.listen(Number(PORT), "0.0.0.0", () => {
  console.log(`🚀 ${chalk.green("OpenAPI MCP Server for API listening on:")} ${chalk.white(PUBLIC_BASE_URL)}`);
  console.log(`🌐 ${chalk.cyan("Upstream API:")} ${chalk.white(UPSTREAM_BASE_URL)}`);
  console.log(`📄 ${chalk.yellow("OpenAPI Spec available at:")} ${chalk.white(`${PUBLIC_BASE_URL}/openapi.json`)}`);
  console.log(`🔌 ${chalk.magenta("MCP endpoint available at:")} ${chalk.white(`${PUBLIC_BASE_URL}/mcp\n`)}`);
});
