|                 Previous                 |             Current              |                      Next                      |
|:----------------------------------------:|:--------------------------------:|:----------------------------------------------:|
| [Token Exchange](./11-token-exchange.md) | **Protect MCP Server — Codex** | [Identity Provider](./13-identity-provider.md) |

# Protect MCP Server — Codex

In this tutorial, we will secure the MCP server using an Authorization Server (Athenz), just as we did with the API Server.

<!-- TOC depthFrom:2 depthTo:2 -->

- [Run Authorization Proxy for MCP Hub](#run-authorization-proxy-for-mcp-hub)
- [Service Cert for MCP Hub ZPU](#service-cert-for-mcp-hub-zpu)
- [Update the MCP Service to Point to the Proxy](#update-the-mcp-service-to-point-to-the-proxy)
- [Verify](#verify)
- [Fix Insufficient Permission](#fix-insufficient-permission)
- [Fetch a New Access Token for the New Role](#fetch-a-new-access-token-for-the-new-role)
- [Update Codex Config with the New Token](#update-codex-config-with-the-new-token)
- [Verify](#verify-1)
- [Review Summary of Changes](#review-summary-of-changes)
- [What's next?](#whats-next)

<!-- /TOC -->

## Run Authorization Proxy for MCP Hub

We will deploy an authorization proxy for the MCP server managed by MCP Hub. The proxy checks the access token before forwarding requests to the MCP server:

```yaml
kubectl patch deploy api-mcp -n mcp-hub --patch "$(cat <<'EOF'
spec:
  template:
    spec:
      containers:
        - name: auth-proxy
          image: ghcr.io/mlajkim/mcp-authorization-proxy:latest
          imagePullPolicy: Always
          env:
            - name: SERVER_PORT
              value: "8082"
            - name: MCP_TARGET_URL
              value: "http://localhost:8081"
            - name: MCP_RESOURCE
              value: "api-mcp"
          ports:
            - containerPort: 8082
EOF
)"
```

## Service Cert for MCP Hub ZPU

The ZPU sidecar needs a service identity in the `mcp-hub` domain so it can fetch and evaluate the MCP Hub policies locally.

```sh
./tools/athenz/create-private-key.sh "./keys/zpu"
./tools/athenz/create-service.sh "mcp-hub" "zpu" "./keys/zpu.public.key"
./tools/athenz/enable-cert-provider.sh "mcp-hub" "zpu"
./tools/athenz/fetch-cert.sh "mcp-hub" "zpu" "./keys/zpu.key" "v1"

kubectl -n mcp-hub delete secret mcp-hub-zpu-cert --ignore-not-found
kubectl -n mcp-hub create secret generic mcp-hub-zpu-cert \
  --from-file=cert=./keys/zpu.crt \
  --from-file=key=./keys/zpu.key \
  --from-file=ca=./athenz_dist/certs/ca.cert.pem
```

Attach the ZPU sidecar so the proxy can evaluate policies locally:

```yaml
kubectl patch deploy api-mcp -n mcp-hub --patch "$(cat <<'EOF'
spec:
  template:
    spec:
      containers:
        - name: auth-proxy
          volumeMounts:
            - name: mcp-hub-policies
              mountPath: /app/policies
              readOnly: true

        - name: zpu
          image: ghcr.io/mlajkim/zpu:latest
          imagePullPolicy: Always
          env:
            - name: ZPU_DOMAIN
              value: "mcp-hub"
            - name: ZTS_URL
              value: "https://athenz-zts-server.athenz:4443/zts/v1"
            - name: ZPU_INTERVAL_SECONDS
              value: "5"
          volumeMounts:
            - name: mcp-hub-policies
              mountPath: /policies
            - name: mcp-hub-zpu-cert
              mountPath: /var/run/athenz/zpu
              readOnly: true

      volumes:
        - name: mcp-hub-policies
          emptyDir: {}
        - name: mcp-hub-zpu-cert
          secret:
            secretName: mcp-hub-zpu-cert
            defaultMode: 0400
EOF
)"
```

## Update the MCP Service to Point to the Proxy

We have a service `api-mcp` that watches the `api-mcp` server right now, with selector: `Selector: app=api-mcp`:

```sh
kubectl describe svc api-mcp -n mcp-hub
```

We are going to change the service `api-mcp` to watch the authorization proxy instead, but with the same port and name:

```sh
kubectl delete svc api-mcp -n mcp-hub
kubectl expose deploy api-mcp -n mcp-hub --port 8081 --target-port 8082 --name api-mcp
```

## Verify

Follow the steps below to verify the setup.

Now, let's test if the new authorization proxy forwards our request to the original MCP Server. (Spoiler: This request is expected to fail)

```
get docs!
```

This will fail because the Authorization Proxy server requires the `access` action on the `mcp-hub:api-mcp` resource, which we haven't granted yet.

> [!NOTE]
> 🟡 TODO: Add a screenshot of Codex receiving the MCP access denied error.

## Fix Insufficient Permission

To authorize access to the authorization server, our identity service (`human.idjag-learner`) must have the following permissions:

- resource: `api-mcp` on domain `mcp-hub`
- action: `access`

Let's create an explicit role named `api-mcp-accessor` and attach an access policy for the `api-mcp` resource.

For now, also create a temporary `docs-getter` role in `mcp-hub`. This keeps the client-facing Access Token in a single Athenz domain while the current Athenz server does not support multi-domain scopes in one token. The real API permission remains `api:role.docs-getter`; the MCP server will exchange into that API-domain role before calling the API server.

```sh
./tools/athenz/create-role.sh "mcp-hub" "api-mcp-accessor"
./tools/athenz/create-role.sh "mcp-hub" "docs-getter"
./tools/athenz/create-role.sh "mcp-hub" "token-exchanging-mcp"
```

```sh
#   ·  Creating Role: mcp-hub:role.api-mcp-accessor...
#   ✔  Role created: mcp-hub:role.api-mcp-accessor
#   ·  Creating Role: mcp-hub:role.docs-getter...
#   ✔  Role created: mcp-hub:role.docs-getter
#   ·  Creating Role: mcp-hub:role.token-exchanging-mcp...
#   ✔  Role created: mcp-hub:role.token-exchanging-mcp
```

Attach the policy to the role:

```sh
./tools/athenz/add-policy.sh "mcp-hub" "api-mcp-accessor" "access" "api-mcp"
```

```sh
#   ·  Creating Policy: mcp-hub:policy.api-mcp-accessor_access_api-mcp...
#   ✔  Policy created: mcp-hub:policy.api-mcp-accessor_access_api-mcp
```

Add your `human.idjag-learner` principal to both client-facing roles, and add the MCP server service identity to the source exchange role:

```sh
./tools/athenz/add-role-member.sh "mcp-hub" "api-mcp-accessor" "human.idjag-learner"
./tools/athenz/add-role-member.sh "mcp-hub" "docs-getter" "human.idjag-learner"
./tools/athenz/add-role-member.sh "mcp-hub" "token-exchanging-mcp" "mcp-hub.api-mcp"
```

```sh
#   ·  Adding Member human.idjag-learner to Role: mcp-hub:role.api-mcp-accessor...
#   ✔  human.idjag-learner  →  mcp-hub:role.api-mcp-accessor
#   ·  Adding Member human.idjag-learner to Role: mcp-hub:role.docs-getter...
#   ✔  human.idjag-learner  →  mcp-hub:role.docs-getter
#   ·  Adding Member mcp-hub.api-mcp to Role: mcp-hub:role.token-exchanging-mcp...
#   ✔  mcp-hub.api-mcp  →  mcp-hub:role.token-exchanging-mcp
```

Allow the MCP server to exchange from an `mcp-hub` token into an `api` token. ZTS checks source exchange in the source domain (`mcp-hub:api`) and target exchange in the target domain (`api:mcp-hub:role.docs-getter`):

```sh
./tools/athenz/add-policy.sh "mcp-hub" "token-exchanging-mcp" "zts.token_source_exchange" "api"
./tools/athenz/add-policy.sh "api" "token-exchanging-mcp" "zts.token_target_exchange" "mcp-hub:role.docs-getter"
```

```sh
#   ·  Creating Policy: mcp-hub:policy.token-exchanging-mcp_zts_token_source_exchange_api...
#   ✔  Policy created: mcp-hub:policy.token-exchanging-mcp_zts_token_source_exchange_api
#   ·  Creating Policy: api:policy.token-exchanging-mcp_zts_token_target_exchange_mcp-hub_role_docs-getter...
#   ✔  Policy created: api:policy.token-exchanging-mcp_zts_token_target_exchange_mcp-hub_role_docs-getter
```

## Fetch a New Access Token for the New Role

> [!NOTE]
> 🟡 TODO: The current Athenz Server does NOT support multi-domain scopes. The temporary `mcp-hub:role.docs-getter` role can be removed once that is fixed.

Now, let's generate a new Access Token containing both `mcp-hub` scopes:

- `mcp-hub:role.api-mcp-accessor`: to access the MCP Authorization Server
- `mcp-hub:role.docs-getter`: temporary docs permission marker until Athenz supports multi-domain scopes

```sh
_scope="mcp-hub:role.api-mcp-accessor mcp-hub:role.docs-getter"
_my_access_token=$(./tools/athenz/fetch-access-token.sh \
  "./keys/idjag-learner.crt" \
  "./keys/idjag-learner.key" \
  "${_scope}" \
  "./keys/mcp-hub_api-mcp-accessor_docs-getter.jwt")

cat "./keys/mcp-hub_api-mcp-accessor_docs-getter.jwt"
```

Check your access token with `scp` including both scopes:

```json
"scp": [
  "docs-getter",
  "api-mcp-accessor"
],
...
```

## Update Codex Config with the New Token

Update `.codex/config.toml` with the new same-domain token:

```sh
_mcp_port=$(./tools/port.sh mcp)
_at=$(cat ./keys/mcp-hub_api-mcp-accessor_docs-getter.jwt)

cat > .codex/config.toml <<EOF
[mcp_servers.id-jag-the-hard-way-mcp]
type = "http"
url = "http://localhost:${_mcp_port}/mcp"
http_headers = { Authorization = "Bearer ${_at}" }
EOF
```

## Verify

Follow the steps below to verify the setup.

Now, test Codex with the exact same prompt that failed previously:

```
get docs!
```

> [!NOTE]
> 🟡 TODO: Add a screenshot of Codex successfully retrieving docs through the MCP Authorization Proxy.

## Review Summary of Changes

We deployed the Authorization Proxy Server, which checks for `access` to the `mcp-hub:api-mcp` resource. We created a new `api-mcp-accessor` role under the `mcp-hub` domain and attached a policy matching the authorization server's requirements. As a result, the MCP server can only be accessed by an authenticated user holding an access token with the `api-mcp-accessor` scope.

## What's next?

Up until now, we have been using an admin certificate to authenticate. In the next tutorial, we will deploy [Keycloak](https://www.keycloak.org/) as an Identity Provider (IdP), enabling users to sign in with their own accounts.

Next: [Identity Provider](./13-identity-provider.md)
