|                            Previous                            |              Current               |           Next           |
|:--------------------------------------------------------------:|:----------------------------------:|:------------------------:|
| [Trusted Identity Provider](./13-trusted-identity-provider.md) | **AI Client Gateway — Open WebUI** | [ID-JAG](./15-id-jag.md) |

# AI Client Gateway — Open WebUI

Deploy AI Client Gateway between Open WebUI and the protected MCP service with the following steps:

<!-- TOC depthFrom:2 depthTo:2 -->

- [Understand ID-JAG](#understand-id-jag)
- [Understand How the ID-JAG Specification Helps Us](#understand-how-the-id-jag-specification-helps-us)
- [Deploy AI Client Gateway in K8s](#deploy-ai-client-gateway-in-k8s)
- [Check the Logs](#check-the-logs)
- [Generate the Required Certificates](#generate-the-required-certificates)
- [Mount the Secret](#mount-the-secret)
- [Review the Result](#review-the-result)
- [Modify the Tool Target](#modify-the-tool-target)
- [Verify](#verify)
- [Understand the Result](#understand-the-result)
- [Next Steps](#next-steps)

<!-- /TOC -->

<a id="learn-about-id-jag"></a>

## Understand ID-JAG

ID-JAG (Identity Assertion JWT Authorization Grant) is an IETF draft specification used in Cross-App Access. It lets a client use an ID token to request authorization for API access on behalf of the signed-in user.

You can learn more about the specifics here:

- [Identity Assertion JWT Authorization Grant - IETF](https://datatracker.ietf.org/doc/draft-ietf-oauth-identity-assertion-authz-grant/)
- [Why ID-JAG is the future of AI agent security - LY Corp. Tech Blog](https://techblog.lycorp.co.jp/en/20260417a)

## Understand How the ID-JAG Specification Helps Us

Keycloak issues an ID token when you sign in. The gateway uses it in two exchanges:

1. Exchange the ID token for an ID-JAG addressed to the ZTS authorization server URL, `https://athenz-zts-server.athenz:4443/zts/v1`.
2. Exchange that ID-JAG for an access token with audience `mcp` and both the MCP and required API scopes.

`ai.open-webui` is the gateway's service identity, not the ID-JAG audience. The gateway obtains tokens for the signed-in user, so you no longer paste an Athenz access token into the tool settings. ZTS still checks the user's roles and the gateway's exchange permissions.

## Deploy AI Client Gateway in K8s

The AI Client Gateway belongs in the `ai` namespace alongside Open WebUI — it is part of the AI-side infrastructure, not the human-side client.

Deploy the AI Client Gateway:

```sh
kubectl create deploy ai-client-gateway -n ai \
  --image=ghcr.io/mlajkim/ai-client-gateway:latest
```

Configure the gateway one connection at a time. Each command updates only the named variables, so settings from earlier steps remain in place.

### 1. Set the MCP Server Address

First, tell the gateway where to forward MCP requests. Set `UPSTREAM_BASE_URL` to the in-cluster address of the MCP Service deployed earlier:

```sh
kubectl set env deployment/ai-client-gateway -n ai \
  --containers=ai-client-gateway \
  UPSTREAM_BASE_URL=http://mcp.mcp:8081
```

```sh
# deployment.apps/ai-client-gateway env updated
```

### 2. Configure Token Issuance through Athenz

Next, configure where the gateway obtains access tokens for MCP requests. `ZTS_URL` is the Athenz ZTS endpoint for the ID token → ID-JAG → access token exchanges. `ATHENZ_ACCESS_TOKEN_AUDIENCE=mcp` specifies the recipient of the resulting access token. The ID-JAG audience remains the ZTS URL:

```sh
kubectl set env deployment/ai-client-gateway -n ai \
  --containers=ai-client-gateway \
  ZTS_URL=https://athenz-zts-server.athenz:4443/zts/v1 \
  ATHENZ_ACCESS_TOKEN_AUDIENCE=mcp
```

```sh
# deployment.apps/ai-client-gateway env updated
```

### 3. Expose the Gateway

Expose the deployment so it can be accessed:

```sh
kubectl expose deploy ai-client-gateway -n ai --port 3101 --name ai-client-gateway
```

## Check the Logs

Check the logs from the `ai-client-gateway` container:

```sh
kubectl logs deploy/ai-client-gateway -n ai -c ai-client-gateway
```

```sh
# ...
# Error: ENOENT: no such file or directory, open '/app/certs/ai-client-gateway.crt'
# ...
```

The gateway requires its X.509 certificate and private key to authenticate to ZTS. The next steps create and mount those files.

> [!NOTE]
> If the result is `ContainerCreating`, the current container instance has not started yet. Wait briefly and retry, or add `--previous` to the command above if an earlier instance has already terminated.

## Generate the Required Certificates

Create the `ai.open-webui` service identity and its certificate for the gateway.

First, create a directory and generate the RSA key pair:

```sh
mkdir -p ./components/ai_client_gateway/certs
./tools/athenz/create-private-key.sh "./components/ai_client_gateway/certs/ai-client-gateway"
```

```sh
#   ·  Generating RSA key pair for: ./components/ai_client_gateway/certs/ai-client-gateway...
#   ✔  Keys generated: ./components/ai_client_gateway/certs/ai-client-gateway.key, ./components/ai_client_gateway/certs/ai-client-gateway.public.key
```

Next, we will create a Top-Level Domain (TLD) named `ai` since we haven't created it yet:

```sh
./tools/athenz/create-tld.sh "ai"
```

```sh
#   ·  Creating TLD: ai...
#   ✔  TLD created: ai
```

Now, register the service open-webui under the `ai` domain using the public key we just generated:

```sh
./tools/athenz/create-service.sh "ai" "open-webui" "./components/ai_client_gateway/certs/ai-client-gateway.public.key"
```

```sh
#   ·  Registering Service: ai.open-webui...
#   ✔  Service registered: ai.open-webui
```

Enable the certificate provider for this service:

```sh
./tools/athenz/enable-cert-provider.sh "ai" "open-webui"
```

```sh
#   ·  Enabling ZTS Certificate Provider for ai.open-webui...
#   ✔  ZTS Certificate Provider enabled for ai.open-webui
```

Generate the X.509 Certificate:

```sh
./tools/athenz/fetch-cert.sh "ai" "open-webui" "./components/ai_client_gateway/certs/ai-client-gateway.key" "v1"
```

```sh
#   ·  Fetching X.509 Certificate for ai.open-webui...
#   ✔  Certificate saved to: ./components/ai_client_gateway/certs/ai-client-gateway.crt
```

Finally, the `ai_client_gateway` requires the Athenz CA certificate. Copy it from the `athenz_dist/certs` directory:

```sh
cp ./athenz_dist/certs/ca.cert.pem ./components/ai_client_gateway/certs/ca.crt
```

Verify that all necessary certificates have been created:

```sh
ls -al ./components/ai_client_gateway/certs/
```

```sh
# total 24
# drwxr-xr-x   5 mlajkim  staff   160 May 2 16:47 .
# drwxr-xr-x  13 mlajkim  staff   416 May 2 16:43 ..
# -rw-r--r--   1 mlajkim  staff  1834 May 2 16:49 ca.crt
# -rw-r--r--   1 mlajkim  staff  1716 May 2 16:47 ai-client-gateway.crt
# -rw-------   1 mlajkim  staff  1675 May 2 16:43 ai-client-gateway.key
# -rw-r--r--   1 mlajkim  staff   451 May 2 16:43 ai-client-gateway.public.key
```

## Mount the Secret

Now, create a Kubernetes secret using the generated certificates:

```sh
kubectl -n ai delete secret ai-client-gateway-cert --ignore-not-found
kubectl -n ai create secret generic ai-client-gateway-cert \
  --from-file=ai-client-gateway.crt=./components/ai_client_gateway/certs/ai-client-gateway.crt \
  --from-file=ai-client-gateway.key=./components/ai_client_gateway/certs/ai-client-gateway.key \
  --from-file=ca.crt=./components/ai_client_gateway/certs/ca.crt
```

```sh
# secret/ai-client-gateway-cert created
```

Mount the Secret to the Deployment:

```yaml
kubectl patch deploy ai-client-gateway -n ai --patch "$(cat <<'EOF'
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
            secretName: ai-client-gateway-cert
EOF
)"
```

```sh
# deployment.apps/ai-client-gateway patched
```

Wait for the new pod with the certificate mount to become available:

```sh
kubectl rollout status deployment/ai-client-gateway -n ai --timeout=180s
```

```sh
# deployment "ai-client-gateway" successfully rolled out
```

Check the current container's logs to verify the gateway started successfully:

```sh
kubectl logs deploy/ai-client-gateway -n ai -c ai-client-gateway
```

```sh
# 🚀 OpenWebUI OpenAPI Gateway listening on 0.0.0.0:3101
# 🔗 Upstream API: http://mcp.mcp:8081
# 🌍 Public Base URL: http://ai-client-gateway.ai:3101
# 🔑 Athenz ZTS Endpoint: https://athenz-zts-server.athenz:4443/zts/v1
```

<a id="whats-done"></a>

## Review the Result

AI Client Gateway is now deployed. Next, configure Open WebUI to send tool requests through it:

![Open WebUI sends requests through AI Client Gateway to the protected MCP route](./assets/core_14_gateway_route.svg)

## Modify the Tool Target

Route Open WebUI tool requests through `ai_client_gateway`. The gateway now handles the ID token → ID-JAG → MCP access token exchanges, so you no longer need to obtain an Athenz access token in advance and enter it in the tool connection settings.

Open the Open WebUI in your browser:

```sh
_open_webui_keycloak_port=54443
open http://localhost:$_open_webui_keycloak_port
```

1. Log in to Open WebUI using an admin account (required to modify integrations).
1. Navigate to `User Icon` > `Admin Panel` > `Settings` > `Integrations`.
1. Click the configuration icon for the API MCP Server.
1. Make the following changes:
  - Change the tool server URL to `http://ai-client-gateway.ai:3101`.
  - Set **Auth** to **OAuth**.

![15_edit_connection_of_tool](./assets/15_edit_connection_of_tool.png)

## Verify

Follow the steps below to verify the setup.

Login as `idjag-learner`:

```sh
_open_webui_port=$(./tools/port.sh open-webui)
./tools/open.sh "http://localhost:${_open_webui_port}" incognito=true
```

![15_logged_in_as_idjag_learner](./assets/15_logged_in_as_idjag_learner.png)

Now, test the setup by asking the AI agent:

```
Get docs with id-jag-the-hard-way-mcp
```

The request should fail because the gateway does not yet have ID-JAG exchange permission:

![15_deliberate_failure_to_get_without_permission](./assets/15_deliberate_failure_to_get_without_permission.png)

<a id="whats-happened"></a>

## Understand the Result

The user is signed in, and the gateway authenticates to ZTS as `ai.open-webui`. ZTS rejects the exchange because that service lacks `zts.jag_exchange` permission for the requested MCP and API roles.

![Sign-in succeeds before ID-JAG delegation is denied](./assets/core_14_idjag_denied.svg)

In another terminal, inspect the last 8 lines of the AI Client Gateway log to see where the exchange failed:

```sh
kubectl logs deploy/ai-client-gateway -n ai -c ai-client-gateway --tail=8
```

Open WebUI sends the user's ID token in the `oauth_id_token` cookie. Example output for a document-read request:

```sh
# [Athenz AT] Cache Feature for Athenz AT is now disabled
# [Athenz ID-JAG] 🔄 Attempting to exchange new ID-JAG with id-token for scope [api:role.docs-getter mcp:role.mcp-accessor] ...
# [Athenz ID-JAG] 🎯 Target ZTS for ID-JAG: https://athenz-zts-server.athenz:4443/zts/v1/oauth2/token
# [2026-09-26T10:45:04.305Z] Proxy request failed: Error: Athenz ZTS Error: HTTP 403 - {"code":403,"message":"Principal not authorized for token exchange for the requested role"}
#     at IncomingMessage.<anonymous> (file:///app/src/utils/idtokenIntoIdjag.js:63:18)
#     at IncomingMessage.emit (node:events:531:35)
#     at endReadableNT (node:internal/streams/readable:1698:12)
#     at process.processTicksAndRejections (node:internal/process/task_queues:89:21)
```

The log shows how far the request progressed:

- `scope [api:role.docs-getter mcp:role.mcp-accessor]`: the gateway requested an ID-JAG covering MCP access and document retrieval
- `Target ZTS for ID-JAG`: the request reached the token-exchange step targeting the ZTS `/oauth2/token` endpoint
- `HTTP 403` and `Principal not authorized for token exchange for the requested role`: ZTS denied the gateway's exchange request. In addition to the user's role memberships, `ai.open-webui` needs `zts.jag_exchange` permission for the requested roles

<a id="whats-next"></a>

## Next Steps

Sign-in succeeds, but Athenz rejects the gateway's ID-JAG request. In the next chapter, you will grant the gateway the required exchange permissions and retry the document request.

Next: [ID-JAG](./15-id-jag.md)
