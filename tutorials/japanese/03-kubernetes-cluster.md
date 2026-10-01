| 前へ | 現在 | 次へ |
|:---:|:---:|:---:|
| [事前準備](./02-prerequisites.md) | **Kubernetes クラスター** | [リソースサーバー（Resource Server）](./04-resource-server.md) |

<a id="kubernetes-cluster"></a>

# Kubernetes クラスター

ローカルに Kubernetes クラスターを作成し、正常に稼働していることを確認します。

<!-- TOC depthFrom:2 depthTo:2 -->

- [ローカル Kubernetes クラスターを作成する](#create-a-local-kubernetes-cluster)
- [Kubernetes クラスターを確認する](#verify-the-kubernetes-cluster)

<!-- /TOC -->

<a id="create-local-kubernetes-cluster"></a>

<a id="create-a-local-kubernetes-cluster"></a>

## ローカル Kubernetes クラスターを作成する

前の章でインストールした kind を使ってローカルクラスターを作成します：

```sh
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
> 別のインストール方法については、[kind のインストールガイド](https://kind.sigs.k8s.io/docs/user/quick-start/#installation)を参照してください。

<a id="verify-the-kubernetes-cluster"></a>

## Kubernetes クラスターを確認する

現在の kubectl コンテキストが指すクラスターを確認します：

```sh
kubectl cluster-info
```

```sh
# Kubernetes control plane is running at https://127.0.0.1:53988
# CoreDNS is running at https://127.0.0.1:53988/api/v1/namespaces/kube-system/services/kube-dns:dns/proxy

# To further debug and diagnose cluster problems, use 'kubectl cluster-info dump'.
```

ネームスペースの一覧を確認します：

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

Kubernetes クラスターが稼働しています。次の章では文書 API をデプロイし、アクセスできることを確認します。

次へ：[リソースサーバー（Resource Server）](./04-resource-server.md)
