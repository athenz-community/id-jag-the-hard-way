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

That API route reads Kubernetes deployments from one namespace:

```text
MCP_HUB_K8S_NAMESPACE=mcp-hub
```

If `MCP_HUB_K8S_NAMESPACE` is not set, the default namespace is:

```text
mcp-hub
```

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

- **Local development:** if `KUBERNETES_SERVICE_HOST` is not set, it shells out to `kubectl`.
- **In-cluster/pod mode:** if `KUBERNETES_SERVICE_HOST` is set, it reads the Kubernetes API using the pod service account token.

This lets local development use the current `kubectl` context while the deployed MCP Hub can use Kubernetes RBAC.

## Required Label

Every MCP server deployment must have this label:

```yaml
metadata:
  labels:
    app.kubernetes.io/part-of: mcp-hub
```

Without this label, the deployment is ignored by the catalog.

## Recommended Labels

Use labels for stable, selector-friendly metadata.

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
    mcp.idthw.dev/alias: "K8s Doc Server"
    mcp.idthw.dev/description: "The MCP server for ID-JAG tutorial documents"
    mcp.idthw.dev/transport: "streamable-http"
    mcp.idthw.dev/tools: "search_docs,read_doc,list_tutorials"
```

### `mcp.idthw.dev/alias`

Human-readable display name.

The deployment name remains the real MCP server name. The UI shows the alias if it exists; otherwise it shows the deployment name.

Use an annotation, not a label, when the alias contains spaces:

```yaml
mcp.idthw.dev/alias: "K8s Doc Server"
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

### `mcp.idthw.dev/transport`

Transport used by the MCP server.

Examples:

```yaml
mcp.idthw.dev/transport: "streamable-http"
mcp.idthw.dev/transport: "sse"
mcp.idthw.dev/transport: "stdio"
```

The current catalog does not display transport yet, but future detail pages should.

### `mcp.idthw.dev/tools`

Comma-separated action/tool names exposed by the MCP server.

```yaml
mcp.idthw.dev/tools: "search_docs,read_doc,list_tutorials"
```

The current catalog does not display tools yet. The next detail page should use this value to show actions available to users.

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
  name: k8s-doc-server
```

The alias is optional display text:

```yaml
metadata:
  annotations:
    mcp.idthw.dev/alias: "K8s Doc Server"
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
  name: k8s-doc-server
  namespace: mcp-hub
  labels:
    app: k8s-doc-server
    app.kubernetes.io/part-of: mcp-hub
    mcp.idthw.dev/project: k8s-docs-server
  annotations:
    mcp.idthw.dev/alias: "K8s Doc Server"
    mcp.idthw.dev/description: "The MCP server for ID-JAG tutorial documents"
    mcp.idthw.dev/transport: "streamable-http"
    mcp.idthw.dev/tools: "search_docs,read_doc,list_tutorials"
spec:
  replicas: 1
  selector:
    matchLabels:
      app: k8s-doc-server
  template:
    metadata:
      labels:
        app: k8s-doc-server
        app.kubernetes.io/part-of: mcp-hub
    spec:
      containers:
        - name: mcp
          image: ghcr.io/mlajkim/mcp:latest
          ports:
            - containerPort: 8081
          env:
            - name: UPSTREAM_BASE_URL
              value: "http://api-server.api:8080"
            - name: PUBLIC_BASE_URL
              value: "http://mcp.mcp-hub:8081"
            - name: MCP_CERT_DIR
              value: "/app/certs"
          volumeMounts:
            - name: mcp-certs
              mountPath: /app/certs
              readOnly: true
      volumes:
        - name: mcp-certs
          secret:
            secretName: api-mcp-cert
```

## Example Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: mcp
  namespace: mcp-hub
  labels:
    app: k8s-doc-server
    app.kubernetes.io/part-of: mcp-hub
spec:
  selector:
    app: k8s-doc-server
  ports:
    - name: http
      port: 8081
      targetPort: 8081
```

The service name can remain stable even if the deployment name changes.

## Verify Discovery

```bash
kubectl -n mcp-hub get deploy \
  -l app.kubernetes.io/part-of=mcp-hub
```

Check metadata:

```bash
kubectl -n mcp-hub get deploy/k8s-doc-server \
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

The catalog should show `K8s Doc Server` if the alias annotation is set.

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
