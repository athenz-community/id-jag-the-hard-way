# MCP Runtime Proxy

`mcp-runtime-proxy` is the pod-local front door for an MCP server. This first slice is intentionally a transparent Streamable HTTP proxy: it forwards MCP requests to the colocated MCP container and adds only health endpoints.

It does not perform Athenz validation, tool authorization, or token exchange yet. Those features can be added behind the same sidecar boundary without changing MCP clients or the Kubernetes Service.

## Request path

```text
MCP client
  -> MCP Gateway
  -> Core MCP Proxy
  -> Kubernetes Service
  -> MCP Runtime Proxy :8082
  -> MCP container on MCP_TARGET_URL
```

The MCP credential broker remains on the client. The Runtime Proxy must target the colocated MCP container directly; targeting MCP Gateway would create a routing loop.

## Configuration

| Environment variable | Default | Purpose |
|---|---|---|
| `PORT` | `8082` | Runtime Proxy listening port |
| `MCP_TARGET_URL` | `http://127.0.0.1:8080` | Base URL of the MCP container in the same pod |

The incoming path and query string are appended to `MCP_TARGET_URL`. For example, `/mcp` is forwarded to `http://127.0.0.1:8080/mcp` with request and response streaming preserved.

Health endpoints are available at `GET /healthz` and `GET /readyz`.

## Run checks

```sh
make check test
```

## Build the image

```sh
make build-image
```

CI publishes `ghcr.io/mlajkim/mcp-runtime-proxy:latest` from the main branch.
