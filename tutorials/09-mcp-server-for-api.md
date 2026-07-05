|                      Previous                      |        Current         |             Next             |
|:--------------------------------------------------:|:----------------------:|:----------------------------:|
| [Granular Permission](./08-granular-permission.md) | **MCP Server for API** | [AI Agent](./10-ai-agent.md) |

# MCP Server for API

In this tutorial, we will set up MCP Server for API so that our AI client agent that we will install in the next tutorial can interact with our protected API server for you with the following steps:

<!-- TOC depthFrom:2 depthTo:2 -->

- [Deploy the MCP Server](#deploy-the-mcp-server)
- [Create Service Cert for MCP Server](#create-service-cert-for-mcp-server)
- [Create K8s Secret](#create-k8s-secret)
- [Mount Secret](#mount-secret)
- [What's done?](#whats-done)
- [What's next?](#whats-next)

<!-- /TOC -->

## Deploy the MCP Server

Create the `mcp-hub` namespace:

```sh
kubectl create namespace mcp-hub --dry-run=client -o yaml | kubectl apply -f -
```

```sh
# namespace/mcp-hub created
```

Deploy the MCP Server:

```sh
kubectl create deploy api-mcp -n mcp-hub \
  --image=ghcr.io/mlajkim/mcp:latest
```

```sh
# deployment.apps/api-mcp created
```

Let's label and annotate it:

```sh
kubectl label deploy api-mcp -n mcp-hub \
  app.kubernetes.io/part-of=mcp-hub \
  mcp.idthw.dev/project=k8s-docs-server
_mcp_port=$(./tools/port.sh mcp)
kubectl annotate deploy api-mcp -n mcp-hub \
  mcp.idthw.dev/alias="K8s Docs Server" \
  mcp.idthw.dev/public-url="http://localhost:${_mcp_port}/mcp"
```

```sh
# deployment.apps/api-mcp labeled
# deployment.apps/api-mcp annotated
```

Expose the deployment above:

```sh
kubectl expose deploy api-mcp -n mcp-hub --port 8081 --name api-mcp
```

```sh
# service/api-mcp exposed
```

Wait for the deployment rollout:

```sh
kubectl rollout status deploy/api-mcp -n mcp-hub
```

```sh
# Waiting for deployment "api-mcp" rollout to finish: 0 of 1 updated replicas are available...
# deployment "api-mcp" successfully rolled out
```

Check the logs:

```sh
kubectl logs deploy/api-mcp -n mcp-hub
```

At this point, you should see an error because the MCP server expects its certificate at `/app/certs/api-mcp.crt`, but we have not created and mounted the certificate yet:

```sh
# ◇ injected env (0) from .env // tip: ◈ secrets for agents [www.dotenvx.com]
# node:fs:560
#   return binding.open(
#                  ^
#
# Error: ENOENT: no such file or directory, open '/app/certs/api-mcp.crt'
#     at Object.openSync (node:fs:560:18)
#     at Object.readFileSync (node:fs:444:35)
#     at tokenDisplay (/app/src/utils/exchange-athenz-at.ts:17:17)
#     at Object.<anonymous> (/app/src/utils/exchange-athenz-at.ts:21:23)
#     at Module._compile (node:internal/modules/cjs/loader:1781:14)
#     at Object.transformer (/app/node_modules/tsx/dist/register-BOkp8V6j.cjs:9:3176)
#     at Module.load (node:internal/modules/cjs/loader:1505:32)
#     at Function._load (node:internal/modules/cjs/loader:1309:12)
#     at wrapModuleLoad (node:internal/modules/cjs/loader:254:19)
#     at Module.require (node:internal/modules/cjs/loader:1527:12) {
#   errno: -2,
#   code: 'ENOENT',
#   syscall: 'open',
#   path: '/app/certs/api-mcp.crt'
# }
#
# Node.js v22.23.1
```

## Create Service Cert for MCP Server

To run successfully, the MCP server also needs its own Athenz service identity and X.509 certificate. The MCP server calls the protected API server, but it is managed by MCP Hub, so we will create service `api-mcp` under the TLD `mcp-hub`.

Run the following:

```sh
./tools/athenz/create-tld.sh "mcp-hub"
./tools/athenz/create-private-key.sh "./keys/api-mcp"
./tools/athenz/create-service.sh "mcp-hub" "api-mcp" "./keys/api-mcp.public.key"
./tools/athenz/enable-cert-provider.sh "mcp-hub" "api-mcp"
./tools/athenz/fetch-cert.sh "mcp-hub" "api-mcp" "./keys/api-mcp.key" "v1"
```

```sh
#   ·  Creating TLD: mcp-hub...
#   ✔  TLD created: mcp-hub
#   ·  Generating RSA key pair for: ./keys/api-mcp...
#   ✔  Keys generated: ./keys/api-mcp.key, ./keys/api-mcp.public.key
#   ·  Registering Service: mcp-hub.api-mcp...
#   ✔  Service registered: mcp-hub.api-mcp
#   ·  Enabling ZTS Certificate Provider for mcp-hub.api-mcp...
# [Template(s) successfully applied to domain]
#   ✔  ZTS Certificate Provider enabled for mcp-hub.api-mcp
#   ·  Fetching X.509 Certificate for mcp-hub.api-mcp...
# command terminated with exit code 1
#   ⚠  Certificate fetch attempt 1/5 failed; retrying in 3s...
#   ✔  Certificate saved to: ./keys/api-mcp.crt
```

## Create K8s Secret

Create a secret based on the generated certificates:

```sh
kubectl -n mcp-hub delete secret api-mcp-cert --ignore-not-found
kubectl -n mcp-hub create secret generic api-mcp-cert \
  --from-file=api-mcp.crt=./keys/api-mcp.crt \
  --from-file=api-mcp.key=./keys/api-mcp.key \
  --from-file=ca.crt=./athenz_dist/certs/ca.cert.pem
```

```sh
# secret/api-mcp-cert created
```

## Mount Secret

Mount the cert secret into the MCP container:

```yaml
kubectl patch deploy api-mcp -n mcp-hub --patch "$(cat <<'EOF'
spec:
  template:
    spec:
      containers:
        - name: mcp
          env:
            - name: UPSTREAM_BASE_URL
              value: "http://api-server.api:8080"
            - name: PUBLIC_BASE_URL
              value: "http://api-mcp.mcp-hub:8081"
            - name: MCP_CERT_DIR
              value: "/app/certs"
            - name: ATHENZ_CERT_PATH
              value: "/app/certs/api-mcp.crt"
            - name: ATHENZ_KEY_PATH
              value: "/app/certs/api-mcp.key"
            - name: ATHENZ_CA_PATH
              value: "/app/certs/ca.crt"
          volumeMounts:
            - name: api-mcp-certs
              mountPath: /app/certs
              readOnly: true
      volumes:
        - name: api-mcp-certs
          secret:
            secretName: api-mcp-cert
EOF
)"
```

Wait for the rollout to complete:

```sh
kubectl rollout status deploy/api-mcp -n mcp-hub
```

```sh
# deployment "api-mcp" successfully rolled out
```

Verify:

```sh
kubectl logs deploy/api-mcp -n mcp-hub
```

```sh
# ◇ injected env (0) from .env // tip: ⌘ custom filepath { path: '/custom/path/.env' }
# 🚀 OpenAPI MCP Server for API listening on: http://api-mcp.mcp-hub:8081
# 🌐 Upstream API: http://api-server.api:8080
# 📄 OpenAPI Spec available at: http://api-mcp.mcp-hub:8081/openapi.json
# 🔌 MCP endpoint available at: http://api-mcp.mcp-hub:8081/mcp
```

## What's done?

We have created a running MCP Server for API with service identity `mcp-hub.api-mcp` highlighted in red below.

![09_arch_mcp_server_for_api](./assets/09_arch_mcp_server_for_api.png)

## What's next?

In next tutorial, we will do actual chat with local AI Agent and see how it interacts with our protected API server through the MCP Server we just created.

Next: [AI Agent](./10-ai-agent.md)
