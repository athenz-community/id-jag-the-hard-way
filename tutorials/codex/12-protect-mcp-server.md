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
kubectl patch deploy k8s-doc-server -n mcp-hub --patch "$(cat <<'EOF'
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
              value: "k8s-doc-server"
          ports:
            - containerPort: 8082
EOF
)"
```

## Service Cert for MCP Hub ZPU

The ZPU sidecar needs a service identity in the `mcp-hub` domain so it can fetch and evaluate the MCP Hub policies locally.

```sh
./tools/athenz/create-private-key.sh "./keys/mcp-zpu"
./tools/athenz/create-service.sh "mcp-hub" "mcp-zpu" "./keys/mcp-zpu.public.key"
./tools/athenz/enable-cert-provider.sh "mcp-hub" "mcp-zpu"
./tools/athenz/fetch-cert.sh "mcp-hub" "mcp-zpu" "./keys/mcp-zpu.key" "v1"

kubectl -n mcp-hub delete secret mcp-hub-zpu-cert --ignore-not-found
kubectl -n mcp-hub create secret generic mcp-hub-zpu-cert \
  --from-file=cert=./keys/mcp-zpu.crt \
  --from-file=key=./keys/mcp-zpu.key \
  --from-file=ca=./athenz_dist/certs/ca.cert.pem
```

Attach the ZPU sidecar so the proxy can evaluate policies locally:

```yaml
kubectl patch deploy k8s-doc-server -n mcp-hub --patch "$(cat <<'EOF'
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

We have a service `k8s-doc-server` that watches the `k8s-doc-server` server right now, with selector: `Selector: app=k8s-doc-server`:

```sh
kubectl describe svc k8s-doc-server -n mcp-hub
```

We are going to change the service `k8s-doc-server` to watch the authorization proxy instead, but with the same port and name:

```sh
kubectl delete svc k8s-doc-server -n mcp-hub
kubectl expose deploy k8s-doc-server -n mcp-hub --port 8081 --target-port 8082 --name k8s-doc-server
```

## Verify

Follow the steps below to verify the setup.

Now, let's test if the new authorization proxy forwards our request to the original MCP Server. (Spoiler: This request is expected to fail)

```
get docs!
```

This will fail because the Authorization Proxy server requires the `access` action on the `mcp-hub:k8s-doc-server` resource, which we haven't granted yet.

> [!NOTE]
> 🟡 TODO: Add a screenshot of Codex receiving the MCP access denied error.

## Fix Insufficient Permission

To authorize access to the authorization server, our identity service (`human.idjag-learner`) must have the following permissions:

- resource: `k8s-doc-server` on domain `mcp-hub`
- action: `access`

Let's create an explicit role named `mcp-accessor` and attach an access policy for the `k8s-doc-server` resource:

```sh
./tools/athenz/create-role.sh "mcp-hub" "mcp-accessor"
```

Attach the policy to the role:

```sh
./tools/athenz/add-policy.sh "mcp-hub" "mcp-accessor" "access" "k8s-doc-server"
```

Add your `human.idjag-learner` principal to the role:

```sh
./tools/athenz/add-role-member.sh "mcp-hub" "mcp-accessor" "human.idjag-learner"
```

## Fetch a New Access Token for the New Role

Now, let's generate a new Access Token containing both scopes (space-separated values):

- `mcp-hub:role.mcp-accessor`: to access the MCP Authorization Server
- `api:role.docs-getter`: to access `get /docs` endpoint

```sh
_scope="mcp-hub:role.mcp-accessor api:role.docs-getter"
_my_access_token=$(./tools/athenz/fetch-access-token.sh \
  "./keys/idjag-learner.crt" \
  "./keys/idjag-learner.key" \
  "${_scope}" \
  "./keys/mcp-hub_mcp-accessor_api_docs-getter.jwt")

cat "./keys/mcp-hub_mcp-accessor_api_docs-getter.jwt"
```

Check your access token with `scp` including both scopes:

```json
"scp": [
  "docs-getter",
  "mcp-accessor"
],
...
```

## Update Codex Config with the New Token

Update `.codex/config.toml` with the new dual-scope token:

```sh
_mcp_port=$(./tools/port.sh mcp)
_at=$(cat ./keys/mcp-hub_mcp-accessor_api_docs-getter.jwt)

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

We deployed the Authorization Proxy Server, which checks for `access` to the `mcp-hub:k8s-doc-server` resource. We created a new `mcp-accessor` role under the `mcp-hub` domain and attached a policy matching the authorization server's requirements. As a result, the MCP server can only be accessed by an authenticated user holding an access token with the `mcp-accessor` scope.

## What's next?

Up until now, we have been using an admin certificate to authenticate. In the next tutorial, we will deploy [Keycloak](https://www.keycloak.org/) as an Identity Provider (IdP), enabling users to sign in with their own accounts.

Next: [Identity Provider](./13-identity-provider.md)
