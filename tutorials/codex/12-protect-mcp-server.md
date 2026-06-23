|                 Previous                 |             Current              |                      Next                      |
|:----------------------------------------:|:--------------------------------:|:----------------------------------------------:|
| [Token Exchange](./11-token-exchange.md) | **Protect MCP Server — Codex** | [Identity Provider](./13-identity-provider.md) |

# Protect MCP Server — Codex

In this tutorial, we will secure the MCP server using an Authorization Server (Athenz), just as we did with the API Server.

<!-- TOC depthFrom:2 depthTo:2 -->

- [Run Authorization Proxy for API MCP](#run-authorization-proxy-for-api-mcp)
- [Update the MCP Target Port to Proxy](#update-the-mcp-target-port-to-proxy)
- [Verify](#verify)
- [Fix Insufficient Permission](#fix-insufficient-permission)
- [Fetch a New Access Token for the New Role](#fetch-a-new-access-token-for-the-new-role)
- [Update Codex Config with the New Token](#update-codex-config-with-the-new-token)
- [Verify](#verify-1)
- [Review Summary of Changes](#review-summary-of-changes)
- [What's next?](#whats-next)

<!-- /TOC -->

## Run Authorization Proxy for API MCP

We will deploy an authorization proxy for the API MCP server, that will check the access token to access to MCP:

```yaml
kubectl patch deploy mcp -n api --patch "$(cat <<'EOF'
spec:
  template:
    spec:
      containers:
        # 1. Add a new container auth-proxy
        - name: auth-proxy
          image: ghcr.io/mlajkim/mcp-authorization-proxy:latest
          imagePullPolicy: Always
          env:
            - name: SERVER_PORT
              value: "8082"
            - name: MCP_TARGET_URL
              value: "http://localhost:8081"
          ports:
            - containerPort: 8082
EOF
)"
```

We are then going to attach the ZPU, that we have done:

```yaml
kubectl patch deploy mcp -n api --patch "$(cat <<'EOF'
spec:
  template:
    spec:
      containers:
        # 1. Update existing api-server container to read policies
        - name: auth-proxy
          volumeMounts:
            - name: api-server-policies
              mountPath: /app/policies
              readOnly: true

        # 2. Add ZPU sidecar container
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

      # 3. Define the volumes
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

## Update the MCP Target Port to Proxy

We have a service `mcp` that watches the `mcp` server right now, with selector: `Selector: app=mcp`:

```sh
kubectl describe svc mcp -n api
```

We are going to change the service `mcp` to watch `mcp-authorization-proxy` instead, but with the same port and name:

```sh
kubectl delete svc mcp -n api
kubectl expose deploy mcp -n api --port 8081 --target-port 8082
```

## Verify

Follow the steps below to verify the setup.

Now, let's test if the new authorization proxy forwards our request to the original MCP Server. (Spoiler: This request is expected to fail)

```
get docs!
```

This will fail because the Authorization Proxy server requires the `access` action on the `api:mcp` resource, which we haven't granted yet.

> [!NOTE]
> 🟡 TODO: Add a screenshot of Codex receiving the MCP access denied error.

## Fix Insufficient Permission

To authorize access to the authorization server, our identity service (`human.idjag-learner`) must have the following permissions:

- resource: `mcp` on domain `api`
- action: `access`

Let's create an explicit role named `mcp-accessor` and attach an access policy for the `mcp` resource:

```sh
./tools/athenz/create-role.sh "api" "mcp-accessor"
```

Attach the policy to the role:

```sh
./tools/athenz/add-policy.sh "api" "mcp-accessor" "access" "mcp"
```

Add your `human.idjag-learner` principal to the role:

```sh
./tools/athenz/add-role-member.sh "api" "mcp-accessor" "human.idjag-learner"
```

## Fetch a New Access Token for the New Role

Now, let's generate a new Access Token containing both scopes (space-separated values):

- `api:role.mcp-accessor`: to access the MCP Authorization Server
- `api:role.docs-getter`: to access `get /docs` endpoint

```sh
_scope="api:role.mcp-accessor api:role.docs-getter"
_my_access_token=$(./tools/athenz/fetch-access-token.sh \
  "./keys/idjag-learner.crt" \
  "./keys/idjag-learner.key" \
  "${_scope}" \
  "./keys/api_mcp-accessor_api_docs-getter.jwt")

cat "./keys/api_mcp-accessor_api_docs-getter.jwt"
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
_at=$(cat ./keys/api_mcp-accessor_api_docs-getter.jwt)

cat > .codex/config.toml <<EOF
[mcp_servers.id-jag-the-hard-way-mcp]
type = "http"
url = "http://localhost:${_mcp_port}/mcp"

[mcp_servers.id-jag-the-hard-way-mcp.headers]
Authorization = "Bearer ${_at}"
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

We deployed the Authorization Proxy Server, which checks for `access` to the `api:mcp` resource. We created a new `mcp-accessor` role under the `api` domain and attached a policy matching the authorization server's requirements. As a result, the MCP server can only be accessed by an authenticated user holding an access token with the `mcp-accessor` scope.

## What's next?

Up until now, we have been using an admin certificate to authenticate. In the next tutorial, we will deploy [Keycloak](https://www.keycloak.org/) as an Identity Provider (IdP), enabling users to sign in with their own accounts.

Next: [Identity Provider](./13-identity-provider.md)
