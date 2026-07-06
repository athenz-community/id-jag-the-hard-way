# Goal

The goal of this FAQ is to run MCP Hub locally.

<!-- TOC depthFrom:2 depthTo:3 -->

- [Step 1. Run MCP Hub](#step-1-run-mcp-hub)
- [Step 2. Open MCP Hub](#step-2-open-mcp-hub)

<!-- /TOC -->

# Prerequisites

- Have the local Kubernetes cluster configured for this repo.
- Have `kubectl` pointed at that cluster.
- Have Node.js and npm available.
- Have at least one MCP server deployment registered in the `mcp-hub` namespace.
- If you want the Tools page to load live tools from an MCP server, have that MCP service reachable from your laptop:

```sh
kubectl -n mcp-hub port-forward svc/example-mcp 24443:8081
```

# Steps

## Step 1. Run MCP Hub

From the repository root:

```sh
make -C mcp_hub local
```

This runs:

```sh
npm install
npm run dev -- --port 3102
```

To use a different port:

```sh
make -C mcp_hub local PORT=3103
```

## Step 2. Open MCP Hub

Open:

```text
http://localhost:3102
```

MCP Hub reads MCP server catalog entries from matching Kubernetes deployments across all namespaces. For local development, it uses your current `kubectl` context.

If the catalog is empty, make sure the MCP server deployment has the required label:

```sh
kubectl get deploy --all-namespaces \
  -l app.kubernetes.io/part-of=mcp-hub
```
