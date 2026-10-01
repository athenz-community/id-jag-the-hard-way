| 前へ | 現在 | 次へ |
|:---:|:---:|:---:|
| [Kubernetes クラスター](./03-kubernetes-cluster.md) | **リソースサーバー（Resource Server）** | [認可サーバー（Authorization Server）](./05-authorization-server.md) |

<a id="resource-server"></a>

# リソースサーバー（Resource Server）

シンプルな文書 API をデプロイし、アクセストークン（Access Token）なしで文書を取得します。その後、トークンの検証を有効にし、同じリクエストが拒否されることを確認します。

<!-- TOC depthFrom:2 depthTo:2 -->

- [API ネームスペースを作成する](#create-the-api-namespace)
- [API サーバーをデプロイする](#deploy-the-api-server)
- [API サーバーにリクエストを送る](#send-a-request-to-the-api-server)
- [結果を確認する](#understand-the-result)
- [API の動作を理解する](#learn-about-the-api)
- [アクセストークンの検証を有効にする](#enable-access-token-enforcement)
- [次のステップ](#next-steps)

<!-- /TOC -->

<a id="create-a-namespace-api-in-kubernetes"></a>

<a id="create-the-api-namespace"></a>

## API ネームスペースを作成する

```sh
kubectl create ns api
```

```sh
# namespace/api created
```

<a id="deploy-a-simple-api-server-to-the-kubernetes"></a>

<a id="deploy-the-api-server"></a>

## API サーバーをデプロイする

```sh
kubectl create deploy api-server -n api \
  --image=ghcr.io/mlajkim/idthw-demo-api:latest
```


Kubernetes Service を通じて Deployment にアクセスできるようにします：

```sh
kubectl expose deploy api-server -n api --port 8080 --name api-server
```

```sh
# service/api-server exposed
```

<a id="send-a-request-to-the-api-server"></a>

## API サーバーにリクエストを送る

Deployment の準備が完了するまで待ちます：

```sh
kubectl rollout status deploy/api-server -n api
```

```sh
# deployment "api-server" successfully rolled out
```

アクセストークンなしで文書をリクエストします：

```sh
kubectl exec deploy/api-server -n api \
  -- node -e 'fetch("http://localhost:8080/api/docs").then(async r => console.log(await r.text()))' | jq
```

```sh
# {
#   "docs": [
#     { "id": 1, "name": "first default doc", "content": "hello world" },
#     { "id": 2, "name": "second default doc", "content": "how are you?" }
#   ]
# }
```

<a id="learn-whats-happened"></a>

<a id="understand-the-result"></a>

## 結果を確認する

まだアクセストークンの検証が無効なため、API は `200 OK` と文書の一覧を返します：

![トークンの検証を無効にした API に文書をリクエストする流れ](../assets/core_04_open_api.svg)

<a id="learn-about-the-api"></a>

## API の動作を理解する

この API サーバーは学習用にシンプルな構成になっています。

データベースを使わず、文書をメモリに保存します。API サーバーを再起動すると、保存されたデータはサンプル文書にリセットされます。

簡単に起動・リセットできるため、認可設定によって API の動作がどう変わるかを確認できます。

<a id="verify-access-token-enforcement"></a>
<a id="access-token-mode"></a>

<a id="enable-access-token-enforcement"></a>

## アクセストークンの検証を有効にする

`ACCESS_TOKEN_ENABLED=true` を設定し、有効な Athenz アクセストークンと、各文書操作に必要なスコープを要求します：

```sh
kubectl set env deploy/api-server -n api ACCESS_TOKEN_ENABLED=true
kubectl rollout status deploy/api-server -n api
```

トークンなしで同じリクエストをもう一度送ります：

```sh
kubectl exec deploy/api-server -n api \
  -- node -e 'fetch("http://localhost:8080/api/docs").then(async r => console.log(await r.text()))' | jq
```

```sh
# {
#   "error": "missing_access_token",
#   "message": "Pass an Athenz access token as Authorization: Bearer <token>."
# }
```

API は `401 Unauthorized` を返します。トークンの検証を有効にした一方で、リクエストにアクセストークンがないためです。この失敗は意図した結果です。

![アクセストークンのない文書リクエストを拒否する API](../assets/04_arc_get_docs_from_api_server_unauthorized.svg)

以降もトークンの検証を有効にしたまま進めます。

<a id="learn-whats-next"></a>

<a id="next-steps"></a>

## 次のステップ

API へのアクセスにはアクセストークンが必要になりました。次の章では Athenz を認可サーバー（Authorization Server）としてデプロイします。

次へ：[認可サーバー（Authorization Server）](./05-authorization-server.md)
