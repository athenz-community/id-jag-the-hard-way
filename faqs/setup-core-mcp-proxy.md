# Setup Core MCP Proxy

The goal of this tutorial is to deploy `core-mcp-proxy` as the central MCP routing proxy in the `mcp-hub` namespace.

For now, `core-mcp-proxy` should not be a new database or SSOT. It should read the same Kubernetes-backed MCP registry that MCP Hub already uses, then expose stable proxy routes.

```text
AI client
  -> core-mcp-proxy /mcp/{id}
  -> registered upstream MCP server /mcp
```

<!-- TOC depthFrom:2 depthTo:3 -->

- [What should be the SSOT?](#what-should-be-the-ssot)
- [What should the proxy do first?](#what-should-the-proxy-do-first)
- [Create MCP Hub Namespace](#create-mcp-hub-namespace)
- [Kubernetes RBAC](#kubernetes-rbac)
- [Use the GHCR Image](#use-the-ghcr-image)
- [Deploy the Proxy](#deploy-the-proxy)
- [Route Shape](#route-shape)
- [What should wait?](#what-should-wait)

<!-- /TOC -->

## What should be the SSOT?

Use Kubernetes deployments as the backing store for now.

MCP Hub already discovers MCP servers from deployments with:

```text
app.kubernetes.io/part-of=mcp-hub
mcp.idthw.dev/project=<project-name>
mcp.idthw.dev/id=<stable-route-id>
mcp.idthw.dev/public-url=<mcp-url>
mcp.idthw.dev/transport=streamable-http
```

`core-mcp-proxy` should read that same metadata. MCP Hub exposes it through `/api/mcp-servers` as the registry contract used by MCP Gateway, while Core MCP Proxy uses the same Kubernetes metadata to resolve the final upstream.

Do not make `core-mcp-proxy` the SSOT yet. Make it a consumer of the registry. Later, if MCP Hub gets a real registration API, that API can become the write path for the same Kubernetes metadata.

For live tool discovery, `public-url` is enough because the IDTHW Hub server calls MCP servers directly for the MCP Hub product. Client configuration uses MCP Gateway when `MCP_HUB_MCP_GATEWAY_URL` is set. Core MCP Proxy can usually infer the in-cluster target from the same-name Kubernetes Service; use `upstream-url` only when the Service cannot be inferred.

```text
mcp.idthw.dev/public-url   direct URL used for MCP Hub live tool discovery
mcp.idthw.dev/upstream-url optional in-cluster proxy target override
```

Do not make the proxy call a local development URL like `http://127.0.0.1:24444/mcp`. Prefer same-name Service discovery or `upstream-url` for the proxy target, and keep `public-url` for MCP Hub's direct live discovery.

## What should the proxy do first?

Keep the first version boring:

1. Read MCP server deployments across namespaces.
2. Filter to deployments labeled `app.kubernetes.io/part-of=mcp-hub`.
3. Build a route table from `mcp.idthw.dev/id` (falling back to deployment name) to a same-name Service, or to `mcp.idthw.dev/upstream-url` when that override is present.
4. Proxy:

```text
/mcp/{id} -> inferred Service URL or mcp.idthw.dev/upstream-url
```

For example:

```text
/mcp/confluence-mcp -> http://confluence-mcp.mcp-hub:9000/mcp
```

This is not one giant merged tool list yet. It is a stable fan-in route namespace.

## Create MCP Hub Namespace

`core-mcp-proxy` is part of MCP Hub infrastructure, so deploy it in the `mcp-hub` namespace:

```sh
kubectl create namespace mcp-hub --dry-run=client -o yaml | kubectl apply -f -
```

```sh
# namespace/mcp-hub created
```

## Kubernetes RBAC

`core-mcp-proxy` needs read-only access to deployments and services across namespaces because registered MCP workloads may run outside `mcp-hub`.

```sh
kubectl apply -f core_mcp_proxy/kubernetes/core-mcp-proxy.yaml
```

```sh
# serviceaccount/core-mcp-proxy created
# clusterrole.rbac.authorization.k8s.io/core-mcp-proxy-reader created
# clusterrolebinding.rbac.authorization.k8s.io/core-mcp-proxy-reader created
```

## Use the GHCR Image

The normal tutorial path should use the published GHCR image:

```text
ghcr.io/mlajkim/core-mcp-proxy:latest
```

The image is built by GitHub Actions from `core_mcp_proxy/`. After a change lands on `main`, the workflow publishes the `latest` tag.

## Deploy the Proxy

The same manifest deploys `core-mcp-proxy` and its Service into `mcp-hub`. It intentionally leaves `MCP_HUB_NAMESPACE` unset so discovery is cluster-wide:

```sh
kubectl apply -f core_mcp_proxy/kubernetes/core-mcp-proxy.yaml
```

Expose the Service locally with the shared port-forward helper. It uses the configured `core-mcp-proxy` port from `tools/config.yaml`, which defaults to `24442`:

```sh
./tools/keep-k8s-port-forward.sh
```

## Route Shape

The client-facing URL becomes:

```text
http://core-mcp-proxy.mcp-hub:8080/mcp/{id}
```

For local development, MCP Hub can show proxy URLs:

```sh
_core_mcp_proxy_port=$(./tools/port.sh core-mcp-proxy)
echo "http://127.0.0.1:${_core_mcp_proxy_port}/mcp/confluence-mcp"
```

The Confluence metadata can look like:

```sh
_core_mcp_proxy_port=$(./tools/port.sh core-mcp-proxy)

kubectl annotate deploy confluence-mcp -n mcp-hub \
  mcp.idthw.dev/id="confluence-mcp" \
  mcp.idthw.dev/public-url="http://127.0.0.1:${_core_mcp_proxy_port}/mcp/confluence-mcp" \
  mcp.idthw.dev/upstream-url="http://confluence-mcp.mcp-hub:9000/mcp" \
  --overwrite
```

## What should wait?

Do not start with full policy/resource enforcement in this proxy.

First version:

- route by MCP server id
- preserve streamable HTTP behavior
- support `tools/list`
- log upstream server id and status

Later versions:

- require ID-JAG/Athenz token
- map Athenz scopes to allowed MCP server ids
- map scopes to allowed tools
- add audit records
- optionally hide denied tools from `tools/list`
