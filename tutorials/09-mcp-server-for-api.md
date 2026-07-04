|                      Previous                      |        Current         |             Next             |
|:--------------------------------------------------:|:----------------------:|:----------------------------:|
| [Granular Permission](./08-granular-permission.md) | **MCP Server for API** | [AI Agent](./10-ai-agent.md) |

# MCP Server for API

In this tutorial, we will set up MCP Server for API so that our AI client agent that we will install in the next tutorial can interact with our protected API server for you.

<!-- TOC depthFrom:2 depthTo:2 -->

- [Run MCP Server for API](#run-mcp-server-for-api)
- [Create K8s Secret](#create-k8s-secret)
- [Deploy the MCP Server](#deploy-the-mcp-server)
- [Mount Secret](#mount-secret)
- [What's done?](#whats-done)
- [What's next?](#whats-next)

<!-- /TOC -->

## Run MCP Server for API

### Service Cert for MCP Server

To run the MCP Server, just like we have given service identity for human user `human.idjag-learner`, we also need to give service identity for the MCP server. The MCP server calls the protected API server, but it is managed by MCP Hub, so we will create service `k8s-doc-server` under the TLD `mcp-hub`.

Run the following:

```sh
./tools/athenz/create-tld.sh "mcp-hub"
./tools/athenz/create-private-key.sh "./keys/k8s-doc-server"
./tools/athenz/create-service.sh "mcp-hub" "k8s-doc-server" "./keys/k8s-doc-server.public.key"
./tools/athenz/enable-cert-provider.sh "mcp-hub" "k8s-doc-server"
```

```sh
#   ·  Creating TLD: mcp-hub...
#   ✔  TLD created: mcp-hub
#   ·  Generating RSA key pair for: ./keys/k8s-doc-server...
#   ✔  Keys generated: ./keys/k8s-doc-server.key, ./keys/k8s-doc-server.public.key
#   ·  Registering Service: mcp-hub.k8s-doc-server...
#   ✔  Service registered: mcp-hub.k8s-doc-server
#   ·  Enabling ZTS Certificate Provider for mcp-hub.k8s-doc-server...
#   ✔  ZTS Certificate Provider enabled for mcp-hub.k8s-doc-server
```

## Create K8s Secret

Create a secret based on the generated certificates:

```sh
./tools/athenz/fetch-cert.sh "mcp-hub" "k8s-doc-server" "./keys/k8s-doc-server.key" "v1"
kubectl create namespace mcp-hub --dry-run=client -o yaml | kubectl apply -f -
kubectl -n mcp-hub delete secret k8s-doc-server-cert --ignore-not-found
kubectl -n mcp-hub create secret generic k8s-doc-server-cert \
  --from-file=k8s-doc-server.crt=./keys/k8s-doc-server.crt \
  --from-file=k8s-doc-server.key=./keys/k8s-doc-server.key \
  --from-file=ca.crt=./athenz_dist/certs/ca.cert.pem
```

```sh
# secret/k8s-doc-server-cert created
```

## Deploy the MCP Server

Deploy the MCP Server:

```sh
kubectl create deploy k8s-doc-server -n mcp-hub \
  --image=ghcr.io/mlajkim/mcp:latest
```

Expose the deployment above:

```sh
kubectl expose deploy k8s-doc-server -n mcp-hub --port 8081 --name k8s-doc-server
```

Wait for the container to be ready:

```sh
kubectl rollout status deploy/k8s-doc-server -n mcp-hub
```

> [!NOTE]
> If you see the following error, the container is still starting up. Wait a few seconds and try again.
>
> ```
> Error from server (BadRequest): container "k8s-doc-server" in pod is waiting to start: ContainerCreating
> ```

## Mount Secret

Mount the cert secret into the MCP container:

```yaml
kubectl patch deploy k8s-doc-server -n mcp-hub --patch "$(cat <<'EOF'
spec:
  template:
    spec:
      containers:
        - name: k8s-doc-server
          env:
            - name: UPSTREAM_BASE_URL
              value: "http://api-server.api:8080"
            - name: PUBLIC_BASE_URL
              value: "http://k8s-doc-server.mcp-hub:8081"
            - name: MCP_CERT_DIR
              value: "/app/certs"
            - name: ATHENZ_CERT_PATH
              value: "/app/certs/k8s-doc-server.crt"
            - name: ATHENZ_KEY_PATH
              value: "/app/certs/k8s-doc-server.key"
            - name: ATHENZ_CA_PATH
              value: "/app/certs/ca.crt"
          volumeMounts:
            - name: k8s-doc-server-certs
              mountPath: /app/certs
              readOnly: true
      volumes:
        - name: k8s-doc-server-certs
          secret:
            secretName: k8s-doc-server-cert
EOF
)"
```

Wait for the rollout to complete:

```sh
kubectl rollout status deploy/k8s-doc-server -n mcp-hub
```

```sh
# deployment "k8s-doc-server" successfully rolled out
```

Verify:

```sh
kubectl logs deploy/k8s-doc-server -n mcp-hub
```

```sh
# ◇ injected env (0) from .env // tip: ⌘ multiple files { path: ['.env.local', '.env'] }
# 🚀 OpenAPI MCP Server for API listening on: http://k8s-doc-server.mcp-hub:8081
# 🌐 Upstream API: http://api-server.api:8080
# 📄 OpenAPI Spec available at: http://k8s-doc-server.mcp-hub:8081/openapi.json
# 🔌 MCP endpoint available at: http://k8s-doc-server.mcp-hub:8081/mcp
```

## What's done?

We have created a running MCP Server for API with service identity `mcp-hub.k8s-doc-server` highlighted in red below.

![09_arch_mcp_server_for_api](./assets/09_arch_mcp_server_for_api.png)

## What's next?

In next tutorial, we will do actual chat with local AI Agent and see how it interacts with our protected API server through the MCP Server we just created.

Next: [AI Agent](./10-ai-agent.md)
