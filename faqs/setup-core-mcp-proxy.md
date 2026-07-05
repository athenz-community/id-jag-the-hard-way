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
mcp.idthw.dev/public-url=<mcp-url>
mcp.idthw.dev/transport=streamable-http
```

`core-mcp-proxy` should read that same metadata. That keeps one registry shape for both the UI and the proxy.

Do not make `core-mcp-proxy` the SSOT yet. Make it a consumer of the registry. Later, if MCP Hub gets a real registration API, that API can become the write path for the same Kubernetes metadata.

For direct MCP Hub calls, `public-url` is enough because the UI and tools page call MCP servers directly. With `core-mcp-proxy`, the proxy can usually infer the in-cluster target from the same-name Kubernetes Service. Use `upstream-url` only when the Service cannot be inferred.

```text
mcp.idthw.dev/public-url   client-facing URL shown by MCP Hub
mcp.idthw.dev/upstream-url optional in-cluster proxy target override
```

Do not make the proxy call a local development URL like `http://127.0.0.1:24444/mcp`. Prefer same-name Service discovery or `upstream-url` for the proxy target, and keep `public-url` for the client-facing route.

## What should the proxy do first?

Keep the first version boring:

1. Read MCP server deployments in namespace `mcp-hub`.
2. Filter to deployments labeled `app.kubernetes.io/part-of=mcp-hub`.
3. Build a route table from deployment name to a same-name Service, or to `mcp.idthw.dev/upstream-url` when that override is present.
4. Proxy:

```text
/mcp/{id} -> inferred Service URL or mcp.idthw.dev/upstream-url
```

For example:

```text
/mcp/confluence-mcp -> http://confluence-mcp.mcp-hub:9000/mcp
/mcp/api-mcp        -> http://api-mcp.mcp-hub:8081/mcp
```

This is not one giant merged tool list yet. It is a stable fan-in route namespace.

## Kubernetes RBAC

`core-mcp-proxy` needs read-only access to deployments and services in `mcp-hub`.

```sh
kubectl apply -f - <<'EOF'
apiVersion: v1
kind: ServiceAccount
metadata:
  name: core-mcp-proxy
  namespace: mcp-hub
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: core-mcp-proxy-reader
  namespace: mcp-hub
rules:
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list", "watch"]
  - apiGroups: [""]
    resources: ["services"]
    verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: core-mcp-proxy-reader
  namespace: mcp-hub
subjects:
  - kind: ServiceAccount
    name: core-mcp-proxy
    namespace: mcp-hub
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: core-mcp-proxy-reader
EOF
```

```sh
# serviceaccount/core-mcp-proxy created
# role.rbac.authorization.k8s.io/core-mcp-proxy-reader created
# rolebinding.rbac.authorization.k8s.io/core-mcp-proxy-reader created
```

## Use the GHCR Image

The normal tutorial path should use the published GHCR image:

```text
ghcr.io/mlajkim/core-mcp-proxy:latest
```

The image is built by GitHub Actions from `core_mcp_proxy/`. After a change lands on `main`, the workflow publishes the `latest` tag.

## Deploy the Proxy

Deploy `core-mcp-proxy` into `mcp-hub`:

```sh
kubectl apply -f - <<'EOF'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: core-mcp-proxy
  namespace: mcp-hub
  labels:
    app: core-mcp-proxy
    app.kubernetes.io/part-of: mcp-hub
spec:
  replicas: 1
  selector:
    matchLabels:
      app: core-mcp-proxy
  template:
    metadata:
      labels:
        app: core-mcp-proxy
    spec:
      serviceAccountName: core-mcp-proxy
      containers:
        - name: core-mcp-proxy
          image: ghcr.io/mlajkim/core-mcp-proxy:latest
          imagePullPolicy: Always
          env:
            - name: MCP_HUB_NAMESPACE
              value: mcp-hub
            - name: MCP_HUB_LABEL_SELECTOR
              value: app.kubernetes.io/part-of=mcp-hub
          ports:
            - name: http
              containerPort: 8080
EOF
```

Create the Kubernetes Service:

```sh
kubectl expose deploy core-mcp-proxy -n mcp-hub \
  --port 8080 \
  --target-port 8080 \
  --name core-mcp-proxy
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
echo "http://127.0.0.1:${_core_mcp_proxy_port}/mcp/api-mcp"
echo "http://127.0.0.1:${_core_mcp_proxy_port}/mcp/confluence-mcp"
```

At that point, the K8s Docs Server metadata can look like:

```sh
_core_mcp_proxy_port=$(./tools/port.sh core-mcp-proxy)

kubectl annotate deploy api-mcp -n mcp-hub \
  mcp.idthw.dev/public-url="http://127.0.0.1:${_core_mcp_proxy_port}/mcp/api-mcp" \
  mcp.idthw.dev/upstream-url="http://api-mcp.mcp-hub:8081/mcp" \
  --overwrite
```

The Confluence metadata can look like:

```sh
_core_mcp_proxy_port=$(./tools/port.sh core-mcp-proxy)

kubectl annotate deploy confluence-mcp -n mcp-hub \
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
