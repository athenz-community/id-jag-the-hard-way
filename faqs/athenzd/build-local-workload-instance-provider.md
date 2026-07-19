# Goal

Build, test, and inspect the standalone local workload instance provider that will later let `athenzd` use an OIDC ID token as Copper Argos attestation. This procedure stops before mounting the plugin into ZTS, registering the provider, or requesting a certificate.

<!-- TOC depthFrom:2 depthTo:2 -->

- [Prerequisites](#prerequisites)
- [Step 1. Build and test the provider](#step-1-build-and-test-the-provider)
- [Step 2. Inspect the plugin JAR](#step-2-inspect-the-plugin-jar)
- [Step 3. Verify the export-only image](#step-3-verify-the-export-only-image)
- [Step 4. Understand the published artifact](#step-4-understand-the-published-artifact)
- [Step 5. Record the future ZTS contract](#step-5-record-the-future-zts-contract)
- [FAQs](#faqs)
- [Reference](#reference)

<!-- /TOC -->

<details>
<summary>Verification status — 🟡 Pending human verification</summary>

| # | Date | Status |
|---|------|--------|
| 1 | TBD  | 🟡 Pending — human has not confirmed this procedure |

</details>

# Prerequisites

- Complete [Test `athenzd` with IDTHW](./test-athenzd-with-idthw.md) if you also want the local Keycloak and Athenz identities used by the future integration.
- Install Java 17 and Maven.
- Start Docker only for the image verification step.
- Run commands from the repository root.

> [!NOTE]
> Building this artifact does not change the running IDTHW cluster. The existing `athenzd` test continues to perform browser login and ZMS registration only.

# Steps

## Step 1. Build and test the provider

Build the thin plugin JAR and run its tests:

```sh
make -C local_workload_instance_provider build
```

The Maven output must end with `BUILD SUCCESS`. The JAR is written to:

```text
local_workload_instance_provider/target/local-workload-instance-provider.jar
```

## Step 2. Inspect the plugin JAR

Confirm the JAR contains the provider class:

```sh
jar tf local_workload_instance_provider/target/local-workload-instance-provider.jar \
  | grep -F 'com/yahoo/athenz/instance/provider/impl/InstanceLocalWorkloadProvider.class'
```

Expected output:

```text
com/yahoo/athenz/instance/provider/impl/InstanceLocalWorkloadProvider.class
```

This module is self-contained at build time. It attributes the upstream reference implementation, but it does not download that implementation at build or runtime.

## Step 3. Verify the export-only image

Build the local carrier image:

```sh
docker build \
  -t local-workload-instance-provider:local \
  ./local_workload_instance_provider
```

Export the JAR through the image's `/export` volume:

```sh
_export_dir="$(mktemp -d)"

docker run --rm \
  -v "${_export_dir}:/export" \
  local-workload-instance-provider:local

ls -l "${_export_dir}/local-workload-instance-provider.jar"
```

The image is only a JAR carrier. It exits after copying the JAR and does not run a provider service.

Remove the temporary export after inspection:

```sh
rm -r "${_export_dir}"
```

## Step 4. Understand the published artifact

The publish workflow builds, tests, and packages the provider as:

```text
ghcr.io/mlajkim/local-workload-instance-provider
```

A push to `main` publishes `latest`; pull requests use a PR-derived tag following the existing Keycloak token exchange provider convention. After `latest` has been published, extract it with:

```sh
mkdir -p ./export

docker run --rm \
  -v "${PWD}/export:/export" \
  ghcr.io/mlajkim/local-workload-instance-provider:latest
```

The exported artifact is:

```text
./export/local-workload-instance-provider.jar
```

## Step 5. Record the future ZTS contract

The future Athenz provider service endpoint will be:

```text
class://com.yahoo.athenz.instance.provider.impl.InstanceLocalWorkloadProvider
```

The intended local IDTHW properties are:

```properties
athenz.zts.local_workload.issuer=https://keycloak.idp:34444/realms/master
athenz.zts.local_workload.jwks_uri=https://keycloak.idp:8443/realms/master/protocol/openid-connect/certs
athenz.zts.local_workload.audience=athenzd
athenz.zts.local_workload.user_name_claim=preferred_username
athenz.zts.local_workload.user_domain_template=home.%s.local
athenz.zts.local_workload.boot_time_offset=300
```

For a valid token containing `preferred_username: idjag-learner`, the provider limits enrollment to `home.idjag-learner.local` and its domain descendants. A separate ZTS policy must still grant the configured provider `launch` permission for the requested service.

Do not apply these settings yet. This stage does not:

- mount the JAR into ZTS;
- register an Athenz provider service;
- add ZTS launch policies;
- add CSR generation or a `POST /zts/v1/instance` client to `athenzd`; or
- issue or refresh an X.509 certificate.

# FAQs

**Is this the same plugin used in Tutorial 14?**

No. Tutorial 14's Keycloak token exchange provider validates an ID token for an OAuth token exchange. This plugin implements Athenz's `InstanceProvider` interface and will validate an ID token as instance attestation during Copper Argos certificate enrollment. Both run in ZTS, but they serve different endpoints and trust decisions.

**Can I configure `idp_user=idjag-learner` to choose the authenticated user?**

No. A local setting must not override the identity signed by the IdP. The provider treats the configured token claim, `preferred_username` for IDTHW, as authoritative. A future OIDC `login_hint` could prefill an IdP login screen, but the returned ID token still determines the authenticated user.

**Does the IdP have one fixed default username during OpenID Connect login?**

No. Keycloak may reuse its current browser SSO session, which can make one account appear to be the default, but the OIDC protocol does not fix one username for the client. To switch users, the client must start a login that allows account selection or reauthentication, or the tester must use separate browser sessions. That login UX belongs in `athenzd`, not in this provider.

**Can the provider validate ID tokens for multiple users?**

Yes. It validates each attestation token independently and derives the allowed home-domain root from that token's signed username claim. Supporting convenient simultaneous account caches or switching profiles in the CLI is separate future `athenzd` work.

**Why can the issuer and JWKS URI use different ports?**

The issuer must exactly match the browser-issued token's `iss` claim at `keycloak.idp:34444`. The ZTS pod will retrieve the same issuer's signing keys through Keycloak's in-cluster HTTPS port `8443`.

**What prevents one user from requesting another user's service certificate?**

The provider validates the token signature, exact issuer, audience, lifetime, subject, and configured username claim. It then accepts only the derived domain root or a label-boundary descendant. ZTS launch policy remains an additional independent authorization check.

**Can I deploy the plugin after completing this FAQ?**

Not yet. The build and publishing pieces are ready, but the ZTS mount, provider registration, policy, trust-store configuration, and `athenzd` instance-registration client are intentionally deferred to the local Copper Argos integration.

# Reference

- [Test `athenzd` with IDTHW](./test-athenzd-with-idthw.md)
- [Local workload instance provider README](../../local_workload_instance_provider/README.md)
- [`InstanceLocalWorkloadProvider`](../../local_workload_instance_provider/src/main/java/com/yahoo/athenz/instance/provider/impl/InstanceLocalWorkloadProvider.java)
- [Provider test workflow](../../.github/workflows/test-local-workload-instance-provider.yml)
- [Provider publish workflow](../../.github/workflows/publish-local-workload-instance-provider.yml)
- [Tutorial 14: Trusted Identity Provider](../../tutorials/14-trusted-identity-provider.md)
- [Upstream reference implementation](https://github.com/ctyano/athenz-plugins/blob/3b39eab88978494d42d260bca6ef4f4607d80641/src/main/java/com/yahoo/athenz/instance/provider/impl/InstanceLocalWorkloadProvider.java)
