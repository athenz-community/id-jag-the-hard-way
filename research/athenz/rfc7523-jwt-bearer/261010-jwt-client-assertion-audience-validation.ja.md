[English](./261010-jwt-client-assertion-audience-validation.md)

# 目的

RFC 7523 アサーションで Athenz アクセストークンを取得し、Athenz v1.12.47 では API 向けのトークンを再利用して別のアクセストークンを取得できることを確認します。

<!-- TOC depthFrom:2 depthTo:2 -->

- [Setup 1. Athenz v1.12.47 を選択する](#setup-1-athenz-v11247-を選択する)
- [Setup 2. 学習者のサービス証明書を更新する](#setup-2-学習者のサービス証明書を更新する)
- [Setup 3. 既存の学習者 ID を確認する](#setup-3-既存の学習者-id-を確認する)
- [Step 1. RFC 7523 アサーションでアクセストークンを取得する](#step-1-rfc-7523-アサーションでアクセストークンを取得する)
- [Step 2. アクセストークンを再利用して別のトークンを取得する](#step-2-アクセストークンを再利用して別のトークンを取得する)

<!-- /TOC -->

<details>
<summary>最終テスト日：2026年10月16日 — ユーザーからの報告</summary>

| # | 日付 | 確認内容 |
|---|---|---|
| 1 | 2026年10月16日 | v1.12.47 のソースを基に手順を作成 |
| 2 | 2026年10月16日 | Step 1 と Step 2 の両方をテストしたとユーザーから報告あり |

テスト記録はユーザーからの報告に基づきます。結果ブロックには引き続き、ソースから導いた比較用の出力例を記載しており、実行時に取得した出力ではありません。出力例では、追加の診断情報、実行ごとに変わるレスポンスフィールド、デコード済み JWT オブジェクト、トークンの生の値を省略しています。ヘルパーは、機密値を除く診断情報を省略せず stderr に、発行されたアクセストークンを stdout に出力します。このページで確認するのは、PR #3499 による audience 検証の修正前の API アクセストークンの再利用です。

</details>

# 前提条件

1. [ID-JAG The Hard Way のメインチュートリアル](https://github.com/mlajkim/id-jag-the-hard-way/tree/main/tutorials)を完了する。[Granular Permission](../../../tutorials/07-granular-permission.md) での学習者 ID の作成と `api:role.docs-getter` への所属も必要
1. ローカルの Kubernetes クラスターと `./tools/keep-k8s-port-forward.sh` を起動し、Bash、`kubectl`、`curl`、`jq`、`openssl` を使用できる状態にする。[バージョン切り替えの前提条件](../../../tools/README.md#switching-the-local-athenz-version)も満たす
1. 各コマンドブロックを IDTHW リポジトリのルートから Bash で実行する。キー ID `v1` に対応する既存の学習者用サービス鍵 `./keys/idjag-learner.key` を使用する。Step 1 と Step 2 は同じ Bash セッションで実行する

[PR #3499](https://github.com/AthenZ/athenz/pull/3499) の修正後に同じリクエストを試す手順は、[261011 の v1.12.48 比較](./261011-jwt-client-assertion-audience-validation.ja.md)を参照してください。

# 手順

## Setup 1. Athenz v1.12.47 を選択する

稼働中の ZTS が `1.12.47` 以下であることを確認します。成功した場合は Setup 2 に進んでください。

```sh
./tools/athenz/athenz-version-verifier.sh --less-or-equal 1.12.47
```

```sh
#   ·  Checking Athenz ZTS version (maximum: 1.12.47, namespace: athenz)...
#   ✔  <zts-pod>: 1.12.47 is at or below the maximum 1.12.47
#   ✔  Athenz ZTS version check passed
```

新しいバージョンと判定された場合（終了コード `1`）は、v1.12.47 を選択します。バージョン切り替え用ヘルパーは、既存のデータベースを保持します。以下は最後に表示される期待結果です。バージョンを検証できない場合（終了コード `2`）は、先にそのエラーを解消してください。古いリリースを使用する場合は、表示されたバージョンを記録してください。

```sh
make athenz-vup VERSION=1.12.47
```

```sh
#   ✔  Athenz 1.12.47 is running; the existing database was preserved
```

## Setup 2. 学習者のサービス証明書を更新する

ここで `human.idjag-learner` のサービス証明書を一度更新します。キー ID `v1` に対応する既存の秘密鍵を使い、証明書を `./keys/idjag-learner.crt` に保存します。既存の証明書が有効であればそのまま使用できます。以降の RFC 7523 リクエストでは、クライアント証明書を使わず、署名付きアサーションを使用します。

```sh
./tools/athenz/fetch-cert.sh \
  human idjag-learner ./keys/idjag-learner.key v1
```

```sh
#   ·  Fetching X.509 Certificate for human.idjag-learner...
#   ·  Requesting DNS SAN domain: zts.athenz.cloud
#   ✔  Certificate saved to: ./keys/idjag-learner.crt
```

## Setup 3. 既存の学習者 ID を確認する

既存のサービスにキー ID `v1` が登録されていることを確認します。`--summary` は識別子だけを表示し、鍵の内容は表示しません。

```sh
./tools/athenz/show-service.sh human idjag-learner --summary
```

```sh
#   ·  Showing service human.idjag-learner...
# service: human.idjag-learner
# public-key-ids: v1
```

同じサービスが `api:role.docs-getter` のメンバーであることを確認します。

```sh
./tools/athenz/show-principal-roles.sh human.idjag-learner api
```

```sh
#   ·  Showing roles for human.idjag-learner in domain api...
# {
#   "memberName": "human.idjag-learner",
#   "memberRoles": [
#     {
#       "roleName": "docs-getter",
#       "domainName": "api"
#     }
#   ]
# }
```

## Step 1. RFC 7523 アサーションでアクセストークンを取得する

`human.idjag-learner` として有効期間 5 分のアサーションに署名し、RFC 7523 JWT bearer 認可グラントとして ZTS に送信します。署名ヘルパーは、稼働中の ZTS から `issuer` を取得し、`aud` に使用します。fetch ヘルパーは、署名済み JWT を `assertion`、`api:role.docs-getter` を HTTP の `scope` パラメーターとして送信し、アクセストークンを返します。Step 2 で使用するため、トークンを `_api_access_token` に保存します。

```sh
_api_access_token=$(
  ./tools/athenz/sign-rfc7523-assertion.sh \
    --principal human.idjag-learner \
    --private-key ./keys/idjag-learner.key \
    --key-id v1 \
    --expires-in 300 \
    | ./tools/athenz/fetch-access-token-with-rfc7523.sh \
        - api:role.docs-getter
)
```

```sh
#   ·  Requesting an access token (jwt-bearer)...
#   ·  ZTS response (HTTP 200; credential values redacted):
# {
#   "access_token": "<redacted>",
#   "token_type": "Bearer"
# }
#   ✔  Access token issued (jwt-bearer)
```

レスポンスには Bearer アクセストークンが含まれます。デコード済みクレームは `human.idjag-learner` を識別し、`aud=api` を持ちます。アサーションの宛先は ZTS ですが、発行されたアクセストークンの宛先は API です。

## Step 2. アクセストークンを再利用して別のトークンを取得する

API サーバー、または Step 1 の Bearer トークンを入手した第三者が、そのトークンを再利用して ZTS から別のアクセストークンを取得しようとする場合を考えます。トークンを持っているだけでは、学習者の秘密鍵を持っていることの証明にはなりません。`aud=api` のトークンは API で使用できますが、クライアント認証や RFC 7523 グラントの宛先として ZTS を識別していません。Athenz v1.12.47 には PR #3499 で追加された audience 検証がなく、この再利用を受け付けます。

Step 1 で保存した `_api_access_token` を RFC 7523 の `assertion` として ZTS に送信します。発行された API アクセストークンを使い、別のアクセストークンの取得を試みます。Step 1 と同じ fetch ヘルパーを使用します。ヘルパーは ZTS のレスポンスを表示し、新たに発行されたアクセストークンを返します。

```sh
./tools/athenz/fetch-access-token-with-rfc7523.sh \
  "${_api_access_token}" api:role.docs-getter
```

```sh
#   ·  Requesting an access token (jwt-bearer)...
#   ·  ZTS response (HTTP 200; credential values redacted):
# {
#   "access_token": "<redacted>",
#   "token_type": "Bearer"
# }
#   ✔  Access token issued (jwt-bearer)
```

v1.12.47 では、送信したトークンが `aud=api` であっても、ZTS はこのリクエストに HTTP `200` を返し、別のアクセストークンを発行します。これにより、audience 検証が不足していることを確認できます。同じリクエストは、[261011 の比較](./261011-jwt-client-assertion-audience-validation.ja.md#step-2-アクセストークンを再利用して別のトークンを取得しようとすると拒否される)では拒否されます。

# 参考資料

- [v1.12.47 の AccessTokenRequest.java](https://github.com/AthenZ/athenz/blob/v1.12.47/servers/zts/src/main/java/com/yahoo/athenz/zts/token/AccessTokenRequest.java)
- [PR #3499 — JWT クライアントアサーションの audience と呼び出し元の紐付けを検証](https://github.com/AthenZ/athenz/pull/3499)
- [261011 — v1.12.48 比較](./261011-jwt-client-assertion-audience-validation.ja.md)
- [RFC 7523 JWT bearer authorization grant の基本手順](./260813-rfc7523-jwt-bearer-authorization-grant.md)
