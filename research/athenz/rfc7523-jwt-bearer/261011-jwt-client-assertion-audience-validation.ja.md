[English](./261011-jwt-client-assertion-audience-validation.md)

# 目的

RFC 7523 アサーションで Athenz アクセストークンを取得し、Athenz v1.12.48 以降では API 向けのトークンを再利用して別のアクセストークンを取得しようとすると拒否されることを確認します。

<!-- TOC depthFrom:2 depthTo:2 -->

- [Setup 1. Athenz v1.12.48 以降を選択する](#setup-1-athenz-v11248-以降を選択する)
- [Setup 2. 学習者のサービス証明書を更新する](#setup-2-学習者のサービス証明書を更新する)
- [Setup 3. 既存の学習者 ID を確認する](#setup-3-既存の学習者-id-を確認する)
- [Step 1. RFC 7523 アサーションでアクセストークンを取得する](#step-1-rfc-7523-アサーションでアクセストークンを取得する)
- [Step 2. アクセストークンを再利用して別のトークンを取得しようとすると拒否される](#step-2-アクセストークンを再利用して別のトークンを取得しようとすると拒否される)

<!-- /TOC -->

<details>
<summary>検証状況 — 🟡 実環境での実行待ち</summary>

| # | 日付 | 確認内容 |
|---|---|---|
| 1 | 2026年10月16日 | 🟡 v1.12.48 のソースを基に手順を作成。実環境での結果は未記録 |

結果ブロックには、ソースから導いた期待結果のうち比較に必要な出力を記載しています。実行時に取得した出力ではありません。出力例では、追加の診断情報、実行ごとに変わるレスポンスフィールド、デコード済み JWT オブジェクト、トークンの生の値を省略しています。ヘルパーは、機密値を除く診断情報を省略せず stderr に、発行されたアクセストークンを stdout に出力します。このページで確認するのは、API アクセストークンの audience 検証です。PR #3499 の呼び出し元の紐付け全体や、ZTS 向けの有効なアサーションの使用を一度だけに制限する仕組みの検証は含みません。

</details>

# 前提条件

1. [ID-JAG The Hard Way のメインチュートリアル](https://github.com/mlajkim/id-jag-the-hard-way/tree/main/tutorials)を完了する。[Granular Permission](../../../tutorials/07-granular-permission.md) での学習者 ID の作成と `api:role.docs-getter` への所属も必要
1. ローカルの Kubernetes クラスターと `./tools/keep-k8s-port-forward.sh` を起動し、Bash、`kubectl`、`curl`、`jq`、`openssl` を使用できる状態にする。[バージョン切り替えの前提条件](../../../tools/README.md#switching-the-local-athenz-version)も満たす
1. 各コマンドブロックを IDTHW リポジトリのルートから Bash で実行する。キー ID `v1` に対応する既存の学習者用サービス鍵 `./keys/idjag-learner.key` を使用する。Step 1 と Step 2 は同じ Bash セッションで実行する

このページは [261010](./261010-jwt-client-assertion-audience-validation.ja.md) のセットアップとトークン取得の流れに沿い、[PR #3499](https://github.com/AthenZ/athenz/pull/3499) の修正を含むリリースを使用します。

# 手順

## Setup 1. Athenz v1.12.48 以降を選択する

稼働中の ZTS が `1.12.48` 以降であることを確認します。成功した場合は Setup 2 に進んでください。

```sh
./tools/athenz/athenz-version-verifier.sh 1.12.48
```

```sh
#   ·  Checking Athenz ZTS version (minimum: 1.12.48, namespace: athenz)...
#   ✔  <zts-pod>: 1.12.48 meets the minimum 1.12.48
#   ✔  Athenz ZTS version check passed
```

古いバージョンと判定された場合（終了コード `1`）は、v1.12.48 を選択します。バージョン切り替え用ヘルパーは、必要な SQL マイグレーションを適用し、既存のデータベースを保持します。以下は最後に表示される期待結果です。バージョンを検証できない場合（終了コード `2`）は、先にそのエラーを解消してください。後続リリースを使用する場合は、表示されたバージョンを記録してください。

```sh
make athenz-vup VERSION=1.12.48
```

```sh
#   ✔  Athenz 1.12.48 is running; the existing database was preserved
```

## Setup 2. 学習者のサービス証明書を更新する

261010 と同様に、ここで `human.idjag-learner` のサービス証明書を一度更新します。キー ID `v1` に対応する既存の秘密鍵を使い、証明書を `./keys/idjag-learner.crt` に保存します。既存の証明書が有効であればそのまま使用できます。以降の RFC 7523 リクエストでは、クライアント証明書を使わず、署名付きアサーションを使用します。

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

261010 と同様に、`human.idjag-learner` として有効期間 5 分のアサーションに署名し、RFC 7523 JWT bearer 認可グラントとして ZTS に送信します。署名ヘルパーは、稼働中の ZTS から `issuer` を取得し、`aud` に使用します。fetch ヘルパーは、署名済み JWT を `assertion`、`api:role.docs-getter` を HTTP の `scope` パラメーターとして送信し、アクセストークンを返します。Step 2 で使用するため、トークンを `_api_access_token` に保存します。

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

## Step 2. アクセストークンを再利用して別のトークンを取得しようとすると拒否される

API サーバー、または Step 1 の Bearer トークンを入手した第三者が、そのトークンを再利用して ZTS から別のアクセストークンを取得しようとする場合を考えます。トークンを持っているだけでは、学習者の秘密鍵を持っていることの証明にはなりません。`aud=api` のトークンは API で使用できますが、クライアント認証や RFC 7523 グラントの宛先として ZTS を識別していません。PR #3499 は、この再利用を拒否する audience 検証を追加しています。

Step 1 で保存した `_api_access_token` を RFC 7523 の `assertion` として ZTS に送信します。発行された API アクセストークンを使い、別のアクセストークンの取得を試みます。Step 1 と同じ fetch ヘルパーを使用します。ヘルパーは ZTS のレスポンスを表示し、トークンの発行が拒否されるとゼロ以外の終了コードを返します。

```sh
./tools/athenz/fetch-access-token-with-rfc7523.sh \
  "${_api_access_token}" api:role.docs-getter
```

```sh
#   ·  Requesting an access token (jwt-bearer)...
#   ·  ZTS response (HTTP 400; credential values redacted):
# {
#   "code": 400,
#   "message": "Invalid client assertion: audience api does not identify the token endpoint"
# }
#   ✘  Expected HTTP 200, received 400
```

修正済みのリリースでは、トークンの `aud=api` がトークンエンドポイントを識別していないため、ZTS はこのリクエストに HTTP `400` を返します。エラーの文言は ZTS のレスポンスから取得します。

# 参考資料

- [Athenz v1.12.48](https://github.com/AthenZ/athenz/releases/tag/v1.12.48)
- [PR #3499 — JWT クライアントアサーションの audience と呼び出し元の紐付けを検証](https://github.com/AthenZ/athenz/pull/3499)
- [v1.12.48 の AccessTokenRequest.java](https://github.com/AthenZ/athenz/blob/v1.12.48/servers/zts/src/main/java/com/yahoo/athenz/zts/token/AccessTokenRequest.java)
- [v1.12.48 の ZTSImplClientAssertionIdTokenReplayTest](https://github.com/AthenZ/athenz/blob/v1.12.48/servers/zts/src/test/java/com/yahoo/athenz/zts/ZTSImplClientAssertionIdTokenReplayTest.java)
- [261010 — v1.12.47 比較](./261010-jwt-client-assertion-audience-validation.ja.md)
- [RFC 7523 JWT bearer authorization grant の基本手順](./260813-rfc7523-jwt-bearer-authorization-grant.md)
