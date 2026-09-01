# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Repository Is

**ID-JAG The Hard Way** is a step-by-step tutorial for building an ID-JAG-based AI agent authorization architecture from scratch. It demonstrates how AI agents can access protected APIs on behalf of signed-in human users using real tokens, least-privilege policies, and a chain of token exchanges. The 15-step tutorial in `tutorials/` is the primary artifact; the code components are supporting infrastructure for the tutorial.

The architecture implements the [ID-JAG specification](https://techblog.lycorp.co.jp/en/20260417a) and is listed on the OAuth.net Cross-App Access (XAA) page.

## Components and Their Roles

The repository contains these runtime components and supporting plugins:

1. **`components/api_server/`** — Java 17 (Maven) REST API that enforces Athenz access tokens. Also contains two sub-services:
   - **`components/api_server/mcp/`** — Node.js/TypeScript MCP (Model Context Protocol) server that performs token exchange with Athenz ZTS before calling the API server.
   - **`components/api_server/authorization_proxy/`** — Spring Boot 3.2.5 proxy that sits in front of the MCP server and validates Athenz access tokens.

2. **`components/ai_client_gateway/`** — Node.js/TypeScript Express proxy that intercepts AI client requests, converts ID tokens to ID-JAG tokens via Athenz, and injects the appropriate access token before forwarding to the MCP server.

3. **`components/mcp-gateway/`** — Node.js/TypeScript authenticated MCP front door for the MCP Hub demo. It performs Keycloak login, keeps the ID token in a server-side session, resolves routes through the MCP Hub API, exchanges ID token → ID-JAG → Athenz access token per session, and forwards `/mcp/{id}` through Core MCP Proxy. It does not replace or change the tutorial's `components/ai_client_gateway/` yet.

4. **`components/mcp-credential-broker/`** — Publishable Node.js/TypeScript stdio connector for MCP clients. Separate processes connect to separate MCP Gateway routes while sharing one opaque, browser-authenticated Gateway session through a private local cache and cross-process lock. It is an OAuth public client using Authorization Code + PKCE; it never embeds a confidential-client secret. Its `--logout` option clears every locally cached Gateway session and revokes each opaque token through the issuer's advertised OAuth revocation endpoint.

5. **`components/athenzd/`** — Go manager CLI for browser login and logout, idempotent ZMS service registration, optional Copper Argos X.509 enrollment, ID-JAG and Athenz access-token issuance, and management of the local GenAI credential-injector daemon.

6. **`components/keycloak_token_exchange_provider/`** — Java 11 Maven Keycloak plugin that enables ID token delegation from Keycloak to Athenz.

7. **`local_workload_instance_provider/`** — Standalone Java 17 Maven plugin for the optional local Copper Argos flow. It validates an OIDC ID token as workload attestation and restricts certificate enrollment to the authenticated user's Athenz home-domain subtree. It is not deployed by default; the `athenzd` FAQ mounts and registers it for testing.

8. **`athenz_dist/`** — Git submodule pointing to `athenz-community/athenz-distribution`. Acts as the authorization server (ZMS + ZTS) and ZPU for the tutorial.

9. **`zpu/`** — Bash script + Dockerfile for the Athenz ZPU (policy updater) service.

10. **`genai_proxy/`** — Minimal locally run Node.js proxy that validates Athenz Bearer tokens with the ZTS public key, requires a `gen-ai.services.<project>` audience and `gen-ai-users` scope, replaces that token with `OPENAI_CODEX_API_KEY`, and forwards OpenAI-compatible `/v1/*` requests to the gateway configured by `GENAI_UPSTREAM_BASE_URL`. It meters both Chat Completions and Responses API token fields, keeps daily JST per-project, per-user and per-model counters with a JST `last_usage` time in `HH:mm:ss` format, owns and enforces per-service-code daily spending limits with HTTP 429 responses, persists counters under the gitignored `components/athenzd/.athenzd/` directory for `make local`, and exposes user-specific projects, limits, spend, and costs at unauthenticated `GET /api/users/{user}`.

**Default ports** — local (`make local`) vs. Kubernetes port-forward (`keep-k8s-port-forward.sh`):

| Component         | Local port | K8s port-forward | K8s container port |
|-------------------|------------|------------------|--------------------|
| Athenz ZMS        | —          | `4443`           | `4443`             |
| Athenz ZTS        | —          | `8443`           | `4443`             |
| Athenz UI         | —          | `3000`           | `3000`             |
| API Server        | —          | `14443`          | `8080`             |
| MCP Server        | —          | `24443`          | `8081`             |
| Confluence MCP    | —          | `24444`          | `9000`             |
| MCP Auth Proxy    | —          | —                | —                  |
| Keycloak (IdP)    | —          | `34443`          | `8080`             |
| Keycloak HTTPS    | —          | `34444`          | `8443`             |
| Agentgateway Proxy | —         | `44440`          | `80`               |
| Agentgateway Admin UI | —      | `44441`          | `15000`            |
| AI Client Gateway | —          | `44443`          | `3101`             |
| MCP Gateway       | `3103`     | `24445`           | `3103`             |
| Open WebUI        | —          | `54443`          | `8080`             |
| GenAI Proxy       | `64443`    | —                | —                  |
| athenzd-managed GenAI Proxy | `65443` | —             | —                  |

## Prerequisites

Before running or building anything, ensure the Docker daemon is running:

```sh
docker info
```

If this fails, start Docker Desktop (Mac/Windows) or run `sudo systemctl start docker` (Linux) before proceeding.

## Running Components Locally

All local development uses `make` commands. Maven commands pass `-Dmaven.resolver.transport=wagon -Dmaven.wagon.http.ssl.insecure=true` to handle self-signed certs.

```sh
# API Server (Java, port 14443)
make -C components/api_server local

# MCP Server (Node.js/TypeScript, port 8101)
make -C components/api_server mcp-local

# MCP Authorization Proxy (Spring Boot, port 8102 → 8101)
make -C components/api_server mcp-proxy-local

# AI Client Gateway (Node.js/TypeScript, port 3101)
make -C components/ai_client_gateway local

# MCP Gateway authenticated routing (Node.js/TypeScript, port 3103)
PUBLIC_BASE_URL='<full-gateway-url>' \
KEYCLOAK_PUBLIC_URL='<full-keycloak-url>' \
make -C components/mcp-gateway local

# MCP stdio credential broker (build and test)
make -C components/mcp-credential-broker install check test build

# athenzd manager CLI and GenAI injector (build and test)
make -C components/athenzd build test

# Keycloak token exchange provider — build only (no local run)
make -C components/keycloak_token_exchange_provider build

# Local workload instance provider — build and test; deployment is opt-in through the athenzd FAQ
make -C local_workload_instance_provider build

# Local GenAI proxy (port 64443 → configured OpenAI-compatible gateway)
OPENAI_CODEX_API_KEY='<upstream API key>' make -C genai_proxy local
```

The existing Express-based Node.js components use `npx tsx` and install their dependencies as part of `make local`. The dependency-free local GenAI proxy runs TypeScript directly with Node.js type stripping.

## Building Docker Images

Each component has a multi-stage Dockerfile. CI/CD via GitHub Actions (`.github/workflows/`) builds and pushes to GHCR on push. To build locally:

```sh
docker build -t <name> .
```

The provider Dockerfiles are export-only — they copy their built JARs into a mounted export directory and do not run a service.

## Technology Stack

| Component                          | Language   | Runtime / Framework                     |
|------------------------------------|------------|-----------------------------------------|
| `components/api_server`                       | Java 17    | Maven, Athenz libs                      |
| `components/api_server/mcp`                   | TypeScript | Node.js 22, Express 5                   |
| `components/api_server/authorization_proxy`   | Java 17    | Spring Boot 3.2.5, Spring Cloud Gateway |
| `components/ai_client_gateway`     | TypeScript | Node.js 22, Express                     |
| `components/athenzd`               | Go 1.25    | Cobra, Viper                            |
| `components/keycloak_token_exchange_provider` | Java 11 | Maven, Keycloak SPI                  |
| `local_workload_instance_provider` | Java 17    | Maven, Athenz InstanceProvider SPI      |
| `genai_proxy`                       | TypeScript | Node.js 22 built-in HTTP/fetch APIs     |

## Key Architectural Concepts

- **ID-JAG token**: An identity assertion token that carries the delegated identity of a human user to an AI agent. The gateway converts IdP-issued ID tokens into ID-JAG tokens via Athenz.
- **Token exchange chain**: AI agent → ID-JAG → Athenz AT → MCP server → token exchange → scoped AT → API server. Each hop re-narrows the permission scope.
- **Athenz ZTS/ZMS**: The authorization server. ZMS manages policies; ZTS issues access tokens after evaluating policies. ZPU pushes policies to resource servers for offline evaluation.
- **Self-signed certs**: Local development uses self-signed certificates. Keys and cert directories are gitignored. Maven SSL flags are set in all `make local` targets.

## Tutorials

The `tutorials/` directory contains the canonical learning path (01–14, with sub-steps). They are Markdown files intended to be read in order. The `tutorials/challenges/` subdirectory contains challenge exercises. Always keep tutorial content consistent with the code behavior when making changes.

## FAQ Writing Rules

For files under `faqs/`, keep the main path short and procedure-first.

Do not manually hard-wrap normal prose. Keep normal paragraphs on one line unless a list, table, or code block needs structure.

Add a collapsible verification status block immediately below the FAQ's table of contents, after `<!-- /TOC -->`. If the FAQ does not have a table of contents, add one before the verification block. Only a human user may mark a FAQ as verified or successful. If the user has not explicitly confirmed that the exact procedure worked, use the pending shape:

```md
<details>
<summary>Verification status — 🟡 Pending human verification</summary>

| # | Date | Status |
|---|------|--------|
| 1 | TBD  | 🟡 Pending — human has not confirmed this procedure |

</details>
```

When the user explicitly confirms success, update the summary to `Last verified on <date> — ✅ Success` and add the human-confirmed result to the table.

Do not add a `# FAQs` section unless the human user explicitly asks for one. When requested, place it after the steps and before `# Reference`, and put small details, rationale, caveats, and troubleshooting there.

Inside a `# FAQs` section, write each question title as bold text instead of a Markdown heading.

```md
**How do I check the locally mounted custom solution template?**
```

New FAQ files should also end with a `# Reference` section by default.

## Research Output Rules

In verified research documents, do not use `...` lines as placeholders for omitted JWT headers, claims, or token-response fields. Show the claims relevant to the recorded result explicitly, mark raw token values as `<redacted>`, and tell readers to rerun the command when the complete current output is required. Do not invent values for fields that were not preserved in the research record.

For two-stage pattern files under `research/athenz/rfc8693_token_exchange/`, use `YYMMDD-<idjag|x509>-<del|imp>-<del|imp>-exchange.md`. The first mode is the initial AT mode and the second mode is the next AT→AT exchange mode. Use `del` for delegated exchange and `imp` for impersonation exchange.

## Tearing Down the Environment

To fully reset after completing the tutorial:

```sh
kind delete cluster                              # only if you used the kind cluster path
rm -rf ~/id_jag_the_hard_way_workspace/athenz_dist
rm -rf ~/id_jag_the_hard_way_workspace
```

**IMPORTANT for AI assistants**: Do not run these commands unless the user explicitly asks to tear down or clean up the entire environment. These are irreversible — they delete the cluster and all local tutorial files.

## Test Suites

Most tutorial components are validated manually by following the tutorials. `athenzd` has a Go test and coverage gate (`make -C components/athenzd test`), and the local GenAI proxy has focused Node.js checks (`make -C genai_proxy test`). Some older `package.json` test scripts still exit with an error by design.
