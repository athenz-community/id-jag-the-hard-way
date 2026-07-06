import fs from "fs";
import https from "https";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { config } from "@/shared/config";

export const runtime = "nodejs";

const DIRECT_DOCS_POLICY = {
  domain: "api",
  policyName: "docs-getter_get_docs",
  role: "api:role.docs-getter",
  resource: "api:docs",
  action: "get",
} as const;

type ZmsResponse = {
  statusCode: number;
  body: string;
};

function resolveFromUi(pathname: string) {
  return path.isAbsolute(pathname) ? pathname : path.resolve(process.cwd(), pathname);
}

function agent() {
  return new https.Agent({
    cert: fs.readFileSync(resolveFromUi(config.athenz.adminCertPath)),
    key: fs.readFileSync(resolveFromUi(config.athenz.adminKeyPath)),
    rejectUnauthorized: false,
  });
}

function requestZms(method: "GET" | "PUT" | "DELETE", body?: string): Promise<ZmsResponse> {
  const zms = config.athenz.zmsUrl.replace(/\/$/, "");
  const url = new URL(`${zms}/domain/${DIRECT_DOCS_POLICY.domain}/policy/${DIRECT_DOCS_POLICY.policyName}`);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method,
        agent: agent(),
        headers: {
          "Content-Type": "application/json",
          ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => {
          data += chunk.toString();
        });
        res.on("end", () => {
          resolve({ statusCode: res.statusCode ?? 500, body: data });
        });
      },
    );

    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function policyBody() {
  return JSON.stringify({
    name: `${DIRECT_DOCS_POLICY.domain}:policy.${DIRECT_DOCS_POLICY.policyName}`,
    assertions: [
      {
        role: DIRECT_DOCS_POLICY.role,
        resource: DIRECT_DOCS_POLICY.resource,
        action: DIRECT_DOCS_POLICY.action,
      },
    ],
  });
}

function enabledFromStatus(statusCode: number) {
  if (statusCode === 404) return false;
  if (statusCode >= 200 && statusCode < 300) return true;
  return null;
}

export async function GET() {
  try {
    const response = await requestZms("GET");
    const enabled = enabledFromStatus(response.statusCode);
    if (enabled === null) {
      return NextResponse.json({ error: response.body || `ZMS returned ${response.statusCode}` }, { status: 502 });
    }
    return NextResponse.json({ enabled });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown ZMS error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = (await request.json()) as { enabled?: unknown };
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "enabled must be boolean" }, { status: 400 });
    }

    const response = body.enabled
      ? await requestZms("PUT", policyBody())
      : await requestZms("DELETE");

    if (response.statusCode === 404 && !body.enabled) {
      return NextResponse.json({ enabled: false });
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      return NextResponse.json({ error: response.body || `ZMS returned ${response.statusCode}` }, { status: 502 });
    }

    return NextResponse.json({ enabled: body.enabled });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown ZMS error" }, { status: 500 });
  }
}
