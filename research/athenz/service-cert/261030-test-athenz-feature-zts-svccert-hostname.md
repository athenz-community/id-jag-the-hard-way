# Goal

Use `zts-svccert` inside the `athenz` namespace's `athenz-cli` deployment to compare hostname SANs in CSRs, get rejected when a certificate request omits its provider, then compare service certificates issued without and with a hostname.

<!-- TOC depthFrom:2 depthTo:2 -->

- [Setup 1. Check the CLI in the deployment](#setup-1-check-the-cli-in-the-deployment)
- [Setup 2. Create a disposable key](#setup-2-create-a-disposable-key)
- [Setup 3. Build the DNS resolver for ZTS](#setup-3-build-the-dns-resolver-for-zts)
- [Setup 4. Authorize the provider and hostname suffix](#setup-4-authorize-the-provider-and-hostname-suffix)
- [Setup 5. Enable the DNS resolver in ZTS](#setup-5-enable-the-dns-resolver-in-zts)
- [Step 1. Generate a CSR without a hostname](#step-1-generate-a-csr-without-a-hostname)
- [Step 2. Check the baseline SAN](#step-2-check-the-baseline-san)
- [Step 3. Generate a CSR with a hostname](#step-3-generate-a-csr-with-a-hostname)
- [Step 4. Check the hostname SAN](#step-4-check-the-hostname-san)
- [Step 5. Preserve SPIFFE and instance-ID URIs](#step-5-preserve-spiffe-and-instance-id-uris)
- [Step 6. Get rejected without a provider](#step-6-get-rejected-without-a-provider)
- [Step 7. Get a service certificate without a hostname](#step-7-get-a-service-certificate-without-a-hostname)
- [Step 8. Get a service certificate with a hostname](#step-8-get-a-service-certificate-with-a-hostname)
- [Clean-up 1. Remove the test files](#clean-up-1-remove-the-test-files)

<!-- /TOC -->

<details>
<summary>Last verified on Oct 30, 2026 — Certificate comparison passed (operator log)</summary>

| # | Date | Confirmed Working |
|---|---|---|
| 1 | Oct 30, 2026 | ✅ Both certificate requests succeeded through `sys.auth.zts`; only the request with `-hostname` added the hostname URI, while service CN, DNS, IP, and SPIFFE identity stayed the same |

The deployment uses `ghcr.io/ctyano/athenz-cli:v1.12.48`. Its CLI prints `zts-svccert (development version)` even though the image has a release tag. OpenSSL 3.5.8 was also confirmed inside the container. The CLI check verifies flag parsing only.

Setups 1, 3, 4, and 5 and Steps 7 and 8 contain captured operator output. Setup 2 records an existing-directory error that stopped key creation; later issuance reused the existing key. The standalone CSR checks, missing-provider rejection, and cleanup still show expected results.

The initial template-based Setup 4 command failed twice with `404` / `validateSolutionTemplates: Template not found: zts_instance_launch_provider`. The explicit grants in the revised Setup 4 then succeeded. The operator issued the hostname certificate first and the baseline afterward; the guide presents the baseline first for comparison.

Private-key and certificate reads are prohibited by LY AI Policy rule 1 in the authoring session. Credential-dependent operations were run by the operator; the records in Steps 7 and 8 use the decoded metadata they supplied, with public key and signature value omitted. The [policy documentation](https://github.com/secdev-whc/ai-cli-hardening) describes the managed settings and the user-run removal procedure.

Steps 7 and 8 verify the issued-certificate comparison for #3490: both requests succeed through `sys.auth.zts`, and only the request with `-hostname` produces a hostname URI SAN. The Secure Boot fallback in #3494 is a separate provider flow and is not verified here.

</details>

# Prerequisites

This tutorial requires the following to be completed:

1. Complete the main [ID-JAG The Hard Way lab](https://github.com/mlajkim/id-jag-the-hard-way)

# Steps

Here is the procedure to get to the goals.

## Setup 1. Check the CLI in the deployment

Run the blocks from the IDTHW repository root. Inspect the deployment's image and confirm its existing CLI accepts `-hostname`. The version check exits before loading a key:

```sh
kubectl -n athenz get deployment athenz-cli \
  -o 'jsonpath={.spec.template.spec.containers[?(@.name=="athenz-cli")].image}{"\n"}' &&
kubectl -n athenz exec deploy/athenz-cli -- \
  zts-svccert -hostname worker-1.example.test -version
```

```sh
# Captured operator output — Oct 30, 2026
# ghcr.io/ctyano/athenz-cli:v1.12.48
# zts-svccert (development version)
```

## Setup 2. Create a disposable key

Create one test key inside the CLI pod. All following CSR commands use this same key:

```sh
kubectl -n athenz exec -i deploy/athenz-cli -- sh <<'SH'
mkdir -m 700 /tmp/idthw-svccert-hostname &&
openssl genrsa -traditional \
  -out /tmp/idthw-svccert-hostname/service.key 2048 &&
printf 'Test key created: /tmp/idthw-svccert-hostname/service.key\n'
SH
```

```sh
# Captured operator output — Oct 30, 2026; rerun with an existing directory
# mkdir: can't create directory '/tmp/idthw-svccert-hostname': File exists
# command terminated with exit code 1
```

The directory already existed in this run, so `&&` stopped execution before `openssl genrsa`; the existing key was preserved and used for the later certificate requests. For a fresh run, remove an existing test directory using the first block under Clean-up 1 before repeating this setup.

## Setup 3. Build the DNS resolver for ZTS

The `sys.auth.zts` provider checks that a requested hostname resolves to the CSR's IP SAN, which must match the caller's IP. Build the supplied [DNS resolver](../../../components/labs/hostname-resolver/DnsHostnameResolverFactory.java) with the running ZTS container's JDK and Athenz APIs. The helper also tests DNS resolution from ZTS to the CLI pod:

```sh
bash components/labs/hostname-resolver/build.sh
```

```sh
# Captured operator output — Oct 30, 2026
#   ·  Reading the CLI pod IP for the resolver test...
#   ·  Compiling and testing the resolver with the ZTS container's JDK and Athenz APIs...
# PASS: missing hostnames are rejected
# PASS: unresolved hostname is rejected
# PASS: 10-244-0-22.athenz.pod.cluster.local resolves to 10.244.0.22 from ZTS
#   ✔  Built /Users/jekim/jekim_workspace/jekim_ly_internal_context/idthw/components/labs/hostname-resolver/target/idthw-hostname-resolver.jar
```

The pod IP and corresponding DNS name change when the CLI pod is replaced. This resolver uses cluster DNS; provider authorization and caller-IP validation remain enforced by ZTS.

<details>
<summary>Recorded working-directory error</summary>

The first build attempt ran from the parent `jekim_ly_internal_context` directory:

```sh
# Captured operator log — Oct 30, 2026
# $ bash components/labs/hostname-resolver/build.sh
# bash: components/labs/hostname-resolver/build.sh: No such file or directory
```

The operator ran `cd idthw` and repeated the build successfully, as recorded above.

</details>

## Setup 4. Authorize the provider and hostname suffix

Grant `sys.auth.zts` permission to launch instances of the existing `human.idjag-learner` service and use hostnames under `.athenz.pod.cluster.local`. Create a research role and policy in each domain. These explicit grants work without the `zts_instance_launch_provider` solution template required by `enable-cert-provider.sh`:

```sh
./tools/athenz/create-role.sh human svccert-hostname-test &&
./tools/athenz/add-role-member.sh human svccert-hostname-test sys.auth.zts &&
./tools/athenz/add-policy.sh human svccert-hostname-test launch service.idjag-learner &&
./tools/athenz/create-role.sh sys.auth svccert-hostname-test &&
./tools/athenz/add-role-member.sh sys.auth svccert-hostname-test sys.auth.zts &&
./tools/athenz/add-policy.sh sys.auth svccert-hostname-test launch hostname.athenz.pod.cluster.local
```

```sh
# Captured operator output — Oct 30, 2026
#   ·  Creating Role: human:role.svccert-hostname-test...
#   ✔  Role created: human:role.svccert-hostname-test
#   ·  Adding Member sys.auth.zts to Role: human:role.svccert-hostname-test...
#   ✔  sys.auth.zts  →  human:role.svccert-hostname-test
#   ·  Creating Policy: human:policy.svccert-hostname-test_launch_service_idjag-learner...
#   ✔  Policy created: human:policy.svccert-hostname-test_launch_service_idjag-learner
#   ·  Creating Role: sys.auth:role.svccert-hostname-test...
#   ✔  Role created: sys.auth:role.svccert-hostname-test
#   ·  Adding Member sys.auth.zts to Role: sys.auth:role.svccert-hostname-test...
#   ✔  sys.auth.zts  →  sys.auth:role.svccert-hostname-test
#   ·  Creating Policy: sys.auth:policy.svccert-hostname-test_launch_hostname_athenz_pod_cluster_local...
#   ✔  Policy created: sys.auth:policy.svccert-hostname-test_launch_hostname_athenz_pod_cluster_local
```

<details>
<summary>Recorded template error — two attempts</summary>

The earlier command chain began with `enable-cert-provider.sh`. Both attempts stopped at the missing template before reaching the remaining commands:

```sh
# Captured operator log — Oct 30, 2026; identical failure recorded twice
# $ ./tools/athenz/enable-cert-provider.sh human idjag-learner
#   ·  Enabling ZTS Certificate Provider for human.idjag-learner...
# code: 404
# message: 'validateSolutionTemplates: Template not found: zts_instance_launch_provider'
#
# command terminated with exit code 1
```

The explicit role and policy commands above supplied the required grants without that template.

</details>

## Setup 5. Enable the DNS resolver in ZTS

Store the built resolver JAR in a ConfigMap:

```sh
kubectl -n athenz create configmap idthw-hostname-resolver \
  --from-file=idthw-hostname-resolver.jar=components/labs/hostname-resolver/target/idthw-hostname-resolver.jar
```

```sh
# Captured operator output — Oct 30, 2026
# configmap/idthw-hostname-resolver created
```

Mount the resolver and configure its factory through `JDK_JAVA_OPTIONS`. The guard stops if that environment variable is already configured, so an existing JVM configuration must be reviewed before applying this lab patch:

```sh
_svccert_java_options=$(kubectl -n athenz get deployment athenz-zts-server \
  -o 'jsonpath={.spec.template.spec.containers[?(@.name=="athenz-zts-server")].env[?(@.name=="JDK_JAVA_OPTIONS")].name}') &&
if [ -n "${_svccert_java_options}" ]; then
  printf 'JDK_JAVA_OPTIONS already exists; review its configuration before applying this patch.\n' >&2
  false
else
  kubectl -n athenz patch deployment athenz-zts-server --type strategic \
    --patch-file components/labs/hostname-resolver/deployment-patch.yaml &&
  kubectl -n athenz rollout status deployment/athenz-zts-server --timeout=180s
fi
```

```sh
# Captured operator output — Oct 30, 2026
# deployment.apps/athenz-zts-server patched
# Waiting for deployment spec update to be observed...
# Waiting for deployment "athenz-zts-server" rollout to finish: 0 out of 1 new replicas have been updated...
# Waiting for deployment "athenz-zts-server" rollout to finish: 0 of 1 updated replicas are available...
# Waiting for deployment "athenz-zts-server" rollout to finish: 0 of 1 updated replicas are available...
# deployment "athenz-zts-server" successfully rolled out
```

The [deployment patch](../../../components/labs/hostname-resolver/deployment-patch.yaml) sets `-Dathenz.zts.hostname_resolver_factory_class=io.github.mlajkim.idthw.cert.DnsHostnameResolverFactory` through `JDK_JAVA_OPTIONS`. At startup, [ZTS loads that factory and calls `create()`](https://github.com/AthenZ/athenz/blob/v1.12.48/servers/zts/src/main/java/com/yahoo/athenz/zts/ZTSImpl.java#L995) to obtain the resolver. This setting activates the resolver; Setup 4's policies authorize the certificate requests.

## Step 1. Generate a CSR without a hostname

Generate the baseline CSR. Disable SPIFFE for this comparison so the added hostname URI will be easy to see:

```sh
kubectl -n athenz exec -i deploy/athenz-cli -- sh <<'SH'
zts-svccert \
  -csr -spiffe=false \
  -private-key /tmp/idthw-svccert-hostname/service.key \
  -domain human -service idjag-learner \
  -dns-domain zts.athenz.cloud \
  > /tmp/idthw-svccert-hostname/baseline.csr &&
printf 'CSR saved: /tmp/idthw-svccert-hostname/baseline.csr\n'
SH
```

```sh
# Expected result
# CSR saved: /tmp/idthw-svccert-hostname/baseline.csr
```

## Step 2. Check the baseline SAN

Display the CSR with its public-key section and signature value omitted. Keep the signature algorithm and requested extensions visible:

```sh
kubectl -n athenz exec -i deploy/athenz-cli -- sh <<'SH'
openssl req -in /tmp/idthw-svccert-hostname/baseline.csr \
  -noout -text -reqopt no_pubkey \
  | awk '/^[[:space:]]*Signature Value:/ { exit } { print }'
SH
```

```sh
# Expected output
# Certificate Request:
#     Data:
#         Version: 1 (0x0)
#         Subject: C=US, O=Oath Inc., OU=Athenz, CN=human.idjag-learner
#         Attributes:
#             Requested Extensions:
#                 X509v3 Subject Alternative Name:
#                     DNS:idjag-learner.human.zts.athenz.cloud
#     Signature Algorithm: sha256WithRSAEncryption
```

This is the baseline: the SAN contains the service DNS name, and no `athenz://hostname/` URI is present.

## Step 3. Generate a CSR with a hostname

Use the same key and service details, adding `-hostname`. The `-csr` option permits this without `-provider`:

```sh
kubectl -n athenz exec -i deploy/athenz-cli -- sh <<'SH'
zts-svccert \
  -csr -spiffe=false \
  -private-key /tmp/idthw-svccert-hostname/service.key \
  -domain human -service idjag-learner \
  -dns-domain zts.athenz.cloud \
  -hostname worker-1.example.test \
  > /tmp/idthw-svccert-hostname/with-hostname.csr &&
printf 'CSR saved: /tmp/idthw-svccert-hostname/with-hostname.csr\n'
SH
```

```sh
# Expected result
# CSR saved: /tmp/idthw-svccert-hostname/with-hostname.csr
```

## Step 4. Check the hostname SAN

Display the new CSR with the same public-key and signature-value omissions. Under `Requested Extensions`, check that the service DNS name is preserved and the requested hostname URI has been added:

```sh
kubectl -n athenz exec -i deploy/athenz-cli -- sh <<'SH'
openssl req -in /tmp/idthw-svccert-hostname/with-hostname.csr \
  -noout -text -reqopt no_pubkey \
  | awk '/^[[:space:]]*Signature Value:/ { exit } { print }'
SH
```

```sh
# Expected output
# Certificate Request:
#     Data:
#         Version: 1 (0x0)
#         Subject: C=US, O=Oath Inc., OU=Athenz, CN=human.idjag-learner
#         Attributes:
#             Requested Extensions:
#                 X509v3 Subject Alternative Name:
#                     DNS:idjag-learner.human.zts.athenz.cloud, URI:athenz://hostname/worker-1.example.test
#     Signature Algorithm: sha256WithRSAEncryption
```

The comparison passes when these two checks match:

| What to check | Step 2: baseline | Step 4: with hostname |
|---|---|---|
| Service DNS SAN | `DNS:idjag-learner.human.zts.athenz.cloud` | The same `DNS:idjag-learner.human.zts.athenz.cloud` |
| Instance hostname URI SAN | Absent | `URI:athenz://hostname/worker-1.example.test` |

The new option records the instance hostname as an Athenz URI SAN. The service's DNS identity stays the same.

## Step 5. Preserve SPIFFE and instance-ID URIs

Include SPIFFE, an instance ID, and a hostname in one CSR. The provider here supplies the instance URI's provider component; `-csr` returns inside the container without a ZTS request:

```sh
kubectl -n athenz exec -i deploy/athenz-cli -- sh <<'SH'
zts-svccert \
  -csr -spiffe \
  -private-key /tmp/idthw-svccert-hostname/service.key \
  -domain human -service idjag-learner \
  -dns-domain zts.athenz.cloud \
  -provider sys.auth.zts -instance research-3490 \
  -hostname worker-1.example.test \
  > /tmp/idthw-svccert-hostname/combined.csr &&
printf 'CSR saved: /tmp/idthw-svccert-hostname/combined.csr\n'
SH
```

```sh
# Expected result
# CSR saved: /tmp/idthw-svccert-hostname/combined.csr
```

Check that the saved CSR contains all three URI SANs:

```sh
kubectl -n athenz exec -i deploy/athenz-cli -- sh <<'SH'
openssl req -in /tmp/idthw-svccert-hostname/combined.csr \
  -noout -text -reqopt no_pubkey \
  | awk '/^[[:space:]]*Signature Value:/ { exit } { print }'
SH
```

```sh
# Expected output
# Certificate Request:
#     Data:
#         Version: 1 (0x0)
#         Subject: C=US, O=Oath Inc., OU=Athenz, CN=human.idjag-learner
#         Attributes:
#             Requested Extensions:
#                 X509v3 Subject Alternative Name:
#                     DNS:idjag-learner.human.zts.athenz.cloud, URI:spiffe://human/sa/idjag-learner, URI:athenz://instanceid/sys.auth.zts/research-3490, URI:athenz://hostname/worker-1.example.test
#     Signature Algorithm: sha256WithRSAEncryption
```

All three URI SANs must coexist. The implementation now appends SPIFFE, instance-ID, and hostname URIs in that order.

## Step 6. Get rejected without a provider

Omit `-csr` and `-provider` while supplying a hostname. The CLI must reject this combination before reaching its ZTS URL check. It loads the disposable key before checking this condition, so a valid key is still required:

```sh
kubectl -n athenz exec -i deploy/athenz-cli -- sh <<'SH'
zts-svccert \
  -private-key /tmp/idthw-svccert-hostname/service.key \
  -domain human -service idjag-learner \
  -dns-domain zts.athenz.cloud \
  -hostname worker-1.example.test
_svccert_status=$?
printf 'Exit status: %s\n' "${_svccert_status}"
exit "${_svccert_status}"
SH
```

```sh
# Expected rejection excerpt; timestamp and usage listing are omitted
# Error: -hostname requires -provider for certificate requests (use -csr to only generate the CSR)
# Exit status: 1
# command terminated with exit code 1
```

This is a passing negative check only when that exact error appears with exit status `1`. A key-loading error, an unknown-flag error, or a missing-ZTS-URL error does not verify this condition.

## Step 7. Get a service certificate without a hostname

Request a baseline certificate from ZTS using `sys.auth.zts`, omitting `-hostname`. Keep the same disposable key, service, provider, and pod IP for Step 8. `-use-instance-register-token` authenticates with the mounted administrator identity and obtains attestation for the existing service, so the key from Setup 2 can be used without registering its public key:

```sh
kubectl -n athenz exec -i deploy/athenz-cli -- sh <<'SH'
_svccert_ip=$(hostname -i | awk '{print $1}') &&
zts-svccert \
  -zts https://athenz-zts-server.athenz:4443/zts/v1 \
  -use-instance-register-token \
  -svc-key-file /var/run/athenz/athenz_admin.private.pem \
  -svc-cert-file /var/run/athenz/athenz_admin.cert.pem \
  -cacert /etc/ssl/certs/ca-certificates.crt \
  -private-key /tmp/idthw-svccert-hostname/service.key \
  -domain human -service idjag-learner \
  -dns-domain zts.athenz.cloud \
  -provider sys.auth.zts \
  -instance "research-3490-baseline-$(date +%s)" \
  -ip "${_svccert_ip}" \
  -cert-file /tmp/idthw-svccert-hostname/without-hostname.cert.pem &&
printf 'Certificate saved: /tmp/idthw-svccert-hostname/without-hostname.cert.pem\n'
SH
```

```sh
# Captured operator output — Oct 30, 2026
# Certificate saved: /tmp/idthw-svccert-hostname/without-hostname.cert.pem
```

Read the baseline certificate with its public key and signature value omitted. Confirm that the service DNS, IP, SPIFFE, and instance-ID entries are present and there is no `athenz://hostname/` URI:

```sh
kubectl -n athenz exec deploy/athenz-cli -- \
  openssl x509 -in /tmp/idthw-svccert-hostname/without-hostname.cert.pem \
  -noout -text -certopt no_pubkey,no_sigdump
```

```sh
# Captured operator output — Oct 30, 2026
# Certificate:
#     Data:
#         Version: 3 (0x2)
#         Serial Number:
#             cf:78:b9:ed:13:7a:f9:f7:77:e9:46:7e:26:de:22:52:a8:1d:2a:4a
#         Signature Algorithm: sha256WithRSAEncryption
#         Issuer: CN=Test CA Certificate
#         Validity
#             Not Before: Oct 30 02:14:03 2026 GMT
#             Not After : Nov 29 02:14:03 2026 GMT
#         Subject: C=US, O=Oath Inc., OU=Athenz, CN=human.idjag-learner
#         X509v3 extensions:
#             X509v3 Basic Constraints:
#                 CA:FALSE
#             X509v3 Extended Key Usage:
#                 TLS Web Client Authentication, TLS Web Server Authentication
#             X509v3 Key Usage:
#                 Digital Signature, Key Encipherment
#             X509v3 Authority Key Identifier:
#                 BA:81:BD:37:DD:AC:18:CB:0F:AC:4A:94:3D:D4:DC:5F:EC:F7:43:69
#             X509v3 Subject Alternative Name:
#                 DNS:idjag-learner.human.zts.athenz.cloud, IP Address:10.244.0.22, URI:spiffe://human/sa/idjag-learner, URI:athenz://instanceid/sys.auth.zts/research-3490-baseline-1793326443
```

The baseline contains the service DNS, IP, SPIFFE, and instance-ID SANs, with no hostname URI.

## Step 8. Get a service certificate with a hostname

Repeat the request with `-hostname`, using the CLI pod's resolvable hostname and IP in place of the CSR-only example `worker-1.example.test`. Each request uses a fresh instance ID and a separate certificate file:

```sh
kubectl -n athenz exec -i deploy/athenz-cli -- sh <<'SH'
_svccert_ip=$(hostname -i | awk '{print $1}') &&
_svccert_hostname=$(printf '%s' "${_svccert_ip}" | tr . -).athenz.pod.cluster.local &&
getent hosts "${_svccert_hostname}" &&
printf '%s\n' "${_svccert_hostname}" > /tmp/idthw-svccert-hostname/hostname.txt &&
zts-svccert \
  -zts https://athenz-zts-server.athenz:4443/zts/v1 \
  -use-instance-register-token \
  -svc-key-file /var/run/athenz/athenz_admin.private.pem \
  -svc-cert-file /var/run/athenz/athenz_admin.cert.pem \
  -cacert /etc/ssl/certs/ca-certificates.crt \
  -private-key /tmp/idthw-svccert-hostname/service.key \
  -domain human -service idjag-learner \
  -dns-domain zts.athenz.cloud \
  -provider sys.auth.zts \
  -instance "research-3490-$(date +%s)" \
  -hostname "${_svccert_hostname}" \
  -ip "${_svccert_ip}" \
  -cert-file /tmp/idthw-svccert-hostname/service.cert.pem &&
printf 'Certificate saved: /tmp/idthw-svccert-hostname/service.cert.pem\n'
SH
```

```sh
# Captured operator output — Oct 30, 2026
# 10.244.0.22       10-244-0-22.athenz.pod.cluster.local  10-244-0-22.athenz.pod.cluster.local
# Certificate saved: /tmp/idthw-svccert-hostname/service.cert.pem
```

Read the issued certificate with its public key and signature value omitted:

```sh
kubectl -n athenz exec deploy/athenz-cli -- \
  openssl x509 -in /tmp/idthw-svccert-hostname/service.cert.pem \
  -noout -text -certopt no_pubkey,no_sigdump
```

```sh
# Captured operator output — Oct 30, 2026
# Certificate:
#     Data:
#         Version: 3 (0x2)
#         Serial Number:
#             98:13:13:0e:f2:39:6b:28:08:b4:a6:08:1d:ff:56:99:1a:bf:cf:9d
#         Signature Algorithm: sha256WithRSAEncryption
#         Issuer: CN=Test CA Certificate
#         Validity
#             Not Before: Oct 30 02:08:50 2026 GMT
#             Not After : Nov 29 02:08:50 2026 GMT
#         Subject: C=US, O=Oath Inc., OU=Athenz, CN=human.idjag-learner
#         X509v3 extensions:
#             X509v3 Basic Constraints:
#                 CA:FALSE
#             X509v3 Extended Key Usage:
#                 TLS Web Client Authentication, TLS Web Server Authentication
#             X509v3 Key Usage:
#                 Digital Signature, Key Encipherment
#             X509v3 Authority Key Identifier:
#                 BA:81:BD:37:DD:AC:18:CB:0F:AC:4A:94:3D:D4:DC:5F:EC:F7:43:69
#             X509v3 Subject Alternative Name:
#                 DNS:idjag-learner.human.zts.athenz.cloud, IP Address:10.244.0.22, URI:spiffe://human/sa/idjag-learner, URI:athenz://instanceid/sys.auth.zts/research-3490-1793326130, URI:athenz://hostname/10-244-0-22.athenz.pod.cluster.local
```

Both value columns below come from the operator's actual certificate inspection output. The same service identity and CLI pod IP appear in both certificates.

| Key | Value (without hostname) | Value (with hostname) | Explanation |
|---|---|---|---|
| Subject CN | `human.idjag-learner` | `human.idjag-learner` | Both certificates represent the same Athenz service |
| DNS SAN | `idjag-learner.human.zts.athenz.cloud` | `idjag-learner.human.zts.athenz.cloud` | The service DNS identity is preserved |
| IP SAN | `10.244.0.22` | `10.244.0.22` | Both requests use the CLI pod IP; the provider checks it against the caller IP |
| SPIFFE URI SAN | `spiffe://human/sa/idjag-learner` | `spiffe://human/sa/idjag-learner` | The same service identity is expressed as a SPIFFE ID |
| Instance-ID URI SAN | `athenz://instanceid/sys.auth.zts/research-3490-baseline-1793326443` | `athenz://instanceid/sys.auth.zts/research-3490-1793326130` | Each issuance uses a fresh instance ID under the same provider |
| Hostname URI SAN | Absent | `athenz://hostname/10-244-0-22.athenz.pod.cluster.local` | `-hostname` adds the instance hostname URI; the main #3490 check |

The recorded comparison passes: the hostname URI is added while the service CN, DNS, IP, and SPIFFE identity stay the same. On another run, compare the hostname URI with `/tmp/idthw-svccert-hostname/hostname.txt` and the IP SAN with the current CLI pod IP. The issuer, serial number, validity period, and instance ID depend on the actual issuance.

Both requests select `sys.auth.zts`, but the hostname lookup is conditional. For this single-IP baseline, [`InstanceZTSProvider.validateHostname()`](https://github.com/AthenZ/athenz/blob/v1.12.48/libs/java/instance_provider/src/main/java/com/yahoo/athenz/instance/provider/impl/InstanceZTSProvider.java#L470) returns before calling the resolver when the hostname is empty. With `-hostname`, ZTS checks the provider's allowed hostname suffix and calls the resolver's `isValidHostname()`; the provider then calls `getAllByName(hostname)` to compare the resolved addresses with the CSR IP. Setup 5 makes the resolver available, and the supplied hostname causes these checks to use it.

## Clean-up 1. Remove the test files

After finishing the checks, remove the test key, CSRs, and both issued certificates from the CLI pod:

```sh
kubectl -n athenz exec -i deploy/athenz-cli -- sh <<'SH'
rm -r /tmp/idthw-svccert-hostname &&
printf 'Test files removed: /tmp/idthw-svccert-hostname\n'
SH
```

```sh
# Expected result
# Test files removed: /tmp/idthw-svccert-hostname
```

If you completed Setup 4, remove its research policies and roles from both domains:

```sh
./tools/athenz/delete-policy.sh human svccert-hostname-test_launch_service_idjag-learner &&
./tools/athenz/delete-role.sh human svccert-hostname-test &&
./tools/athenz/delete-policy.sh sys.auth svccert-hostname-test_launch_hostname_athenz_pod_cluster_local &&
./tools/athenz/delete-role.sh sys.auth svccert-hostname-test
```

```sh
# Expected result
#   ·  Deleting policy human:policy.svccert-hostname-test_launch_service_idjag-learner...
#   ✔  Policy deleted or already absent: human:policy.svccert-hostname-test_launch_service_idjag-learner
#   ·  Deleting role human:role.svccert-hostname-test...
#   ✔  Role deleted or already absent: human:role.svccert-hostname-test
#   ·  Deleting policy sys.auth:policy.svccert-hostname-test_launch_hostname_athenz_pod_cluster_local...
#   ✔  Policy deleted or already absent: sys.auth:policy.svccert-hostname-test_launch_hostname_athenz_pod_cluster_local
#   ·  Deleting role sys.auth:role.svccert-hostname-test...
#   ✔  Role deleted or already absent: sys.auth:role.svccert-hostname-test
```

If you completed Setup 5, remove the resolver's JVM option and mount, wait for ZTS to restart, then delete its ConfigMap. The guard requires the JVM option to still match this experiment:

```sh
_svccert_java_options=$(kubectl -n athenz get deployment athenz-zts-server \
  -o 'jsonpath={.spec.template.spec.containers[?(@.name=="athenz-zts-server")].env[?(@.name=="JDK_JAVA_OPTIONS")].value}') &&
if [ "${_svccert_java_options}" != '-Dathenz.zts.hostname_resolver_factory_class=io.github.mlajkim.idthw.cert.DnsHostnameResolverFactory' ]; then
  printf 'JDK_JAVA_OPTIONS differs from this experiment; review it before cleanup.\n' >&2
  false
else
  kubectl -n athenz patch deployment athenz-zts-server --type strategic \
    --patch-file components/labs/hostname-resolver/deployment-cleanup-patch.yaml &&
  kubectl -n athenz rollout status deployment/athenz-zts-server --timeout=180s &&
  kubectl -n athenz delete configmap idthw-hostname-resolver
fi
```

```sh
# Expected final result; rollout progress varies
# deployment.apps/athenz-zts-server patched
# deployment "athenz-zts-server" successfully rolled out
# configmap "idthw-hostname-resolver" deleted
```

# Reference

- [Athenz PR #3490 — expose hostname field for zts-svccert utility](https://github.com/AthenZ/athenz/pull/3490)
- [v1.12.48 CLI — hostname validation and CSR construction](https://github.com/AthenZ/athenz/blob/v1.12.48/utils/zts-svccert/zts-svccert.go#L198)
- [v1.12.48 CLI — registration request hostname](https://github.com/AthenZ/athenz/blob/v1.12.48/utils/zts-svccert/zts-svccert.go#L307)
- [v1.12.48 InstanceZTSProvider — registration tokens and hostname/IP validation](https://github.com/AthenZ/athenz/blob/v1.12.48/libs/java/instance_provider/src/main/java/com/yahoo/athenz/instance/provider/impl/InstanceZTSProvider.java)
- [v1.12.48 DataCache — provider hostname suffix authorization](https://github.com/AthenZ/athenz/blob/v1.12.48/servers/zts/src/main/java/com/yahoo/athenz/zts/cache/DataCache.java#L227)
- [v1.12.48 ZTSImpl — load the configured hostname resolver factory](https://github.com/AthenZ/athenz/blob/v1.12.48/servers/zts/src/main/java/com/yahoo/athenz/zts/ZTSImpl.java#L995)
- [v1.12.48 X509CertRequest — hostname authorization and resolver validation](https://github.com/AthenZ/athenz/blob/v1.12.48/servers/zts/src/main/java/com/yahoo/athenz/zts/cert/X509CertRequest.java#L228)
- [v1.12.48 HostnameResolver interface](https://github.com/AthenZ/athenz/blob/v1.12.48/libs/java/server_common/src/main/java/com/yahoo/athenz/common/server/dns/HostnameResolver.java)
- [Athenz PR #3494 — secure boot provider hostname fallback](https://github.com/AthenZ/athenz/pull/3494)
