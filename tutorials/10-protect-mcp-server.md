|                 Previous                 |        Current         |                      Next                      |
|:----------------------------------------:|:----------------------:|:----------------------------------------------:|
| [Token Exchange](./09-token-exchange.md) | **Protect MCP Server** | [Identity Provider](./11-identity-provider.md) |

# Protect MCP Server

In this tutorial, we will secure the MCP server using an Authorization Server (Athenz), just as we did with the API Server.

<!-- TOC depthFrom:2 depthTo:2 -->

- [Run Authorization Proxy for API MCP](#run-authorization-proxy-for-api-mcp)
- [Update the MCP Target Port to Proxy](#update-the-mcp-target-port-to-proxy)
- [Verify](#verify)
- [Fix Insufficient Permission](#fix-insufficient-permission)
- [Fetch a New Access Token for the New Role](#fetch-a-new-access-token-for-the-new-role)
- [Attach the Access Token & Configure the New Authorization Server](#attach-the-access-token--configure-the-new-authorization-server)
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

It will fail with an error similar to the following:

![10_open_webui_says_no_permission_against_mcp_server](./assets/10_open_webui_says_no_permission_against_mcp_server.png)

This happens because the Authorization Proxy server we just configured requires the `access` action on the `api:mcp` resource, which we haven't granted yet. This permission check is illustrated in the architecture diagram below:

![10_failed_to_go_through_authorization_server](./assets/10_failed_to_go_through_authorization_server.png)

## Fix Insufficient Permission

To authorize access to the authorization server, our identity service (`human.idjag-learner`) must have the following permissions:

- resource: `mcp` on domain `api`
- action: `access`

Since we haven't prepared any roles or policies yet, let's create an explicit role named `mcp-accessor` and attach an access policy for the `mcp` resource.

```sh
./my_tools/create-role.sh "api" "mcp-accessor"
```

Next, attach the policy to the role:

```sh
./my_tools/add-policy.sh "api" "mcp-accessor" "access" "mcp"
```

Finally, add you `human.idjag-learner` principal to the role:

```sh
./my_tools/add-role-member.sh "api" "mcp-accessor" "human.idjag-learner"
```

## Fetch a New Access Token for the New Role

Now, let's generate a new Access Token containing both scopes (space-separated values):

- `api:role.mcp-accessor`: to access the MCP Authorization Server
- `api:role.docs-getter`: to access `get /docs` endpoint

```sh
_scope="api:role.mcp-accessor api:role.docs-getter"
_my_access_token=$(./my_tools/fetch-access-token.sh \
  "./keys/idjag-learner.crt" \
  "./keys/idjag-learner.key" \
  "${_scope}" \
  "./keys/api_mcp-accessor_api_docs-getter.jwt")

cat "./keys/api_mcp-accessor_api_docs-getter.jwt"
```

Note that the scope now includes both roles. This is because we need an Access Token that passes both authorization layer:

- Able to call `GET /api/docs` (Or `get` on `api:docs`)
- Able to access MCP Server (Or `access` on `api:mcp`)

Check your access token with `scp` including both scopes:

```json
"scp": [
  "docs-getter",
  "mcp-accessor"
],
...
```

## Attach the Access Token & Configure the New Authorization Server

Navigate to `User Icon` > `Admin Panel` > `Settings` > `Integrations`, and click the configure icon for the API MCP Server.

Then, attach the access token exactly as we did previously.

![10_attach_access_token_with_new_scope](./assets/10_attach_access_token_with_new_scope.png)

## Verify

Follow the steps below to verify the setup.

Now, test the AI Agent with the exact same prompt that failed previously:

```
get docs!
```

And we successfully get the docs from the API MCP Server!

![10_successsfully_get_docs_from_api_mcp_server](./assets/10_successsfully_get_docs_from_api_mcp_server.png)

The permission check is illustrated in the architecture diagram below:

![10_mcp_access_permission_required](./assets/10_mcp_access_permission_required.png)

## Review Summary of Changes

First, we deployed the Authorization Proxy Server (indicated by the red dotted box), which checks for `access` to the `api:mcp` resource. To grant this access, we created a new `mcp-accessor` role under the `api` domain and attached a policy matching the authorization server's requirements. As a result, the MCP server can only be accessed by an authenticated user holding an access token with the `mcp-accessor` scope—a key application of the Principle of Least Privilege.

![10_arch_architecture_of_mcp_server_with_authorization_proxy](./assets/10_arch_architecture_of_mcp_server_with_authorization_proxy.png)

## What's next?

Up until now, we have been logging into the AI Client Agent using an admin account. In an enterprise environment, individual employees are assigned separate accounts to maintain control and security over the AI Client Agent—sharing the admin account is out of the question. In the next tutorial, we will deploy [Keycloak](https://www.keycloak.org/) as an Identity Provider (IdP) for our AI Client Agent, enabling users to sign in with non-admin (standard) accounts.

Next: [Identity Provider](./11-identity-provider.md)
