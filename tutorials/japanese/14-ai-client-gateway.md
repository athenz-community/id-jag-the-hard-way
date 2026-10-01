| 前へ | 現在 | 次へ |
|:---:|:---:|:---:|
| [信頼する ID プロバイダー（Identity Provider, IdP）](./13-trusted-identity-provider.md) | **AI Client Gateway** | [ID-JAG](./15-id-jag.md) |

<a id="ai-client-gateway--codex"></a>

# AI Client Gateway — Codex

Codex CLI と MCP サービスの間に AI Client Gateway をデプロイします。ゲートウェイはログインしたユーザーの Keycloak ID トークン（ID Token）を使って Athenz アクセストークン（Access Token）を取得します。その後、API にアクセスするための交換は MCP Runtime Proxy が行います。

<!-- TOC depthFrom:2 depthTo:2 -->

- [AI Client Gateway を Kubernetes にデプロイする](#deploy-ai-client-gateway-in-k8s)
- [必要な証明書を作成する](#generate-the-required-certificates)
- [証明書をマウントする](#mount-the-certificates)
- [Keycloak クライアント用 Secret を作成する](#create-the-keycloak-client-secret)
- [ゲートウェイを設定する](#configure-the-gateway)
- [Keycloak からログアウトする](#sign-out-of-keycloak)
- [Codex の MCP 設定を変更する](#update-codex-mcp-config)
- [結果を確認する](#verify)
- [次のステップ](#next-steps)

<!-- /TOC -->

<a id="deploy-ai-client-gateway-in-k8s"></a>

## AI Client Gateway を Kubernetes にデプロイする

ゲートウェイは人が操作するクライアント側のコンポーネントなので、`human` ネームスペースにデプロイします。

`human` ネームスペースを作成します。すでに作成済みならスキップします：

```sh
kubectl create ns human
```

`codex-idjag-learner-ai-client-gateway` という名前でゲートウェイをデプロイします：

```sh
kubectl create deploy codex-idjag-learner-ai-client-gateway -n human \
  --image=ghcr.io/mlajkim/ai-client-gateway:latest
```

```sh
# deployment.apps/codex-idjag-learner-ai-client-gateway created
```

`ai-client-gateway` コンテナのログを確認します：

```sh
kubectl logs deploy/codex-idjag-learner-ai-client-gateway -n human -c ai-client-gateway
```

```sh
# ...
# Error: ENOENT: no such file or directory, open '/app/certs/ai-client-gateway.crt'
# ...
```

ゲートウェイが Athenz ZTS に自身の ID を証明するには X.509 証明書が必要ですが、まだ設定していないためです。

> [!NOTE]
> 結果が `ContainerCreating` なら、コンテナはまだ起動していません。少し待って再実行してください。前回の起動が終了して再起動中なら、上のコマンドに `--previous` を付けて直前のログを確認します。

<a id="generate-the-required-certificates"></a>

## 必要な証明書を作成する

サービス ID を作成し、X.509 証明書を取得します：

```sh
./tools/athenz/create-private-key.sh "./keys/human-idjag-learner-codex"
./tools/athenz/create-subdomain.sh "human" "idjag-learner"
./tools/athenz/create-service.sh "human.idjag-learner" "codex" "./keys/human-idjag-learner-codex.public.key"
./tools/athenz/enable-cert-provider.sh "human.idjag-learner" "codex"
./tools/athenz/fetch-cert.sh "human.idjag-learner" "codex" "./keys/human-idjag-learner-codex.key" "v1"
```

```sh
#   ·  Generating RSA key pair for: ./keys/human-idjag-learner-codex...
#   ✔  Keys generated: ./keys/human-idjag-learner-codex.key, ./keys/human-idjag-learner-codex.public.key
#   ·  Creating Subdomain: human.idjag-learner...
#   ✔  Subdomain created: human.idjag-learner
#   ·  Registering Service: human.idjag-learner.codex...
#   ✔  Service registered: human.idjag-learner.codex
#   ·  Enabling ZTS Certificate Provider for human.idjag-learner.codex...
# [Template(s) successfully applied to domain]
#   ✔  ZTS Certificate Provider enabled for human.idjag-learner.codex
#   ·  Fetching X.509 Certificate for human.idjag-learner.codex...
#   ✔  Certificate saved to: ./keys/human-idjag-learner-codex.crt
```

<a id="mount-the-certificates"></a>

## 証明書をマウントする

証明書、秘密鍵、CA 証明書を Kubernetes Secret に保存します：

```sh
test -f ./keys/human-idjag-learner-codex.crt

kubectl delete -n human secret human-idjag-learner-codex-cert --ignore-not-found=true
kubectl -n human create secret generic human-idjag-learner-codex-cert \
  --from-file=ai-client-gateway.crt=./keys/human-idjag-learner-codex.crt \
  --from-file=ai-client-gateway.key=./keys/human-idjag-learner-codex.key \
  --from-file=ca.crt=./athenz_dist/certs/ca.cert.pem
```

```sh
# secret/human-idjag-learner-codex-cert created
```

ゲートウェイ Pod に Secret をマウントします：

```sh
kubectl patch deploy codex-idjag-learner-ai-client-gateway -n human --patch "$(cat <<'EOF'
spec:
  template:
    spec:
      containers:
        - name: ai-client-gateway
          volumeMounts:
            - name: certs
              mountPath: /app/certs
              readOnly: true
      volumes:
        - name: certs
          secret:
            secretName: human-idjag-learner-codex-cert
EOF
)"
```

```sh
# deployment.apps/codex-idjag-learner-ai-client-gateway patched
```

証明書のマウントを適用した新しい Pod の準備が完了するまで待ちます：

```sh
kubectl rollout status deployment/codex-idjag-learner-ai-client-gateway -n human --timeout=180s
```

```sh
# deployment "codex-idjag-learner-ai-client-gateway" successfully rolled out
```

今度は現在のコンテナのログを確認し、ゲートウェイがエラーなく起動したことを確認します：

```sh
kubectl logs deploy/codex-idjag-learner-ai-client-gateway -n human -c ai-client-gateway
```

```sh
# 🚀 OpenWebUI OpenAPI Gateway listening on 0.0.0.0:3101
# 🔗 Upstream API: http://mcp.mcp:8081
# 🌍 Public Base URL: http://localhost:44444
# 🔑 Athenz ZTS Endpoint: https://athenz-zts-server.athenz:4443/zts/v1
```

<a id="deploy-the-human-gateway"></a>

<a id="create-the-keycloak-client-secret"></a>

## Keycloak クライアント用 Secret を作成する

OAuth2 ログインの流れに必要な Keycloak の認証情報をゲートウェイに設定します。

Keycloak クライアントの認証情報で Kubernetes Secret を作成します：

```sh
./tools/keycloak/create-client-k8s-secret.sh \
  "human.idjag-learner.codex" \
  "human" \
  "human-idjag-learner-codex-keycloak"
```

```sh
#   ·  Fetching Keycloak admin token...
#   ·  Looking up UUID for client human.idjag-learner.codex...
#   ·  Fetching client secret...
#   ·  Creating K8s secret human/human-idjag-learner-codex-keycloak...
# secret/human-idjag-learner-codex-keycloak created
#   ✔  Secret created: human/human-idjag-learner-codex-keycloak
```

ゲートウェイが登録済み OAuth2 クライアントとして Keycloak に認証できるよう、`KEYCLOAK_CLIENT_ID` と `KEYCLOAK_CLIENT_SECRET` を設定します。作成した `human-idjag-learner-codex-keycloak` Secret の `client-id` と `client-secret` キーを参照させます：

```sh
kubectl patch deploy codex-idjag-learner-ai-client-gateway -n human --type=strategic --patch "$(cat <<'EOF'
spec:
  template:
    spec:
      containers:
        - name: ai-client-gateway
          env:
            - name: KEYCLOAK_CLIENT_ID
              valueFrom:
                secretKeyRef:
                  name: human-idjag-learner-codex-keycloak
                  key: client-id
            - name: KEYCLOAK_CLIENT_SECRET
              valueFrom:
                secretKeyRef:
                  name: human-idjag-learner-codex-keycloak
                  key: client-secret
EOF
)"
```

```sh
# deployment.apps/codex-idjag-learner-ai-client-gateway patched
```

<a id="set-env-vars-for-the-gateway"></a>

<a id="configure-the-gateway"></a>

## ゲートウェイを設定する

ゲートウェイに必要な情報を接続先ごとに設定します。各コマンドは指定した変数だけを変更するため、それまでの設定値は維持されます。

### 1. MCP サーバーのアドレスを設定する

まず、ゲートウェイがリクエストを転送する MCP サーバーのアドレスを指定します。`UPSTREAM_BASE_URL` には、先ほどデプロイした MCP Service のクラスター内アドレスを設定します：

```sh
kubectl set env deployment/codex-idjag-learner-ai-client-gateway -n human \
  --containers=ai-client-gateway \
  UPSTREAM_BASE_URL=http://mcp.mcp:8081
```

```sh
# deployment.apps/codex-idjag-learner-ai-client-gateway env updated
```

### 2. Athenz のトークン発行先を設定する

MCP リクエストに使うアクセストークン（Access Token）の発行先を指定します。`ZTS_URL` は ID トークン → ID-JAG → アクセストークンの交換を要求する Athenz ZTS のアドレスです。`ATHENZ_ACCESS_TOKEN_AUDIENCE=mcp` は取得するアクセストークンの受信先を指定します。ID-JAG の audience には ZTS URL を使います：

```sh
kubectl set env deployment/codex-idjag-learner-ai-client-gateway -n human \
  --containers=ai-client-gateway \
  ZTS_URL=https://athenz-zts-server.athenz:4443/zts/v1 \
  ATHENZ_ACCESS_TOKEN_AUDIENCE=mcp
```

```sh
# deployment.apps/codex-idjag-learner-ai-client-gateway env updated
```

### 3. Keycloak のログインサーバーに接続する

ユーザーのログイン後、ゲートウェイは Keycloak から受け取った認可コードをトークンに交換します。このサーバー間リクエストに使うアドレスを `KEYCLOAK_URL`、先ほどクライアントを登録した realm を `KEYCLOAK_REALM` に指定します：

```sh
kubectl set env deployment/codex-idjag-learner-ai-client-gateway -n human \
  --containers=ai-client-gateway \
  KEYCLOAK_URL=http://keycloak.idp:8080 \
  KEYCLOAK_REALM=master
```

```sh
# deployment.apps/codex-idjag-learner-ai-client-gateway env updated
```

### 4. ブラウザーからアクセスするアドレスを設定する

次にブラウザーがアクセスするポート転送先のアドレスを設定します。`KEYCLOAK_PUBLIC_URL` はログイン画面に移動する Keycloak のアドレス、`PUBLIC_BASE_URL` はログイン後に `/oauth/callback` へ戻るゲートウェイのアドレスです。AI クライアントもこのゲートウェイのアドレスに接続します：

```sh
_gateway_port=$(./tools/port.sh ai-client-gateway-codex)
_keycloak_port=$(./tools/port.sh keycloak)

kubectl set env deployment/codex-idjag-learner-ai-client-gateway -n human \
  --containers=ai-client-gateway \
  PUBLIC_BASE_URL="http://localhost:${_gateway_port}" \
  KEYCLOAK_PUBLIC_URL="http://localhost:${_keycloak_port}"
```

```sh
# deployment.apps/codex-idjag-learner-ai-client-gateway env updated
```

### 5. Service を公開して動作を確認する

Deployment を Service として公開します：

```sh
kubectl delete -n human svc ai-client-gateway-codex --ignore-not-found=true
kubectl expose deploy codex-idjag-learner-ai-client-gateway -n human --port 3101 --name ai-client-gateway-codex
```

```sh
# service/ai-client-gateway-codex exposed
```

ゲートウェイ設定を反映するロールアウトが終わるまで待ちます：

```sh
kubectl rollout status deployment/codex-idjag-learner-ai-client-gateway -n human --timeout=180s
```

```sh
# deployment "codex-idjag-learner-ai-client-gateway" successfully rolled out
```

現在のコンテナの起動ログを確認します：

```sh
kubectl logs deploy/codex-idjag-learner-ai-client-gateway -n human -c ai-client-gateway --tail=5
```

```sh
# 🚀 OpenWebUI OpenAPI Gateway listening on 0.0.0.0:3101
# 🔗 Upstream API: http://mcp.mcp:8081
# 🌍 Public Base URL: http://localhost:44444
# 🔑 Athenz ZTS Endpoint: https://athenz-zts-server.athenz:4443/zts/v1
```

<a id="verification-prerequisite"></a>

<a id="sign-out-of-keycloak"></a>

## Keycloak からログアウトする

新しいセッションで確認できるよう、まず Keycloak からログアウトします：

```sh
_keycloak_port=$(./tools/port.sh keycloak)
./tools/open.sh "http://localhost:${_keycloak_port}/realms/master/protocol/openid-connect/logout"
```

Keycloak に **"Do you want to log out?"** と表示されたら **Logout** をクリックします。

<a id="update-codex-mcp-config"></a>

## Codex の MCP 設定を変更する

`.codex/config.toml` を次の内容に変更し、示された設定を追記して Codex をゲートウェイに接続します。ここからはゲートウェイが ID-JAG の一連の処理を担うため、アクセストークンを事前に取得して `Authorization` ヘッダーへ直接設定する必要はありません：

```sh
_gateway_port=$(./tools/port.sh ai-client-gateway-codex)

cat > .codex/config.toml <<EOF
[mcp_servers.id-jag-the-hard-way-mcp]
enabled = true
url = "http://localhost:${_gateway_port}/mcp"
auth = "oauth"
EOF

cat .codex/settings.toml >> .codex/config.toml
```

> [!NOTE]
> `Authorization` ヘッダーや事前取得したアクセストークンを設定していないことを確認してください。ゲートウェイがユーザーに代わって ID-JAG の一連の処理を担います。

<a id="verify"></a>

## 結果を確認する

ログインする前に、現在の Codex セッションを終了します：

```sh
/quit
```

プロジェクトのディレクトリで、ターミナルから MCP ログインコマンドを実行します：

```sh
codex mcp login id-jag-the-hard-way-mcp
```

```sh
# Authorize `id-jag-the-hard-way-mcp` by opening this URL in your browser:
# http://localhost:44444/oauth/authorize?...
```

表示された URL をブラウザーで開き、次のアカウントでログインします：

- ユーザー名：`idjag-learner`
- パスワード：`password`

ログインが完了すると、ターミナルに次のように表示されます：

```sh
# Successfully logged in to MCP server 'id-jag-the-hard-way-mcp'.
```

ログイン後、同じプロジェクトのディレクトリで Codex を再起動し、変更した設定とログイン情報を読み込みます：

```sh
codex
```

Codex 内で MCP の接続状態を確認します：

```sh
/mcp
```

```sh
# 🔌  MCP Tools

#   • id-jag-the-hard-way-mcp: failed (0 tools)
```

ログインには成功しますが、MCP の接続状態は `failed (0 tools)` と表示されます。この段階では予想どおりです。ゲートウェイはログインしたユーザーの Keycloak ID トークンを Athenz ZTS で交換しようとしますが、`human.idjag-learner.codex` に要求した MCP ロールの `zts.jag_exchange` 権限がまだないため、Athenz は交換を拒否します。

別のターミナルで AI Client Gateway の直近 8 行のログを確認し、交換リクエストがどこで失敗したか調べます：

```sh
kubectl logs deploy/codex-idjag-learner-ai-client-gateway -n human -c ai-client-gateway --tail=8
```

出力例：

```sh
# [Athenz ID-JAG] 🔑 Resolved ID token from bearer session (Claude Code path)
# [Athenz ID-JAG] 🔄 Attempting to exchange new ID-JAG with id-token for scope [mcp:role.mcp-accessor] ...
# [Athenz ID-JAG] 🎯 Target ZTS for ID-JAG: https://athenz-zts-server.athenz:4443/zts/v1/oauth2/token
# [2026-09-26T10:45:04.305Z] Proxy request failed: Error: Athenz ZTS Error: HTTP 403 - {"code":403,"message":"Principal not authorized for token exchange for the requested role"}
#     at IncomingMessage.<anonymous> (file:///app/src/utils/idtokenIntoIdjag.js:63:18)
#     at IncomingMessage.emit (node:events:531:35)
#     at endReadableNT (node:internal/streams/readable:1698:12)
#     at process.processTicksAndRejections (node:internal/process/task_queues:89:21)
```

ログを順に読むと、リクエストがどこまで進んだかわかります：

- `Resolved ID token from bearer session`：ゲートウェイがセッションからログインしたユーザーの ID トークンを見つけました。`(Claude Code path)` は Codex でも使う共通の Bearer セッション処理経路を示すログ文言です
- `scope [mcp:role.mcp-accessor]`：ゲートウェイが ZTS の `/oauth2/token` エンドポイントに、MCP ロール用の ID-JAG を要求しました
- `HTTP 403` と `Principal not authorized for token exchange for the requested role`：ZTS がゲートウェイの交換リクエストを拒否しました。ユーザーがロールのメンバーであることとは別に、ゲートウェイにもそのロールに対する `zts.jag_exchange` 権限が必要です

<a id="whats-next"></a>

<a id="next-steps"></a>

## 次のステップ

ログインは成功しましたが、Athenz はゲートウェイの ID-JAG リクエストを拒否しました。次の章ではゲートウェイに必要な交換権限を付与し、文書リクエストを再試行します。

次へ：[ID-JAG](./15-id-jag.md)
