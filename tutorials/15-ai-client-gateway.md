|                            Previous                            |        Current        |           Next           |
|:--------------------------------------------------------------:|:---------------------:|:------------------------:|
| [Trusted Identity Provider](./14-trusted-identity-provider.md) | **AI Client Gateway** | [ID-JAG](./16-id-jag.md) |

# AI Client Gateway

In this tutorial, we will deploy the `AI Client Gateway`. This component sits between Claude Code and the MCP server. It intercepts every request, resolves the human user's Keycloak ID token, and runs the full ID-JAG token exchange chain — so neither Claude Code nor the user ever has to manage Athenz tokens by hand.

<!-- TOC depthFrom:2 depthTo:2 -->

- [Deploy AI Client Gateway in K8s](#deploy-ai-client-gateway-in-k8s)
- [Generate the Required Certificates](#generate-the-required-certificates)
- [Mount the Certificates](#mount-the-certificates)
- [Deploy the Human Gateway](#deploy-the-human-gateway)
- [Set env vars for the gateway](#set-env-vars-for-the-gateway)
- [Verification Prerequisite](#verification-prerequisite)
- [Verify](#verify)
- [What's next?](#whats-next)

<!-- /TOC -->

## Deploy AI Client Gateway in K8s

The gateway belongs in the `human` namespace — it represents the human-controlled, client side of the architecture.

Create the `human` namespace:

```sh
kubectl create ns human
```

```sh
# namespace/human created
```

Deploy the gateway with name `claude-idjag-learner-ai-client-gateway`:

```sh
kubectl create deploy claude-idjag-learner-ai-client-gateway -n human \
  --image=ghcr.io/mlajkim/ai-client-gateway:latest
```

```sh
# deployment.apps/claude-idjag-learner-ai-client-gateway created
```

Check the logs — you will see an error about missing certificates (this is expected and you will fix it shortly):

```sh
kubectl logs deploy/claude-idjag-learner-ai-client-gateway -n human
```

```sh
# ...
# Error: ENOENT: no such file or directory, open '...certs/ai-client-gateway.crt'
# ...
```

This is expected. The gateway needs an X.509 certificate to identify itself to Athenz ZTS, and we have not provided one yet. The next two sections take care of that.

## Generate the Required Certificates

Create the service identity and fetch its X.509 certificate:

```sh
./tools/athenz/create-private-key.sh "./keys/human-idjag-learner-claude"
./tools/athenz/create-subdomain.sh "human" "idjag-learner"
./tools/athenz/create-service.sh "human.idjag-learner" "claude" "./keys/human-idjag-learner-claude.public.key"
./tools/athenz/enable-cert-provider.sh "human.idjag-learner" "claude"
./tools/athenz/fetch-cert.sh "human.idjag-learner" "claude" "./keys/human-idjag-learner-claude.key" "v1"
```

```sh
#   ·  Generating RSA key pair for: ./keys/human-idjag-learner-claude...
#   ✔  Keys generated: ./keys/human-idjag-learner-claude.key, ./keys/human-idjag-learner-claude.public.key
#   ·  Creating Subdomain: human.idjag-learner...
#   ✔  Subdomain created: human.idjag-learner
#   ·  Registering Service: human.idjag-learner.claude...
#   ✔  Service registered: human.idjag-learner.claude
#   ·  Enabling ZTS Certificate Provider for human.idjag-learner.claude...
# [Template(s) successfully applied to domain]
#   ✔  ZTS Certificate Provider enabled for human.idjag-learner.claude
#   ·  Fetching X.509 Certificate for human.idjag-learner.claude...
#   ✔  Certificate saved to: ./keys/human-idjag-learner-claude.crt
```

## Mount the Certificates

Store the certificate as a Kubernetes Secret:

```sh
kubectl delete -n human secret human-idjag-learner-claude-cert --ignore-not-found=true
kubectl -n human create secret generic human-idjag-learner-claude-cert \
  --from-file=ai-client-gateway.crt=./keys/human-idjag-learner-claude.crt \
  --from-file=ai-client-gateway.key=./keys/human-idjag-learner-claude.key \
  --from-file=ca.crt=./athenz_dist/certs/ca.cert.pem
```

```sh
# secret/human-idjag-learner-claude-cert created
```

Mount the secret into the gateway pod so the application can read the certificate files at `/app/certs`:

```sh
kubectl patch deploy claude-idjag-learner-ai-client-gateway -n human --patch "$(cat <<'EOF'
spec:
  template:
    spec:
      containers:
        - name: ai-client-gateway
          volumeMounts:
            - name: certs
              mountPath: /app/certs
              readOnly: true
      volumes:
        - name: certs
          secret:
            secretName: human-idjag-learner-claude-cert
EOF
)"
```

```sh
# deployment.apps/claude-idjag-learner-ai-client-gateway patched
```

Verify the gateway started without errors:

```sh
kubectl logs deploy/claude-idjag-learner-ai-client-gateway -n human
```

```sh
# 🚀 OpenWebUI OpenAPI Gateway listening on 0.0.0.0:3101
# 🔗 Upstream API: http://mcp.api:8081
# 🌍 Public Base URL: http://localhost:44443
# 🔑 Athenz ZTS Endpoint: https://athenz-zts-server.athenz:4443/zts/v1
```

![AI Client Gateway deployed](./assets/15_ai_client_agent_installed_and_used.png)

## Deploy the Human Gateway

Now that the certificate is in place, configure the gateway with the Keycloak credentials it needs to drive the OAuth2 login flow.

Create the Kubernetes Secret from the Keycloak client credentials:

```sh
./tools/keycloak/create-client-k8s-secret.sh \
  "human.idjag-learner.claude" \
  "human" \
  "human-idjag-learner-claude-keycloak"
```

```sh
#   ·  Fetching Keycloak admin token...
#   ·  Looking up UUID for client human.idjag-learner.claude...
#   ·  Fetching client secret...
#   ·  Creating K8s secret human/human-idjag-learner-claude-keycloak...
# secret/human-idjag-learner-claude-keycloak created
#   ✔  Secret created: human/human-idjag-learner-claude-keycloak
```

## Set env vars for the gateway

Configure the environment variables for the gateway deployment. This patches the deployment with the URLs and credentials it needs to wire up the full token exchange chain.

<details>
<summary>What each variable does</summary>

- `UPSTREAM_BASE_URL` — the in-cluster MCP server the gateway proxies requests to.
- `ZTS_URL` — the Athenz ZTS endpoint used to exchange ID-JAG tokens for scoped Access Tokens.
- `KEYCLOAK_URL` / `KEYCLOAK_REALM` — in-cluster Keycloak address used for server-side token validation during the OAuth callback.
- `KEYCLOAK_CLIENT_ID` / `KEYCLOAK_CLIENT_SECRET` — pulled from the Kubernetes Secret you just created; used to authenticate this gateway as a registered OAuth2 client.
- `PUBLIC_BASE_URL` — the port-forwarded gateway address the browser is redirected back to after login.
- `KEYCLOAK_PUBLIC_URL` — the port-forwarded Keycloak address used in the browser-facing login redirect URL.

</details>

```sh
_gateway_port=$(./tools/port.sh ai-client-gateway)
_keycloak_port=$(./tools/port.sh keycloak)

kubectl patch deploy claude-idjag-learner-ai-client-gateway -n human --patch "$(cat <<EOF
spec:
  template:
    spec:
      containers:
        - name: ai-client-gateway
          imagePullPolicy: Always
          env:
            - name: UPSTREAM_BASE_URL
              value: "http://mcp.api:8081"
            - name: ZTS_URL
              value: "https://athenz-zts-server.athenz:4443/zts/v1"
            - name: KEYCLOAK_URL
              value: "http://keycloak.idp:8080"
            - name: KEYCLOAK_REALM
              value: "master"
            - name: KEYCLOAK_CLIENT_ID
              valueFrom:
                secretKeyRef:
                  name: human-idjag-learner-claude-keycloak
                  key: client-id
            - name: KEYCLOAK_CLIENT_SECRET
              valueFrom:
                secretKeyRef:
                  name: human-idjag-learner-claude-keycloak
                  key: client-secret
            - name: PUBLIC_BASE_URL
              value: "http://localhost:${_gateway_port}"
            - name: KEYCLOAK_PUBLIC_URL
              value: "http://localhost:${_keycloak_port}"
EOF
)"
```

```sh
# deployment.apps/claude-idjag-learner-ai-client-gateway patched
```

> [!NOTE]
> `KEYCLOAK_URL` uses the in-cluster address `keycloak.idp:8080` because the server-side token exchange happens inside the cluster during the OAuth callback. `KEYCLOAK_PUBLIC_URL` uses the port-forwarded address because the browser's login redirect must be reachable from your local machine.

Expose the deployment as a service and confirm the logs look healthy:

```sh
kubectl delete -n human svc ai-client-gateway --ignore-not-found=true
kubectl expose deploy claude-idjag-learner-ai-client-gateway -n human --port 3101 --name ai-client-gateway
kubectl logs deploy/claude-idjag-learner-ai-client-gateway -n human --tail=5
```

```sh
# 🚀 OpenWebUI OpenAPI Gateway listening on 0.0.0.0:3101
# 🔗 Upstream API: http://mcp.api:8081
# 🌍 Public Base URL: http://localhost:44443
# 🔑 Athenz ZTS Endpoint: https://athenz-zts-server.athenz:4443/zts/v1
```

## Verification Prerequisite

Before verifying, sign out of Keycloak so you start with a clean session. You may still be logged in as `admin` or `idjag-learner` from a previous tutorial.

```sh
_keycloak_port=$(./tools/port.sh keycloak)
./tools/open.sh "http://localhost:${_keycloak_port}/realms/master/protocol/openid-connect/logout"
```

If Keycloak asks **"Do you want to log out?"**, click **Logout** to confirm.

![15_click_logout_from_keycloak](./assets/15_click_logout_from_keycloak.png)

Then you will see the following after successful logout:

![15_signed_out_from_idp_keycloak](./assets/15_signed_out_from_idp_keycloak.png)

## Verify

Point Claude Code at the gateway by writing an `.mcp.json` configuration file:

```sh
_gateway_port=$(./tools/port.sh ai-client-gateway)

cat > .mcp.json <<EOF
{
  "mcpServers": {
    "id-jag-the-hard-way-mcp": {
      "type": "http",
      "url": "http://localhost:${_gateway_port}/mcp"
    }
  }
}
EOF
```

> [!NOTE]
> Notice that there is no `Authorization` header or pre-fetched access token in this configuration. The gateway handles the entire ID-JAG flow on your behalf — you no longer need `_at=$(cat ./keys/idjag-learner.jwt)` or anything like it.

Then reload the plugin:

```sh
/reload-plugins
```

Then run the following, then:

```sh
/mcp
```

Then select **1. Re-authenticate**.

![15_re_authenticate](./assets/15_re_authenticate.png)

Claude Code will detect that the gateway requires a login and prompt you to authenticate:

![15_ask_to_login](./assets/15_ask_to_login.png)

Open the link (Claude Code may open it automatically). You will be redirected to Keycloak and asked to sign in. Use

- username `idjag-learner`
- password `password`

![15_password_requested](./assets/15_password_requested.png)

After signing in, you will see the authentication succeed but the MCP connection fail immediately — this is intentional and will be fixed in the next tutorial:

`Got new credentials, but reconnecting to id-jag-the-hard-way-mcp failed: HTTP 502 at http://localhost:44443/mcp`

![15_got_new_credential_but_reconnection_failed](./assets/15_got_new_credential_but_reconnection_failed.png)

This failure is intentional. The gateway now has your ID token and can prove who you are, but the `human.idjag-learner.claude` service does not yet have permission in Athenz to exchange that ID token for an ID-JAG token. Think of it like an enterprise policy: even though `idjag-learner` personally has access to the API, the organization has not yet granted this AI agent the right to act on that person's behalf.

## What's next?

In the next tutorial, we will grant `human.idjag-learner.claude` the Athenz permissions it needs to perform the full ID-JAG token exchange — effectively telling the authorization server that this AI agent is allowed to act on behalf of `idjag-learner`.

Next: [ID-JAG](./16-id-jag.md)
