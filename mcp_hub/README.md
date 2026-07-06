# MCP Hub

MCP Hub is a small Next.js application for discovering and eventually registering MCP servers in the IDTHW environment.

The catalog is backed by Kubernetes. MCP server rows are discovered from Kubernetes `Deployment` resources with MCP Hub labels and annotations. Kubernetes is the first source of truth: if an MCP server is deployed, labeled, and annotated correctly, it appears in the catalog.

## Local Development

```bash
npm install
npm run dev -- --port 3102
```

or:

```bash
make local
```

`make local` uses port `3102` by default.

## Data Source

The page fetches data from the local Next API route:

```text
/api/mcp-servers
```

That API route reads Kubernetes deployments from all namespaces visible to the current Kubernetes client.

The API selects deployments with:

```text
app.kubernetes.io/part-of=mcp-hub
```

Override the selector with:

```text
MCP_HUB_K8S_LABEL_SELECTOR=<selector>
```

## Local vs Pod Mode

The catalog reader supports two execution modes:

- **Local development:** if `KUBERNETES_SERVICE_HOST` is not set, it shells out to `kubectl get deployments --all-namespaces` and uses your current kubeconfig permissions.
- **In-cluster/pod mode:** if `KUBERNETES_SERVICE_HOST` is set, it reads all namespaces through the Kubernetes API using the pod service account token.

For the current local workflow, no additional MCP Hub RBAC setup is required beyond your own `kubectl` access.

## Live Tool Discovery

The Tools page discovers tools from the running MCP server with JSON-RPC `tools/list`. Deployment annotations can provide the endpoint URL, but the tool definitions come from the live MCP server.

For local development, port-forward the MCP service before opening the Tools page:

```bash
kubectl -n mcp-hub port-forward svc/example-mcp 24443:8081
```

The local default MCP endpoint is:

```text
MCP_HUB_LOCAL_MCP_URL=http://127.0.0.1:24443/mcp
```

For a specific MCP deployment, set the public MCP endpoint with:

```yaml
mcp.idthw.dev/public-url: "http://localhost:24443/mcp"
```

The client configuration page and live tool discovery use this annotation when it is present. If the value is just a host and port, such as `http://localhost:24443`, MCP Hub normalizes it to `/mcp`.

When MCP Hub runs in-cluster, the default endpoint is derived from the selected server name and namespace:

```text
http://{server}.{namespace}:8081/mcp
```

## Required Label

Every MCP server deployment in any namespace must have these labels:

```yaml
metadata:
  labels:
    app.kubernetes.io/part-of: mcp-hub
    mcp.idthw.dev/project: k8s-docs-server
```

Without both labels, the deployment is ignored by the catalog.

## Recommended Labels

Use labels for stable, selector-friendly metadata. The required labels are:

```yaml
metadata:
  labels:
    app.kubernetes.io/part-of: mcp-hub
    mcp.idthw.dev/project: k8s-docs-server
```

### `mcp.idthw.dev/project`

The owning project for the MCP server.

Example:

```yaml
mcp.idthw.dev/project: k8s-docs-server
```

This appears in the catalog `Project` column.

## Optional Annotations

Use annotations for display metadata and richer values.

```yaml
metadata:
  annotations:
    mcp.idthw.dev/alias: "K8s Docs Server"
    mcp.idthw.dev/description: "The MCP server for ID-JAG tutorial documents"
    mcp.idthw.dev/public-url: "http://localhost:24443/mcp"
    mcp.idthw.dev/transport: "streamable-http"
```

### `mcp.idthw.dev/alias`

Human-readable display name.

The deployment name remains the real MCP server name. The UI shows the alias if it exists; otherwise it shows the deployment name.

Use an annotation, not a label, when the alias contains spaces:

```yaml
mcp.idthw.dev/alias: "K8s Docs Server"
```

### `mcp.idthw.dev/description`

Catalog description.

```yaml
mcp.idthw.dev/description: "The MCP server for ID-JAG tutorial documents"
```

If omitted, the API uses:

```text
The MCP server for <name-or-alias>
```

### `mcp.idthw.dev/public-url`

Externally reachable MCP endpoint used for client configuration and live tool discovery.

```yaml
mcp.idthw.dev/public-url: "http://localhost:24443/mcp"
```

If the value is only an origin, MCP Hub adds `/mcp` automatically:

```yaml
mcp.idthw.dev/public-url: "http://localhost:24443"
```

### `mcp.idthw.dev/transport`

Transport used by the MCP server.

Examples:

```yaml
mcp.idthw.dev/transport: "streamable-http"
mcp.idthw.dev/transport: "sse"
mcp.idthw.dev/transport: "stdio"
```

The current catalog does not display transport yet, but future detail pages should.

### `mcp.idthw.dev/icon`

Optional icon path served by the Next app.

```yaml
mcp.idthw.dev/icon: "/icons/confluence.png"
```

Public icon files belong under:

```text
public/icons/
```

## Name vs Alias

The deployment name is the MCP server's real name:

```yaml
metadata:
  name: example-mcp
```

The alias is optional display text:

```yaml
metadata:
  annotations:
    mcp.idthw.dev/alias: "Example MCP"
```

The catalog display rule is:

```text
display name = alias ?? deployment metadata.name
```

This keeps Kubernetes identity stable while allowing friendly UI names.

## Example MCP Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: example-mcp
  namespace: mcp-hub
  labels:
    app: example-mcp
    app.kubernetes.io/part-of: mcp-hub
    mcp.idthw.dev/project: example
  annotations:
    mcp.idthw.dev/alias: "Example MCP"
    mcp.idthw.dev/description: "Example MCP server"
    mcp.idthw.dev/public-url: "http://localhost:24443/mcp"
    mcp.idthw.dev/transport: "streamable-http"
spec:
  replicas: 1
  selector:
    matchLabels:
      app: example-mcp
  template:
    metadata:
      labels:
        app: example-mcp
        app.kubernetes.io/part-of: mcp-hub
    spec:
      containers:
        - name: example-mcp
          image: ghcr.io/example/mcp:latest
          ports:
            - containerPort: 8081
          env:
            - name: PUBLIC_BASE_URL
              value: "http://example-mcp.mcp-hub:8081"
            - name: MCP_CERT_DIR
              value: "/app/certs"
          volumeMounts:
            - name: example-mcp-certs
              mountPath: /app/certs
              readOnly: true
      volumes:
        - name: example-mcp-certs
          secret:
            secretName: example-mcp-cert
```

## Example Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: example-mcp
  namespace: mcp-hub
  labels:
    app: example-mcp
    app.kubernetes.io/part-of: mcp-hub
spec:
  selector:
    app: example-mcp
  ports:
    - name: http
      port: 8081
      targetPort: 8081
```

The service name can remain stable even if the deployment name changes.

## Verify Discovery

```bash
kubectl get deploy --all-namespaces \
  -l app.kubernetes.io/part-of=mcp-hub
```

Check metadata:

```bash
kubectl -n mcp-hub get deploy/example-mcp \
  -o jsonpath='{.metadata.name}{"\t"}{.metadata.annotations.mcp\.idthw\.dev/alias}{"\t"}{.metadata.labels.mcp\.idthw\.dev/project}{"\n"}'
```

Run the app:

```bash
make local
```

Open:

```text
http://localhost:3102
```

The catalog should show `K8s Docs Server` if the alias annotation is set.

## Future Registration Flow

The long-term goal is to let MCP providers register MCP servers from the UI.

The registration form should eventually collect:

- MCP server name
- Display alias
- Project
- Container image
- Transport
- Port
- Service account
- Replicas
- Tools/actions
- Managed policy metadata

The first real implementation should create Kubernetes resources from that form. A database should only be added once there is a concrete need for draft state, audit history, approval workflows, or richer metadata that does not fit Kubernetes labels and annotations.
