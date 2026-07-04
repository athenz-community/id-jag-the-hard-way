|                 Previous                 |        Current         |                      Next                      |
|:----------------------------------------:|:----------------------:|:----------------------------------------------:|
| [Token Exchange](./11-token-exchange.md) | **Protect MCP Server** | [Identity Provider](./13-identity-provider.md) |

# Protect MCP Server

In this tutorial, we will secure the MCP server using an Authorization Proxy — exactly as we protected the API server with Athenz in earlier tutorials.

<!-- TOC depthFrom:2 depthTo:2 -->

- [Run Authorization Proxy for MCP Hub](#run-authorization-proxy-for-mcp-hub)
- [Service Cert for MCP Hub ZPU](#service-cert-for-mcp-hub-zpu)
- [Update the MCP Service to Point to the Proxy](#update-the-mcp-service-to-point-to-the-proxy)
- [Verify (Expected Failure)](#verify-expected-failure)
- [Fix Insufficient Permission](#fix-insufficient-permission)
- [Fetch a New Access Token for the New Role](#fetch-a-new-access-token-for-the-new-role)
- [Update .mcp.json with the New Token](#update-mcpjson-with-the-new-token)
- [Verify](#verify)
- [Review Summary of Changes](#review-summary-of-changes)
- [What's next?](#whats-next)

<!-- /TOC -->

## Run Authorization Proxy for MCP Hub

Deploy the authorization proxy as a sidecar container in the `k8s-doc-server` deployment. It will intercept all incoming requests and verify the Athenz Access Token before forwarding to the real MCP server:

```sh
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

```sh
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

The `k8s-doc-server` service currently routes traffic directly to the MCP container on port `8081`. We need to re-point it to the proxy on port `8082`:

```sh
kubectl delete svc k8s-doc-server -n mcp-hub
kubectl expose deploy k8s-doc-server -n mcp-hub --port 8081 --target-port 8082 --name k8s-doc-server
```

## Verify (Expected Failure)

> [!WARNING]
> This step will intentionally fail — that is the point, and you will fix it in the next section.

Reload the plugin in Claude Code, then ask:

```sh
/reload-plugins
```

```sh
get docs from k8s doc server!
```


This fails because the proxy requires `access` on the `mcp-hub:k8s-doc-server` resource, and we haven't created that policy yet.

You can also see from the log of the `auth-proxy` container that the request was rejected:

```sh
kubectl logs deploy/k8s-doc-server -n mcp-hub -c auth-proxy
```

```sh
# =========================================================
# 🚀 OpenAPI MCP Auth Proxy Server listening on: http://0.0.0.0:8082
# 🔗 Upstream API: http://localhost:8081
# 📄 OpenAPI Spec available at: http://0.0.0.0:8082/openapi.json
# 📄 MCP endpoint available at: http://0.0.0.0:8082/mcp
# =========================================================

# [2026-06-21 01:38:33] [WARN] [MCP-Auth-Proxy] ❌ REJECTED: Policy denied access. (Action: 'access', Resource: 'k8s-doc-server', Token: eyJraWQiOi...)
```

## Fix Insufficient Permission

Create the `mcp-accessor` role and attach the required policy:

```sh
./tools/athenz/create-role.sh "mcp-hub" "mcp-accessor"
./tools/athenz/add-policy.sh "mcp-hub" "mcp-accessor" "access" "k8s-doc-server"
```

Add `human.idjag-learner` (the identity whose token we are using) as a member:

```sh
./tools/athenz/add-role-member.sh "mcp-hub" "mcp-accessor" "human.idjag-learner"
```

## Fetch a New Access Token for the New Role

The Access Token must now include both scopes — one to pass through the MCP proxy, and one to call the API server:

```sh
_scope="mcp-hub:role.mcp-accessor api:role.docs-getter"
./tools/athenz/fetch-access-token.sh \
  "./keys/idjag-learner.crt" \
  "./keys/idjag-learner.key" \
  "${_scope}" \
  "./keys/idjag-learner.jwt"
```

Verify that the token's `scp` claim contains both roles:

```json
"scp": [
  "docs-getter",
  "mcp-accessor"
],
```

## Update .mcp.json with the New Token

```sh
_mcp_port=$(./tools/port.sh mcp)
_at=$(cat ./keys/idjag-learner.jwt)

cat > .mcp.json <<EOF
{
  "mcpServers": {
    "id-jag-the-hard-way-mcp": {
      "type": "http",
      "url": "http://localhost:${_mcp_port}/mcp",
      "headers": {
        "Authorization": "Bearer ${_at}"
      }
    }
  }
}
EOF
```

## Verify

Reload in Claude Code, then ask:

```sh
/reload-plugins
```

```sh
get docs from k8s doc server!
```

![12_claude_token_exchange_successful](./assets/12_claude_token_exchange_successful.png)

Check the MCP server logs to confirm the proxy authorized the request:

```sh
kubectl logs deploy/k8s-doc-server -n mcp-hub -c auth-proxy
```

```sh
# ✅ AUTHORIZED: 'access' on 'k8s-doc-server' (Token: eyJraWQi...)
# ➡️  Forwarding to downstream MCP Server
```

## Review Summary of Changes

We deployed the Authorization Proxy in front of the MCP server. Only callers whose Access Token carries the `mcp-hub:role.mcp-accessor` scope can reach the MCP server. Everything else is rejected at the proxy — the MCP server itself never sees an unauthorized request.

## What's next?

We have been using the `human.idjag-learner` certificate to fetch Access Tokens — a static X.509 identity that represents a human user in Athenz. In a real enterprise environment, users sign in through an Identity Provider. In the next tutorial, we will deploy Keycloak so that individual users can sign in with their own credentials and receive a proper ID token.

Next: [Identity Provider](./13-identity-provider.md)
