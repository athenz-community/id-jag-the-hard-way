import { UPSTREAM_BASE_URL, PUBLIC_BASE_URL } from "../config/env.js";

interface OpenApiSpec {
  openapi?: string;
  info?: {
    title?: string;
    version?: string;
    [key: string]: any;
  };
  servers?: Array<{ url: string; description?: string }>;
  paths?: {
    [path: string]: {
      [method: string]: {
        operationId?: string;
        summary?: string;
        "x-athenz-required-scope"?: string;
        [key: string]: any;
      };
    };
  };
  [key: string]: any;
}

const ATHENZ_REQUIRED_SCOPE_HEADER = "x-athenz-required-scope";

const VALID_METHODS = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
]);

export const operationScopeMap = new Map<string, string>();

type ScopeRouteEntry = {
  method: string;
  openapiPath: string;
  operationId: string;
  scope: string;
  regex: RegExp;
};

const scopeRouteTable: ScopeRouteEntry[] = [];

let lastSyncedSpec: OpenApiSpec | null = null;
let syncInFlight: Promise<OpenApiSpec> | null = null;
let allScopesUnion: string | null = null;

// getAllScopesUnion returns the union of every unique scope found in the OpenAPI spec.
// Used by the MCP path which cannot resolve scope per-operation.
export function getAllScopesUnion(): string | null {
  return allScopesUnion;
}

function makeOperationId(method: string, path: string): string {
  return `${method}_${path.replace(/[^a-zA-Z0-9]/g, "_")}`
    .replace(/_+/g, "_")
    .replace(/^_/, "")
    .replace(/_$/, "")
    .toLowerCase();
}

function normalizeScope(scope: string): string {
  return Array.from(
    new Set(
      scope
        .trim()
        .split(/\s+/)
        .filter(Boolean)
    )
  )
    .sort()
    .join(" ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function openApiPathToRegex(openapiPath: string): RegExp {
  const pattern = openapiPath
    .split("/")
    .map((segment) => {
      if (/^\{[^/{}]+\}$/.test(segment)) {
        return "[^/]+";
      }

      return escapeRegExp(segment);
    })
    .join("/");

  return new RegExp(`^${pattern}/?$`);
}

function routeSpecificity(openapiPath: string): number {
  return openapiPath
    .split("/")
    .filter((segment) => segment && !/^\{[^/{}]+\}$/.test(segment))
    .length;
}

function rebuildScopeIndexes(spec: OpenApiSpec) {
  operationScopeMap.clear();
  scopeRouteTable.length = 0;

  if (!spec.paths) return;

  for (const [openapiPath, methods] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(methods || {})) {
      const lowerMethod = method.toLowerCase();

      if (!VALID_METHODS.has(lowerMethod)) continue;

      const generatedOpId = makeOperationId(lowerMethod, openapiPath);
      const operationId = operation.operationId || generatedOpId;

      operation.operationId = operationId;

      const rawScope = operation[ATHENZ_REQUIRED_SCOPE_HEADER];

      if (!rawScope) {
        console.warn(
          `[OpenAPI Sync] No ${ATHENZ_REQUIRED_SCOPE_HEADER} for ${lowerMethod.toUpperCase()} ${openapiPath}`
        );
        continue;
      }

      const requiredScope = normalizeScope(rawScope);

      operation[ATHENZ_REQUIRED_SCOPE_HEADER] = requiredScope;

      operationScopeMap.set(operationId, requiredScope);

      scopeRouteTable.push({
        method: lowerMethod,
        openapiPath,
        operationId,
        scope: requiredScope,
        regex: openApiPathToRegex(openapiPath),
      });

      console.log(
        `[OpenAPI Sync] ${lowerMethod.toUpperCase()} ${openapiPath} (${operationId}) scope [${requiredScope}]`
      );
    }
  }

  scopeRouteTable.sort((a, b) => {
    return routeSpecificity(b.openapiPath) - routeSpecificity(a.openapiPath);
  });

  // MCP path uses the intersection of scopes across all operations — scopes that every
  // operation requires. This avoids requesting jag_exchange for roles that not all
  // operations need (e.g. docs-deleter), while still covering the common gateway role.
  let intersection: Set<string> | null = null;
  for (const entry of scopeRouteTable) {
    const entryScopes = new Set(entry.scope.split(/\s+/).filter(Boolean));
    if (intersection === null) {
      intersection = entryScopes;
    } else {
      for (const s of intersection) {
        if (!entryScopes.has(s)) intersection.delete(s);
      }
    }
  }
  allScopesUnion = intersection ? Array.from(intersection).sort().join(" ") : null;
  console.log(`[OpenAPI Sync] MCP union scope: [${allScopesUnion}]`);
}

function cloneAndRewriteOpenApiSpec(spec: OpenApiSpec): OpenApiSpec {
  const rewritten: OpenApiSpec = structuredClone(spec);

  rewritten.servers = [{ url: PUBLIC_BASE_URL as string }];

  if (!rewritten.info) {
    rewritten.info = {
      title: "OpenWebUI OpenAPI Gateway",
      version: "1.0.0",
    };
  } else {
    rewritten.info.title = rewritten.info.title || "OpenWebUI OpenAPI Gateway";
    rewritten.info.version = rewritten.info.version || "1.0.0";
  }

  if (rewritten.paths) {
    for (const [path, methods] of Object.entries(rewritten.paths)) {
      for (const [method, operation] of Object.entries(methods || {})) {
        const lowerMethod = method.toLowerCase();

        if (!VALID_METHODS.has(lowerMethod)) continue;

        if (!operation.operationId) {
          operation.operationId = makeOperationId(lowerMethod, path);
        }

        if (!operation.summary) {
          operation.summary = `${lowerMethod.toUpperCase()} ${path}`;
        }
      }
    }
  }

  rebuildScopeIndexes(rewritten);

  return rewritten;
}

export async function fetchUpstreamOpenApiSpec(): Promise<OpenApiSpec> {
  const url = new URL("/openapi.json", UPSTREAM_BASE_URL as string);
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch upstream openapi.json: ${response.status} ${response.statusText}`
    );
  }

  const spec: OpenApiSpec = await response.json();
  const rewritten = cloneAndRewriteOpenApiSpec(spec);

  lastSyncedSpec = rewritten;

  console.log(
    `[OpenAPI] ✅ Successfully fetched and synced openapi.json from upstream (${UPSTREAM_BASE_URL})`
  );

  return rewritten;
}

export async function ensureOpenApiSpecSynced(): Promise<OpenApiSpec> {
  if (lastSyncedSpec) {
    return lastSyncedSpec;
  }

  if (!syncInFlight) {
    syncInFlight = fetchUpstreamOpenApiSpec().finally(() => {
      syncInFlight = null;
    });
  }

  return syncInFlight;
}

// resolveRequiredScope returns what kind of scope is required for the given method and path.
// If no scope is found, it returns undefined.
// If a scope is found, it returns the scope.
export function resolveRequiredScope(
  method: string,
  requestPath: string
): string | undefined {
  const lowerMethod = method.toLowerCase();

  const pathname = (() => {
    try {
      return new URL(requestPath, "http://gateway.local").pathname;
    } catch {
      return requestPath.split("?")[0];
    }
  })();

  for (const entry of scopeRouteTable) {
    if (entry.method !== lowerMethod) continue;

    if (entry.regex.test(pathname)) {
      console.log(
        `[Scope Resolve] ${method.toUpperCase()} ${pathname} -> ${entry.scope} (${entry.operationId})`
      );
      return entry.scope;
    }
  }

  console.warn(`[Scope Resolve] No scope found for ${method.toUpperCase()} ${pathname}`);
  return undefined;
}
