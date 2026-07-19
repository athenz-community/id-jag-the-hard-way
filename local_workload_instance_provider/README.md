# Local Workload Instance Provider

This standalone Maven module builds a class-based Athenz Copper Argos provider that accepts an OIDC ID token as instance attestation data. It is intentionally not deployed or registered by this repository yet.

The later `athenzd` flow will generate a private key and CSR locally, submit the cached ID token to ZTS `POST /zts/v1/instance`, and receive an X.509 service certificate. The private key must never leave the workstation.

## Build

Java 17 and Maven are required.

```sh
make build
```

The thin plugin JAR is written to:

```text
target/local-workload-instance-provider.jar
```

Run only the tests with:

```sh
make test
```

## Published image

The [publish workflow](../.github/workflows/publish-local-workload-instance-provider.yml) packages the tested JAR as:

```text
ghcr.io/<repository-owner>/local-workload-instance-provider
```

Pushes to `main` publish the `latest` tag. Pull requests use the same PR-tagging convention as the existing Keycloak token exchange provider workflow.

The image is a JAR carrier, not a running provider service. Extract the JAR through its `/export` volume:

```sh
mkdir -p ./export
docker run --rm \
  -v "${PWD}/export:/export" \
  ghcr.io/mlajkim/local-workload-instance-provider:latest
```

The exported file is `./export/local-workload-instance-provider.jar`.

## Provider class

The future Athenz provider service endpoint will be:

```text
class://com.yahoo.athenz.instance.provider.impl.InstanceLocalWorkloadProvider
```

Do not load this JAR alongside another JAR containing the same class. Which duplicate class wins would depend on classpath order.

## Configuration contract

| Property | Required | Default | Purpose |
|---|---:|---|---|
| `athenz.zts.local_workload.issuer` | yes | — | Comma-separated exact issuer allowlist. |
| `athenz.zts.local_workload.audience` | yes | — | Comma-separated accepted ID-token audiences. |
| `athenz.zts.local_workload.jwks_uri` | no | discovery | JWKS URI when exactly one issuer is configured. |
| `athenz.zts.local_workload.jwks_uri_map` | no | — | Semicolon-separated `issuer=jwks-uri` entries for allowed issuers. |
| `athenz.zts.local_workload.user_name_claim` | no | `athenz_user` | Claim mapped to the Athenz home-domain name. |
| `athenz.zts.local_workload.user_domain_template` | no | `home.%s` | Allowed domain root; `%s` is replaced by the validated user name. |
| `athenz.zts.local_workload.boot_time_offset` | no | `0` | Maximum token age in seconds; `0` disables only the freshness window. |
| `athenz.zts.local_workload.external_domain` | no | — | Fallback domain for a single issuer when the user claim is absent. |
| `athenz.zts.local_workload.external_domain_map` | no | — | Semicolon-separated allowed-issuer-to-domain fallbacks. |

The intended local IDTHW configuration is:

```properties
athenz.zts.local_workload.issuer=https://keycloak.idp:34444/realms/master
athenz.zts.local_workload.jwks_uri=https://keycloak.idp:8443/realms/master/protocol/openid-connect/certs
athenz.zts.local_workload.audience=athenzd
athenz.zts.local_workload.user_name_claim=preferred_username
athenz.zts.local_workload.user_domain_template=home.%s.local
athenz.zts.local_workload.boot_time_offset=300
```

With `preferred_username: idjag-learner`, this permits requests for the domain `home.idjag-learner.local` and its descendants. ZTS policy must independently grant the provider `launch` permission for the exact target service.

## Security boundaries

- Only explicitly allowlisted issuers are accepted.
- Only the configured IdP JWKS is trusted; Athenz ZTS/SIA keys are not added to this validator.
- The token signature, issuer, audience, `exp`, `nbf`, `iat`, and `sub` are validated.
- The user-name claim must be an Athenz simple name and therefore cannot inject domain separators.
- Domain checks use label boundaries, so `home.alice.locality` is not below `home.alice.local`.
- Certificates are client-only and non-refreshable in this first implementation.

The ID token remains a replayable bearer credential until it expires. For local enrollment, configure a short freshness window and narrowly scoped ZTS launch policies.

## Attribution

See [NOTICE.md](./NOTICE.md). The reference implementation is not pulled at build or runtime.

## Deferred integration

This module currently does not:

- mount the JAR into ZTS;
- register an Athenz provider service;
- change ZTS properties or policies;
- add the `athenzd` CSR and `/instance` client; or
- support certificate refresh.

Those changes belong to the later local Copper Argos integration.
