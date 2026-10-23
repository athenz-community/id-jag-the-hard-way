# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Repository Is

**ID-JAG The Hard Way** is a step-by-step tutorial for building an ID-JAG-based AI agent authorization architecture from scratch. It demonstrates how AI agents can access protected APIs on behalf of signed-in human users using real tokens, least-privilege policies, and a chain of token exchanges. The 15-step tutorial in `tutorials/` is the primary artifact; the code components are supporting infrastructure for the tutorial.

The architecture implements the [ID-JAG specification](https://techblog.lycorp.co.jp/en/20260417a) and is listed on the OAuth.net Cross-App Access (XAA) page.

## Components and Their Roles

The repository contains these runtime components and supporting plugins:

1. **`components/api_server/`** — Legacy Java 17 (Maven) REST API. The core tutorial now uses `components/idthw-demo-api/`, which validates Athenz access tokens and enforces per-operation scopes directly. The legacy API directory also contains two sub-services:
   - **`components/idthw-demo-api-mcp/`** — Core tutorial and Hub MCP server. Chapter 08 verifies startup and tool discovery; chapter 10 adds Runtime Proxy, which supplies request-specific API token files; chapter 11 grants downstream exchange permissions.
   - **`components/api_server/mcp/`** — Legacy Node.js/TypeScript MCP adapter that performs its own token exchange; no longer used by the core tutorial.
   - **`components/api_server/authorization_proxy/`** — Legacy Spring Boot 3.2.5 proxy that evaluates Athenz policies. The core tutorial uses `components/mcp-runtime-proxy/` for validation and downstream exchange, with OpenAPI discovery for the existing AI Client Gateway.

2. **`components/ai_client_gateway/`** — Node.js/TypeScript Express proxy that intercepts AI client requests, converts ID tokens to ID-JAG tokens via Athenz, and injects the appropriate access token before forwarding to the MCP server.

3. **`components/idthw_hub/`** — Full-stack Next.js application for IDTHW product surfaces and server-side APIs. It currently hosts MCP Hub and Gen AI. MCP Hub remains the Kubernetes-backed registry and provider/consumer UI inside the broader IDTHW Hub.

4. **`components/mcp-gateway/`** — Node.js/TypeScript authenticated MCP front door for the MCP Hub demo. It performs Keycloak login, keeps the ID token in a bounded server-side session, resolves routes and exact `tools/call.params.name` access scopes through the MCP Hub API, caches ID-JAGs by their actual audience/scopes/expiry, renews scoped Athenz access tokens from those assertions, requests browser reauthentication only when a fresh ID-JAG requires a new ID token, and forwards `/mcp/{id}` through Core MCP Proxy. It does not replace or change the tutorial's `components/ai_client_gateway/` yet.

5. **`components/mcp-credential-broker/`** — Publishable Node.js/TypeScript stdio connector for MCP clients. Separate processes connect to separate MCP Gateway routes while sharing one opaque, browser-authenticated Gateway session through a private local cache and cross-process lock. It is an OAuth public client using Authorization Code + PKCE; it never embeds a confidential-client secret. Its `--logout` option clears every locally cached Gateway session and revokes each opaque token through the issuer's advertised OAuth revocation endpoint; explicit `--logout --idp` additionally opens Keycloak browser sign-out through a short-lived Gateway ticket without exposing the ID token to the broker.

6. **`components/athenzd/`** — Go manager CLI for browser login and logout, idempotent ZMS service registration, optional Copper Argos X.509 enrollment, ID-JAG and Athenz access-token issuance, and management of the local GenAI credential-injector daemon.

7. **`components/keycloak_token_exchange_provider/`** — Java 11 Maven Keycloak plugin that enables ID token delegation from Keycloak to Athenz.

8. **`components/local_workload_instance_provider/`** — Standalone Java 17 Maven plugin for the optional local Copper Argos flow. It validates an OIDC ID token as workload attestation and restricts certificate enrollment to the authenticated user's Athenz home-domain subtree. It is not deployed by default; the `athenzd` FAQ mounts and registers it for testing.

9. **`athenz_dist/`** — Git submodule pointing to `athenz-community/athenz-distribution`. Acts as the authorization server (ZMS + ZTS) for the tutorial.

10. **`components/genai_proxy/`** — Minimal locally run Node.js proxy that validates Athenz Bearer tokens with the ZTS public key, requires a `gen-ai.services.<project>` audience and `gen-ai-users` scope, replaces that token with `OPENAI_CODEX_API_KEY`, and forwards OpenAI-compatible `/v1/*` requests to the gateway configured by `GENAI_UPSTREAM_BASE_URL`. It meters both Chat Completions and Responses API token fields, keeps daily JST per-project, per-user and per-model counters with a JST `last_usage` time in `HH:mm:ss` format, owns and enforces per-service-code daily spending limits with HTTP 429 responses, persists counters under the gitignored `components/athenzd/.athenzd/` directory for `make local`, and exposes user-specific projects, limits, spend, and costs at unauthenticated `GET /api/users/{user}`.

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
| IDTHW Hub         | `3102`     | —                | `3102`             |
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

# IDTHW Hub (Next.js, port 3102)
make -C components/idthw_hub local

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
make -C components/local_workload_instance_provider build

# Local GenAI proxy (port 64443 → configured OpenAI-compatible gateway)
OPENAI_CODEX_API_KEY='<upstream API key>' make -C components/genai_proxy local
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
| `components/idthw_hub`             | TypeScript | Next.js 16                              |
| `components/athenzd`               | Go 1.25    | Cobra, Viper                            |
| `components/keycloak_token_exchange_provider` | Java 11 | Maven, Keycloak SPI                  |
| `components/local_workload_instance_provider` | Java 17    | Maven, Athenz InstanceProvider SPI      |
| `components/genai_proxy`            | TypeScript | Node.js 22 built-in HTTP/fetch APIs     |

## Key Architectural Concepts

- **ID-JAG token**: An identity assertion token that carries the delegated identity of a human user to an AI agent. The gateway converts IdP-issued ID tokens into ID-JAG tokens via Athenz.
- **Token exchange chain**: AI Client Gateway obtains ID-JAG and an MCP-audience Athenz AT. MCP Runtime Proxy validates and exchanges it for a scoped API AT, supplied to the MCP application through a request-specific file. The gateway holds the ID token; the AI client holds its gateway session token.
- **Athenz ZTS/ZMS**: The authorization server. ZMS manages roles and policies; ZTS issues tokens after checking membership and the applicable issuance/exchange policies. The tutorial's API and MCP Runtime Proxy validate signed scopes directly.
- **Self-signed certs**: Local development uses self-signed certificates. Keys and cert directories are gitignored. Maven SSL flags are set in all `make local` targets.

## Tutorials

The `tutorials/` directory contains the canonical learning path (01–15, with alternative AI client paths). They are Markdown files intended to be read in order. The `tutorials/challenges/` subdirectory contains challenge exercises. Always keep tutorial content consistent with the code behavior when making changes.

### Runnable Shell Examples

Every runnable shell block in tutorials, research, and FAQs must work on its own from the documented working directory after the stated prerequisites. Define or fetch every variable and temporary input inside the block that uses it; keep fixed values inline when a variable adds no clarity. Do not rely on variables from an earlier block or require the same shell session. If several checks must reuse the same token, include its creation and those checks in one block.

Immediately follow every runnable command block with a separate `sh` result block, with every output line prefixed by `#`, so readers can compare their output directly. Include intentional failure results too. Distinguish expected examples from captured output and do not invent successful verification.

New or revised shell tools must follow neighboring tools' output style and reuse `tools/color.sh` (`info`, `ok`, `warn`, `err`, and `fatal`) for progress, success, and failure messages.

### English Source and Translations

- English is the source of truth for the README, tutorials, and research. Make changes to the content, procedures, and technical behavior in the English pages first, then update translations from the revised English source
- Do not introduce independent technical changes in a translation. If a translation reveals an error or missing explanation, fix the English source first and reflect that change in the translated pages
- Preserve commands, configuration values, identifiers, and example output when translating. Translate the surrounding explanations and link labels, and adjust relative links and navigation for the translated directory
- The Korean tutorial under `tutorials/korean/` covers the Codex path: translate chapters 01–08 from the shared English pages and chapters 09–15 from `tutorials/codex/`. Translate `tutorials/korean/00-README.md` from the root English README
- Introduce the Korean tutorial's Codex scope in chapter 09, where readers choose an AI client, and link to the English Claude Code and Open WebUI paths there. Keep language links in the root README and Korean introduction independent of client choice
- Use the root README for language selection and previous/current/next links for chapter navigation. Do not add repeated language or source-link rows such as `English · 한국어 소개` to translated pages

### Korean Writing Style and Terminology

- Use clear Korean engineering prose, with [NAVER D2](https://d2.naver.com/), [우아한형제들 기술블로그](https://techblog.woowahan.com/), [Coupang Engineering](https://medium.com/coupang-engineering), and [Kakao Developers](https://developers.kakao.com/docs/ko/kakaologin/common) as writing references. Prefer practical explanations over literal English sentence structure or marketing language
- Explain a step's purpose before its command, then describe the expected result and the reason for an intentional failure. Use short sentences and direct verbs such as `설정합니다`, `요청합니다`, and `확인합니다`
- The English source is also the source of truth for technical terms. In chapter titles and at first use, write the Korean term followed by its canonical English name in parentheses, for example `인가 서버 (Authorization Server)`, `리소스 서버 (Resource Server)`, `인가 프록시 (Authorization Proxy)`, `액세스 토큰 (Access Token)`, and `ID 제공자 (Identity Provider, IdP)`
- Use the same bilingual technical terms in previous/current/next navigation and the closing `다음:` links, matching the chapter titles
- Prefer natural chapter references such as `저번 장에서는`, `이번 장에서는`, and `다음 장에서는` over numbered references such as `04장에서는`. Use `저번 장` only for the immediately preceding chapter and `지금까지` when recapping earlier progress. For a specific earlier task, use `앞서` with enough context to identify the step. Keep a chapter number or link only when needed to locate a specific nonadjacent section
- After introducing a term, use the Korean form or the established English abbreviation consistently. Keep authentication (`인증`) distinct from authorization (`인가`); explain `audience` as the token's intended recipient and `principal` as the authenticated identity
- Preserve English UI labels, protocol names, claim names, error messages, and identifiers exactly. Improve Korean phrasing without changing the procedure or technical meaning, and keep commands and example output identical to the English source

## Architecture Diagrams

- Use editable, self-contained SVGs for architecture and flow diagrams.
- Preserve the technical meaning: components, identities, boundaries, permissions, protocols, and arrow directions.
- Show the architecture with short labels. Keep explanations in the surrounding Markdown; omit explanatory headings, paragraphs, and summary panels inside diagrams.
- Keep component cards simple: names and identities, with extra detail only when essential to that diagram. Omit validation and role annotations such as `JWT · docs-getter` or `JWT · mcp-accessor`; put those checks in Markdown or dedicated permission diagrams.
- Label the client component `AI Agent`, with `Codex, Claude Code, etc.` as examples.
- Lead with architecture roles: `IdP`, `IdP AS`, `Authorization Server (AS)`, and `Resource Server`. Label the document API `Resource Server`, with service identity `api.idthw-api`. Show Keycloak and Athenz as smaller product labels. In this tutorial, Athenz implements both IdP AS and AS; show those logical roles within one product boundary where both are present.
- Use a consistent visual style: restrained colors, distinct component icons, readable type, intentional spacing, and clean arrow routing. Human icons have a connected head and body, without facial detail.
- Use one shared 280 × 200 component card across core diagrams, with the same icon size, typography, padding, and proportions. Align cards on a grid and adjust the layout around them. Center each group's contents with equal 48 px padding on all sides; calculate the group rectangle from its components.
- Prefer straight horizontal or vertical connectors. Use diagonals only when needed, always at the same 45° angle; avoid arbitrary slopes and curved routes.
- Reuse the token key drawing: gold for access tokens, blue for exchanged access tokens.
- Match each diagram to its tutorial stage and client path; use the current core component names in the core tutorial.
- Keep screenshots and recorded demos in their original formats. Render and visually inspect SVGs before replacing image references.

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

Most tutorial components are validated manually by following the tutorials. `athenzd` has a Go test and coverage gate (`make -C components/athenzd test`), and the local GenAI proxy has focused Node.js checks (`make -C components/genai_proxy test`). Some older `package.json` test scripts still exit with an error by design.
