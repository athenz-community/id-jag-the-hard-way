|                Previous                |        Current         |               Next               |
|:--------------------------------------:|:----------------------:|:--------------------------------:|
| [Prerequisites](./02-prerequisites.md) | **Kubernetes Cluster** | [API Server](./04-api-server.md) |

# Kubernetes Cluster

In this tutorial, we will set up Kubernetes cluster with the following step:

<!-- TOC depthFrom:2 depthTo:2 -->

- [Create Local Kubernetes Cluster](#create-local-kubernetes-cluster)
- [Verify the Kubernetes Cluster](#verify-the-kubernetes-cluster)

<!-- /TOC -->

## Create Local Kubernetes Cluster

You can use almost any Kubernetes cluster, but to simplify the process, we will use Kind (Kubernetes in Docker).

```sh
go install sigs.k8s.io/kind@latest
kind create cluster
```

```sh
# Creating cluster "kind" ...
#  ✓ Ensuring node image (kindest/node:v1.XX.X) 🖼 
#  ✓ Preparing nodes 📦
#  ✓ Writing configuration 📜
#  ✓ Starting control-plane 🕹️
#  ✓ Installing CNI 🔌
#  ✓ Installing StorageClass 💾
# Set kubectl context to "kind-kind"
# You can now use your cluster with:

# kubectl cluster-info --context kind-kind
```

> [!NOTE]
> The Single Source of Truth (SSOT) guide for downloading and installing Kind can be found [here](https://kind.sigs.k8s.io/)

## Verify the Kubernetes Cluster

Get cluster info of the defualt:

```sh
kubectl cluster-info
```

```sh
# Kubernetes control plane is running at https://127.0.0.1:53988
# CoreDNS is running at https://127.0.0.1:53988/api/v1/namespaces/kube-system/services/kube-dns:dns/proxy

# To further debug and diagnose cluster problems, use 'kubectl cluster-info dump'.
```

Get namespaces available:

```sh
kubectl get ns
```

```sh
# NAME                 STATUS   AGE
# default              Active   14s
# kube-node-lease      Active   14s
# kube-public          Active   14s
# kube-system          Active   14s
# local-path-storage   Active   15s
```

Next: [API Server](./04-api-server.md)
