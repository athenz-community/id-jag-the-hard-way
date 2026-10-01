| 前へ | 現在 | 次へ |
|:---:|:---:|:---:|
| [Codex](./09-ai-agent.md) | **MCP サーバーの保護** | [トークン交換（Token Exchange）](./11-token-exchange.md) |

<a id="protect-mcp-server--codex"></a>

# MCP サーバーの保護 — Codex

前の章では AI クライアントが Athenz アクセストークン（Access Token, AT）を使って文書を取得しました。API サーバーと同様に、MCP サーバーも AT で保護します。

[MCP 認可仕様](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#access-token-privilege-restriction)には次のように記されています（訳）：

> *MCP サーバーが上流の API にリクエストを送る場合、その API の OAuth クライアントとして動作できます。上流 API で使うアクセストークンは、上流の認可サーバー（Authorization Server）が発行した別のトークンです。MCP サーバーは MCP クライアントから受け取ったトークンをそのまま転送しては**なりません（MUST NOT）**。*

この章では MCP サーバーの前段に `MCP Runtime Proxy` を認可プロキシ（Authorization Proxy）としてデプロイします。ツールの呼び出しには、受信先（audience）が `mcp` で、スコープ（Scope）が `mcp:role.mcp-accessor` の AT を要求します。以前使った API トークンが拒否されることを確認してから、演習用 ID に MCP へのアクセス権限を付与します。

<!-- TOC depthFrom:2 depthTo:2 -->

- [MCP Runtime Proxy を認可プロキシとしてデプロイする](#deploy-mcp-runtime-proxy-as-an-authorization-proxy)
- [MCP へのアクセスが拒否されることを確認する](#verify-mcp-access-is-rejected)
- [演習用 ID に MCP へのアクセス権限を付与する](#grant-the-learner-mcp-access)
- [Codex に MCP トークンを設定する](#update-codex-with-the-mcp-token)
- [MCP へのアクセスが許可されることを確認する](#verify-mcp-access-is-accepted)
- [次のステップ](#next-steps)

<!-- /TOC -->

<a id="deploy-mcp-runtime-proxy-as-an-authorization-proxy"></a>

## MCP Runtime Proxy を認可プロキシとしてデプロイする

プロキシはツールの呼び出しを MCP サーバーに渡す前に、Athenz アクセストークンを検証します。

<a id="attach-the-proxy"></a>

### プロキシを追加する

MCP Pod の二つ目のコンテナとして Runtime Proxy を追加します。必要な audience と MCP スコープを設定し、`MCP_TOOL_SCOPES` にはツールごとに必要な API 権限を指定します。Athenz ドメインと演習用 ID のロールは後で作成します。

```sh
kubectl patch deploy mcp -n mcp --patch "$(cat <<'EOF'
spec:
  template:
    spec:
      containers:
        - name: auth-proxy
          image: ghcr.io/mlajkim/mcp-runtime-proxy:latest
          imagePullPolicy: Always
          env:
            - name: ATHENZ_EXPECTED_AUDIENCE
              value: "mcp"
            - name: ATHENZ_REQUIRED_SCOPE
              value: "mcp:role.mcp-accessor"
            - name: MCP_PUBLIC_OPENAPI_ENABLED
              value: "true"
            - name: MCP_TOOL_SCOPES
              value: '{"get_k8s_docs":"api:role.docs-getter","post_k8s_doc":"api:role.docs-poster","delete_k8s_doc":"api:role.docs-deleter"}'
          ports:
            - containerPort: 8082
          readinessProbe:
            httpGet:
              path: /readyz
              port: 8082
          livenessProbe:
            httpGet:
              path: /healthz
              port: 8082
EOF
)"
```

```sh
# deployment.apps/mcp patched
```

二つのコンテナは Pod のネットワークを共有します。Runtime Proxy はポート `8082` でリクエストを受け、既定のループバックアドレス `http://127.0.0.1:8080` で MCP アプリケーションにアクセスします。

プロキシは起動時に `/var/run/athenz/ca.crt` を読みます。次の手順で CA をマウントするまでは、コンテナが終了と再起動を繰り返します。CA のマウント後に準備状態を確認してください。

<a id="create-and-attach-the-ca-secret"></a>

### CA Secret を作成して接続する

既存の Athenz CA 証明書を含む Secret を作成します。Runtime Proxy はアクセストークンの検証に必要な署名鍵を取得するとき、この CA を使って ZTS を信頼します：

```sh
kubectl -n mcp create secret generic mcp-runtime-proxy-athenz-ca \
  --from-file=ca.crt=./athenz_dist/certs/ca.cert.pem \
  --dry-run=client -o yaml | kubectl apply -f -
```

```sh
# secret/mcp-runtime-proxy-athenz-ca created
```

Runtime Proxy に CA Secret をマウントします：

```sh
kubectl patch deploy mcp -n mcp --patch "$(cat <<'EOF'
spec:
  template:
    spec:
      containers:
        - name: auth-proxy
          volumeMounts:
            - name: athenz-ca-secret
              mountPath: /var/run/athenz
              readOnly: true
      volumes:
        - name: athenz-ca-secret
          secret:
            secretName: mcp-runtime-proxy-athenz-ca
EOF
)"
```

```sh
# deployment.apps/mcp patched
```

これでプロキシを起動できます。readiness probe は MCP の初期化を確認します。ツール一覧と OpenAPI 仕様の取得には、引き続き認証は必要ありません。

<a id="route-requests-through-the-proxy"></a>

### リクエストをプロキシに転送する

両方のコンテナの準備が完了するまで待ちます：

```sh
kubectl rollout status deploy/mcp -n mcp
```

```sh
# deployment "mcp" successfully rolled out
```

Service の外部ポート `8081` はそのままにして、Runtime Proxy のポート `8082` にリクエストを転送するよう変更します：

```sh
kubectl patch svc mcp -n mcp --patch '{"spec":{"ports":[{"port":8081,"targetPort":8082}]}}'
```

```sh
# service/mcp patched
```

変更後、ローカル接続がプロキシに向くよう `./tools/keep-k8s-port-forward.sh` を再起動します。

<a id="verify-mcp-access-is-rejected"></a>

## MCP へのアクセスが拒否されることを確認する

変更後の接続を確認する前に、現在の Codex セッションを終了します：

```sh
/quit
```

プロジェクトのディレクトリで Codex を再起動し、会話を続けてプロキシ経由で接続し直します：

```sh
codex resume --last
```

前の章の設定のまま、Codex に再び文書の取得を依頼します：

```sh
Get docs with id-jag-the-hard-way-mcp
```

Codex に **Authentication required** と表示されるはずです：

![get_k8s_docs が拒否され Authentication required と表示する Codex](../codex/assets/10_codex_get_k8s_docs_authentication_required.png)

Codex は接続してツール一覧を取得できますが、Runtime Proxy はツールの呼び出しを拒否します。前の章のトークンの受信先（audience）は `api` で、プロキシが要求するのは `mcp` だからです。期限内の API トークンもここで拒否されます。次は audience が `mcp` のトークンを取得します。

プロキシのログで、Codex に認証メッセージが表示された理由を確認します：

```sh
kubectl logs deploy/mcp -n mcp -c auth-proxy --tail=2
```

期限内の API アクセストークンを送った場合の、変更後のプロキシの出力例です：

```sh
# 2026-XX-XXT03:20:11.552Z → INFO  [mcp-runtime-proxy] [request] request received | requestId=434926ee-eba7-4770-aca3-6a292410b19c method=POST path=/mcp accessTokenPresent=true
# 2026-XX-XXT03:20:11.583Z ! WARN  [mcp-runtime-proxy] [auth] access denied | requestId=434926ee-eba7-4770-aca3-6a292410b19c method=POST path=/mcp accessTokenPresent=true code=invalid_access_token durationMs=31 message="The Athenz access token is invalid or expired." status=401 expectedAudience=mcp requiredScope=mcp:role.mcp-accessor keyId=athenz-zts-server-example signatureVerified=true expiresAt=2026-XX-XXT04:20:11.000Z expiresInSeconds=3600 audiences=["api"] reason=audience_mismatch
```

`reason=audience_mismatch`、`expectedAudience=mcp`、`audiences=["api"]` から失敗した検証を特定できます。`signatureVerified=true` と正の `expiresInSeconds` は、署名と有効期限の検証を通過したことを示します。

`invalid_access_token` はクライアントに返すエラーコードです。トークンが期限切れなら、ログに `reason=token_expired`、`expiresAt`、ゼロ以下の `expiresInSeconds` が記録されます。有効期限の検証は audience の検証より先に行われます。Codex が Bearer トークンを送らなかった場合は `accessTokenPresent=false`、`code=missing_access_token`、`reason=missing_authorization` が記録され、この場合も `status=401` です。これらのリクエストは MCP アプリケーションに届く前にプロキシで遮断されます。

![Runtime Proxy が AI エージェントに 401 を返し、MCP サーバーと API は呼ばれない流れ](../assets/core_10_mcp_rejected.svg)

<a id="grant-the-learner-mcp-access"></a>

## 演習用 ID に MCP へのアクセス権限を付与する

`mcp` ドメインを作成します：

```sh
./tools/athenz/create-tld.sh "mcp"
```

MCP へのアクセス用ロールを作成します：

```sh
./tools/athenz/create-role.sh "mcp" "mcp-accessor"
```

演習用 ID をこのロールに追加します：

```sh
./tools/athenz/add-role-member.sh "mcp" "mcp-accessor" "human.idjag-learner"
```

audience に MCP を明示し、MCP と API の両方のスコープを要求します：

```sh
_scope="mcp:role.mcp-accessor api:role.docs-getter"
_my_access_token=$(./tools/athenz/fetch-access-token.sh \
  "./keys/idjag-learner.crt" \
  "./keys/idjag-learner.key" \
  "${_scope}" \
  "./keys/idjag-learner.jwt" \
  --audience mcp)
```

出力例：

```text
  ·  Fetching Access Token for scope: mcp:role.mcp-accessor api:role.docs-getter...
  ✔  Access token issued for scope: mcp:role.mcp-accessor api:role.docs-getter
{
  "kid": "athenz-zts-server-5fcdbc67f4-lwctf",
  "typ": "at+jwt",
  "alg": "RS256"
}
{
  "sub": "human.idjag-learner",
  "scp": [
    "api:role.docs-getter",
    "mcp-accessor"
  ],
  "ver": 1,
  "iss": "athenz-zts-server-5fcdbc67f4-lwctf",
  "client_id": "human.idjag-learner",
  "aud": "mcp",
  "uid": "human.idjag-learner",
  "auth_time": 1790138556,
  "scope": "api:role.docs-getter mcp-accessor",
  "cnf": {
    "x5t#S256": "X-pSh5Xo4sMnl9vvbPkUtcJCgOPHdfsBG1PGzecYoIg"
  },
  "exp": 1790142156,
  "iat": 1790138556,
  "jti": "0e87ef54-6233-4540-9452-77608bd02556"
}
```

MCP ロールはツール実行権限を、API ロールは文書閲覧権限を表します。このトークンは MCP に渡すために発行されたものです。

<a id="update-codex-with-the-mcp-token"></a>

## Codex に MCP トークンを設定する

前の手順で取得した MCP 用アクセストークンで `.codex/config.toml` を更新します。`_my_access_token` を取得したシェルで次のブロックを実行します。トークンが期限切れなら、先に取得コマンドを再実行してください。

前の章で作成したチュートリアル用の設定を使っている場合は、次のブロックを実行します。ほかの設定を追加している場合、ファイル全体を置き換えず、対象サーバーの `http_headers` 項目だけを修正してください：

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

<a id="verify-token-exchange-is-required"></a>
<a id="verify-the-service-certificate-is-required"></a>

<a id="verify-mcp-access-is-accepted"></a>

## MCP へのアクセスが許可されることを確認する

Codex にもう一度文書の取得を依頼します：

```sh
Get docs with id-jag-the-hard-way-mcp
```

この段階では文書の取得はまだ失敗します。プロキシのログで MCP アクセスの検証を通過したことを確認します：

```sh
kubectl logs deploy/mcp -n mcp -c auth-proxy --tail=3
```

次の項目を探します：

```sh
# 2026-XX-XXT07:05:21.312Z ✓ INFO  [mcp-runtime-proxy] [auth] access token verified | requestId=eb1c16b4-6ec0-445f-905d-7baa32cb4952 method=POST path=/mcp audiences=["mcp"] clientId=human.idjag-learner expiresAt=2026-XX-XXT08:04:16.000Z expiresInSeconds=3535 keyId=athenz-zts-server-example scopes=["api:role.docs-getter","mcp-accessor"] subject=human.idjag-learner userId=human.idjag-learner
```

`access token verified` は MCP アクセスの検証を通過したことを示します。その後に発生する `502 downstream_token_exchange_unavailable` はこの段階で予想されるエラーで、次の章で解消します。

<a id="next-steps"></a>

## 次のステップ

次の章では、MCP が保護された API から文書を取得できるようトークン交換（Token Exchange）を設定します。

次へ：[トークン交換（Token Exchange）— Codex](./11-token-exchange.md)
