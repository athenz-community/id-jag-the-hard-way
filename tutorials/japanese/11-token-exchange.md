| 前へ | 現在 | 次へ |
|:---:|:---:|:---:|
| [MCP サーバーの保護](./10-protect-mcp-server.md) | **トークン交換（Token Exchange）** | [ID プロバイダー（Identity Provider, IdP）](./12-identity-provider.md) |

<a id="token-exchange--codex"></a>

# トークン交換（Token Exchange）— Codex

前の章では Runtime Proxy が演習用 ID の MCP トークンを受け付けましたが、文書の取得は引き続き `502 downstream_token_exchange_unavailable` で失敗しました。

この章では Runtime Proxy のサービス ID（Service Identity）を作成し、トークン交換とトークンファイルの共有を設定します。必要な Athenz 権限を付与した後、Codex から文書を取得します。

<!-- TOC depthFrom:2 depthTo:2 -->

- [残っているエラーの原因を確認する](#understand-the-remaining-error)
- [トークン交換の流れを理解する](#how-token-exchange-works)
- [MCP サービス ID を作成する](#create-the-mcp-service-identity)
- [Kubernetes Secret を作成する](#create-a-kubernetes-secret)
- [下流トークン交換を設定する](#configure-downstream-token-exchange)
- [演習用 ID のトークンを更新する](#refresh-the-learner-token)
- [Codex に MCP トークンを設定する](#update-codex-with-the-mcp-token)
- [トークン交換が拒否されることを確認する](#verify-token-exchange-is-denied)
- [下流への交換権限を付与する](#authorize-the-downstream-exchange)
- [文書を取得できるか確認する](#verify-document-retrieval)
- [次のステップ](#next-steps)

<!-- /TOC -->

<a id="understand-the-remaining-error"></a>

## 残っているエラーの原因を確認する

演習用 ID の MCP トークンと API スコープ（Scope）は検証を通過します。ただし、Runtime Proxy が Athenz にトークン交換を要求するには、自身のサービス ID で認証する必要があります。サービス証明書はまだマウントしていないため、ツールのリクエストは HTTP `502` を返します：

```json
{
  "error": "downstream_token_exchange_unavailable",
  "message": "Token exchange failed: the required MCP service certificate could not be read. Check ATHENZ_TOKEN_EXCHANGE_CERT_PATH."
}
```

プロキシのログを確認します：

```sh
kubectl logs deploy/mcp -n mcp -c auth-proxy --tail=3
```

次の項目を探します：

```sh
# 2026-XX-XXT07:05:21.312Z × ERROR [mcp-runtime-proxy] [exchange] downstream token exchange failed | requestId=eb1c16b4-6ec0-445f-905d-7baa32cb4952 method=POST path=/mcp code=downstream_token_exchange_unavailable durationMs=3 message="Token exchange failed: the required MCP service certificate could not be read. Check ATHENZ_TOKEN_EXCHANGE_CERT_PATH." status=502 reason=service_certificate_unavailable credentialPath=/var/run/athenz/service.cert.pem fileErrorCode=ENOENT athenzRequestSent=false
```

`reason=service_certificate_unavailable` が失敗の原因です。`credentialPath` は必要なファイルのパス、`fileErrorCode=ENOENT` はファイルが存在しないことを示します。プロキシはサービスの認証情報を読む前に、演習用 ID のスコープを確認します。

`athenzRequestSent=false` は交換リクエストが Athenz に届かなかったことを示します。そのため Athenz はまだプロキシの交換権限を確認しておらず、MCP ツールと API も呼び出されていません。

<a id="how-token-exchange-works"></a>

## トークン交換の流れを理解する

Codex は受信先（audience）が `mcp` の、演習用 ID のアクセストークン（Access Token）を送ります。Runtime Proxy は最初にトークンを検証し、MCP へのアクセス権限とツールに必要な API スコープを確認します。その後、サービス証明書と秘密鍵を読み、`mcp.idthw-api-mcp` として Athenz ZTS に認証します。演習用 ID のトークンを提示し、audience が `api`、スコープが `api:role.docs-getter` の新しいトークンを要求します。ツールに設定されたスコープに基づき、この交換が自動的に実行されます。

Athenz は、そのサービスが `mcp` audience のトークンを API の `docs-getter` ロールに交換できるか確認します。交換が成功すると、Runtime Proxy は API トークンをリクエストごとのファイルに書き、ファイルパスを MCP サーバーに渡します。MCP サーバーはこのトークンで API を呼び出します。リクエストが終わると、プロキシがファイルを削除します。

![Runtime Proxy が演習用 ID の MCP トークンを API トークンに交換し、MCP が API を呼び出す流れ](../assets/core_11_exchange_allowed.svg)

<a id="create-the-mcp-service-identity"></a>

## MCP サービス ID を作成する

Runtime Proxy が Athenz ZTS にトークン交換を要求するときに使うサービス ID を作成します。前の章で作成した `mcp` ドメインに `idthw-api-mcp` を登録します。プリンシパル（Principal）は `mcp.idthw-api-mcp` で、秘密鍵は Runtime Proxy だけにマウントします。

ID と証明書の作成用スクリプトで、MCP サービス ID `mcp.idthw-api-mcp` を作成します：

```sh
./tools/athenz/create-private-key.sh "./keys/api-mcp"
./tools/athenz/create-service.sh "mcp" "idthw-api-mcp" "./keys/api-mcp.public.key"
./tools/athenz/enable-cert-provider.sh "mcp" "idthw-api-mcp"
./tools/athenz/fetch-cert.sh "mcp" "idthw-api-mcp" "./keys/api-mcp.key" "v1"
```

```sh
#   ·  Generating RSA key pair for: ./keys/api-mcp...
#   ✔  Keys generated: ./keys/api-mcp.key, ./keys/api-mcp.public.key
#   ·  Registering Service: mcp.idthw-api-mcp...
#   ✔  Service registered: mcp.idthw-api-mcp
#   ·  Enabling ZTS Certificate Provider for mcp.idthw-api-mcp...
# [Template(s) successfully applied to domain]
#   ✔  ZTS Certificate Provider enabled for mcp.idthw-api-mcp
#   ·  Fetching X.509 Certificate for mcp.idthw-api-mcp...
#   ✔  Certificate saved to: ./keys/api-mcp.crt
```

<a id="create-k8s-secret"></a>

<a id="create-a-kubernetes-secret"></a>

## Kubernetes Secret を作成する

サービス証明書と秘密鍵を `mcp` ネームスペースに保存します。この Secret は Runtime Proxy だけにマウントします。CA は前の章でマウントした別の CA Secret に残します：

```sh
kubectl -n mcp create secret generic api-mcp-cert \
  --from-file=api-mcp.crt=./keys/api-mcp.crt \
  --from-file=api-mcp.key=./keys/api-mcp.key \
  --dry-run=client -o yaml | kubectl apply -f -
```

```sh
# secret/api-mcp-cert created
```

<a id="configure-downstream-token-exchange"></a>

## 下流トークン交換を設定する

<a id="mount-the-service-identity"></a>

### サービス ID をマウントする

CA 証明書とは別に、サービス ID を Runtime Proxy にマウントします：

```sh
kubectl patch deploy mcp -n mcp --patch "$(cat <<'EOF'
spec:
  template:
    spec:
      containers:
        - name: auth-proxy
          volumeMounts:
            - name: mcp-identity
              mountPath: /var/run/athenz-identity
              readOnly: true
      volumes:
        - name: mcp-identity
          secret:
            secretName: api-mcp-cert
EOF
)"
```

```sh
# deployment.apps/mcp patched
```

<a id="share-the-api-token-directory"></a>

### API トークン用ディレクトリを共有する

交換した API トークンを保存するため、プロキシにメモリベースのディレクトリを用意します。MCP コンテナには同じディレクトリを読み取り専用でマウントします。`fsGroup: 1000` によって MCP プロセスが共有ファイルを読めるようにします。

次の図に、交換に成功した後、二つのコンテナが同じファイルを使う方法を示します：

![MCP Pod 内で Runtime Proxy が共有メモリに API トークンを書き、MCP にファイルパスを渡し、MCP が読み取り専用マウントから読む流れ](../assets/core_10_shared_api_token_directory.svg)

```sh
kubectl patch deploy mcp -n mcp --patch "$(cat <<'EOF'
spec:
  template:
    spec:
      securityContext:
        fsGroup: 1000
      containers:
        - name: auth-proxy
          volumeMounts:
            - name: access-tokens
              mountPath: /var/run/idthw-access-tokens
        - name: idthw-demo-api-mcp
          volumeMounts:
            - name: access-tokens
              mountPath: /var/run/idthw-access-tokens
              readOnly: true
      volumes:
        - name: access-tokens
          emptyDir:
            medium: Memory
EOF
)"
```

```sh
# deployment.apps/mcp patched
```

<a id="configure-the-service-credential-paths"></a>

### サービスの認証情報のパスを設定する

Runtime Proxy が、マウントしたサービス証明書と秘密鍵を使えるようにパスを設定します。前の章で指定した `MCP_TOOL_SCOPES` の対応に従い、演習用 ID のスコープ検証が通ると交換が実行されます。

```sh
kubectl set env deploy/mcp -n mcp --containers=auth-proxy \
  ATHENZ_TOKEN_EXCHANGE_CERT_PATH=/var/run/athenz-identity/api-mcp.crt \
  ATHENZ_TOKEN_EXCHANGE_KEY_PATH=/var/run/athenz-identity/api-mcp.key
```

```sh
# deployment.apps/mcp env updated
```

ツールを呼ぶたびに、プロキシは交換したトークンをリクエストごとのファイルに書き、パスを MCP に渡します。MCP サーバーはこのトークンで API を呼び、レスポンスが終わるとプロキシがファイルを削除します。Athenz にはまだ交換を許可していないため、後で拒否されることを確認します。

変更後の Pod の準備が完了するまで待ちます：

```sh
kubectl rollout status deploy/mcp -n mcp
```

```sh
# deployment "mcp" successfully rolled out
```

ローカル接続が変更後の Pod に向くよう `./tools/keep-k8s-port-forward.sh` を再起動します。

<a id="refresh-the-learner-token"></a>

## 演習用 ID のトークンを更新する

前の章と同じ audience と二つのスコープで、演習用 ID の新しいトークンを取得します：

```sh
_scope="mcp:role.mcp-accessor api:role.docs-getter"
_my_access_token=$(./tools/athenz/fetch-access-token.sh \
  "./keys/idjag-learner.crt" \
  "./keys/idjag-learner.key" \
  "${_scope}" \
  "./keys/idjag-learner.jwt" \
  --audience mcp)
```

デコードした出力には `aud=mcp` が表示され、`scp` には `mcp-accessor` と `api:role.docs-getter` の両方が含まれるはずです。Runtime Proxy はツールの呼び出し中に別の API アクセストークンを取得します。

<a id="update-the-client"></a>

<a id="update-codex-with-the-mcp-token"></a>

## Codex に MCP トークンを設定する

`_my_access_token` を取得したシェルで、チュートリアルの `.codex/config.toml` を更新します。ほかの設定を追加している場合はファイル全体を置き換えず、対象サーバーの `http_headers` 項目だけを修正してください：

```sh
_mcp_port=$(./tools/port.sh mcp)

cat > .codex/config.toml <<EOF
[mcp_servers.id-jag-the-hard-way-mcp]
url = "http://localhost:${_mcp_port}/mcp"
http_headers = { Authorization = "Bearer ${_my_access_token}" }
EOF
cat .codex/settings.toml >> .codex/config.toml
```

現在の Codex セッションを終了します：

```sh
/quit
```

プロジェクトのディレクトリで Codex を再起動し、会話を続けて新しいトークンを読み込みます：

```sh
codex resume --last
```

<a id="verify-token-exchange-is-denied"></a>

## トークン交換が拒否されることを確認する

Codex に再び文書の取得を依頼します：

```sh
Get docs with id-jag-the-hard-way-mcp
```

Runtime Proxy は交換失敗に対して `insufficient_scope` 認証チャレンジを返すため、Codex に **Insufficient scope** と表示される場合があります。プロキシのログでも失敗の原因を確認できます：

```sh
kubectl logs deploy/mcp -n mcp -c auth-proxy --tail=3
```

出力例：

```sh
# 2026-09-23T04:44:42.137Z → INFO  [mcp-runtime-proxy] [request] request received | requestId=7dd7e8b3-f274-4708-90a0-3dd28c48e2a3 method=POST path=/mcp accessTokenPresent=true
# 2026-09-23T04:44:42.158Z ✓ INFO  [mcp-runtime-proxy] [auth] access token verified | requestId=7dd7e8b3-f274-4708-90a0-3dd28c48e2a3 method=POST path=/mcp audiences=["mcp"] clientId=human.idjag-learner expiresAt=2026-09-23T05:42:36.000Z expiresInSeconds=3474 keyId=athenz-zts-server-5fcdbc67f4-lwctf scopes=["api:role.docs-getter","mcp-accessor"] subject=human.idjag-learner userId=human.idjag-learner
# 2026-09-23T04:44:42.190Z ! WARN  [mcp-runtime-proxy] [exchange] downstream token exchange failed | requestId=7dd7e8b3-f274-4708-90a0-3dd28c48e2a3 method=POST path=/mcp code=downstream_token_exchange_denied durationMs=53 message="Athenz denied the downstream token exchange." status=403
```

同じ `requestId` で「access token verified」に続き、`code=downstream_token_exchange_denied`、`status=403` の「downstream token exchange failed」が現れることを確認します。変更後のプロキシは `reason=athenz_error_response`、`athenzRequestSent=true`、Athenz の応答ステータス `athenzStatus` も記録します。これでプロキシはサービスの認証情報を読み、Athenz にアクセスできていますが、サービス ID にはまだ交換権限がありません。

代わりに `reason=service_certificate_unavailable` または `reason=service_private_key_unavailable` が表示された場合は、上の Secret のマウントと認証情報のパスを確認してください。`athenzRequestSent=false` は、Athenz による交換権限の確認前にリクエストが止まったことを示します。

![MCP へのアクセスは許可されるが、Athenz が Runtime Proxy の下流トークン交換を拒否する流れ](../assets/core_10_exchange_denied.svg)

<a id="authorize-the-downstream-exchange"></a>

## 下流への交換権限を付与する

演習用 ID はすでに `mcp:role.mcp-accessor` と `api:role.docs-getter` の両方を持っています。次にプロキシのサービス ID に交換権限を付与します。Athenz は送信元の `mcp` ドメインと、宛先の `api` ドメインの両方で権限を要求します。

<a id="allow-exchange-from-mcp-to-api"></a>

### MCP から API への交換を許可する

`mcp` に交換用ロールを作成し、宛先 `api` に対する `zts.token_source_exchange` を許可してから、`mcp.idthw-api-mcp` をロールに追加します：

```sh
./tools/athenz/create-role.sh "mcp" "to-api-exchanger"
./tools/athenz/add-policy.sh "mcp" "to-api-exchanger" "zts.token_source_exchange" "api"
./tools/athenz/add-role-member.sh "mcp" "to-api-exchanger" "mcp.idthw-api-mcp"
```

初回実行時の出力例：

```sh
#   ·  Creating Role: mcp:role.to-api-exchanger...
#   ✔  Role created: mcp:role.to-api-exchanger
#   ·  Creating Policy: mcp:policy.to-api-exchanger_zts_token_source_exchange_api...
#   ✔  Policy created: mcp:policy.to-api-exchanger_zts_token_source_exchange_api
#   ·  Adding Member mcp.idthw-api-mcp to Role: mcp:role.to-api-exchanger...
#   ✔  mcp.idthw-api-mcp  →  mcp:role.to-api-exchanger
```

ポリシーのリソースは `mcp:api` です。`mcp` ドメインが、このサービスに MCP 用アクセストークンを `api` ドメインへ交換する権限を与えます。

<a id="allow-exchange-into-the-api-role"></a>

### API ロールへの交換を許可する

`api` に交換用ロールを作成し、`mcp` から `docs-getter` への `zts.token_target_exchange` を許可してから、同じサービス ID を追加します：

```sh
./tools/athenz/create-role.sh "api" "docs-getter-exchanger"
./tools/athenz/add-policy.sh "api" "docs-getter-exchanger" "zts.token_target_exchange" "mcp:role.docs-getter"
./tools/athenz/add-role-member.sh "api" "docs-getter-exchanger" "mcp.idthw-api-mcp"
```

初回実行時の出力例：

```sh
#   ·  Creating Role: api:role.docs-getter-exchanger...
#   ✔  Role created: api:role.docs-getter-exchanger
#   ·  Creating Policy: api:policy.docs-getter-exchanger_zts_token_target_exchange_mcp_role_docs-getter...
#   ✔  Policy created: api:policy.docs-getter-exchanger_zts_token_target_exchange_mcp_role_docs-getter
#   ·  Adding Member mcp.idthw-api-mcp to Role: api:role.docs-getter-exchanger...
#   ✔  mcp.idthw-api-mcp  →  api:role.docs-getter-exchanger
```

ポリシーのリソースは `api:mcp:role.docs-getter` です。`api` ドメインが、このサービスに `mcp` のトークンを自分の `docs-getter` ロールへ交換する権限を与えます。文書へのアクセス権限は演習用 ID のスコープに由来し、サービスに追加したロールは交換そのものを許可します。

<a id="verify-document-retrieval"></a>

## 文書を取得できるか確認する

**Insufficient scope** が表示されたリクエストを Codex で再試行します：

```sh
Get docs with id-jag-the-hard-way-mcp
```

これで Codex が文書を取得できるはずです。チュートリアルの既定の文書を使っている場合、ツールの構造化レスポンスには次の内容が含まれます：

```json
{
  "status": 200,
  "ok": true,
  "data": {
    "docs": [
      { "id": 1, "name": "first default doc", "content": "hello world" },
      { "id": 2, "name": "second default doc", "content": "how are you?" }
    ]
  }
}
```

プロキシのログを確認します：

```sh
kubectl logs deploy/mcp -n mcp -c auth-proxy --tail=5
```

同じ `requestId` で次のイベントを探します：

- `access token verified` — 演習用 ID の MCP トークンの検証に成功
- `downstream access token published` — 交換に成功し、API トークンファイルの準備が完了
- `upstreamStatus=200` の `request completed` — MCP サーバーがレスポンスを返す
- `downstream access token removed` — プロキシがそのリクエストのトークンファイルを削除

ポリシーの変更直後も `downstream_token_exchange_denied` が記録される場合は、Athenz のポリシーキャッシュが更新されるまで待ち、Codex で同じリクエストを再試行してください。

<a id="next-steps"></a>

## 次のステップ

これで Codex が保護された MCP サービスを通じて文書を取得できます。Runtime Proxy は演習用 ID の MCP トークンを、リクエストごとに必要な API トークンに交換します。

次の章ではユーザーがログインして ID トークンを受け取れるよう、Keycloak をデプロイします。

次へ：[ID プロバイダー（Identity Provider, IdP）](./12-identity-provider.md)
