|                 Previous                 |        Current         |                      Next                      |
|:----------------------------------------:|:----------------------:|:----------------------------------------------:|
| [Token Exchange](./11-token-exchange.md) | **Protect MCP Server** | [Identity Provider](./13-identity-provider.md) |

# Protect MCP Server

In this tutorial, we will secure MCP tool execution using an Authorization Proxy - exactly as we protected the API server with Athenz in earlier tutorials. MCP protocol bootstrap and `tools/list` remain public so clients can discover the server and its available tools before requesting access.

<!-- TOC depthFrom:2 depthTo:2 -->

- [Run Authorization Proxy for API MCP](#run-authorization-proxy-for-api-mcp)
- [Update the MCP Service to Point to the Proxy](#update-the-mcp-service-to-point-to-the-proxy)
- [Verify (Expected Failure)](#verify-expected-failure)
- [Fix Insufficient Permission](#fix-insufficient-permission)
- [Fetch a New Access Token for the New Role](#fetch-a-new-access-token-for-the-new-role)
- [Update .mcp.json with the New Token](#update-mcpjson-with-the-new-token)
- [Verify](#verify)
- [Review Summary of Changes](#review-summary-of-changes)
- [What's next?](#whats-next)

<!-- /TOC -->

## Run Authorization Proxy for API MCP

Deploy the authorization proxy as a sidecar container in the `mcp` deployment. It allows protocol bootstrap and tool discovery without an access token, and verifies the Athenz Access Token before forwarding protected methods such as `tools/call` to the real MCP server:

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

The `mcp` service currently routes traffic directly to the MCP container on port `8081`. We need to re-point it to the proxy on port `8082`:

```sh
kubectl delete svc mcp -n api
kubectl expose deploy mcp -n api --port 8081 --target-port 8082 --name mcp
```

```sh
# service "mcp" deleted
# service/mcp exposed
```

## Verify (Expected Failure)

> [!WARNING]
> This step will intentionally fail - that is the point, and you will fix it in the next section.

Reload the plugin in Claude Code:

```sh
/reload-plugins
```

Then ask:

```sh
get docs from k8s doc server!
```

![12_no_permission_to_access_mcp](./assets/12_no_permission_to_access_mcp.png)

The client can still initialize and list the available tools. The tool call fails because the proxy requires `access` on the `api:mcp` resource for protected methods, and we have not created that policy yet.

You can also see from the log of the `auth-proxy` container that the request was rejected:

```sh
kubectl logs deploy/mcp -n api -c auth-proxy
```

```sh
# [2026-06-21 01:38:33] [WARN] [MCP-Auth-Proxy] REJECTED: Policy denied access. (Action: 'access', Resource: 'mcp', Token: eyJraWQiOi...)
```

## Fix Insufficient Permission

Create the `mcp-accessor` role and attach the required policy:

```sh
./tools/athenz/create-role.sh "api" "mcp-accessor"
./tools/athenz/add-policy.sh "api" "mcp-accessor" "access" "mcp"
```

```sh
#   ·  Creating Role: api:role.mcp-accessor...
#   ✔  Role created: api:role.mcp-accessor
#   ·  Creating Policy: api:policy.mcp-accessor_access_mcp...
#   ✔  Policy created: api:policy.mcp-accessor_access_mcp
```

Add `human.idjag-learner` as a member:

```sh
./tools/athenz/add-role-member.sh "api" "mcp-accessor" "human.idjag-learner"
```

```sh
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
kubectl logs deploy/mcp -n api -c auth-proxy
```

```sh
# AUTHORIZED: 'access' on 'mcp' (Token: eyJraWQi...)
# Forwarding to downstream MCP Server for API Server
```

## Review Summary of Changes

We deployed the Authorization Proxy in front of the MCP server. Any client can initialize and list tools without an Athenz access role. Protected methods such as `tools/call` reach the MCP server only when the caller's Access Token carries the `api:role.mcp-accessor` scope.

## What's next?

We have been using the `human.idjag-learner` certificate to fetch Access Tokens - a static X.509 identity that represents a human user in Athenz. In a real enterprise environment, users sign in through an Identity Provider. In the next tutorial, we will deploy Keycloak so that individual users can sign in with their own credentials and receive a proper ID token.

Next: [Identity Provider](./13-identity-provider.md)
