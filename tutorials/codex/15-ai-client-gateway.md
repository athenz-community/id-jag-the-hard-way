|                            Previous                            |           Current            |           Next           |
|:--------------------------------------------------------------:|:----------------------------:|:------------------------:|
| [Trusted Identity Provider](./14-trusted-identity-provider.md) | **AI Client Gateway — Codex** | [ID-JAG](./16-id-jag.md) |

# AI Client Gateway — Codex

In this tutorial, we will deploy the `AI Client Gateway`. This component sits between Codex CLI and the MCP server. It intercepts every request, resolves the human user's Keycloak ID token, and runs the full ID-JAG token exchange chain — so neither Codex nor the user ever has to manage Athenz tokens by hand.

<!-- TOC depthFrom:2 depthTo:2 -->

- [Understand What the Gateway Does](#understand-what-the-gateway-does)
- [Deploy AI Client Gateway in K8s](#deploy-ai-client-gateway-in-k8s)
- [Generate the Required Certificates](#generate-the-required-certificates)
- [Mount the Certificates](#mount-the-certificates)
- [Deploy the Human Gateway](#deploy-the-human-gateway)
- [Set env vars for the gateway](#set-env-vars-for-the-gateway)
- [Verification Prerequisite](#verification-prerequisite)
- [Update Codex MCP Config](#update-codex-mcp-config)
- [Verify](#verify)
- [What's next?](#whats-next)

<!-- /TOC -->

## Understand What the Gateway Does

Codex CLI supports OAuth2-protected MCP servers. The first time it connects to an MCP server that responds with `401 Unauthorized`, it reads the `WWW-Authenticate` header, fetches the gateway's OAuth2 metadata document, and opens your browser to begin a login flow.

The gateway itself acts as a thin OAuth2 Authorization Server that delegates the actual authentication to Keycloak. After you log in, the gateway stores your Keycloak ID token in a server-side session and hands Codex a short-lived session token. From that point on, every MCP request from Codex carries that session token as a `Bearer` credential. The gateway resolves it back to your ID token and performs the same ID-JAG exchange chain you have seen in earlier tutorials.

```
[human ns]                       [ai ns]          [api ns]
Codex CLI
    │ Bearer (session token)
    ▼
human ai-client-gateway
    │ resolves ID token
    │ → ID-JAG exchange (as human.idjag-learner.codex)
    │ → Athenz AT
    ▼
                              MCP Auth Proxy → MCP Server → API Server
```

> [!NOTE]
> 🟡 TODO: Verify that Codex CLI supports the same OAuth2 MCP flow as Claude Code (`WWW-Authenticate` redirect). Check the Codex CLI documentation for `oauth` MCP server type support.

## Deploy AI Client Gateway in K8s

The gateway belongs in the `human` namespace — it represents the human-controlled, client side of the architecture.

Create the `human` namespace (skip if already created in a previous tutorial):

```sh
kubectl create ns human
```

Deploy the gateway with name `codex-idjag-learner-ai-client-gateway`:

```sh
kubectl create deploy codex-idjag-learner-ai-client-gateway -n human \
  --image=ghcr.io/mlajkim/ai-client-gateway:latest
```

Check the logs — you will see an error about missing certificates (this is expected):

```sh
kubectl logs deploy/codex-idjag-learner-ai-client-gateway -n human
```

```sh
# Error: ENOENT: no such file or directory, open '...certs/ai-client-gateway.crt'
```

This is expected. The gateway needs an X.509 certificate to identify itself to Athenz ZTS, and we have not provided one yet.

## Generate the Required Certificates

The gateway authenticates to Athenz ZTS as the service identity `human.idjag-learner.codex`. Generate an RSA key pair for the service:

```sh
./tools/athenz/create-private-key.sh "./keys/human-idjag-learner-codex"
```

```sh
#   ·  Generating RSA key pair for: ./keys/human-idjag-learner-codex...
#   ✔  Keys generated: ./keys/human-idjag-learner-codex.key, ./keys/human-idjag-learner-codex.public.key
```

Create the `idjag-learner` subdomain under `human` (skip if already exists):

```sh
./tools/athenz/create-subdomain.sh "human" "idjag-learner"
```

Register the `codex` service under `human.idjag-learner` and enable the certificate provider:

```sh
./tools/athenz/create-service.sh "human.idjag-learner" "codex" "./keys/human-idjag-learner-codex.public.key"
./tools/athenz/enable-cert-provider.sh "human.idjag-learner" "codex"
```

## Mount the Certificates

Fetch the signed X.509 certificate from Athenz and store it as a Kubernetes Secret:

```sh
./tools/athenz/fetch-cert.sh "human.idjag-learner" "codex" "./keys/human-idjag-learner-codex.key" "v1"

kubectl delete -n human secret human-idjag-learner-codex-cert --ignore-not-found=true
kubectl -n human create secret generic human-idjag-learner-codex-cert \
  --from-file=ai-client-gateway.crt=./keys/human-idjag-learner-codex.crt \
  --from-file=ai-client-gateway.key=./keys/human-idjag-learner-codex.key \
  --from-file=ca.crt=./athenz_dist/certs/ca.cert.pem
```

Mount the secret into the gateway pod:

```sh
kubectl patch deploy codex-idjag-learner-ai-client-gateway -n human --patch "$(cat <<'EOF'
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
            secretName: human-idjag-learner-codex-cert
EOF
)"
```

Verify the gateway started without errors:

```sh
kubectl logs deploy/codex-idjag-learner-ai-client-gateway -n human
```

```sh
# 🚀 OpenWebUI OpenAPI Gateway listening on 0.0.0.0:3101
# 🔗 Upstream API: http://mcp.api:8081
# 🌍 Public Base URL: http://localhost:44443
# 🔑 Athenz ZTS Endpoint: https://athenz-zts-server.athenz:4443/zts/v1
```

> [!NOTE]
> 🟡 TODO: Add a screenshot of the AI Client Gateway logs running successfully for the Codex path.

## Deploy the Human Gateway

Configure the gateway with the Keycloak credentials it needs to drive the OAuth2 login flow.

Open the Keycloak clients list:

```sh
_keycloak_port=$(./tools/port.sh keycloak)
./tools/open.sh "http://localhost:${_keycloak_port}/admin/master/console/#/master/clients"
```

Click **human.idjag-learner.codex**, go to the **Credentials** tab, and copy the client secret.

Now run the command below and paste your secret when prompted:

```sh
printf '\033[1mPaste your client secret and press Enter:\033[0m\n'
read _client_secret

kubectl delete -n human secret human-idjag-learner-codex-keycloak --ignore-not-found=true
kubectl -n human create secret generic human-idjag-learner-codex-keycloak \
  --from-literal=client-id="human.idjag-learner.codex" \
  --from-literal=client-secret="${_client_secret}"
```

## Set env vars for the gateway

Configure the environment variables for the gateway deployment:

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

kubectl patch deploy codex-idjag-learner-ai-client-gateway -n human --patch "$(cat <<EOF
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
                  name: human-idjag-learner-codex-keycloak
                  key: client-id
            - name: KEYCLOAK_CLIENT_SECRET
              valueFrom:
                secretKeyRef:
                  name: human-idjag-learner-codex-keycloak
                  key: client-secret
            - name: PUBLIC_BASE_URL
              value: "http://localhost:${_gateway_port}"
            - name: KEYCLOAK_PUBLIC_URL
              value: "http://localhost:${_keycloak_port}"
EOF
)"
```

Expose the deployment as a service and confirm the logs look healthy:

```sh
kubectl delete -n human svc ai-client-gateway --ignore-not-found=true
kubectl expose deploy codex-idjag-learner-ai-client-gateway -n human --port 3101 --name ai-client-gateway
kubectl logs deploy/codex-idjag-learner-ai-client-gateway -n human --tail=5
```

## Verification Prerequisite

Before verifying, sign out of Keycloak so you start with a clean session:

```sh
_keycloak_port=$(./tools/port.sh keycloak)
./tools/open.sh "http://localhost:${_keycloak_port}/realms/master/protocol/openid-connect/logout"
```

If Keycloak asks **"Do you want to log out?"**, click **Logout** to confirm.

## Update Codex MCP Config

Point Codex at the gateway by updating `.codex/config.toml`. This time with no `Authorization` header — the gateway handles the entire ID-JAG flow:

```sh
_gateway_port=$(./tools/port.sh ai-client-gateway)

cat > .codex/config.toml <<EOF
[mcp_servers.id-jag-the-hard-way-mcp]
type = "http"
url = "http://localhost:${_gateway_port}/mcp"
EOF
```

> [!NOTE]
> Notice that there is no `Authorization` header or pre-fetched access token. The gateway handles the entire ID-JAG flow on your behalf.

## Verify

Log in to the MCP server. Unlike Claude Code (which prompts you inside the chat), Codex uses a dedicated login command:

```sh
codex mcp login id-jag-the-hard-way-mcp
```

Codex will print a URL and wait:

```sh
# Authorize `id-jag-the-hard-way-mcp` by opening this URL in your browser:
# http://localhost:44443/oauth/authorize?...
```

Open that URL in your browser and sign in with:

- username: `idjag-learner`
- password: `password`

Once you complete the login, the terminal will confirm:

```sh
# Successfully logged in to MCP server 'id-jag-the-hard-way-mcp'.
```

Now start Codex:

```sh
codex
```

> [!NOTE]
> 🟡 TODO: Add a screenshot of Codex CLI running after successful MCP login.

After signing in, the MCP connection will fail — this is intentional. The `human.idjag-learner.codex` service does not yet have permission in Athenz to exchange the ID token for an ID-JAG token.

## What's next?

In the next tutorial, we will grant `human.idjag-learner.codex` the Athenz permissions it needs to perform the full ID-JAG token exchange.

Next: [ID-JAG](./16-id-jag.md)
