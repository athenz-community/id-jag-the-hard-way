# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Repository Is

**ID-JAG The Hard Way** is a step-by-step tutorial for building an ID-JAG-based AI agent authorization architecture from scratch. It demonstrates how AI agents can access protected APIs on behalf of signed-in human users using real tokens, least-privilege policies, and a chain of token exchanges. The 15-step tutorial in `tutorials/` is the primary artifact; the code components are supporting infrastructure for the tutorial.

The architecture implements the [ID-JAG specification](https://techblog.lycorp.co.jp/en/20260417a) and is listed on the OAuth.net Cross-App Access (XAA) page.

## Components and Their Roles

Five microservices implement the full authorization flow:

1. **`api_server/`** — Java 17 (Maven) REST API that enforces Athenz access tokens. Also contains two sub-services:
   - **`api_server/mcp/`** — Node.js/TypeScript MCP (Model Context Protocol) server that performs token exchange with Athenz ZTS before calling the API server.
   - **`api_server/authorization_proxy/`** — Spring Boot 3.2.5 proxy that sits in front of the MCP server and validates Athenz access tokens.

2. **`ai_client_gateway/`** — Node.js/TypeScript Express proxy that intercepts AI client requests, converts ID tokens to ID-JAG tokens via Athenz, and injects the appropriate access token before forwarding to the MCP server.

3. **`keycloak_token_exchange_provider/`** — Java 11 Maven Keycloak plugin that enables ID token delegation from Keycloak to Athenz.

4. **`athenz_dist/`** — Git submodule pointing to `athenz-community/athenz-distribution`. Acts as the authorization server (ZMS + ZTS) and ZPU for the tutorial.

5. **`zpu/`** — Bash script + Dockerfile for the Athenz ZPU (policy updater) service.

**Default ports** — local (`make local`) vs. Kubernetes port-forward (`keep-k8s-port-forward.sh`):

| Component         | Local port | K8s port-forward | K8s container port |
|-------------------|------------|------------------|--------------------|
| Athenz ZMS        | —          | `4443`           | `4443`             |
| Athenz ZTS        | —          | `8443`           | `4443`             |
| Athenz UI         | —          | `3000`           | `3000`             |
| API Server        | —          | `14443`          | `8080`             |
| MCP Server        | —          | `24443`          | `8081`             |
| MCP Auth Proxy    | —          | —                | —                  |
| Keycloak (IdP)    | —          | `34443`          | `8080`             |
| Keycloak HTTPS    | —          | `34444`          | `8443`             |
| AI Client Gateway | —          | `44443`          | `3101`             |
| Open WebUI        | —          | `54443`          | `8080`             |
| Ollama Server     | `11434`    | —                | —                  |

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
make -C api_server local

# MCP Server (Node.js/TypeScript, port 8101)
make -C api_server mcp-local

# MCP Authorization Proxy (Spring Boot, port 8102 → 8101)
make -C api_server mcp-proxy-local

# AI Client Gateway (Node.js/TypeScript, port 3101)
make -C ai_client_gateway local

# Keycloak token exchange provider — build only (no local run)
make -C keycloak_token_exchange_provider build
```

Node.js components use `npx tsx` (no compile step required) and `npm install` is run as part of `make local`.

## Building Docker Images

Each component has a multi-stage Dockerfile. CI/CD via GitHub Actions (`.github/workflows/`) builds and pushes to GHCR on push. To build locally:

```sh
docker build -t <name> .
```

The `keycloak_token_exchange_provider` Dockerfile is export-only — it copies the built JAR into a scratch image for extraction.

## Technology Stack

| Component                          | Language   | Runtime / Framework                     |
|------------------------------------|------------|-----------------------------------------|
| `api_server`                       | Java 17    | Maven, Athenz libs                      |
| `api_server/mcp`                   | TypeScript | Node.js 22, Express 5                   |
| `api_server/authorization_proxy`   | Java 17    | Spring Boot 3.2.5, Spring Cloud Gateway |
| `ai_client_gateway`                | TypeScript | Node.js 22, Express                     |
| `keycloak_token_exchange_provider` | Java 11    | Maven, Keycloak SPI                     |

## Key Architectural Concepts

- **ID-JAG token**: An identity assertion token that carries the delegated identity of a human user to an AI agent. The gateway converts IdP-issued ID tokens into ID-JAG tokens via Athenz.
- **Token exchange chain**: AI agent → ID-JAG → Athenz AT → MCP server → token exchange → scoped AT → API server. Each hop re-narrows the permission scope.
- **Athenz ZTS/ZMS**: The authorization server. ZMS manages policies; ZTS issues access tokens after evaluating policies. ZPU pushes policies to resource servers for offline evaluation.
- **Self-signed certs**: Local development uses self-signed certificates. Keys and cert directories are gitignored. Maven SSL flags are set in all `make local` targets.

## Tutorials

The `tutorials/` directory contains the canonical learning path (01–14, with sub-steps). They are Markdown files intended to be read in order. The `tutorials/challenges/` subdirectory contains challenge exercises. Always keep tutorial content consistent with the code behavior when making changes.

## Tearing Down the Environment

To fully reset after completing the tutorial:

```sh
kind delete cluster                              # only if you used the kind cluster path
rm -rf ~/id_jag_the_hard_way_workspace/athenz_dist
rm -rf ~/id_jag_the_hard_way_workspace
```

**IMPORTANT for AI assistants**: Do not run these commands unless the user explicitly asks to tear down or clean up the entire environment. These are irreversible — they delete the cluster and all local tutorial files.

## No Test Suite

There are no automated tests in this repository. The `test` script in all `package.json` files exits with an error. Validation is done manually by following the tutorials.
