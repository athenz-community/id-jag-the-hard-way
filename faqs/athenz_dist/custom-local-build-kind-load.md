# Goal

Build custom local Athenz ZMS/ZTS images from `athenz_dist`, load them into the local kind cluster, and restart both deployments.

<details>
<summary>Last verified on 2026-07-17 — ✅ Success</summary>

| # | Date       | Status                                      |
|---|------------|---------------------------------------------|
| 1 | 2026-07-17 | ✅ Success — human confirmed fully tested |

</details>

# Prerequisites

- Run from the repo root.
- Docker is running.
- `kubectl` is pointed at the local kind cluster.
- The `athenz` namespace already exists.

# Steps

## Step 1. Build ZMS and ZTS

```sh
make -C athenz_dist build-athenz-zms-server build-athenz-zts-server
```

## Step 2. Load the Images into kind

For kind, this is the local equivalent of pushing the image to the cluster:

```sh
kind load docker-image ghcr.io/ctyano/athenz-zms-server:latest ghcr.io/ctyano/athenz-zts-server:latest
```

## Step 3. Restart ZMS and ZTS & Wait

```sh
kubectl -n athenz rollout restart deployment/athenz-zms-server
kubectl -n athenz rollout restart deployment/athenz-zts-server

kubectl -n athenz rollout status deployment/athenz-zms-server
kubectl -n athenz rollout status deployment/athenz-zts-server
```

## Step 4. Check Pods

```sh
kubectl -n athenz get pods
```

Expected:

```sh
# NAME                                 READY   STATUS    RESTARTS       AGE
# athenz-zms-server-5697c49655-7ggmd   1/1     Running   0              44m
# athenz-zts-server-54b7d7749f-7hnc2   1/1     Running   0              10m
# ...
```

# FAQs

**What if I changed only ZMS?**

You can build, load, and restart only ZMS:

```sh
make -C athenz_dist build-athenz-zms-server
kind load docker-image ghcr.io/ctyano/athenz-zms-server:latest
kubectl -n athenz rollout restart deployment/athenz-zms-server
kubectl -n athenz rollout status deployment/athenz-zms-server
```

If ZTS depends on the changed behavior, use the full ZMS plus ZTS steps instead.

**What if I changed only ZTS?**

You can build, load, and restart only ZTS:

```sh
make -C athenz_dist build-athenz-zts-server
kind load docker-image ghcr.io/ctyano/athenz-zts-server:latest
kubectl -n athenz rollout restart deployment/athenz-zts-server
kubectl -n athenz rollout status deployment/athenz-zts-server
```

**What if I changed Kubernetes YAML?**

Apply the changed kustomize directory too:

```sh
kubectl apply -k athenz_dist/kubernetes/athenz-zms-server/kustomize
kubectl apply -k athenz_dist/kubernetes/athenz-zts-server/kustomize
```

Then restart and wait for rollout.

**Does this rewrite CA or key files?**

No. Building images, loading them into kind, and restarting deployments does not rewrite the local CA or key files.

Applying kustomize can reapply Kubernetes Secrets from files already present under `athenz_dist/kubernetes/.../kustomize`, but it does not generate new keys.

**Why restart ZTS too?**

ZTS can depend on ZMS behavior, shared Java code, or signed domain data from ZMS. When testing local Athenz changes, restart both unless you are sure the change is isolated.

**Why can ZTS fail after I build and restart custom ZMS?**

In this local Kubernetes setup, the ZMS signing key id comes from the ZMS pod name. When ZMS is restarted, the pod name can change. ZTS validates signed domain data from ZMS, so `sys.auth.zms` must contain the current ZMS pod-name key id.

Facts:

- Rebuilding the ZMS image does not create a new ZMS private/public key pair.
- Restarting the ZMS deployment can create a new ZMS pod name.
- The current ZMS deployment uses the pod name as `ZMS_PRIVATE_KEY_ID`, `ZMS_RSA_PRIVATE_KEY_ID`, and `ZMS_EC_PRIVATE_KEY_ID`.
- ZMS signs domain data with that key id.
- ZTS verifies signed domain data by looking up the matching ZMS public key id from `sys.auth.zms`.
- The ZTS init container registers the ZTS service key, not the current ZMS pod-name key id.
- That is why the current ZMS public key may need to be registered again after a custom ZMS restart.

**How do I register the current ZMS key id for ZTS?**

Run this after a custom ZMS rebuild/restart if ZTS does not become ready:

```sh
_zms_pod=$(kubectl -n athenz get pod -l app.kubernetes.io/name=athenz-zms-server -o jsonpath='{.items[0].metadata.name}')

kubectl -n athenz exec -i deployment/athenz-cli -- sh -c "cat >/tmp/zms.public.pem && zms-cli -z https://athenz-zms-server.athenz:4443/zms/v1 -key /var/run/athenz/athenz_admin.private.pem -cert /var/run/athenz/athenz_admin.cert.pem -d sys.auth add-public-key zms ${_zms_pod} /tmp/zms.public.pem" < athenz_dist/kubernetes/athenz-zms-server/kustomize/keys/zms.public.pem

kubectl -n athenz rollout restart deployment/athenz-zts-server
kubectl -n athenz rollout status deployment/athenz-zts-server
```

**What if ZTS stays `0/1 READY` after a ZMS restart?**

Check the ZTS logs:

```sh
kubectl -n athenz logs deployment/athenz-zts-server --all-containers=true --tail=200
```

If it says the ZMS public key id is not available, register the current ZMS key id using the command above.

# Reference

- [Athenz distribution Makefile](../../athenz_dist/Makefile)
- [Athenz Kubernetes Makefile](../../athenz_dist/kubernetes/Makefile)
