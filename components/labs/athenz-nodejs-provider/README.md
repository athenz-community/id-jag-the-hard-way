# Athenz Node.js provider

A small lab app that calls the real `@athenz/zpe-client` `AuthZPEClient.allowAccess()` API from Athenz `v1.12.50`. Follow the [setup guide](../../../research/athenz/nodejs-client/261026-setup-nodejs-provider.md) to build and run it locally with Node.js. The normal component workflows do not build this lab.

| Request | Behavior |
|---|---|
| `GET /healthz` | Process health, Athenz release version, and the upstream source revision |
| `GET /readyz` | Verifies the signed policy snapshot and its expiry |
| `GET /hello` | Requires `read` on `nodejs-provider:hello` |
| `POST /hello` | Requires `write` on the same resource; returns a greeting if allowed |

Send a ZTS **role token** in `Athenz-Role-Auth`. The tutorial grants only `read`, so the same token returns HTTP 200 for GET and HTTP 403 for POST. A missing, malformed, or expired role token returns HTTP 401. An unavailable, expired, or invalid policy snapshot returns HTTP 503.

`upstream.json` pins both ZPE and its `@athenz/auth-core` dependency to the Athenz `v1.12.50` release, resolved to commit `8fb407836b73c8b487bd373ab3a60663c698b2ce`. `make install` downloads the 27 listed runtime/license files into the ignored `vendor/` directory and checks their Git blob hashes before installing the locked npm dependencies. Existing files that differ from their pinned hashes are preserved and reported as an error. Upstream source files are used unchanged. The upstream npm packages retain their own `1.0.0` version; `v1.12.50` identifies the Athenz repository release used here.

`make build test` installs the pinned dependencies, checks the JavaScript, and exercises HTTP authorization using temporary in-memory signing fixtures. The app runs directly from JavaScript source. Tests cover real token and policy signature validation, allow/deny behavior, malformed and expired tokens, policy expiry, and log redaction. They do not read existing lab credentials.

After preparing the public verification keys and signed policy snapshot with the guide, `make local` starts the provider at `http://127.0.0.1:18080`. Use `PORT` to select another port. The provider reads `ATHENZ_CONF` and `ATHENZ_POLICY_DIR`, which default to `.local/athenz.conf` and `.local/policies` inside this lab directory. The `.local/` directory is ignored by Git. Refresh the snapshot before it expires or when policies change. Restart the process after changing the public keys, since this library loads them at initialization.

This is a small lab provider. It clears the upstream request caches and checks policy expiry on every authorization request. Upstream messages are sanitized before logging, while the HTTP method, action, resource, and decision remain visible in the terminal running `make local`.
