# Goal

The goal of this FAQ is to run MCP Hub locally.

<!-- TOC depthFrom:2 depthTo:3 -->

- [Step 1. Configure IdP Login](#step-1-configure-idp-login)
- [Step 2. Setup X.509 Cert for the UI](#step-2-setup-x509-cert-for-the-ui)
- [Step 3. Grant Per-User MCP Access](#step-3-grant-per-user-mcp-access)
- [Step 4. Run MCP Hub](#step-4-run-mcp-hub)
- [Step 5. Import K8s API Docs Server](#step-5-import-k8s-api-docs-server)
- [Step 6. Verify Protected MCP Tools](#step-6-verify-protected-mcp-tools)

<!-- /TOC -->

<details>
<summary>Verification status — 🟡 Pending human verification</summary>

| # | Date | Status |
|---|------|--------|
| 1 | TBD  | 🟡 Pending — human has not confirmed this procedure |

</details>

# Prerequisites

- Have the local Kubernetes cluster configured for this repo.
- Have `kubectl` pointed at that cluster.
- Have Node.js and npm available.

# Steps

## Step 1. Configure IdP Login

Register MCP Hub as a confidential client in the tutorial Keycloak realm:

```sh
make -C mcp_hub register-idp-client PORT=3102
```

This registers both callback URLs used by the hub:

```text
http://localhost:3102/api/auth/callback/idp
http://localhost:3102/api/auth/idp-logout/complete
```

MCP Hub accepts any Keycloak user that has a non-empty `preferred_username` claim. Create additional users without changing the hub code:

```sh
./tools/keycloak/create-user.sh alice alice@athenz.io Alice User
./tools/keycloak/create-user.sh bob bob@athenz.io Bob User
```

After the first login, use **Sign in as a different user** to add another Keycloak account. The top-bar user menu then keeps the sessioned users in an encrypted browser cache and switches between them without another login prompt. The default cache limit is five users; set `MCP_HUB_ACCOUNT_CACHE_SIZE` from `1` to `8` to override it.

## Step 2. Setup X.509 Cert for the UI

The UI server needs its own Athenz workload certificate to exchange each signed-in user's ID token through ID-JAG. This certificate and private key remain server-side; they are not stored in the browser session.

```sh
./tools/athenz/create-tld.sh "mcp-hub"
./tools/athenz/create-private-key.sh "./keys/mcp-hub-ui"
./tools/athenz/create-service.sh "mcp-hub" "hub-ui" "./keys/mcp-hub-ui.public.key"
./tools/athenz/enable-cert-provider.sh "mcp-hub" "hub-ui"
./tools/athenz/fetch-cert.sh "mcp-hub" "hub-ui" "./keys/mcp-hub-ui.key" "v1"
```

Copy the certificate and its key for the local development:

```sh
mkdir -p "mcp_hub/certs"
cp "./keys/mcp-hub-ui.key" "mcp_hub/certs/"
cp "./keys/mcp-hub-ui.crt" "mcp_hub/certs/"
cp ./athenz_dist/certs/ca.cert.pem ./mcp_hub/certs/ca.crt
ls -al mcp_hub/certs/
```

```sh
# total 16
# drwxr-xr-x@  4 mlajkim  staff   128 Jul  7 08:16 .
# drwxr-xr-x  21 mlajkim  staff   672 Jul  7 08:15 ..
# -rw-r--r--   1 mlajkim  staff  1834 Jul  7 08:16 ca.crt
# -rw-------   1 mlajkim  staff  1720 Jul  7 08:16 mcp-hub-ui.crt
# -rw-------   1 mlajkim  staff  1679 Jul  7 08:16 mcp-hub-ui.key
```

By default, MCP Hub reads these files:

- `mcp_hub/certs/mcp-hub-ui.crt`
- `mcp_hub/certs/mcp-hub-ui.key`
- `mcp_hub/certs/ca.crt`

## Step 3. Grant Per-User MCP Access

The API MCP authorization proxy requires `access` on `api:mcp`. Add each human user to `api:role.mcp-accessor`, then allow the MCP Hub workload to perform ID-JAG exchange into that role:

```sh
./tools/athenz/create-role.sh "api" "mcp-accessor"
./tools/athenz/add-policy.sh "api" "mcp-accessor" "access" "mcp"
./tools/athenz/add-role-member.sh "api" "mcp-accessor" "human.idjag-learner"
./tools/athenz/add-role-member.sh "api" "mcp-accessor" "human.alice"
./tools/athenz/add-role-member.sh "api" "mcp-accessor" "human.bob"

./tools/athenz/create-role.sh "api" "mcp-accessor-jag-exchanger"
./tools/athenz/add-policy.sh "api" "mcp-accessor-jag-exchanger" "zts.jag_exchange" "role.mcp-accessor"
./tools/athenz/add-role-member.sh "api" "mcp-accessor-jag-exchanger" "mcp-hub.hub-ui"
```

```sh
#   ·  Creating Role: api:role.mcp-accessor...
#   ✔  Role created: api:role.mcp-accessor
#   ·  Creating Policy: api:policy.mcp-accessor_access_mcp...
#   ✔  Policy created: api:policy.mcp-accessor_access_mcp
#   ✔  human.idjag-learner  →  api:role.mcp-accessor
#   ✔  human.alice  →  api:role.mcp-accessor
#   ✔  human.bob  →  api:role.mcp-accessor
#   ✔  mcp-hub.hub-ui  →  api:role.mcp-accessor-jag-exchanger
```

Authentication proves who the user is; Athenz role membership determines which authenticated users may access the protected MCP server.

## Step 4. Run MCP Hub

Start MCP Hub after the certificate files exist. The local Makefile sets `MCP_HUB_ZTS_URL` from `./tools/port.sh zts`.

Set `MCP_HUB_MCP_ACCESS_SCOPE` because this FAQ imports the protected API MCP server. Without this environment variable, MCP Hub does not fetch an access token and calls MCP servers without an `Authorization` header.

```sh
env MCP_HUB_MCP_ACCESS_SCOPE="api:role.mcp-accessor" \
  MCP_HUB_MCP_GATEWAY_URL="http://mcp-gateway.idthw.org:$(./tools/port.sh mcp-gateway)" \
  make -C mcp_hub local PORT=3102 OPEN_UI=true
```

If you need custom paths, override these environment variables:

```sh
env \
  MCP_HUB_ZTS_URL="https://localhost:$(./tools/port.sh zts)/zts/v1" \
  MCP_HUB_MCP_ACCESS_SCOPE="api:role.mcp-accessor" \
  MCP_HUB_MCP_GATEWAY_URL="http://mcp-gateway.idthw.org:$(./tools/port.sh mcp-gateway)" \
  MCP_HUB_CORE_PROXY_URL="http://host.docker.internal:$(./tools/port.sh core-mcp-proxy)" \
  MCP_HUB_REGISTRY_TOKEN="idthw-local-mcp-registry-token" \
  MCP_HUB_ATHENZ_CERT_PATH="./certs/mcp-hub-ui.crt" \
  MCP_HUB_ATHENZ_KEY_PATH="./certs/mcp-hub-ui.key" \
  MCP_HUB_ATHENZ_CA_PATH="./certs/ca.crt" \
  make -C mcp_hub local PORT=3102 OPEN_UI=true
```

## Step 5. Import K8s API Docs Server

MCP Hub discovers servers from Kubernetes labels and annotations. Add the MCP Hub metadata to the existing `mcp` deployment in the `api` namespace:

```sh
_core_mcp_proxy_port=$(./tools/port.sh mcp)

kubectl label deploy mcp -n api \
  app.kubernetes.io/part-of=mcp-hub \
  mcp.idthw.dev/project=k8s-docs-server \
  --overwrite

kubectl annotate deploy mcp -n api \
  mcp.idthw.dev/id="k8s-docs-server" \
  mcp.idthw.dev/access-scope="api:role.mcp-accessor api:role.docs-getter" \
  mcp.idthw.dev/alias="K8s API Docs Server" \
  mcp.idthw.dev/description="MCP server for Kubernetes API docs used by ID-JAG tutorials" \
  mcp.idthw.dev/public-url="http://127.0.0.1:${_core_mcp_proxy_port}" \
  mcp.idthw.dev/upstream-url="http://mcp.api:8081/mcp" \
  mcp.idthw.dev/transport="streamable-http" \
  --overwrite
```

```sh
# deployment.apps/mcp labeled
# deployment.apps/mcp annotated
```

Refresh MCP Hub. The K8s API Docs Server should appear:

![k8s_doc_server_visible](./assets/k8s_doc_server_visible.png)

## Step 6. Verify Protected MCP Tools

Sign in through Keycloak and open the K8s API Docs Server tools page. MCP Hub should exchange that user's ID token through ID-JAG, fetch a user-scoped Athenz access token, and load the protected tool list. Use the user menu in the top bar to switch to another configured user and repeat the check.

![alt text](image.png)
