import { Router, Request, Response } from "express";
import { fetchUpstreamOpenApiSpec } from "../utils/openapi.js";

const router = Router();

router.get("/", async (_req: Request, res: Response) => {
  try {
    const spec = await fetchUpstreamOpenApiSpec();
    res.setHeader("content-type", "application/json");
    res.json(spec);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    console.error("Failed to serve /openapi.json:", error);
    res.status(502).json({
      error: "failed_to_fetch_upstream_openapi",
      message: errorMessage
    });
  }
});

export default router;
