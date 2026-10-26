# Athenz Node.js provider

A simple HTTP provider using the real Athenz Node.js ZPE and auth-core libraries. Build its image with `VERSION=v1.12.46` to use the older parser or `VERSION=v1.12.50` to use the fixed parser. The default is `v1.12.50`; bare versions such as `1.12.46` are also accepted.

Follow the complete [v1.12.46 setup and HTTP tests](../../../research/athenz/nodejs-client/261025-reproduce-nodejs-token-parsing-v1.12.46.md) or [v1.12.50 setup and HTTP tests](../../../research/athenz/nodejs-client/261026-verify-nodejs-token-parsing-v1.12.50.md). Both guides build the actual provider, configure the API roles and signed policy snapshot, run the image, and send requests with the learner's role token.

From this lab directory, build the release you want:

```sh
make build VERSION=v1.12.46
```

```sh
# Expected image tag; Docker prints the complete build log
# naming to docker.io/library/idthw-athenz-nodejs-provider:v1.12.46 done
```

| Setting | Default | Purpose |
|---|---|---|
| `VERSION` | `v1.12.50` | Selects the pinned Athenz library release for the image |
| `IMAGE` | `idthw-athenz-nodejs-provider:<version>` | Local image name and tag |
| `PORT` | `18080` | Host port published by `make run` on `127.0.0.1` |
| `ZMS_URL` | `https://localhost:4443/zms/v1` | Source of the ZMS public verification keys |
| `ZTS_URL` | `https://localhost:8443/zts/v1` | Source of the ZTS public keys, policies, and role tokens |

Only `v1.12.46` and `v1.12.50` are supported. Their manifests pin repository commits and all 27 runtime/license file hashes. The build fetches unchanged upstream files and installs the locked npm dependencies. The upstream packages retain their own npm version `1.0.0`; `VERSION` identifies the Athenz repository release. The image's `/healthz` response reports its selected release and commit.

| Target | Purpose |
|---|---|
| `make build VERSION=<version>` | Build the provider image for that release |
| `make run VERSION=<version>` | Run that image with the public-key and signed-policy files mounted read-only |
| `make configure` | Save ZMS/ZTS endpoint choices without building |
| `make endpoints` | Display the effective endpoint URLs |
| `make sync` | Fetch the public keys and signed `api` policies with the saved endpoints |
| `make native-build test` | Build and test the default `v1.12.50` app directly on the host |
| `make local` | Run the default host app directly with Node.js |

The first build resolves local endpoints through IDTHW's `tools/port.sh`, including port overrides, then saves them in `.local/endpoints.json`. Explicit `ZMS_URL` and `ZTS_URL` values override saved settings. Pass full `/zms/v1` and `/zts/v1` base URLs to `make build` or `make configure` to select another environment.

After the policies exist on the selected server, `make sync` writes `.local/athenz.conf` and `.local/policies/api.pol`. It defaults to the tutorial CA and learner identity at `athenz_dist/certs/ca.cert.pem`, `keys/idjag-learner.crt`, and `keys/idjag-learner.key` relative to the repository root. `ATHENZ_CA_CERT`, `ATHENZ_CLIENT_CERT`, and `ATHENZ_CLIENT_KEY` select other paths. The guides use [fetch-role-token.sh](../../../tools/athenz/fetch-role-token.sh) with the same identity settings and selected ZTS endpoint.

`make run` mounts only `.local/athenz.conf` and `.local/policies` into the container and publishes `http://127.0.0.1:18080`. The Docker build context is an allowlist of application source, scripts, package metadata, and pinned manifests. Images are built manually; this lab has no CI pipeline.

| Request | Behavior |
|---|---|
| `GET /healthz` | Reports the running Athenz library release and commit |
| `GET /readyz` | Verifies the signed `api` policy snapshot and its expiry |
| `GET /api/docs` | Requires `get` on `api:docs` |
| `POST /api/docs` | Requires `post` on `api:docs` |

Send a ZTS role token in `Athenz-Role-Auth`. The guides grant GET to `api:role.docs-getter` and POST to `api:role.docs-poster`, then request a token restricted to `docs-getter` as `human.idjag-learner`. The regular token allows GET and denies POST. Appending an unsigned poster role produces an unauthorized POST allowance in `v1.12.46` and an invalid-token rejection in `v1.12.50`.

The app reloads signed policies and revalidates tokens on each authorization request, checks snapshot expiry, and sanitizes upstream token logs. Rerun sync when policies change or before the snapshot expires. Restart the provider after verification-key rotation because this library loads the public keys at initialization.
