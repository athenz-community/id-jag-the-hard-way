|                      Previous                      |        Current         |                    Next                    |
|:--------------------------------------------------:|:----------------------:|:------------------------------------------:|
| [Granular Permission](./06-granular-permission.md) | **MCP Server for API** | [AI Client Agent](./08-ai-client-agent.md) |

# MCP Server for API

In this tutorial, we will set up MCP Server for API so that our AI client agent that we will install in the next tutorial can interact with our protected API server for you.

<!-- TOC depthFrom:2 depthTo:2 -->

- [Run MCP Server for API](#run-mcp-server-for-api)
- [Create K8s Secret](#create-k8s-secret)
- [Mount Secret](#mount-secret)

<!-- /TOC -->

## Run MCP Server for API

### Service Cert for MCP Server

To run the MCP Server, just like we have given service identity for human user `human.idjag-learner` , we also need to give service identity for the MCP server. Because mcp server is part of the API server, we will simply create service `api-mcp` under the tld (domain) `api`.

Run the following:

```sh
./my_tools/create-private-key.sh "./keys/api-mcp"
./my_tools/create-service.sh "api" "api-mcp" "./keys/api-mcp.public.key"
./my_tools/enable-cert-provider.sh "api" "api-mcp"
sleep 2
./my_tools/fetch-cert.sh "api" "api-mcp" "./keys/api-mcp.key" "v1"
```

*Detailed explanation is skipped as thoroughly explained in the previous tutorials. Also, sleep has been included for Athenz to sync.*

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

### Run the MCP Server

```sh
kubectl create deploy mcp -n api \
  --image=ghcr.io/mlajkim/mcp:latest
```

Expose the deployment above:

```sh
kubectl expose deploy mcp -n api --port 8081 --name mcp
```


See the log:

```sh
kubectl logs deploy/mcp -n api
```

```sh
# ◇ injected env (0) from .env // tip: ⌘ enable debugging { debug: true }
# node:fs:560
#   return binding.open(
#                  ^

# Error: ENOENT: no such file or directory, open '/app/certs/api-mcp.crt'
# ...
```

## Mount Secret

```yaml
kubectl patch deploy mcp -n api --patch "$(cat <<'EOF'
spec:
  template:
    spec:
      containers:
        - name: mcp
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

Verify:

```sh
kubectl logs deploy/mcp -n api

```sh
# ◇ injected env (0) from .env // tip: ⌘ enable debugging { debug: true }
# 🚀 OpenAPI MCP Server for API listening on: http://mcp-server.api.svc.cluster.local
# 🔗 Upstream API: http://api-server.api.svc.cluster.local
# 📄 OpenAPI Spec available at: http://mcp-server.api.svc.cluster.local/openapi.json
```

Run the server:

```sh
make -C api_server mcp-local PORT=8101
```

```sh
# 🚀 OpenAPI MCP Server for API listening on: http://localhost:8101
# 🔗 Upstream API: http://localhost:14443
# 📄 OpenAPI Spec available at: http://localhost:8101/openapi.json
```

## What's done?

We have created a running MCP Server for API with service identity `api.mcp-api` highlighted in red below.

![07_arch_mcp_server_for_api](./assets/07_arch_mcp_server_for_api.png)

## What's next?

In next tutorial, we will do actual chat with local AI Agent and see how it interacts with our protected API server through the MCP Server we just created.

Next: [AI Client Agent](./08-ai-client-agent.md)
