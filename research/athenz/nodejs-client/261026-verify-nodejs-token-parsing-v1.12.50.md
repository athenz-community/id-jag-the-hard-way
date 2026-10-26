# Goal

Build and run the Node.js provider image with the real Athenz v1.12.50 libraries, then use `human.idjag-learner` to verify that the fixed parser rejects an unsigned role override.

<!-- TOC depthFrom:2 depthTo:2 -->

- [Step 1. Build the provider image](#step-1-build-the-provider-image)
- [Step 2. Prepare the API roles and policies](#step-2-prepare-the-api-roles-and-policies)
- [Step 3. Sync the public keys and signed policies](#step-3-sync-the-public-keys-and-signed-policies)
- [Step 4. Run the provider image](#step-4-run-the-provider-image)
- [Step 5. Check missing and malformed tokens](#step-5-check-missing-and-malformed-tokens)
- [Step 6. Test the getter token and unsigned role override](#step-6-test-the-getter-token-and-unsigned-role-override)

<!-- /TOC -->

<details>
<summary>Last verified on Oct 26, 2026 — 🟡 Image verification in progress; live ZTS checks pending</summary>

| # | Date | Confirmed Working |
|---|------|-------------------|
| 1 | Oct 26, 2026 | ✅ — v1.12.50 is pinned to commit `8fb407836b73c8b487bd373ab3a60663c698b2ce`; its 27 runtime/license files are verified against Git blob hashes |
| 2 | Oct 26, 2026 | 🟡 — version-selected image build and runtime checks pending |
| 3 | Oct 26, 2026 | 🟡 — live ZMS setup, policy sync, and ZTS-issued role-token requests have not been executed by this CLI; [LY AI Policy](https://github.com/secdev-whc/ai-cli-hardening) prohibits access to the required certificates and private keys |

The expected output in the credential-dependent steps is an operator example, not a captured live result. PR #3480 is absent from `v1.12.46` and included in `v1.12.47` through `v1.12.50`. This procedure tests the role-token/ZPE path; it does not exercise `PrincipalToken`.

</details>

# Prerequisites

This tutorial requires the following to be completed:

1. Complete [Granular Permission](../../../tutorials/07-granular-permission.md), including `api`, `docs-getter`, and `human.idjag-learner`
1. Keep the local Athenz ZMS/ZTS port-forwards running
1. Start Docker and install Node.js 22 or newer, npm, `curl`, and `jq`
1. Have the tutorial CA at `athenz_dist/certs/ca.cert.pem` and learner identity at `keys/idjag-learner.crt` and `keys/idjag-learner.key`; the ZMS management tools also need the tutorial administrator identity

Run every command from the IDTHW repository root. Credential-dependent steps are for the lab operator to run locally.

# Steps

Here is the procedure to get to the goals.

## Step 1. Build the provider image

Select the Athenz library release with `VERSION`. The image contains the actual HTTP provider and unchanged upstream ZPE/auth-core code from that release. The npm packages retain their own `1.0.0` versions; `VERSION` selects the Athenz repository release. The build verifies the source hashes, installs locked dependencies, and checks the app syntax.

Build the image and inspect its version label. The expected result omits routine Docker build output:

```sh
make -C components/labs/athenz-nodejs-provider build VERSION=v1.12.50 &&
docker image inspect idthw-athenz-nodejs-provider:v1.12.50 \
  --format '{{index .Config.Labels "org.opencontainers.image.version"}}'
```

```sh
# Expected final result
# v1.12.50
```

The build saves the host's ZMS/ZTS endpoint choices in the ignored lab `.local/endpoints.json`. Defaults come from `tools/port.sh`: `https://localhost:4443/zms/v1` and `https://localhost:8443/zts/v1`. Pass `ZMS_URL` and `ZTS_URL` to `make build` for another environment. Images are built manually; no pipeline is added.

## Step 2. Prepare the API roles and policies

Reuse `api:role.docs-getter` and `human.idjag-learner`. Grant `get` on `api:docs` to the getter role, and `post` to a separate `docs-poster` role. The test requests a token restricted to `docs-getter`; a matching poster policy is needed to expose whether an unsigned role override can gain POST access.

The shared management scripts use the administrator identity against local ZMS. For custom endpoints, prepare the equivalent roles, membership, and policies with that server's administrative tooling:

```sh
./tools/athenz/add-role-member.sh api docs-getter human.idjag-learner &&
./tools/athenz/create-role.sh api docs-poster &&
./tools/athenz/add-policy.sh api docs-getter get docs &&
./tools/athenz/add-policy.sh api docs-poster post docs
```

```sh
# Expected result when docs-poster is first created; existing roles are reported by the tool
#   ✔  Member already exists: human.idjag-learner  →  api:role.docs-getter
#   ·  Creating Role: api:role.docs-poster...
#   ✔  Role created: api:role.docs-poster
#   ·  Creating Policy: api:policy.docs-getter_get_docs...
#   ✔  Policy created: api:policy.docs-getter_get_docs
#   ·  Creating Policy: api:policy.docs-poster_post_docs...
#   ✔  Policy created: api:policy.docs-poster_post_docs
```

The app maps GET `/api/docs` to `get` and POST `/api/docs` to `post`, both on `api:docs`. The main tutorial API checks OAuth scopes; this app evaluates Athenz action/resource policies through ZPE and accepts ZTS role tokens in `Athenz-Role-Auth`.

## Step 3. Sync the public keys and signed policies

Fetch the public verification keys and signed `api` policy snapshot with the saved endpoints, then confirm that ZTS has received the poster grant. If that final check fails, wait for ZMS-to-ZTS synchronization and rerun this block:

```sh
make -C components/labs/athenz-nodejs-provider sync &&
jq -e '{docsPosterPolicy: any(.signedPolicyData.policyData.policies[].assertions[]?;
  .role == "api:role.docs-poster" and .action == "post" and
  .resource == "api:docs" and (.effect // "ALLOW") == "ALLOW")}
  | select(.docsPosterPolicy)' \
  components/labs/athenz-nodejs-provider/.local/policies/api.pol
```

```sh
# Expected result with the default IDTHW endpoints
#   ·  Fetching ZMS public keys: https://localhost:4443/zms/v1/domain/sys.auth/service/zms
#   ·  Fetching ZTS public keys: https://localhost:8443/zts/v1/domain/sys.auth/service/zts
#   ·  Fetching signed policies: https://localhost:8443/zts/v1/domain/api/signed_policy_data
# {
#   "domain": "api",
#   "docsGetterPolicy": true
# }
#   ✔  ZPE public keys and signed policy refreshed
# {
#   "docsPosterPolicy": true
# }
```

Sync defaults to the IDTHW CA and learner certificate/key. Override their file paths with `ATHENZ_CA_CERT`, `ATHENZ_CLIENT_CERT`, and `ATHENZ_CLIENT_KEY` for another environment. The image uses only the resulting public-key configuration and signed policy snapshot. Rerun sync when policies change or before the snapshot expires; restart the provider after verification-key rotation.

## Step 4. Run the provider image

Stop a previously started provider in its terminal with Ctrl-C, then run this image in the foreground. Keep the terminal open. The container mounts the public-key configuration and policy directory read-only and publishes the app on `127.0.0.1:18080`:

```sh
make -C components/labs/athenz-nodejs-provider run VERSION=v1.12.50
```

```sh
# Expected startup log
# info: Node.js provider listening on http://0.0.0.0:18080; Athenz v1.12.50 (8fb407836b73c8b487bd373ab3a60663c698b2ce)
```

In another terminal, confirm the actual library version and policy readiness:

```sh
curl -fsS http://127.0.0.1:18080/healthz | jq &&
curl -fsS http://127.0.0.1:18080/readyz | jq
```

```sh
# Expected result
# {
#   "status": "ok",
#   "athenzVersion": "v1.12.50",
#   "athenzRevision": "8fb407836b73c8b487bd373ab3a60663c698b2ce"
# }
# {
#   "status": "ready",
#   "domain": "api"
# }
```

## Step 5. Check missing and malformed tokens

Check the two rejection paths. Curl writes the HTTP status to stderr so `jq` receives only JSON; the status can appear before or after the formatted body:

```sh
curl -sS -w '%{stderr}HTTP %{http_code}\n' \
  http://127.0.0.1:18080/api/docs | jq &&
curl -sS -w '%{stderr}HTTP %{http_code}\n' \
  -H 'Athenz-Role-Auth: not-a-role-token' \
  http://127.0.0.1:18080/api/docs | jq
```

```sh
# Expected result — these rejections are intentional
# HTTP 401
# {
#   "error": "missing_role_token",
#   "message": "Send an Athenz role token in Athenz-Role-Auth."
# }
# HTTP 401
# {
#   "error": "invalid_role_token",
#   "decision": "DENY_ROLETOKEN_INVALID",
#   "message": "Access denied due to invalid RoleToken"
# }
```

The fixed ZPE client converts malformed-token parsing errors into `DENY_ROLETOKEN_INVALID`, which the app returns as HTTP 401.

## Step 6. Test the getter token and unsigned role override

Use [fetch-role-token.sh](../../../tools/athenz/fetch-role-token.sh) to obtain a 600-second role token as `human.idjag-learner`, restricted to `docs-getter`. Send it for GET, then POST. Finally append `;r=docs-poster` after its signature and repeat POST with that modified token, without signing it again.

The helper prints progress and response metadata to stderr. The subshell keeps the token local, and curl receives the header through stdin. The expected output omits the changing `expiryTime` metadata, which the helper prints in full:

```sh
(
  _nodejs_zts_url=$(node ./components/labs/athenz-nodejs-provider/scripts/endpoints.cjs url zts) &&
  _nodejs_role_token=$(
    ZTS_URL="${_nodejs_zts_url}" \
    ATHENZ_CA_CERT="${ATHENZ_CA_CERT:-./athenz_dist/certs/ca.cert.pem}" \
    ./tools/athenz/fetch-role-token.sh \
      "${ATHENZ_CLIENT_CERT:-./keys/idjag-learner.crt}" \
      "${ATHENZ_CLIENT_KEY:-./keys/idjag-learner.key}" \
      api docs-getter
  ) &&
  printf 'Athenz-Role-Auth: %s\n' "${_nodejs_role_token}" \
    | curl -sS --header @- -w '%{stderr}HTTP %{http_code}\n' \
        http://127.0.0.1:18080/api/docs | jq &&
  printf 'Athenz-Role-Auth: %s\n' "${_nodejs_role_token}" \
    | curl -sS --header @- -X POST -w '%{stderr}HTTP %{http_code}\n' \
        http://127.0.0.1:18080/api/docs | jq &&
  printf 'Athenz-Role-Auth: %s;r=docs-poster\n' "${_nodejs_role_token}" \
    | curl -sS --header @- -X POST -w '%{stderr}HTTP %{http_code}\n' \
        http://127.0.0.1:18080/api/docs | jq
)
```

```sh
# Expected result — GET, normal POST, then modified-token POST
#   ·  Fetching Role Token for role: api:role.docs-getter...
#   ·  ZTS endpoint: https://localhost:8443/zts/v1/domain/api/token
#   ✔  Role token issued for role: api:role.docs-getter
# HTTP 200
# {
#   "message": "Documents from the Athenz Node.js provider",
#   "action": "get",
#   "resource": "api:docs",
#   "decision": "ALLOW"
# }
# HTTP 403
# {
#   "error": "forbidden",
#   "decision": "DENY_NO_MATCH",
#   "message": "Access denied due to no match to any of the assertions defined in domain policy file"
# }
# HTTP 401
# {
#   "error": "invalid_role_token",
#   "decision": "DENY_ROLETOKEN_INVALID",
#   "message": "Access denied due to invalid RoleToken"
# }
```

The final HTTP 401 verifies the fix: the parser rejects the extra data after the signature, and the unsigned poster role never reaches policy evaluation. The original getter token still allows GET and denies POST.

Press Ctrl-C in the terminal running the container when finished. The [v1.12.46 setup](./261025-reproduce-nodejs-token-parsing-v1.12.46.md) runs the same HTTP checks with the older library.

# Reference

- [PR #3480: parse token claims only from the signed prefix](https://github.com/AthenZ/athenz/pull/3480)
- [Pinned v1.12.50 source](https://github.com/AthenZ/athenz/tree/8fb407836b73c8b487bd373ab3a60663c698b2ce)
- [ZTS role-token API](https://github.com/AthenZ/athenz/blob/8fb407836b73c8b487bd373ab3a60663c698b2ce/core/zts/src/main/rdl/Token.rdli)
- [Provider Dockerfile](../../../components/labs/athenz-nodejs-provider/Dockerfile)
