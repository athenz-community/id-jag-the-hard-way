|             Previous             |         Current          |               Next               |
|:--------------------------------:|:------------------------:|:--------------------------------:|
| [API Server](./04-api-server.md) | **Authorization Server** | [ZPU Server](./06-zpu-server.md) |

# Authorization Server

In this tutorial, we will deploy Athenz as the local authorization server and verify that it is running properly in Kubernetes cluster.

<!-- TOC depthFrom:2 depthTo:2 -->

- [Deploy Athenz Server](#deploy-athenz-server)
- [Check Athenz Server Running](#check-athenz-server-running)
- [Keep Core Endpoints Locally Reachable](#keep-core-endpoints-locally-reachable)
- [Open Athenz UI](#open-athenz-ui)

<!-- /TOC -->

## Deploy Athenz Server

Run the following command (this will take about 5 minutes):

```sh
git submodule update --init --recursive
make -C athenz_dist clean-kubernetes-athenz deploy-kubernetes-athenz
```

> [!NOTE]
> The SSOT guide for using the Athenz manifest is available [here](https://github.com/athenz-community/athenz-distribution/blob/main/README.md)

Once you see the following output, you can proceed to the next step:

```sh
# ...
# namespace/athenz unchanged
# configmap/athenz-ui-config created
# secret/athenz-admin-keys configured
# secret/athenz-ui-keys created
# service/athenz-ui created
# deployment.apps/athenz-ui created
```

## Check Athenz Server Running

> [!NOTE]
> It may take about 5–10 minutes for all Athenz servers to be fully available.

Execute the following to see the status of the Athenz server:

```sh
_athenz_components=(
  "athenz-db"
  "athenz-cli"
  "athenz-zms-server"
  "athenz-zts-server"
  "athenz-ui"
)

echo "Waiting for athenz servers to be ready ..."

for component in "${_athenz_components[@]}"; do
  kubectl wait -n athenz \
    --for=condition=ready pod \
    --selector=app.kubernetes.io/name=$component \
    --timeout=180s || echo "Timed out waiting for $component. Check logs manually."
done
```

```sh
# pod/athenz-db-0 condition met
# pod/athenz-cli-574d747dff-mfdgz condition met
# pod/athenz-zms-server-568d4cfd89-tqwwn condition met
# pod/athenz-zts-server-6966ff7f66-4j67d condition met
# pod/athenz-ui-59f7f77667-5rpf7 condition met
```

Verify that the pods are running:

```sh
kubectl get pods -n athenz
```

```sh
# NAME                                 READY   STATUS    RESTARTS   AGE
# athenz-cli-574d747dff-mfdgz          1/1     Running   0          87s
# athenz-db-0                          1/1     Running   0          88s
# athenz-ui-59f7f77667-5rpf7           2/2     Running   0          87s
# athenz-zms-server-568d4cfd89-tqwwn   1/1     Running   0          87s
# athenz-zts-server-6966ff7f66-4j67d   1/1     Running   0          87s
```

## Keep Core Endpoints Locally Reachable

The `kubectl port-forward` command may stop if a pod restarts. Therefore, we need a way to keep the port-forwarding active.

Start the port-forwarder. If a default port is already in use, it will ask you to pick a different one:

```sh
./tools/keep-k8s-port-forward.sh
```

## Open Athenz UI

Open Athenz UI:

```sh
_athenz_ui_port=$(./tools/port.sh athenz-ui)
./tools/open.sh "http://localhost:${_athenz_ui_port}"
```

![athenz_ui](assets/05_athenz_ui.png)

In the next tutorial, we will create a ZPU (details later explained):

Next: [ZPU Server](./06-zpu-server.md)
