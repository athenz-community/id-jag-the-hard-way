# MCP Gateway

`MCP Gateway` is the authenticated public entry point for MCP clients in the MCP Hub architecture.

```text
User -> AI client -> MCP Gateway /mcp/{id}
     -> Core MCP Proxy /mcp/{id}
     -> registered MCP server
     -> protected API
```

## Responsibilities

The gateway:

1. Publishes OAuth authorization-server and protected-resource metadata.
2. Completes OAuth Authorization Code + PKCE against Keycloak.
3. Validates the Keycloak ID token and stores it in a server-side session.
4. Gives the MCP client an opaque gateway session token, never the ID token or Athenz token.
5. Resolves `{id}` through MCP Hub's `/api/mcp-servers` registry API.
6. For `tools/call`, resolves the exact tool name to the Athenz scopes published by MCP Hub. Protocol bootstrap, `ping`, and `tools/list` do not mint an Athenz token.
7. Checks the access-token cache first, then an ID-JAG cache indexed by the token's actual `aud` and `scp`/`scope` claims, with usability bounded by its actual `exp`. It uses the stored ID token only when no usable ID-JAG covers the requested scope.
8. Rejects partial grants for the current request but retains them under their actual granted scope, so they can satisfy a later narrower request.
9. Requests fresh browser authentication with HTTP 401 when neither a cached credential nor a fresh ID token can complete the exchange.
10. Strips the opaque session bearer before forwarding. Public discovery is forwarded without authorization; protected methods receive the Athenz bearer.
11. Supports an explicit browser sign-out flow that invalidates the opaque Gateway session and redirects a one-use logout ticket to Keycloak without exposing the stored ID token to the broker.

Kubernetes remains the underlying registration source. MCP Hub's API is the registry contract consumed by the gateway.

## Stable MCP URL

Register a globally unique route ID on the MCP deployment:

```yaml
metadata:
  annotations:
    mcp.idthw.dev/id: k8s-docs-server
    mcp.idthw.dev/access-scope: "api:role.mcp-accessor api:role.docs-getter"
```

The MCP client URL is then:

```text
http://mcp-gateway.idthw.org/mcp/k8s-docs-server
```

## One Browser Sign-In for Multiple MCP Entries

Use `components/mcp-credential-broker` as the stdio command for every route. The MCP client still sees separate entries such as `confluence`, `jira`, and `slack`, while all broker processes share one opaque session for this Gateway issuer. The first process opens Keycloak login automatically and the others wait for that session; no client-specific `mcp login` command is needed.

The shared session contains human authentication, not a union of tool permissions. Every `/mcp/{id}` request still resolves its own Kubernetes-backed route metadata. Each `tools/call` obtains only the scopes mapped to `params.name`; clients can initialize and enumerate tools without that access permission. When a server publishes a tool map, an unknown tool fails closed instead of receiving the route-wide fallback scope.

The opaque Gateway session has its own bounded lifetime, configured by `GATEWAY_SESSION_TTL_SECONDS` (eight hours by default), so a valid cached ID-JAG can renew an access token after the shorter Keycloak ID token expires. If another scope needs a new ID-JAG after that ID token expires, the Gateway invalidates the opaque session and returns `401 reauth_required`; the credential broker then opens browser login and retries once.

HTTP is allowed only when `ALLOW_INSECURE_HTTP=true`. Use HTTPS outside the current development phase.

## Athenz Workload Identity

Create a dedicated identity whose Athenz `clientId` matches the Keycloak client ID:

```sh
./tools/athenz/create-tld.sh mcp-hub
./tools/athenz/create-private-key.sh ./keys/mcp-gateway
./tools/athenz/create-service.sh mcp-hub mcp-gateway ./keys/mcp-gateway.public.key
./tools/athenz/enable-cert-provider.sh mcp-hub mcp-gateway
./tools/athenz/set-service-client-id.sh mcp-hub mcp-gateway mcp-gateway
./tools/athenz/fetch-cert.sh mcp-hub mcp-gateway ./keys/mcp-gateway.key v1
```

Allow that workload to perform JAG exchange into the read-only scopes used by the K8s docs MCP server:

```sh
./tools/athenz/add-role-member.sh api mcp-accessor-jag-exchanger mcp-hub.mcp-gateway
./tools/athenz/add-role-member.sh api docs-getter-jag-exchanger mcp-hub.mcp-gateway
```

Create its Kubernetes certificate secret:

```sh
./tools/athenz/create-k8s-secret.sh \
  mcp-hub \
  mcp-gateway-athenz-cert \
  ./keys/mcp-gateway.crt \
  ./keys/mcp-gateway.key \
  ./athenz_dist/certs/ca.cert.pem \
  mcp-gateway.crt \
  mcp-gateway.key \
  ca.crt
```

## MCP Hub Registry Authentication

MCP Hub still accepts browser sessions for its UI. MCP Gateway calls the same `/api/mcp-servers` endpoint with a service bearer token.

Create one shared secret and configure the same value as `MCP_HUB_REGISTRY_TOKEN` on the IDTHW Hub server that exposes the MCP Hub registry endpoint:

```sh
kubectl -n mcp-hub create secret generic mcp-hub-registry \
  --from-literal=token='<replace-with-random-secret>' \
  --dry-run=client \
  -o yaml \
  | kubectl apply -f -
```

The registry response supplies `routeId`, `proxyUrl`, the optional route fallback `accessScope`, and optional `toolScopes` keyed by MCP tool name. MCP Hub derives `toolScopes` from each tool's `<signed_in_user>` permission requirements. For Kubernetes, configure MCP Hub's `MCP_HUB_CORE_PROXY_URL` as:

```text
http://core-mcp-proxy.mcp-hub:8080
```

The same bearer token protects `GET /internal/cache-status`. MCP Hub calls this endpoint through `MCP_HUB_GATEWAY_STATUS_URL` to aggregate the active OAuth users and their Athenz cache status. The response contains only username, subject, expiry, status, and scope/cache timestamps; it never contains ID tokens, ID-JAGs, Athenz access tokens, opaque session tokens, or hashes.

## Local Run

Create `components/mcp-gateway/certs/` containing:

```text
mcp-gateway.crt
mcp-gateway.key
ca.crt
```

Register the Keycloak client and run the service:

```sh
make -C components/mcp-gateway register-idp-client \
  PUBLIC_BASE_URL=http://mcp-gateway.idthw.org

make -C components/mcp-gateway local \
  PUBLIC_BASE_URL=http://mcp-gateway.idthw.org \
  KEYCLOAK_PUBLIC_URL=http://localhost:34443 \
  ALLOW_INSECURE_HTTP=true
```

`register-idp-client` also registers `${PUBLIC_BASE_URL}/oauth/idp-logout/complete` as the allowed Keycloak post-logout redirect. The local Gateway derives that same URL by default. Override `KEYCLOAK_POST_LOGOUT_REDIRECT_URI` only when the browser must return somewhere else after Keycloak logout.

The local defaults use:

```text
MCP_HUB_REGISTRY_URL=http://127.0.0.1:3102/api/mcp-servers
MCP_HUB_REGISTRY_TOKEN=idthw-local-mcp-registry-token
MCP_GATEWAY_ACCESS_SCOPE=api:role.mcp-accessor api:role.docs-getter
GATEWAY_SESSION_TTL_SECONDS=28800
```

## Kubernetes Run

Create the Keycloak secret and public endpoint ConfigMap, then apply the manifest:

```sh
./tools/keycloak/create-client-k8s-secret.sh mcp-gateway mcp-hub mcp-gateway-keycloak

kubectl -n mcp-hub create configmap mcp-gateway-public-endpoints \
  --from-literal=gateway-url=http://mcp-gateway.idthw.org \
  --from-literal=idp-url='<keycloak-url>' \
  --from-literal=idp-issuer='<keycloak-issuer>' \
  --from-literal=hub-registry-url='http://mcp-hub.mcp-hub:3102/api/mcp-servers' \
  --dry-run=client \
  -o yaml \
  | kubectl apply -f -

kubectl apply -f components/mcp-gateway/kubernetes/mcp-gateway.yaml
```

Once the Service is deployed, the shared port-forward helper exposes it on the configured `mcp-gateway` port, which defaults to `24445`:

```sh
./tools/keep-k8s-port-forward.sh
./tools/port.sh mcp-gateway
```

The default local MCP client URL through that port-forward is `http://127.0.0.1:24445/mcp/k8s-docs-server`. Configure `gateway-url` and the Keycloak client redirect URI with the same externally visible origin so OAuth metadata and callbacks agree with the client URL.

The current deployment has one replica because OAuth transaction and gateway session state are held in memory. Use a shared session store before scaling it horizontally.

## Checks

```sh
make -C components/mcp-gateway check test build
make -C components/mcp-gateway build-image
```
