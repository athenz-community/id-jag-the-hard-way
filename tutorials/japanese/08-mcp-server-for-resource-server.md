| 前へ | 現在 | 次へ |
|:---:|:---:|:---:|
| [権限の細分化](./07-granular-permission.md) | **リソースサーバー（Resource Server）向け MCP サーバー** | [Codex](./09-ai-agent.md) |

<a id="mcp-server-for-resource-server"></a>

# リソースサーバー（Resource Server）向け MCP サーバー

`idthw-demo-api-mcp` をデプロイし、MCP エンドポイントに接続して文書操作用ツールの一覧を確認します。

<!-- TOC depthFrom:2 depthTo:2 -->

- [MCP ネームスペースを作成する](#create-the-mcp-namespace)
- [MCP サーバーをデプロイする](#deploy-the-mcp-server)
- [ツール一覧を確認する](#discover-the-tools)
- [結果を確認する](#understand-the-result)
- [次のステップ](#next-steps)

<!-- /TOC -->

<a id="create-the-mcp-namespace"></a>

## MCP ネームスペースを作成する

MCP は `mcp` ネームスペースに、リソースサーバーは `api` ネームスペースにデプロイします：

```sh
kubectl create ns mcp
```

```sh
# namespace/mcp created
```

<a id="deploy-the-mcp-server"></a>

## MCP サーバーをデプロイする

既定の設定で MCP サーバーをデプロイします：

```sh
kubectl create deploy mcp -n mcp \
  --image=ghcr.io/mlajkim/idthw-demo-api-mcp:latest
```

```sh
# deployment.apps/mcp created
```

Service のポート `8081` からコンテナのポート `8080` にアクセスできるようにします：

```sh
kubectl expose deploy mcp -n mcp --port 8081 --target-port 8080 --name mcp
```

```sh
# service/mcp exposed
```

MCP サーバーの準備が完了するまで待ちます：

```sh
kubectl rollout status deploy/mcp -n mcp
```

```sh
# deployment "mcp" successfully rolled out
```

ローカルから MCP Service にアクセスできるよう、別のターミナルで `./tools/keep-k8s-port-forward.sh` を実行し続けてください。

<a id="discover-the-tools"></a>

## ツール一覧を確認する

ステートレスな MCP サーバーの初期化レスポンスを確認します：

```sh
_mcp_port=$(./tools/port.sh mcp)
curl -sS "http://localhost:${_mcp_port}/mcp" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"tutorial","version":"1.0"}}}' | jq '.result.serverInfo'
```

```sh
# {
#   "name": "idthw-demo-api-mcp",
#   "title": "IDTHW Demo API MCP",
#   "version": "0.1.0"
# }
```

文書操作用ツールの一覧を取得します：

```sh
_mcp_port=$(./tools/port.sh mcp)
curl -sS "http://localhost:${_mcp_port}/mcp" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | jq '.result.tools[].name'
```

```sh
# "get_k8s_docs"
# "post_k8s_doc"
# "delete_k8s_doc"
```

ツールの検出に認証は必要ありません。ツールが文書を取得するときは、API が有効なトークンを要求します。

<a id="understand-the-result"></a>

## 結果を確認する

MCP サーバーが起動し、初期化に成功しました。ツール一覧には `get_k8s_docs`、`post_k8s_doc`、`delete_k8s_doc` が表示されます。この検出処理にはアクセストークン（Access Token）も Runtime Proxy も必要ありません。

![MCP クライアントがサーバーを初期化し、ツール一覧を取得する流れ](../assets/core_08_mcp_api.svg)

ツール一覧の取得では API を呼び出しません。文書操作用ツールは渡された API アクセストークンでリソースサーバーを呼び出し、リソースサーバーが引き続きトークンを検証します。MCP サーバー自体はトークンを交換しません。

<a id="next-steps"></a>

## 次のステップ

MCP サーバーの準備ができ、ツール一覧を取得できました。次の章では AI クライアントを接続し、ツールを検出できることを確認します。

次へ：[Codex](./09-ai-agent.md)
