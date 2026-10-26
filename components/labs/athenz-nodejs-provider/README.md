# Athenz Node.js provider

A small lab app that calls the real `@athenz/zpe-client` `AuthZPEClient.allowAccess()` API from Athenz `v1.12.50`. Follow the [v1.12.50 setup and fix verification](../../../research/athenz/nodejs-client/261026-verify-nodejs-token-parsing-v1.12.50.md) to build and run it locally with Node.js. The normal component workflows do not build this lab.

| Request | Behavior |
|---|---|
| `GET /healthz` | Process health, Athenz release version, and the upstream source revision |
| `GET /readyz` | Verifies the signed policy snapshot and its expiry |
| `GET /api/docs` | Requires `get` on `api:docs` |
| `POST /api/docs` | Requires `post` on the same resource; returns a sample response if allowed |

The lab reuses the tutorial's `api` domain, `docs-getter` role, and `human.idjag-learner` identity. Send a ZTS **role token** restricted to `docs-getter` in `Athenz-Role-Auth`. The setup guide grants that role only `get` on `api:docs`, so the same token returns HTTP 200 for GET and HTTP 403 for POST. The main tutorial API checks OAuth scopes; this lab evaluates ZPE action/resource policies. A missing, malformed, or expired role token returns HTTP 401. An unavailable, expired, or invalid policy snapshot returns HTTP 503.

`upstream.json` pins both ZPE and its `@athenz/auth-core` dependency to the Athenz `v1.12.50` release, resolved to commit `8fb407836b73c8b487bd373ab3a60663c698b2ce`. `make install` downloads the 27 listed runtime/license files into the ignored `vendor/` directory and checks their Git blob hashes before installing the locked npm dependencies. Existing files that differ from their pinned hashes are preserved and reported as an error. Upstream source files are used unchanged. The upstream npm packages retain their own `1.0.0` version; `v1.12.50` identifies the Athenz repository release used here.

`make build test` configures the endpoints, installs the pinned dependencies, checks the JavaScript, and exercises HTTP authorization using temporary in-memory signing fixtures. The app runs directly from JavaScript source. Tests cover endpoint selection and persistence, snapshot refresh failures, real token and policy signature validation, allow/deny behavior, malformed and expired tokens, policy expiry, and log redaction. They do not read existing lab credentials.

The first build resolves the local endpoints through IDTHW's `tools/port.sh`, including `tools/config.local.yaml` port overrides. Settings are saved in the ignored `.local/endpoints.json`. Explicit `ZMS_URL` and `ZTS_URL` values override saved settings; later builds reuse saved settings when those values are omitted.

| Setting | IDTHW default | Used for |
|---|---|---|
| `ZMS_URL` | `https://localhost:4443/zms/v1` | Fetching the ZMS public verification keys |
| `ZTS_URL` | `https://localhost:8443/zts/v1` | Fetching the ZTS public keys, signed policies, and role tokens |

To select another environment, run this from the lab directory with that environment's full API base URLs:

```sh
make build \
  ZMS_URL=https://zms.example.test/zms/v1 \
  ZTS_URL=https://zts.example.test/zts/v1
```

```sh
# Expected endpoint settings; dependency verification and syntax-check output also appear
# {
#   "zmsUrl": "https://zms.example.test/zms/v1",
#   "ztsUrl": "https://zts.example.test/zts/v1"
# }
```

`make configure` accepts the same settings without rebuilding dependencies. `make endpoints` displays the effective URLs. After the `api` domain and its `docs-getter` policy exist on the selected servers, `make sync` fetches the verification keys and signed policy snapshot using those URLs. The provider itself evaluates requests locally using `.local/policies/api.pol`.

Snapshot sync uses the IDTHW CA and learner identity by default: `athenz_dist/certs/ca.cert.pem`, `keys/idjag-learner.crt`, and `keys/idjag-learner.key` relative to the repository root. Complete the [Granular Permission tutorial](../../../tutorials/07-granular-permission.md) first. For another environment, pass `ATHENZ_CA_CERT`, `ATHENZ_CLIENT_CERT`, and `ATHENZ_CLIENT_KEY` as file paths to `make sync`. The guide uses [fetch-role-token.sh](../../../tools/athenz/fetch-role-token.sh) with the selected ZTS URL and the same identity overrides to request a 600-second `docs-getter` role token. Its shared membership/policy tools use the administrator identity to configure local ZMS; prepare equivalent permissions on a custom ZMS with that environment's administrative tooling.

After `make sync`, `make local` starts the provider at `http://127.0.0.1:18080`. Use `PORT` to select another port. The provider and sync helper use `ATHENZ_CONF` and `ATHENZ_POLICY_DIR`, which default to `.local/athenz.conf` and `.local/policies` inside this lab directory. The `.local/` directory is ignored by Git. Run `make sync` again before the snapshot expires or when policies change. Restart the process after changing the public keys, since this library loads them at initialization.

This is a small lab provider. It clears the upstream request caches and checks policy expiry on every authorization request. Upstream messages are sanitized before logging, while the HTTP method, action, resource, and decision remain visible in the terminal running `make local`.

The PR #3480 tests call the real ZPE libraries directly with isolated fixtures on the same Node.js runtime. Six cases cover normal role enforcement, an unsigned role override, an expired-token bypass, and malformed-token handling. Each target builds the lab dependencies and checks the selected release in its own process. The tests create their own policy snapshots and signing keys.

| Target from the lab directory | Release | Guide |
|---|---|---|
| `make reproduce-pr-3480` | `v1.12.46` | [Reproduce the bug](../../../research/athenz/nodejs-client/261025-reproduce-nodejs-token-parsing-v1.12.46.md) |
| `make verify-pr-3480` | `v1.12.50` | [Verify the fix](../../../research/athenz/nodejs-client/261026-verify-nodejs-token-parsing-v1.12.50.md#step-7-verify-that-v11250-rejects-unsigned-overrides) |
| `make compare-pr-3480` | Both releases | [Compare captured results](../../../research/athenz/nodejs-client/261025-reproduce-nodejs-token-parsing-v1.12.46.md#step-2-compare-the-same-cases-with-v11250) |

The older-library targets verify the source files against `upstream-v1.12.46.json` and store them in `.local/pr-3480/v1.12.46/`. The fixed-library target uses the installed dependencies pinned by `upstream.json`.
