import fs from "fs";
import https from "https";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { config } from "@/shared/config";

export const runtime = "nodejs";

const DOMAIN = "api";
const ROLE = "jag-exchanging-ai-agents";
const ACTION = "zts.jag_exchange";
const POLICY_BY_PERMISSION = {
  get: {
    policyName: "jag-exchanging-ai-agents_zts_jag_exchange_role_docs-getter",
    resource: "role.docs-getter",
  },
  post: {
    policyName: "jag-exchanging-ai-agents_zts_jag_exchange_role_docs-poster",
    resource: "role.docs-poster",
  },
  delete: {
    policyName: "jag-exchanging-ai-agents_zts_jag_exchange_role_docs-deleter",
    resource: "role.docs-deleter",
  },
  mcp: {
    policyName: "jag-exchanging-ai-agents_zts_jag_exchange_role_api-mcp-accessor",
    resource: "role.api-mcp-accessor",
  },
} as const;

type PolicyKey = keyof typeof POLICY_BY_PERMISSION;
type JagPolicy = typeof POLICY_BY_PERMISSION[PolicyKey];

type ZmsResponse = { statusCode: number; body: string };

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

function requestZms(method: "GET" | "PUT" | "DELETE", urlPath: string, body?: string): Promise<ZmsResponse> {
  const zms = config.athenz.zmsUrl.replace(/\/$/, "");
  const url = new URL(`${zms}${urlPath}`);

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
        res.on("end", () => resolve({ statusCode: res.statusCode ?? 500, body: data }));
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function policyPath(policyName: string) {
  return `/domain/${DOMAIN}/policy/${policyName}`;
}

function policyBody(policy: JagPolicy) {
  return JSON.stringify({
    name: `${DOMAIN}:policy.${policy.policyName}`,
    assertions: [
      {
        role: `${DOMAIN}:role.${ROLE}`,
        resource: `${DOMAIN}:${policy.resource}`,
        action: ACTION,
      },
    ],
  });
}

function selectedPolicies(request: NextRequest): JagPolicy[] {
  const permission = request.nextUrl.searchParams.get("permission");
  if (permission && permission in POLICY_BY_PERMISSION) {
    return [POLICY_BY_PERMISSION[permission as PolicyKey]];
  }
  return Object.values(POLICY_BY_PERMISSION);
}

async function getPolicyStates(policies: JagPolicy[]) {
  const states = await Promise.all(
    policies.map(async (policy) => {
      const res = await requestZms("GET", policyPath(policy.policyName));
      if (res.statusCode === 404) return { policyName: policy.policyName, enabled: false };
      if (res.statusCode >= 200 && res.statusCode < 300) return { policyName: policy.policyName, enabled: true };
      throw new Error(res.body || `ZMS returned ${res.statusCode}`);
    }),
  );

  return states;
}

export async function GET(request: NextRequest) {
  try {
    const policies = await getPolicyStates(selectedPolicies(request));
    return NextResponse.json({
      enabled: policies.every((policy) => policy.enabled),
      policies,
    });
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

    const policiesToToggle = selectedPolicies(request);

    if (body.enabled) {
      for (const policy of policiesToToggle) {
        const res = await requestZms("PUT", policyPath(policy.policyName), policyBody(policy));
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return NextResponse.json({ error: `Failed to create ${policy.policyName}: ${res.body}` }, { status: 502 });
        }
      }
    } else {
      for (const policy of policiesToToggle) {
        const res = await requestZms("DELETE", policyPath(policy.policyName));
        if (res.statusCode !== 404 && (res.statusCode < 200 || res.statusCode >= 300)) {
          return NextResponse.json({ error: `Failed to delete ${policy.policyName}: ${res.body}` }, { status: 502 });
        }
      }
    }

    const policies = await getPolicyStates(policiesToToggle);
    return NextResponse.json({
      enabled: policies.every((policy) => policy.enabled),
      policies,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown ZMS error" }, { status: 500 });
  }
}
