import { UPSTREAM_BASE_URL, DANGEROUSLY_SHOW_RAW_ACCESS_TOKEN, PUBLIC_BASE_URL } from "../config/env.js";
import { collectForwardHeaders } from "../utils/httpHelpers.js";
import { logIncomingRequest } from "./logger.js";
import { getAccessToken } from "../utils/athenzAt.ts";
import {
  ensureOpenApiSpecSynced,
  resolveRequiredScope,
  getAllScopesUnion,
  operationScopeMap,
} from "../utils/openapi.js";
import { getSession } from "../utils/sessionStore.js";
import {Request, Response } from "express";

function isAuthenticated(req: Request): boolean {
  const authHeader = req.headers["authorization"];
  if (authHeader?.startsWith("Bearer ")) {
    const session = getSession(authHeader.slice(7));
    if (session) return true;
  }
  const cookie = req.headers.cookie ?? "";
  return cookie.includes("oauth_id_token=");
}

export async function proxyMiddleware(req: Request, res: Response) {
  if (req.path === "/openapi.json" || req.path === "/health") {
    return res.status(404).json({ error: "not_found" });
  }

  if (!isAuthenticated(req)) {
    res.setHeader(
      "WWW-Authenticate",
      `Bearer realm="${PUBLIC_BASE_URL}", resource_metadata="${PUBLIC_BASE_URL}/.well-known/oauth-authorization-server"`
    );
    return res.status(401).json({
      error: "unauthorized",
      message: "No valid session. Authenticate via the gateway OAuth2 flow.",
    });
  }

  try {
    await ensureOpenApiSpecSynced();

    let requiredScope: string | null;

    if (req.path === "/mcp") {
      // For MCP tool calls, resolve scope from the tool name (= operationId).
      // For all other MCP messages (initialize, tools/list, ping, etc.) fall back
      // to the common intersection scope so the session token is always valid.
      const mcpMethod = (() => {
        try {
          const body = req.body && Buffer.isBuffer(req.body)
            ? JSON.parse(req.body.toString("utf8"))
            : req.body;
          return body?.method as string | undefined;
        } catch { return undefined; }
      })();

      const toolName = (() => {
        if (mcpMethod !== "tools/call") return undefined;
        try {
          const body = req.body && Buffer.isBuffer(req.body)
            ? JSON.parse(req.body.toString("utf8"))
            : req.body;
          return body?.params?.name as string | undefined;
        } catch { return undefined; }
      })();

      if (toolName) {
        requiredScope = operationScopeMap.get(toolName) ?? getAllScopesUnion();
        console.log(`[Scope Resolve] MCP tools/call "${toolName}" -> ${requiredScope}`);
      } else {
        requiredScope = getAllScopesUnion();
      }
    } else {
      requiredScope = resolveRequiredScope(req.method, req.path);
    }

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

    const hasBody = req.body && req.method !== "GET" && req.method !== "HEAD";

    if (hasBody) {
      if (Buffer.isBuffer(req.body)) {
        fetchOptions.body = req.body;
      } else {
        fetchOptions.body = JSON.stringify(req.body);
        forwardHeaders["content-type"] = "application/json";
      }
    }

    const timestamp = new Date().toISOString();
    console.error(`\n[${timestamp}]`);
    console.error(`======================== GATEWAY -> TARGET ========================`);
    console.error(`[Method]                    : ${fetchOptions.method}`);
    console.error(`[URL]                       : ${upstreamUrl.toString()}`);
    console.error(`[Athenz Required Scope]     : ${requiredScope}`);
    console.error(`[Request Headers]           : ${JSON.stringify(forwardHeaders)}`);
    console.error(`[Request Body]              : ${fetchOptions.body ? fetchOptions.body.toString().slice(0, 500) : "(none)"}`);
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
