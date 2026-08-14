# Goal

The goal of this document is to verify certificate SAN-DNS validation hardening introduced in Athenz v1.12.42 by testing role-certificate DNS SAN inheritance, strict rejection, and external role-certificate validation, with the following steps:

<!-- TOC depthFrom:2 depthTo:2 -->

- [Step 1. Create the temporary workspace](#step-1-create-the-temporary-workspace)
- [Step 2. Save the original ZTS properties](#step-2-save-the-original-zts-properties)
- [Step 3. Create a test principal certificate with a custom DNS SAN](#step-3-create-a-test-principal-certificate-with-a-custom-dns-san)
- [Step 4. Enable strict role certificate DNS validation](#step-4-enable-strict-role-certificate-dns-validation)
- [Step 5. Verify that a role certificate can inherit the principal DNS SAN](#step-5-verify-that-a-role-certificate-can-inherit-the-principal-dns-san)
- [Step 6. Build a narrow external certificate data validator](#step-6-build-a-narrow-external-certificate-data-validator)
- [Step 7. Mount and enable the external validator](#step-7-mount-and-enable-the-external-validator)
- [Step 8. Verify the external validator for a role certificate](#step-8-verify-the-external-validator-for-a-role-certificate)
- [Step 9. Verify a non-allowlisted role DNS SAN remains rejected](#step-9-verify-a-non-allowlisted-role-dns-san-remains-rejected)

<!-- /TOC -->

<details>
<summary>Verification status — 🟡 Pending human verification</summary>

| # | Date | Status                                              |
|---|------|-----------------------------------------------------|
| 1 | TBD  | 🟡 Pending — human has not confirmed this procedure |

</details>

# Prerequisites

This tutorial requires the following to be completed:

1. Complete the main [ID-JAG The Hard Way tutorial](../../../tutorials/16-id-jag.md), including the final ID-JAG step.

# Prerequisite Knowledge

**How ZTS validates a role-certificate DNS SAN**

1. Accept if the original X.509 certificate (service certificate) contains the DNS SAN.
  - Introduced in [Athenz PR #3363 — extend role cert san-dns validation check](https://github.com/AthenZ/athenz/pull/3363)
1. If not, accept it when it matches the ZTS-configured DNS suffix: `athenz.zts.cert_dns_suffix=.athenz.cloud`.
1. If an external validator is configured, use it.
  - Introduced in [Athenz PR #3375 — add external cert data validator for san dns entries](https://github.com/AthenZ/athenz/pull/3375)

If none of the checks above accepts the DNS SAN, ZTS checks:

`athenz.zts.validate_role_cert_dns_names=[true|false]`

If `true`, it rejects the request. If `false`, it writes a log but still allows the role certificate to be fetched.

# Steps

Here is the procedure to get to the goals.

## Step 1. Create the temporary workspace

Create one explicit temporary workspace for this research procedure:

```sh
_san_test_dir=/private/tmp/idthw-1-12-42-san-dns
mkdir -p "${_san_test_dir}"
```

## Step 2. Save the original ZTS properties

Save the full original `zts.properties` value before changing it. The cleanup step restores this exact value, including the Keycloak provider configuration created by the main tutorial:

```sh
kubectl -n athenz get configmap athenz-zts-conf \
  -o jsonpath='{.data.zts\.properties}' \
  > "${_san_test_dir}/zts.properties.original"
```

Confirm the backup is non-empty:

```sh
test -s "${_san_test_dir}/zts.properties.original" \
  && echo 'Original ZTS properties saved'
```

## Step 3. Create a test principal certificate with a custom DNS SAN

Create a client certificate for the existing tutorial identity `human.idjag-learner` directly with the tutorial root CA. Its optional DNS domain deliberately uses `inherited.example`, which is outside the normal tutorial certificate suffix:

```sh
./tools/athenz/create-cert-with-root-ca.sh \
  human \
  idjag-learner \
  ./keys/idjag-learner.key \
  "${_san_test_dir}/principal.cert.pem" \
  --dns-domain inherited.example
```

```sh
#   ·  Creating certificate for human.idjag-learner with the tutorial root CA...
#   ·  Included DNS SAN: idjag-learner.human.inherited.example
#   ✔  Certificate saved to: /private/tmp/idthw-1-12-42-san-dns/principal.cert.pem
```

Verify the identity and DNS SAN:

```sh
openssl x509 \
  -in "${_san_test_dir}/principal.cert.pem" \
  -noout \
  -subject \
  -issuer \
  -ext subjectAltName
```

The output must contain:

```sh
# subject=C=US, O=Oath Inc., OU=Athenz, CN=human.idjag-learner
# issuer=CN=Test CA Certificate
# DNS:idjag-learner.human.inherited.example
```

## Step 4. Enable strict role certificate DNS validation

Remove any previous value of the validation property from the saved configuration, append `true`, and update only the `zts.properties` ConfigMap entry:

```sh
_zts_properties="$(
  sed '/^athenz\.zts\.validate_role_cert_dns_names=/d' \
    "${_san_test_dir}/zts.properties.original"
)"
_zts_properties="${_zts_properties}"$'\nathenz.zts.validate_role_cert_dns_names=true'

kubectl -n athenz patch configmap athenz-zts-conf \
  --type merge \
  --patch "$(
    jq -n \
      --arg properties "${_zts_properties}" \
      '{data:{"zts.properties":$properties}}'
  )"
```

```sh
# configmap/athenz-zts-conf patched
```

Restart ZTS so it loads the updated Java property:

```sh
kubectl -n athenz rollout restart deployment/athenz-zts-server
kubectl -n athenz rollout status deployment/athenz-zts-server
```

Confirm the active property:

```sh
kubectl -n athenz exec deployment/athenz-zts-server \
  -c athenz-zts-server \
  -- grep '^athenz.zts.validate_role_cert_dns_names=' \
    /opt/athenz/zts/conf/zts_server/zts.properties
```

```sh
# athenz.zts.validate_role_cert_dns_names=true
```

## Step 5. Verify that a role certificate can inherit the principal DNS SAN

PR #3363 changed strict role-certificate validation from requiring exactly one built-in DNS SAN to evaluating every requested entry. A DNS SAN is accepted when it exactly exists in the authenticated principal certificate or matches the built-in `<service>.<domain-with-dashes>.<allowed-suffix>` form. One unrecognized entry rejects the request when strict validation is enabled.

Request `api:role.docs-getter` with `--dns-domain inherited.example`. `fetch-role-cert.sh` derives `idjag-learner.human.inherited.example`, exactly matching the DNS SAN in the authenticated principal certificate:

```sh
./tools/athenz/fetch-role-cert.sh \
  api \
  docs-getter \
  "${_san_test_dir}/principal.cert.pem" \
  ./keys/idjag-learner.key \
  --dns-domain inherited.example \
  --output "${_san_test_dir}/inherited-role.cert.pem"
```

Inspect the issued role certificate:

```sh
openssl x509 \
  -in "${_san_test_dir}/inherited-role.cert.pem" \
  -noout \
  -subject \
  -ext subjectAltName
```

```sh
# subject=C=US, O=Oath Inc., OU=Athenz, CN=api:role.docs-getter
# X509v3 Subject Alternative Name:
#     URI:spiffe://api/ra/docs-getter, URI:athenz://principal/human.idjag-learner, DNS:idjag-learner.human.inherited.example
```

Before installing the external validator, ZTS denies the request with `--dns-domain external.example` because the authenticated principal certificate does not contain that DNS SAN and the built-in rules do not recognize it.

```sh
./tools/athenz/fetch-role-cert.sh \
  api \
  docs-getter \
  "${_san_test_dir}/principal.cert.pem" \
  ./keys/idjag-learner.key \
  --dns-domain external.example \
  --output "${_san_test_dir}/external-role.cert.pem"
```

```sh
#   ·  Creating role certificate request for api:role.docs-getter as human.idjag-learner...
#   ·  Requesting DNS SAN: idjag-learner.human.external.example
#   ✘  ZTS error response:
# {
#   "code": 400,
#   "message": "Unable to validate cert request"
# }

# ✘ Failed to fetch role certificate for api:role.docs-getter (HTTP 400)
```

Check the ZTS log:

```sh
kubectl -n athenz logs deployment/athenz-zts-server \
  -c athenz-zts-server \
  --since=5m \
  | grep 'Role Certificate sanDNS Validation - invalid entry'
```

```sh
# ... Role Certificate sanDNS Validation - invalid entry: idjag-learner.human.external.example, principal: human.idjag-learner
```

## Step 6. Build a narrow external certificate data validator

PR #3375 added `CertificateDataValidator` and `CertificateDataValidatorFactory`. When configured, ZTS calls the plugin only after its built-in SAN-DNS checks cannot recognize a requested name. Returning `true` accepts that name; returning `false` leaves strict validation to reject it. A production validator must verify authoritative ownership and must never allow every name.

Create a minimal Maven project in the temporary workspace:

```sh
mkdir -p \
  "${_san_test_dir}/validator/src/main/java/io/github/mlajkim/idthw/cert"
```

Create its POM. The `provided` dependency supplies the interfaces at compile time while ZTS supplies them at runtime:

```sh
cat > "${_san_test_dir}/validator/pom.xml" <<'EOF'
<project xmlns="http://maven.apache.org/POM/4.0.0"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>

  <groupId>io.github.mlajkim.idthw</groupId>
  <artifactId>idthw-cert-data-validator</artifactId>
  <version>1.0.0</version>

  <properties>
    <maven.compiler.release>17</maven.compiler.release>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
  </properties>

  <dependencies>
    <dependency>
      <groupId>com.yahoo.athenz</groupId>
      <artifactId>athenz-server-common</artifactId>
      <version>1.12.42</version>
      <scope>provided</scope>
    </dependency>
  </dependencies>
</project>
EOF
```

Create a factory that permits only one exact role DNS SAN. The interface requires a service-certificate method too, but this focused validator returns `false` for that path:

```sh
cat > "${_san_test_dir}/validator/src/main/java/io/github/mlajkim/idthw/cert/AllowlistedCertificateDataValidatorFactory.java" <<'EOF'
package io.github.mlajkim.idthw.cert;

import com.yahoo.athenz.common.server.cert.CertificateDataValidator;
import com.yahoo.athenz.common.server.cert.CertificateDataValidatorFactory;

import java.util.List;

public final class AllowlistedCertificateDataValidatorFactory
        implements CertificateDataValidatorFactory {

    @Override
    public CertificateDataValidator create() {
        return new AllowlistedCertificateDataValidator();
    }

    private static final class AllowlistedCertificateDataValidator
            implements CertificateDataValidator {

        private static final String ALLOWED_DNS =
                "idjag-learner.human.external.example";

        @Override
        public boolean validateServiceIdentityCertSanDnsName(
                String domainName,
                String serviceName,
                String dnsName,
                String serviceDnsSuffix,
                List<String> providerDnsSuffixes) {
            return false;
        }

        @Override
        public boolean validateRoleCertSanDnsName(
                String roleDomainName,
                String roleName,
                String principalName,
                String dnsName,
                List<String> roleDnsSuffixList) {
            return "api".equals(roleDomainName)
                    && "docs-getter".equals(roleName)
                    && "human.idjag-learner".equals(principalName)
                    && ALLOWED_DNS.equals(dnsName);
        }
    }
}
EOF
```

Build the test-only JAR:

```sh
mvn \
  -f "${_san_test_dir}/validator/pom.xml" \
  clean package
```

```sh
# ...
# [INFO] ------------------------------------------------------------------------
# [INFO] BUILD SUCCESS
# [INFO] ------------------------------------------------------------------------
# [INFO] Total time:  7.016 s
# [INFO] Finished at: 2026-08-14T10:03:38+09:00
# [INFO] ------------------------------------------------------------------------
```

Verify the expected class is present:

```sh
jar tf \
  "${_san_test_dir}/validator/target/idthw-cert-data-validator-1.0.0.jar" \
  | grep 'AllowlistedCertificateDataValidatorFactory.class'
```

```sh
# io/github/mlajkim/idthw/cert/AllowlistedCertificateDataValidatorFactory.class
```


## Step 7. Mount and enable the external validator

Create a ConfigMap containing the small plugin JAR:

```sh
kubectl -n athenz create configmap cert-data-validator-plugin \
  --from-file=idthw-cert-data-validator.jar="${_san_test_dir}/validator/target/idthw-cert-data-validator-1.0.0.jar" \
  --dry-run=client \
  -o yaml \
  | kubectl apply -f -
```

```sh
# configmap/cert-data-validator-plugin created
```

Mount the JAR under `/athenz/plugins`, which is already included in the ZTS `USER_CLASSPATH`:

```sh
kubectl -n athenz patch deployment athenz-zts-server --patch "$(cat <<'EOF'
spec:
  template:
    spec:
      volumes:
        - name: cert-data-validator-plugin
          configMap:
            name: cert-data-validator-plugin
      containers:
        - name: athenz-zts-server
          volumeMounts:
            - name: cert-data-validator-plugin
              mountPath: /athenz/plugins/idthw-cert-data-validator.jar
              subPath: idthw-cert-data-validator.jar
              readOnly: true
EOF
)"
```

```sh
# deployment.apps/athenz-zts-server patched
```

Rebuild the ZTS properties from the original backup, then enable both strict validation and the plugin factory:

```sh
_zts_properties="$(
  sed \
    -e '/^athenz\.zts\.validate_role_cert_dns_names=/d' \
    -e '/^athenz\.zts\.cert_data_validator_factory_class=/d' \
    "${_san_test_dir}/zts.properties.original"
)"
_zts_properties="${_zts_properties}"$'\nathenz.zts.validate_role_cert_dns_names=true'
_zts_properties="${_zts_properties}"$'\nathenz.zts.cert_data_validator_factory_class=io.github.mlajkim.idthw.cert.AllowlistedCertificateDataValidatorFactory'

kubectl -n athenz patch configmap athenz-zts-conf \
  --type merge \
  --patch "$(
    jq -n \
      --arg properties "${_zts_properties}" \
      '{data:{"zts.properties":$properties}}'
  )"
```

Restart ZTS and verify the JAR and property:

```sh
kubectl -n athenz rollout restart deployment/athenz-zts-server
kubectl -n athenz rollout status deployment/athenz-zts-server
```

Check the jar:

```sh
kubectl -n athenz exec deployment/athenz-zts-server \
  -c athenz-zts-server \
  -- ls -l /athenz/plugins/idthw-cert-data-validator.jar
```

```sh
# -rw-r--r-- 1 root root 3965 Aug 14 10:05 /athenz/plugins/idthw-cert-data-validator.jar
```

```sh
kubectl -n athenz exec deployment/athenz-zts-server \
  -c athenz-zts-server \
  -- grep '^athenz.zts.cert_data_validator_factory_class=' \
    /opt/athenz/zts/conf/zts_server/zts.properties
```

```sh
# athenz.zts.cert_data_validator_factory_class=io.github.mlajkim.idthw.cert.AllowlistedCertificateDataValidatorFactory
```

## Step 8. Verify the external validator for a role certificate

Request `api:role.docs-getter` with `external.example`. This DNS SAN is neither inherited from the principal certificate nor allowed by the built-in ZTS suffix, so the request can succeed only through the external role-certificate validator:

```sh
./tools/athenz/fetch-role-cert.sh \
  api \
  docs-getter \
  "${_san_test_dir}/principal.cert.pem" \
  ./keys/idjag-learner.key \
  --dns-domain external.example \
  --output "${_san_test_dir}/external-role.cert.pem"
```

Inspect the result:

```sh
openssl x509 \
  -in "${_san_test_dir}/external-role.cert.pem" \
  -noout \
  -subject \
  -ext subjectAltName
```

The output must contain:

```sh
# subject=C=US, O=Oath Inc., OU=Athenz, CN=api:role.docs-getter
# X509v3 Subject Alternative Name:
#     URI:spiffe://api/ra/docs-getter, URI:athenz://principal/human.idjag-learner, DNS:idjag-learner.human.external.example
```

## Step 9. Verify a non-allowlisted role DNS SAN remains rejected

The validator must not turn strict validation into an allow-all rule. Repeat the role request with `denied.example`:

```sh
./tools/athenz/fetch-role-cert.sh \
  api \
  docs-getter \
  "${_san_test_dir}/principal.cert.pem" \
  ./keys/idjag-learner.key \
  --dns-domain denied.example \
  --output "${_san_test_dir}/denied-role.cert.pem"
```

```sh
#   ·  Creating role certificate request for api:role.docs-getter as human.idjag-learner...
#   ·  Requesting DNS SAN: idjag-learner.human.denied.example
#   ✘  ZTS error response:
# {
#   "code": 400,
#   "message": "Unable to validate cert request"
# }

# ✘ Failed to fetch role certificate for api:role.docs-getter (HTTP 400)
```

The command must fail because the external validator does not allow the denied role DNS SAN.

# Reference

- Core PRs:
  - [Athenz v1.12.42 release](https://github.com/AthenZ/athenz/releases/tag/v1.12.42)
    - [Athenz PR #3315 — enforce role cert SAN-DNS validation](https://github.com/AthenZ/athenz/pull/3315)
    - [Athenz PR #3363 — extend role cert san-dns validation check](https://github.com/AthenZ/athenz/pull/3363)
    - [Athenz PR #3375 — add external cert data validator for san dns entries](https://github.com/AthenZ/athenz/pull/3375)
- [Athenz `CertificateDataValidator`](https://github.com/AthenZ/athenz/blob/v1.12.43/libs/java/server_common/src/main/java/com/yahoo/athenz/common/server/cert/CertificateDataValidator.java)
- [Athenz `X509RoleCertRequest`](https://github.com/AthenZ/athenz/blob/v1.12.43/servers/zts/src/main/java/com/yahoo/athenz/zts/cert/X509RoleCertRequest.java)
- [ID-JAG The Hard Way](https://github.com/mlajkim/id-jag-the-hard-way)
