# Core MCP Proxy

`core-mcp-proxy` routes stable MCP paths to MCP servers registered across Kubernetes namespaces.

```text
/mcp/{id} -> registered MCP server /mcp
```

It discovers MCP deployments cluster-wide using:

```text
app.kubernetes.io/part-of=mcp-hub
mcp.idthw.dev/project=<project-name>
mcp.idthw.dev/id=<stable-route-id>
```

`mcp.idthw.dev/id` is optional and defaults to the deployment name. Set it when the public route must be independent of the deployment name or namespace, for example `k8s-docs-server`.

For each deployment, the proxy uses `mcp.idthw.dev/upstream-url` when present. Otherwise it infers:

```text
http://<same-name-service>.<namespace>:<service-port>/mcp
```

Set `MCP_HUB_NAMESPACE` only when discovery should be restricted to one namespace. The default is all namespaces and requires cluster-wide read access to Deployments and Services.

## Image

GitHub Actions publishes:

```text
ghcr.io/mlajkim/core-mcp-proxy:latest
```

## Runtime

```sh
npm run check
npm start
```
