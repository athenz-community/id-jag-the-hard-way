# Goal

Run a simple Node.js HTTP provider locally using the real Athenz ZPE library from release `v1.12.50`, then use one ZTS role token to verify an allowed read and a denied write.

<!-- TOC depthFrom:2 depthTo:2 -->

- [Step 1. Build the provider with the pinned library](#step-1-build-the-provider-with-the-pinned-library)
- [Step 2. Create the provider domain and read permission](#step-2-create-the-provider-domain-and-read-permission)
- [Step 3. Load the public keys and signed policy snapshot](#step-3-load-the-public-keys-and-signed-policy-snapshot)
- [Step 4. Run the provider locally](#step-4-run-the-provider-locally)
- [Step 5. Verify rejection without a valid role token](#step-5-verify-rejection-without-a-valid-role-token)
- [Step 6. Verify an allowed read and a denied write](#step-6-verify-an-allowed-read-and-a-denied-write)

<!-- /TOC -->

<details>
<summary>Last verified on Oct 26, 2026 — 🟡 Native build verified; live Athenz verification pending</summary>

| # | Date | Confirmed Working |
|---|------|-------------------|
| 1 | Oct 26, 2026 | ✅ — resolved Athenz `v1.12.50` to commit `8fb407836b73c8b487bd373ab3a60663c698b2ce`; all 27 runtime/license files match the release's Git blob hashes |
| 2 | Oct 26, 2026 | ✅ — `make build test` completed locally; syntax checks and all 17 tests passed, including the installed runtime source hashes |
| 3 | Oct 26, 2026 | ✅ — `make local` started directly with Node.js using temporary empty key lists and an empty policy directory; `/healthz` returned 200 with `v1.12.50`, `/hello` returned the expected 401, and `/readyz` returned the expected 503 for missing policies |
| 4 | Oct 26, 2026 | ✅ — all seven shell blocks passed `bash -n`; command/result pairs, relative links, native Makefile targets, and the `.local/` ignore rule were checked |
| 5 | Oct 26, 2026 | ✅ — existing CI workflows use explicit component paths and build contexts; none select this lab |
| 6 | Oct 26, 2026 | 🟡 — live Athenz configuration and ZTS-issued role-token checks have not been run; this CLI's LY AI Policy prohibits access to the lab certificates and private keys |

Expected output below is labeled separately from captured verification. Fixture tests do not establish that the live lab procedure has succeeded.

</details>

# Prerequisites

This tutorial requires the following to be completed:

1. Complete the main [ID-JAG The Hard Way tutorial](https://github.com/mlajkim/id-jag-the-hard-way/tree/main/tutorials) through the Athenz setup
1. Keep the existing Athenz deployment and its local ZMS/ZTS port-forwards running
1. Install Node.js 22 or newer, npm, `curl`, and `jq`
1. Have the tutorial's local CA and administrator identity available at `athenz_dist/certs/ca.cert.pem`, `athenz_dist/certs/athenz_admin.cert.pem`, and `athenz_dist/keys/athenz_admin.private.pem`

Run every command from the IDTHW repository root. The credential-dependent steps are for the lab operator to run locally.

# Steps

Here is the procedure to get to the goals.

## Step 1. Build the provider with the pinned library

The [lab app](../../../components/labs/athenz-nodejs-provider/) calls `AuthZPEClient.allowAccess({ roleToken, action, resource }, callback)`. It pins `@athenz/zpe-client` and `@athenz/auth-core` to Athenz `v1.12.50`, resolved to commit `8fb407836b73c8b487bd373ab3a60663c698b2ce`, with their runtime files unchanged. The source manifest records each file's Git blob hash; `package-lock.json` locks the remaining npm dependencies. This lab is built manually and is outside the normal component CI workflows.

Prepare the pinned dependencies, check the JavaScript, and run the tests locally:

```sh
make -C components/labs/athenz-nodejs-provider build test
```

```sh
# Captured stable results from the native build and tests
# Athenz v1.12.50 (8fb407836b73c8b487bd373ab3a60663c698b2ce): 27 runtime/license files verified
# ℹ tests 17
# ℹ pass 17
# ℹ fail 0
```

The library accepts Athenz **role tokens** (`v=Z1;...`) through `Athenz-Role-Auth`. The OAuth access tokens used in the main tutorial are a different format. For this small provider, each authorization request reloads the signed policies and revalidates the token. The app also checks policy-snapshot expiry, which the pinned library does not enforce itself.

## Step 2. Create the provider domain and read permission

Create a separate `nodejs-provider` domain, give `user.athenz_admin` the `hello-reader` role, and allow that role to `read` `nodejs-provider:hello`. These commands use the existing IDTHW operation tools:

```sh
./tools/athenz/create-tld.sh nodejs-provider &&
./tools/athenz/create-role.sh nodejs-provider hello-reader &&
./tools/athenz/add-role-member.sh nodejs-provider hello-reader user.athenz_admin &&
./tools/athenz/add-policy.sh nodejs-provider hello-reader read hello
```

```sh
# Expected result on first creation; existing domains, roles, and membership are reported by the tools
#   ·  Creating TLD: nodejs-provider...
#   ✔  TLD created: nodejs-provider
#   ·  Creating Role: nodejs-provider:role.hello-reader...
#   ✔  Role created: nodejs-provider:role.hello-reader
#   ·  Adding Member user.athenz_admin to Role: nodejs-provider:role.hello-reader...
#   ✔  user.athenz_admin  →  nodejs-provider:role.hello-reader
#   ·  Creating Policy: nodejs-provider:policy.hello-reader_read_hello...
#   ✔  Policy created: nodejs-provider:policy.hello-reader_read_hello
```

The app maps `GET /hello` to `read` and `POST /hello` to `write`. There is no write grant, so POST will be denied even with a valid `hello-reader` token.

## Step 3. Load the public keys and signed policy snapshot

Fetch the ZMS and ZTS public verification keys and the signed policies through the local ZTS endpoint. Save them under the lab's ignored `.local/` directory, which the local app reads at startup and during authorization checks.

ZTS may need time to receive the new domain and policy from ZMS. If it returns `404` or the `helloReaderPolicy` check below fails, wait for synchronization and rerun this block.

```sh
. ./tools/color.sh &&
_nodejs_zts_port=$(./tools/port.sh zts) &&
_nodejs_state_dir=./components/labs/athenz-nodejs-provider/.local &&
mkdir -p "${_nodejs_state_dir}/policies" &&
_nodejs_snapshot_dir=$(mktemp -d "${_nodejs_state_dir}/snapshot.XXXXXX") &&
info 'Fetching public keys and signed policies from ZTS...' &&
curl -fsS \
  --cacert ./athenz_dist/certs/ca.cert.pem \
  --cert ./athenz_dist/certs/athenz_admin.cert.pem \
  --key ./athenz_dist/keys/athenz_admin.private.pem \
  "https://localhost:${_nodejs_zts_port}/zts/v1/domain/sys.auth/service/zms" \
  -o "${_nodejs_snapshot_dir}/zms.json" &&
curl -fsS \
  --cacert ./athenz_dist/certs/ca.cert.pem \
  --cert ./athenz_dist/certs/athenz_admin.cert.pem \
  --key ./athenz_dist/keys/athenz_admin.private.pem \
  "https://localhost:${_nodejs_zts_port}/zts/v1/domain/sys.auth/service/zts" \
  -o "${_nodejs_snapshot_dir}/zts.json" &&
jq -en \
  --slurpfile zms "${_nodejs_snapshot_dir}/zms.json" \
  --slurpfile zts "${_nodejs_snapshot_dir}/zts.json" \
  '{zmsPublicKeys: $zms[0].publicKeys, ztsPublicKeys: $zts[0].publicKeys}
   | select((.zmsPublicKeys | length) > 0 and (.ztsPublicKeys | length) > 0)' \
  > "${_nodejs_snapshot_dir}/athenz.conf" &&
curl -fsS \
  --cacert ./athenz_dist/certs/ca.cert.pem \
  --cert ./athenz_dist/certs/athenz_admin.cert.pem \
  --key ./athenz_dist/keys/athenz_admin.private.pem \
  "https://localhost:${_nodejs_zts_port}/zts/v1/domain/nodejs-provider/signed_policy_data" \
  -o "${_nodejs_snapshot_dir}/nodejs-provider.pol" &&
jq -e '{
    domain: .signedPolicyData.policyData.domain,
    helloReaderPolicy: any(.signedPolicyData.policyData.policies[].assertions[]?;
      .role == "nodejs-provider:role.hello-reader" and
      .action == "read" and .resource == "nodejs-provider:hello")
  } | select(.domain == "nodejs-provider" and .helloReaderPolicy)' \
  "${_nodejs_snapshot_dir}/nodejs-provider.pol" &&
mv "${_nodejs_snapshot_dir}/athenz.conf" "${_nodejs_state_dir}/athenz.conf" &&
mv "${_nodejs_snapshot_dir}/nodejs-provider.pol" "${_nodejs_state_dir}/policies/nodejs-provider.pol" &&
ok "Public keys and signed policy saved under ${_nodejs_state_dir}"
```

```sh
# Expected result
#   ·  Fetching public keys and signed policies from ZTS...
# {
#   "domain": "nodejs-provider",
#   "helloReaderPolicy": true
# }
#   ✔  Public keys and signed policy saved under ./components/labs/athenz-nodejs-provider/.local
```

The ZPE library verifies the ZTS signature on `signedPolicyData`, then the ZMS signature on `policyData`. Readiness succeeds only when that validation and the expiry check succeed. Rerun this step when policies change or before the snapshot's `signedPolicyData.expires` time. After a key rotation, restart the local process because its public-key store is initialized only at startup.

## Step 4. Run the provider locally

Start the app directly with Node.js and keep this terminal open. It reads the files prepared in Step 3 and listens on `127.0.0.1:18080`:

```sh
make -C components/labs/athenz-nodejs-provider local
```

```sh
# Expected result; npm startup messages also appear
# info: Node.js provider listening on http://127.0.0.1:18080; Athenz v1.12.50 (8fb407836b73c8b487bd373ab3a60663c698b2ce)
```

In another terminal, confirm that the running app has loaded the policies:

```sh
curl -fsS http://127.0.0.1:18080/readyz
```

```sh
# Expected result
# {"status":"ready","domain":"nodejs-provider"}
```

## Step 5. Verify rejection without a valid role token

Check that a missing token and a malformed token both produce HTTP 401. The malformed input is a fixed invalid string, not a credential:

```sh
curl -sS -w 'HTTP %{http_code}\n' http://127.0.0.1:18080/hello &&
curl -sS -w 'HTTP %{http_code}\n' \
  -H 'Athenz-Role-Auth: not-a-role-token' \
  http://127.0.0.1:18080/hello
```

```sh
# Expected result — both rejections are intentional
# {"error":"missing_role_token","message":"Send an Athenz role token in Athenz-Role-Auth."}
# HTTP 401
# {"error":"invalid_role_token","decision":"DENY_ROLETOKEN_INVALID","message":"Access denied due to invalid RoleToken"}
# HTTP 401
```

## Step 6. Verify an allowed read and a denied write

Obtain a role token restricted to `hello-reader`, then use that same token for both checks. The `role` query parameter matters: requesting all roles for the administrator would also include the domain's admin role. The subshell keeps the token local to this block, and curl receives its header through stdin so it is not printed or placed in curl's argument list:

```sh
(
  _nodejs_zts_port=$(./tools/port.sh zts) &&
  _nodejs_role_token=$(curl -fsS \
    --cacert ./athenz_dist/certs/ca.cert.pem \
    --cert ./athenz_dist/certs/athenz_admin.cert.pem \
    --key ./athenz_dist/keys/athenz_admin.private.pem \
    "https://localhost:${_nodejs_zts_port}/zts/v1/domain/nodejs-provider/token?role=hello-reader&minExpiryTime=600&maxExpiryTime=600" \
    | jq -er '.token') &&
  printf 'Athenz-Role-Auth: %s\n' "${_nodejs_role_token}" \
    | curl -sS --header @- -w 'HTTP %{http_code}\n' \
        http://127.0.0.1:18080/hello &&
  printf 'Athenz-Role-Auth: %s\n' "${_nodejs_role_token}" \
    | curl -sS --header @- -X POST -w 'HTTP %{http_code}\n' \
        http://127.0.0.1:18080/hello
)
```

```sh
# Expected result — GET is allowed and POST is intentionally denied
# {"message":"Hello from the Athenz Node.js provider","action":"read","resource":"nodejs-provider:hello","decision":"ALLOW"}
# HTTP 200
# {"error":"forbidden","decision":"DENY_NO_MATCH","message":"Access denied due to no match to any of the assertions defined in domain policy file"}
# HTTP 403
```

The terminal running `make local` also shows `decision=ALLOW` for GET and `decision=DENY_NO_MATCH` for POST. Press Ctrl-C there when you have finished.

# Reference

- [Athenz v1.12.50 release tag](https://github.com/AthenZ/athenz/tree/v1.12.50)
- [Pinned Node.js ZPE source](https://github.com/AthenZ/athenz/tree/8fb407836b73c8b487bd373ab3a60663c698b2ce/clients/nodejs/zpe/src)
- [Pinned Node.js auth-core source](https://github.com/AthenZ/athenz/tree/8fb407836b73c8b487bd373ab3a60663c698b2ce/libs/nodejs/auth_core/src)
- [ZTS signed-policy API and format](https://github.com/AthenZ/athenz/blob/8fb407836b73c8b487bd373ab3a60663c698b2ce/core/zts/src/main/rdl/SignedPolicies.rdli)
- [ZTS role-token API](https://github.com/AthenZ/athenz/blob/8fb407836b73c8b487bd373ab3a60663c698b2ce/core/zts/src/main/rdl/Token.rdli)
