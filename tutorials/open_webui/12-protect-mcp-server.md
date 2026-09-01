|                 Previous                 |                Current                 |                      Next                      |
|:----------------------------------------:|:--------------------------------------:|:----------------------------------------------:|
| [Token Exchange](./11-token-exchange.md) | **Protect MCP Server - Open WebUI** | [Identity Provider](./13-identity-provider.md) |

# Protect MCP Server - Open WebUI

In this tutorial, we will secure MCP tool execution using an Authorization Proxy - exactly as we protected the API server with Athenz in earlier tutorials. MCP protocol bootstrap and `tools/list` remain public so clients can discover the server and its available tools before requesting access.

<!-- TOC depthFrom:2 depthTo:2 -->

- [Run Authorization Proxy for API MCP](#run-authorization-proxy-for-api-mcp)
- [Update the MCP Service to Point to the Proxy](#update-the-mcp-service-to-point-to-the-proxy)
- [Verify (Expected Failure)](#verify-expected-failure)
- [Fix Insufficient Permission](#fix-insufficient-permission)
- [Fetch a New Access Token for the New Role](#fetch-a-new-access-token-for-the-new-role)
- [Verify](#verify)
- [Review Summary of Changes](#review-summary-of-changes)
- [What's next?](#whats-next)

<!-- /TOC -->

## Run Authorization Proxy for API MCP

Deploy the authorization proxy as a sidecar container in the `mcp` deployment. It allows protocol bootstrap and tool discovery without an access token, while protecting methods such as `tools/call`:

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

Ask Open WebUI:

```sh
get docs!
```

Open WebUI can still initialize and list the available tools. The tool call fails because the proxy requires `access` on the `api:mcp` resource for protected methods, and we have not created that policy yet.

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
  "./keys/api_mcp-accessor_docs-getter.jwt"

cat "./keys/api_mcp-accessor_docs-getter.jwt"
```

```sh
#   ·  Fetching Access Token for scope: api:role.mcp-accessor api:role.docs-getter...
#   ✔  Access token issued for scope: api:role.mcp-accessor api:role.docs-getter
#   ✔  Token saved to: ./keys/api_mcp-accessor_docs-getter.jwt
```

Navigate back to Open WebUI and replace the MCP Authorization header with this new Access Token.

## Verify

Ask Open WebUI again:

```sh
get docs!
```

Check the MCP server logs to confirm the proxy authorized the request:

```sh
kubectl logs deploy/mcp -n api -c auth-proxy
```

## Review Summary of Changes

We deployed the Authorization Proxy in front of the MCP server. Any client can initialize and list tools without an Athenz access role. Protected methods such as `tools/call` reach the MCP server only when the caller's Access Token carries the `api:role.mcp-accessor` scope.

## What's next?

Next: [Identity Provider](./13-identity-provider.md)
