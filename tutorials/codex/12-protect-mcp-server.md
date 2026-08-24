|                 Previous                 |            Current             |                      Next                      |
|:----------------------------------------:|:------------------------------:|:----------------------------------------------:|
| [Token Exchange](./11-token-exchange.md) | **Protect MCP Server - Codex** | [Identity Provider](./13-identity-provider.md) |

# Protect MCP Server - Codex

In this tutorial, we will secure the MCP server using an Authorization Proxy - exactly as we protected the API server with Athenz in earlier tutorials.

<!-- TOC depthFrom:2 depthTo:2 -->

- [Run Authorization Proxy for API MCP](#run-authorization-proxy-for-api-mcp)
- [Update the MCP Service to Point to the Proxy](#update-the-mcp-service-to-point-to-the-proxy)
- [Verify (Expected Failure)](#verify-expected-failure)
- [Fix Insufficient Permission](#fix-insufficient-permission)
- [Fetch a New Access Token for the New Role](#fetch-a-new-access-token-for-the-new-role)
- [Update Codex Config with the New Token](#update-codex-config-with-the-new-token)
- [Verify](#verify)
- [Review Summary of Changes](#review-summary-of-changes)
- [What's next?](#whats-next)

<!-- /TOC -->

## Run Authorization Proxy for API MCP

Deploy the authorization proxy as a sidecar container in the `mcp` deployment:

```sh
kubectl patch deploy mcp -n api --patch "$(cat <<'EOF'
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
              value: "mcp"
          ports:
            - containerPort: 8082
EOF
)"
```

```sh
# deployment.apps/mcp patched
```

Attach the ZPU sidecar so the proxy can evaluate policies locally:

```sh
kubectl patch deploy mcp -n api --patch "$(cat <<'EOF'
spec:
  template:
    spec:
      containers:
        - name: auth-proxy
          volumeMounts:
            - name: api-server-policies
              mountPath: /app/policies
              readOnly: true
        - name: zpu
          image: ghcr.io/mlajkim/zpu:latest
          imagePullPolicy: Always
          env:
            - name: ZPU_DOMAIN
              value: "api"
            - name: ZTS_URL
              value: "https://athenz-zts-server.athenz:4443/zts/v1"
            - name: ZPU_INTERVAL_SECONDS
              value: "5"
          volumeMounts:
            - name: api-server-policies
              mountPath: /policies
            - name: api-zpu-cert
              mountPath: /var/run/athenz/zpu
              readOnly: true
      volumes:
        - name: api-server-policies
          emptyDir: {}
        - name: api-zpu-cert
          secret:
            secretName: api-zpu-cert
            defaultMode: 0400
EOF
)"
```

```sh
# deployment.apps/mcp patched
```

## Update the MCP Service to Point to the Proxy

```sh
kubectl delete svc mcp -n api
kubectl expose deploy mcp -n api --port 8081 --target-port 8082 --name mcp
```

```sh
# service "mcp" deleted
# service/mcp exposed
```

## Verify (Expected Failure)

Ask Codex:

```sh
get docs from k8s doc server!
```

This fails because the proxy requires `access` on the `api:mcp` resource, and we have not created that policy yet.

```sh
kubectl logs deploy/mcp -n api -c auth-proxy
```

## Fix Insufficient Permission

Create the `mcp-accessor` role and attach the required policy:

```sh
./tools/athenz/create-role.sh "api" "mcp-accessor"
./tools/athenz/add-policy.sh "api" "mcp-accessor" "access" "mcp"
./tools/athenz/add-role-member.sh "api" "mcp-accessor" "human.idjag-learner"
```

```sh
#   ·  Creating Role: api:role.mcp-accessor...
#   ✔  Role created: api:role.mcp-accessor
#   ·  Creating Policy: api:policy.mcp-accessor_access_mcp...
#   ✔  Policy created: api:policy.mcp-accessor_access_mcp
#   ·  Adding Member human.idjag-learner to Role: api:role.mcp-accessor...
#   ✔  human.idjag-learner  →  api:role.mcp-accessor
```

## Fetch a New Access Token for the New Role

The Access Token must now include both scopes - one to pass through the MCP proxy, and one to call the API server:

```sh
_scope="api:role.mcp-accessor api:role.docs-getter"
./tools/athenz/fetch-access-token.sh \
  "./keys/idjag-learner.crt" \
  "./keys/idjag-learner.key" \
  "${_scope}" \
  "./keys/idjag-learner.jwt"
```

```sh
#   ·  Fetching Access Token for scope: api:role.mcp-accessor api:role.docs-getter...
#   ✔  Access token issued for scope: api:role.mcp-accessor api:role.docs-getter
#   ✔  Token saved to: ./keys/idjag-learner.jwt
```

## Update Codex Config with the New Token

```sh
_mcp_port=$(./tools/port.sh mcp)
_at=$(cat ./keys/idjag-learner.jwt)

cat > .codex/config.toml <<EOF
[mcp_servers.id-jag-the-hard-way-mcp]
url = "http://localhost:${_mcp_port}/mcp"
http_headers = { Authorization = "Bearer ${_at}" }
EOF

cat .codex/settings.toml >> .codex/config.toml
```

## Verify

Start a new Codex chat so the updated MCP config is used:

```sh
/new
```

Then ask Codex again:

```sh
get docs from k8s doc server!
```

![Codex MCP access successful](./assets/12_codex_mcp_access_successful.png)

## Review Summary of Changes

We deployed the Authorization Proxy in front of the MCP server. Only callers whose Access Token carries the `api:role.mcp-accessor` scope can reach the MCP server.

## What's next?

Next: [Identity Provider](./13-identity-provider.md)
