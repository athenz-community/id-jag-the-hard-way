import { UPSTREAM_BASE_URL, DANGEROUSLY_SHOW_RAW_ACCESS_TOKEN } from "../config/env.js";
import { collectForwardHeaders } from "../utils/httpHelpers.js";
import { logIncomingRequest } from "./logger.js";
import { getAccessToken } from "../utils/athenzAt.ts";
import {
  ensureOpenApiSpecSynced,
  resolveRequiredScope,
} from "../utils/openapi.js";
import {Request, Response } from "express";

export async function proxyMiddleware(req: Request, res: Response) {
  if (req.path === "/openapi.json" || req.path === "/health") {
    return res.status(404).json({ error: "not_found" });
  }

  try {
    await ensureOpenApiSpecSynced();

    const requiredScope = resolveRequiredScope(req.method, req.path);

    if (!requiredScope) {
      return res.status(403).json({
        error: "athenz_required_scope_not_found",
        message: "No x-athenz-required-scope was found for this operation",
        method: req.method,
        path: req.path,
      });
    }

    const upstreamUrl = new URL(req.originalUrl, UPSTREAM_BASE_URL);

    const accessToken = await getAccessToken(req, requiredScope);
    const forwardHeaders = {
      ...collectForwardHeaders(req),
      "authorization": `Bearer ${accessToken}`
    };
    logIncomingRequest(req, forwardHeaders);

    const fetchOptions: any = {
      method: req.method,
      headers: forwardHeaders,
    };

    const hasBody =
      req.body &&
      Buffer.isBuffer(req.body) &&
      req.body.length > 0 &&
      req.method !== "GET" &&
      req.method !== "HEAD";

    if (hasBody) {
      fetchOptions.body = req.body;
    }

    const timestamp = new Date().toISOString();
    console.error(`\n[${timestamp}]`);
    console.error(`======================== GATEWAY -> TARGET ========================`);
    console.error(`[Method]                    : ${fetchOptions.method}`);
    console.error(`[URL]                       : ${upstreamUrl.toString()}`);
    console.error(`[Athenz Required Scope]     : ${requiredScope}`);
    DANGEROUSLY_SHOW_RAW_ACCESS_TOKEN && console.error(`⚠️ [DANGEROUSLY_SHOW_RAW_ACCESS_TOKEN] : ${DANGEROUSLY_SHOW_RAW_ACCESS_TOKEN}`);
    console.error(`[Athenz AT (Authorization)] : Bearer ${DANGEROUSLY_SHOW_RAW_ACCESS_TOKEN ? accessToken : `<redacted>`}`);
    console.error("==================================================================\n");

    const upstreamResponse = await fetch(upstreamUrl, fetchOptions);
    const responseBuffer = Buffer.from(await upstreamResponse.arrayBuffer());

    console.error(`\n[${new Date().toISOString()}]`);
    console.error(`====================== REQUESTER <- GATEWAY ======================`);
    console.error(`[Status]                    : ${upstreamResponse.status}`);

    let responseBodyLog = "";
    try {
      const parsedJson = JSON.parse(responseBuffer.toString("utf8"));
      const formattedParts = Object.entries(parsedJson).map(([key, value]) => {
        return `  "${key}": ${JSON.stringify(value)}`;
      });
      responseBodyLog = `{\n${formattedParts.join(",\n")}\n}`;
    } catch {
      responseBodyLog = responseBuffer.toString("utf8");
    }

    console.error(`[Body]                      :\n${responseBodyLog}`);
    console.error("==================================================================\n");

    res.status(upstreamResponse.status);

    const contentType = upstreamResponse.headers.get("content-type");
    if (contentType) {
      res.setHeader("content-type", contentType);
    }

    res.send(responseBuffer);
  } catch (error: any) {
    if (error.code === "ID_TOKEN_EXPIRED") {
      return res.status(401).json({
        error: "id_token_expired",
        message: "Your session has expired. Please sign out from your IdP (e.g. Keycloak) and re-login to get a new session. (Automatic re-login is not yet implemented but coming soon.)",
      });
    }
    console.error(`[${new Date().toISOString()}] Proxy request failed:`, error);
    res.status(502).json({
      error: "upstream_request_failed",
      message: error.message,
    });
  }
}
