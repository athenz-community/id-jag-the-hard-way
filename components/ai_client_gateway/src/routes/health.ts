import { Router, Request, Response } from "express";
import { UPSTREAM_BASE_URL, PUBLIC_BASE_URL } from "../config/env.js";
import { fetchUpstreamOpenApiSpec } from "../utils/openapi.js";

const router = Router();

router.get("/", async (_req: Request, res: Response) => {
  try {
    await fetchUpstreamOpenApiSpec();

    res.json({
      ok: true,
      status: "healthy",
      upstream: UPSTREAM_BASE_URL,
      publicBaseUrl: PUBLIC_BASE_URL
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    console.error("[Health Check] Upstream connection failed:", errorMessage);
    
    res.status(503).json({
      ok: false,
      status: "unhealthy",
      error: "upstream_unavailable",
      message: errorMessage
    });
  }
});

export default router;
