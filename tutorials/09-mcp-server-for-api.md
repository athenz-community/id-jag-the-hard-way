|                      Previous                      |        Current         |             Next             |
|:--------------------------------------------------:|:----------------------:|:----------------------------:|
| [Granular Permission](./08-granular-permission.md) | **MCP Server for API** | [AI Agent](./10-ai-agent.md) |

# MCP Server for API

In this tutorial, we will set up MCP Server for API so that our AI client agent that we will install in the next tutorial can interact with our protected API server for you with the following steps:

<!-- TOC depthFrom:2 depthTo:2 -->

- [Create Service Cert for MCP Server](#create-service-cert-for-mcp-server)
- [Create K8s Secret](#create-k8s-secret)
- [Deploy the MCP Server](#deploy-the-mcp-server)
- [Mount Secret](#mount-secret)
- [What's done?](#whats-done)
- [What's next?](#whats-next)

<!-- /TOC -->

## Create Service Cert for MCP Server

To run the MCP Server, just like we have given service identity for human user `human.idjag-learner`, we also need to give service identity for the MCP server. Because the MCP server is part of the API server, we will create service `api-mcp` under the TLD `api`.

Run the following:

```sh
./tools/athenz/create-private-key.sh "./keys/api-mcp"
./tools/athenz/create-service.sh "api" "api-mcp" "./keys/api-mcp.public.key"
./tools/athenz/enable-cert-provider.sh "api" "api-mcp"
./tools/athenz/fetch-cert.sh "api" "api-mcp" "./keys/api-mcp.key" "v1"
```

```sh
#   ·  Generating RSA key pair for: ./keys/api-mcp...
#   ✔  Keys generated: ./keys/api-mcp.key, ./keys/api-mcp.public.key
#   ·  Registering Service: api.api-mcp...
#   ✔  Service registered: api.api-mcp
#   ·  Enabling ZTS Certificate Provider for api.api-mcp...
# [Template(s) successfully applied to domain]
#   ✔  ZTS Certificate Provider enabled for api.api-mcp
#   ·  Fetching X.509 Certificate for api.api-mcp...
#   ✔  Certificate saved to: ./keys/api-mcp.crt
```

## Create K8s Secret

Create a secret based on the generated certificates:

```sh
kubectl -n api delete secret api-mcp-cert --ignore-not-found
kubectl -n api create secret generic api-mcp-cert \
  --from-file=api-mcp.crt=./keys/api-mcp.crt \
  --from-file=api-mcp.key=./keys/api-mcp.key \
  --from-file=ca.crt=./athenz_dist/certs/ca.cert.pem
```

```sh
# secret/api-mcp-cert created
```

## Deploy the MCP Server

Deploy the MCP Server in the `api` namespace:

```sh
kubectl create deploy mcp -n api \
  --image=ghcr.io/mlajkim/mcp:latest
```

```sh
# deployment.apps/mcp created
```

Expose the deployment:

```sh
kubectl expose deploy mcp -n api --port 8081 --name mcp
```

```sh
# service/mcp exposed
```

Wait for the container to be ready:

```sh
kubectl rollout status deploy/mcp -n api
```

```sh
# Waiting for deployment "mcp" rollout to finish: 0 of 1 updated replicas are available...
# deployment "mcp" successfully rolled out
```

> [!NOTE]
> If you see the following error, the container is still starting up. Wait a few seconds and try again.
>
> ```sh
> Error from server (BadRequest): container "mcp" in pod is waiting to start: ContainerCreating
> ```

## Mount Secret

Mount the cert secret into the MCP container:

```yaml
kubectl patch deploy mcp -n api --patch "$(cat <<'EOF'
spec:
  template:
    spec:
      containers:
        - name: mcp
          env:
            - name: UPSTREAM_BASE_URL
              value: "http://api-server.api:8080"
            - name: PUBLIC_BASE_URL
              value: "http://mcp.api:8081"
            - name: MCP_CERT_DIR
              value: "/app/certs"
            - name: ATHENZ_CERT_PATH
              value: "/app/certs/api-mcp.crt"
            - name: ATHENZ_KEY_PATH
              value: "/app/certs/api-mcp.key"
            - name: ATHENZ_CA_PATH
              value: "/app/certs/ca.crt"
          volumeMounts:
            - name: mcp-certs
              mountPath: /app/certs
              readOnly: true
      volumes:
        - name: mcp-certs
          secret:
            secretName: api-mcp-cert
EOF
)"
```

```sh
# deployment.apps/mcp patched
```

Wait for the rollout to complete:

```sh
kubectl rollout status deploy/mcp -n api
```

```sh
# deployment "mcp" successfully rolled out
```

Verify:

```sh
kubectl logs deploy/mcp -n api
```

```sh
# OpenAPI MCP Server for API listening on: http://mcp.api:8081
# Upstream API: http://api-server.api:8080
# OpenAPI Spec available at: http://mcp.api:8081/openapi.json
# MCP endpoint available at: http://mcp.api:8081/mcp
```

## What's done?

We have created a running MCP Server for API with service identity `api.api-mcp` highlighted in red below.

![09_arch_mcp_server_for_api](./assets/09_arch_mcp_server_for_api.png)

## What's next?

Next: [AI Agent](./10-ai-agent.md)
