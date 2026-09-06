# IDTHW Hub

IDTHW Hub is a full-stack Next.js application that hosts the MCP Hub, Gen AI, and future IDTHW product surfaces. Its server-side APIs also provide product contracts to other components such as MCP Gateway.

MCP Hub is the product for discovering and registering MCP servers in the IDTHW environment.

The catalog is backed by Kubernetes. MCP server rows are discovered from Kubernetes `Deployment` resources with MCP Hub labels and annotations. Kubernetes is the underlying source of truth, while `/api/mcp-servers` is the registry API consumed by both the UI and MCP Gateway.

## Local Docker Run

```bash
make local
```

`make local` builds the image and starts the detached `idthw-hub-local` Docker container on port `3102`. If that container already exists, it replaces it automatically. The local certificates and kubeconfig are mounted read-only so the server can continue to use Athenz and the current Kubernetes context.

For host-side development with hot reload, run `npm install` followed by `npm run dev -- --port 3102`.

## Authentication and Multiple Users

IDTHW Hub requires OpenID Connect login before rendering the console. The default local IdP is Keycloak, but the provider is configured with environment variables:

```text
MCP_HUB_IDP_NAME
MCP_HUB_IDP_ISSUER
MCP_HUB_IDP_PUBLIC_ISSUER
MCP_HUB_IDP_WELL_KNOWN
MCP_HUB_IDP_AUTHORIZATION_ENDPOINT
MCP_HUB_IDP_CLIENT_ID
MCP_HUB_IDP_CLIENT_SECRET
MCP_HUB_IDP_TOKEN_ENDPOINT
MCP_HUB_IDP_END_SESSION_ENDPOINT
MCP_HUB_ACCOUNT_CACHE_SIZE
AUTH_SECRET
```

Register the default local Keycloak client, then run the hub:

```sh
make -C components/idthw_hub register-idp-client
make -C components/idthw_hub local OPEN_UI=true
```

Each browser can keep up to five IdP sessions by default. The app bar lists the cached users for one-click switching; **Sign in as a different user** goes through Keycloak only when adding an account that is not already sessioned. Set `MCP_HUB_ACCOUNT_CACHE_SIZE` from `1` to `8` to change the limit. Identity claims and refresh tokens remain inside the encrypted, HTTP-only Auth.js cookie, while the UI receives only account display summaries. Signing out clears the full browser account cache and signs the current account out through the IdP.

IDTHW Hub does not generate a private key or user certificate in the browser session. Its existing `mcp-hub.hub-ui` workload certificate stays server-side and is used to read permission membership from ZMS and provision the shared roles and policy for a newly created Hub-managed MCP server. Live MCP Hub tool discovery does not mint an Athenz access token. MCP Gateway performs ID-JAG exchange only when an authenticated client invokes a protected MCP method such as `tools/call`.

The current in-memory authentication cache status is available at `GET /api/mcp-cache-status`. Its Hub access-token field remains empty for response compatibility, and it reports MCP Gateway's current OAuth session users and per-session Athenz cache metadata for protected calls. Configure the Gateway source with `MCP_HUB_GATEWAY_STATUS_URL`; local Docker defaults to `http://host.docker.internal:<mcp-gateway-port>/internal/cache-status`. The Hub authenticates that internal request with `MCP_HUB_REGISTRY_TOKEN` and whitelists the response fields. Neither endpoint returns access tokens, ID tokens, ID-JAGs, opaque session tokens, or their hashes. Like `/api/mcp-servers`, the Hub endpoint accepts either an authenticated MCP Hub browser session or `Authorization: Bearer <MCP_HUB_REGISTRY_TOKEN>` and always returns `Cache-Control: no-store`.

## Gen AI Product

Use the product switcher in the top bar to move between **MCP hub** and **Gen AI**. The Gen AI product currently provides:

- a monitoring dashboard for the currently signed-in user's `user.<preferred_username>` identity
- separate responsibility boxes for Athenz service domains where that user holds `cost-accountable-admins` or `gen-ai-users-managers`; cost accountable admins see all assigned managers, managers see all assigned Gen AI users, and users holding both roles see both boxes
- associated system codes derived from the GenAI proxy projects
- rolling 30-day JST token usage grouped by model
- rolling 30-day JST estimated cost incurred by the current user, grouped by model
- proxy-owned daily service-code spending limits, currently `$240` for Athenz and `$0.002` for Spire, reset at `00:00 JST`
- per-model totals, defaulting legacy unlabelled usage to `gpt-5.6-luna` and automatically including additional reported models

The dashboard reads the signed-in user's GenAI proxy usage endpoint through the Next.js server. For `idjag-learner`, this is:

```text
http://127.0.0.1:64443/api/users/idjag-learner
```

Override the proxy origin when needed:

```sh
make local GENAI_PROXY_URL=http://127.0.0.1:65000
```

The service administrator boxes read the signed-in user's direct role memberships across all domains matching `gen-ai.services.<project>` from ZMS using IDTHW Hub's server-side X.509 certificate. Cost-accountable membership supports both `cost-accountable-admins` and the existing `pm-cost-approval-officer-lv5` schema; manager membership supports both `gen-ai-users-managers` and `gen-ai-users-manager`. Those memberships are accumulated independently, so the same user and service can appear in both responsibility boxes. A cost accountable admin box lists every member of that project's manager role; a Gen AI user manager box lists every member of `gen-ai-users`. The queried member is still always the active signed-in user's full `user.<preferred_username>` Athenz principal; the certificate is only the Hub's credential for the ZMS request. Each service row links directly to `http://localhost:3000/domain/<domain>/role/<managed-role>/members`, so the relevant membership editor opens immediately. Override the local ZMS endpoint or Athenz UI origin when needed:

```sh
make local \
  MCP_HUB_ZMS_URL=https://zms.example.test/zms/v1 \
  MCP_HUB_ZMS_TLS_SERVER_NAME=zms.example.test
MCP_HUB_ATHENZ_UI_URL=https://athenz-ui.example.test make local
```

When the ZMS connection hostname differs from the name on its TLS certificate, set `MCP_HUB_ZMS_TLS_SERVER_NAME` to the certificate name. IDTHW Hub uses it for both TLS SNI and the HTTP `Host` header because ZMS validates that they match. The local Docker workflow defaults this value to `localhost` because it reaches ZMS through `host.docker.internal`, while the local certificate is issued for `localhost`.

The local cost values are explicitly estimates based on fixed demo rates; they are not billing data.![alt text](image.png)

## Data Source

The page fetches data from the local Next API route:

```text
/api/mcp-servers
```

Browser requests authenticate with the IDTHW Hub login session. MCP Gateway can call the same endpoint with:

```text
Authorization: Bearer <MCP_HUB_REGISTRY_TOKEN>
```

Each returned server includes:

- `routeId`, the stable globally unique ID used in `/mcp/{id}`
- `gatewayUrl`, the public MCP client URL when `MCP_HUB_MCP_GATEWAY_URL` is configured
- `proxyUrl`, the corresponding Core MCP Proxy URL
- `accessScope`, the shared Athenz route scope published on a Hub-managed deployment
- `toolScopes`, when permission presets configure tool execution, mapping each MCP tool name to its custom scopes plus the shared managed route scope

The client-configuration page converts `gatewayUrl` into a separate stdio entry backed by `@mlajkim/mcp-credential-broker` from the standard npm registry. The package defaults to `@mlajkim/mcp-credential-broker@latest`; set `NEXT_PUBLIC_MCP_CREDENTIAL_BROKER_PACKAGE` at build time to use another published version:

```sh
NEXT_PUBLIC_MCP_CREDENTIAL_BROKER_PACKAGE='@mlajkim/mcp-credential-broker@0.1.2' make local
```

The first entry opens Keycloak login through MCP Gateway automatically; all entries for that Gateway reuse one opaque local session, so clients do not need a separate native OAuth login per MCP server. Run `npx -y @mlajkim/mcp-credential-broker@latest --logout --idp` to clear the shared Gateway session and open Keycloak browser sign-out before a fresh sign-in. Use `--logout` without `--idp` when only the Gateway session should be revoked. Kubernetes remains the source of each route ID and Gateway URL.

## Permission Readiness Presets

The client-configuration page shows required Athenz role memberships before the manual client setup. Athenz remains the source of truth for current role membership. The Hub checks membership through ZMS with its server-side certificate. Creation of a Hub-managed server provisions only the shared managed-access roles and exchange policy described below; custom per-tool grants are configurable requirements and are not provisioned automatically.

Checked-in defaults live in the pure settings document at [`config/permission-presets.yaml`](./config/permission-presets.yaml). It starts with `version` and `servers` and contains no Kubernetes resource wrapper. `make local`, and therefore the repository-root `make ui`, generates and applies the `mcp-hub/mcp-hub-permission-presets` ConfigMap from that file before building and starting IDTHW Hub. The ConfigMap stores the document under `permission-presets.yaml`.

An authenticated Hub user can edit a live tool's custom requirements in its permission dialog. Each row targets either `<signed_in_user>` or a literal Athenz service principal and one Athenz role. The Hub stores partial per-tool overrides as versioned JSON in the MCP Deployment's `mcp.idthw.dev/tool-permissions` annotation; an override replaces that tool's checked-in default while other defaults remain intact. An empty override intentionally removes all custom requirements for that tool. Because the patch changes Deployment metadata only, saving it does not restart the MCP pod. Saving configuration also does not add role members in Athenz.

The current preset contains only `k8s-docs-server`. A server without a preset still shows the generated shared Hub-managed access requirements when its deployment publishes a managed access scope. A server with neither a preset nor a managed access scope shows its tools with the yellow `No configuration found` state.

The permission setup uses the public live MCP `tools/list` response as the source of truth for available tools. Listing tools does not require an Athenz access role or mint an access token. Every returned tool is shown before manual client setup; the configured and generated requirements describe protected execution, not discovery. A tool without either kind of requirement is marked yellow as `No configuration found`; otherwise it shows its checked Athenz status. The dialog separates editable custom **Tool permissions** from read-only Hub-managed **MCP access** defaults and links each role to Athenz. MCP Hub does not submit custom permission requests yet.

Use the exact reserved member value `<signed_in_user>` when a requirement belongs to the current browser session:

```yaml
member: <signed_in_user>
role: api:role.docs-getter
```

It resolves to `human.<preferred_username>` by default. Override the Athenz domain with `MCP_HUB_PERMISSION_SIGNED_IN_USER_DOMAIN`. All other member values must be complete literal Athenz principals such as `mcp-hub.mcp-gateway` or `api.api-mcp`. Partial interpolation and unknown placeholders are rejected. A malformed preset produces a visible configuration error rather than silently omitting a requirement and reporting a false ready state.

For every tool, the current K8s Docs preset and generated defaults check:

- the signed-in user in the tool-specific role and the shared `api:role.mcp-accessor` role
- `mcp-hub.mcp-gateway` in the shared `api:role.mcp-accessor-jag-exchanger` role and the tool-specific `api:role.*-jag-exchanger` role
- `api.api-mcp` in the tool-specific exchanger role for downstream token exchange

Shared MCP-access requirements are generated for every tool from the Deployment's managed access scope. They appear in the read-only **MCP access** section at the bottom of each tool dialog instead of being duplicated in the editable preset.

### Hub-managed Athenz access

Creating a server with **Hub-managed access** requires an existing Athenz service in `mcp-hub.mcps.<project>`. After the Kubernetes server-side dry run succeeds and before creating the resources, the Hub idempotently verifies the domain and selected service, then ensures:

- `mcp-hub.mcps.<project>:role.accessor` contains `human.<signed-in-user>`
- `mcp-hub.mcps.<project>:role.accessor-jag-exchanger` contains `mcp-hub.mcp-gateway`
- the exchanger role may perform `zts.jag_exchange` on `mcp-hub.mcps.<project>:role.accessor`

The Hub does not create `mcp-hub.mcps.<project>` itself. Project/domain lifecycle remains separate. The generated Deployment publishes the accessor role as `mcp.idthw.dev/access-scope`. MCP Gateway reads it dynamically through `/api/mcp-servers`, requests an Athenz access token when a protected method such as `tools/call` is invoked, and replaces the opaque Gateway session bearer with that Athenz bearer before forwarding. Core MCP Proxy preserves the header. The pod-local Runtime Proxy verifies the ZTS signature, expiry, managed audience, and accessor scope before preserving the validated header for the MCP container. No Gateway ConfigMap update or restart is required.

Hub-managed creation and update idempotently apply a project-local `mcp-runtime-proxy-athenz-ca` ConfigMap from the Hub's configured Athenz CA. The Runtime Proxy uses that trust bundle to retrieve signing keys directly from `https://athenz-zts-server.athenz:4443/zts/v1/oauth2/keys?rfc=true`; TLS verification is not disabled. It does not download or evaluate Athenz policy. MCP bootstrap, `ping`, and `tools/list` remain public, while protected calls return `401` for missing or invalid tokens and `403` when the accessor scope is absent.

Custom per-tool requirements can be supplied by `config/permission-presets.yaml` or overridden from the permission dialog. Their signed-in-user roles are combined with the shared accessor role for that exact tool call, and the readiness UI checks both the custom and managed memberships.

When a server returns five or more tools, the client-configuration page collapses the permission rows by default behind **Expand tools** so the configuration in step 2 remains visible without a long initial scroll. Servers with fewer than five tools keep their rows expanded.

Override the ConfigMap location when needed with `MCP_HUB_PERMISSION_CONFIG_MAP_NAMESPACE`, `MCP_HUB_PERMISSION_CONFIG_MAP_NAME`, and `MCP_HUB_PERMISSION_CONFIG_MAP_KEY`. In-cluster IDTHW Hub service accounts need read access to that ConfigMap.

Configure the proxy origin with `MCP_HUB_CORE_PROXY_URL`. Local Docker `make local` uses `host.docker.internal` plus the local Core MCP Proxy port; host-side development can use `127.0.0.1`, and an in-cluster IDTHW Hub should use `http://core-mcp-proxy.mcp-hub:8080`.

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

For the current local workflow, no additional IDTHW Hub RBAC setup is required beyond your own `kubectl` access.

## Live Tool Discovery

The Tools page discovers tools from the running MCP server with public JSON-RPC `tools/list`. MCP Hub does not send an `Authorization` header for this request. Deployment annotations can provide the endpoint URL, but the tool definitions come from the live MCP server.

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

Live tool discovery uses the server's Core MCP Proxy route without an Athenz access token. The annotation remains the direct public endpoint and is used by the client-configuration page only as a fallback when `MCP_HUB_MCP_GATEWAY_URL` is not configured. If the value is just a host and port, such as `http://localhost:24443`, MCP Hub normalizes it to `/mcp`.

When IDTHW Hub runs in-cluster, the default endpoint is derived from the selected server name and namespace:

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
    mcp.idthw.dev/id: "k8s-docs-server"
    mcp.idthw.dev/access-scope: "api:role.mcp-accessor api:role.docs-getter"
    mcp.idthw.dev/alias: "K8s Docs Server"
    mcp.idthw.dev/description: "The MCP server for ID-JAG tutorial documents"
    mcp.idthw.dev/public-url: "http://localhost:24443/mcp"
    mcp.idthw.dev/transport: "streamable-http"
```

### `mcp.idthw.dev/id`

Globally unique stable route ID used by MCP Gateway and Core MCP Proxy:

```yaml
mcp.idthw.dev/id: "k8s-docs-server"
```

It defaults to the deployment name. Set it explicitly when the public route must not change with the deployment name or namespace.

### `mcp.idthw.dev/access-scope`

Optional space-separated Athenz scopes that MCP Gateway requests for the signed-in user's route-specific access token:

```yaml
mcp.idthw.dev/access-scope: "api:role.mcp-accessor api:role.docs-getter"
```

For a Hub-managed server, this annotation is generated as `mcp-hub.mcps.<project>:role.accessor`. If the server also has permission presets, `/api/mcp-servers` publishes a `toolScopes` map that combines this shared role with each tool's custom `<signed_in_user>` roles, and MCP Gateway selects the exact mapping from `tools/call.params.name`. An unmapped tool on such a server fails closed. Servers without `toolScopes` use the annotation as the route-level scope for protected calls.

If omitted, MCP Gateway uses its `MCP_GATEWAY_ACCESS_SCOPE` fallback.

### `mcp.idthw.dev/tool-permissions`

Optional versioned JSON containing partial per-tool requirement overrides saved by the Hub UI. Each configured tool replaces the same tool from `config/permission-presets.yaml`; unmentioned tools continue to use the checked-in default. The Hub derives Gateway `toolScopes` only from `<signed_in_user>` requirements, while literal service-principal requirements are still included in readiness checks.

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

Externally reachable MCP endpoint used for live tool discovery and as the client-configuration fallback when no MCP Gateway URL is configured.

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

Optional image file ID selected during MCP server or MCP template creation/editing. Server Deployments and template Secrets both use this annotation; templates also keep the ID in `template.json`.

```yaml
mcp.idthw.dev/icon: "confluence.png"
```

Public icon files belong under:

```text
public/mcp_icons/
```

The Hub lists supported image files from that directory. If the annotation is absent, invalid, or references a file that no longer exists, server and template lists fall back to initials derived from the resource name. A template icon becomes the default when creating a server from that template, and users can still choose another icon. Legacy `/icons/<file>` and `/mcp_icons/<file>` annotation values are normalized to the file ID when an existing server is edited.

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
    mcp.idthw.dev/id: "example-mcp"
    mcp.idthw.dev/access-scope: "api:role.mcp-accessor api:role.docs-getter"
    mcp.idthw.dev/alias: "Example MCP"
    mcp.idthw.dev/id: "example-mcp"
```

The catalog display rule is:

```text
display name = alias ?? deployment metadata.name
```

This keeps Kubernetes identity stable while allowing friendly UI names.

## MCP Gateway Client URL

Set the public gateway origin:

```text
MCP_HUB_MCP_GATEWAY_URL=http://mcp-gateway.idthw.org:24445
```

Codex is selected by default on the client-configuration page, which generates:

```toml
[mcp_servers.k8s-docs-server]
enabled = true
startup_timeout_sec = 360
command = "npx"
args = [
    "-y",
    "@mlajkim/mcp-credential-broker@latest",
    "--allow-insecure-http",
    "http://mcp-gateway.idthw.org:24445/mcp/k8s-docs-server",
]
```

The Tools page uses the deployment's Core MCP Proxy route to perform public live `tools/list` discovery from the IDTHW Hub server. This avoids treating a host-only `127.0.0.1` port-forward as container-local. Protected client calls continue through MCP Gateway's workload-certificate → user-scoped Athenz token flow.

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
