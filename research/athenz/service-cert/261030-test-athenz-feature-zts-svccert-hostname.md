# Goal

Use `zts-svccert` inside the `athenz` namespace's `athenz-cli` deployment to compare hostname SANs in CSRs, get rejected when a certificate request omits its provider, then obtain a service certificate from ZTS and inspect its hostname URI.

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
- [Step 7. Get a service certificate and inspect it](#step-7-get-a-service-certificate-and-inspect-it)
- [Clean-up 1. Remove the test files](#clean-up-1-remove-the-test-files)

<!-- /TOC -->

<details>
<summary>Last verified on Oct 30, 2026 — 🟡 Certificate issuance pending</summary>

| # | Date | Confirmed Working |
|---|---|---|
| 1 | Oct 30, 2026 | ✅ Container CLI interface — `athenz/deploy/athenz-cli` accepts `-hostname worker-1.example.test -version` with exit status `0`; help lists `-hostname` |
| 2 | Oct 30, 2026 | ✅ Resolver preparation — compiled against the running ZTS APIs; missing/unresolvable hostname tests passed, and ZTS resolved the CLI pod hostname to its IP; deployment patch accepted in server dry-run |
| 3 | Oct 30, 2026 | 🟡 Permission setup, resolver activation, CSR checks, certificate issuance/inspection, and cleanup await operator verification |

The deployment uses `ghcr.io/ctyano/athenz-cli:v1.12.48`. Its CLI prints `zts-svccert (development version)` even though the image has a release tag. OpenSSL 3.5.8 was also confirmed inside the container. The CLI check verifies flag parsing only.

Setup 1 and the build/DNS test in Setup 3 contain captured output. The remaining result blocks are expected examples awaiting operator verification. The ConfigMap and deployment changes were checked with dry-run commands; they have not been applied.

Private-key and certificate reads are prohibited by LY AI Policy rule 1 in the authoring session, so credential-dependent setup, issuance, and certificate inspection below are for the operator to run. The [policy documentation](https://github.com/secdev-whc/ai-cli-hardening) describes the managed settings and the user-run removal procedure.

Step 7 uses `sys.auth.zts` and checks the issued certificate, covering the registration path added by #3490. The Secure Boot fallback in #3494 is a separate provider flow. Keep the release review's #3490 status pending until the issuance result is confirmed.

</details>

# Prerequisites

This tutorial requires the following to be completed:

1. Complete the main [ID-JAG The Hard Way lab](https://github.com/mlajkim/id-jag-the-hard-way) through the `human.idjag-learner` service setup, and keep the Athenz deployments running
1. Select the lab's Kubernetes context and have permission to run `kubectl exec` in the CLI pod
1. Keep the tutorial's ZMS port-forward and administrator identity available for the shared management helpers; the CLI pod also needs its administrator identity mounted at `/var/run/athenz`

Run the blocks from the IDTHW repository root. Setup 2 creates a test directory and key inside the CLI pod; subsequent steps reuse those files. Keep the deployment's single CLI pod running throughout the procedure. If it is replaced, repeat Setup 2 and the CSR generation steps. Setups 3–5 prepare the IPv4 Kubernetes lab for live issuance in Step 7; enabling the resolver restarts ZTS.

# Steps

Here is the procedure to get to the goals.

## Setup 1. Check the CLI in the deployment

Inspect the deployment's image and confirm its existing CLI accepts `-hostname`. The version check exits before loading a key:

```sh
kubectl -n athenz get deployment athenz-cli \
  -o 'jsonpath={.spec.template.spec.containers[?(@.name=="athenz-cli")].image}{"\n"}' &&
kubectl -n athenz exec deploy/athenz-cli -- \
  zts-svccert -hostname worker-1.example.test -version
```

```sh
# Captured — Oct 30, 2026
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
# Expected result
# Test key created: /tmp/idthw-svccert-hostname/service.key
```

For a fresh run, remove an existing test directory using the first block under Clean-up 1.

## Setup 3. Build the DNS resolver for ZTS

The `sys.auth.zts` provider checks that a requested hostname resolves to the CSR's IP SAN, which must match the caller's IP. Build the supplied [DNS resolver](../../../components/labs/hostname-resolver/DnsHostnameResolverFactory.java) with the running ZTS container's JDK and Athenz APIs. The helper also tests DNS resolution from ZTS to the CLI pod:

```sh
bash components/labs/hostname-resolver/build.sh
```

```sh
# Captured — Oct 30, 2026; final build path shown relative to the repository root
#   ·  Reading the CLI pod IP for the resolver test...
#   ·  Compiling and testing the resolver with the ZTS container's JDK and Athenz APIs...
# PASS: missing hostnames are rejected
# PASS: unresolved hostname is rejected
# PASS: 10-244-0-22.athenz.pod.cluster.local resolves to 10.244.0.22 from ZTS
#   ✔  Built components/labs/hostname-resolver/target/idthw-hostname-resolver.jar
```

The pod IP and corresponding DNS name change when the CLI pod is replaced. This resolver uses cluster DNS; provider authorization and caller-IP validation remain enforced by ZTS.

## Setup 4. Authorize the provider and hostname suffix

Enable the tutorial's provider grant for `human.idjag-learner`, then give `sys.auth.zts` permission to use hostnames under `.athenz.pod.cluster.local` through a research role and policy:

```sh
./tools/athenz/enable-cert-provider.sh human idjag-learner &&
./tools/athenz/create-role.sh sys.auth svccert-hostname-test &&
./tools/athenz/add-role-member.sh sys.auth svccert-hostname-test sys.auth.zts &&
./tools/athenz/add-policy.sh sys.auth svccert-hostname-test launch hostname.athenz.pod.cluster.local
```

```sh
# Expected success excerpts; the helpers print their progress and CLI responses too
#   ✔  ZTS Certificate Provider enabled for human.idjag-learner
#   ✔  Role created: sys.auth:role.svccert-hostname-test
#   ✔  sys.auth.zts  →  sys.auth:role.svccert-hostname-test
#   ✔  Policy created: sys.auth:policy.svccert-hostname-test_launch_hostname_athenz_pod_cluster_local
```

## Setup 5. Enable the DNS resolver in ZTS

Store the built resolver JAR in a ConfigMap:

```sh
kubectl -n athenz create configmap idthw-hostname-resolver \
  --from-file=idthw-hostname-resolver.jar=components/labs/hostname-resolver/target/idthw-hostname-resolver.jar
```

```sh
# Expected result
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
# Expected final result; rollout progress varies
# deployment.apps/athenz-zts-server patched
# deployment "athenz-zts-server" successfully rolled out
```

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

## Step 7. Get a service certificate and inspect it

Request a service certificate from ZTS using `sys.auth.zts`. `-use-instance-register-token` authenticates with the mounted administrator identity and obtains attestation for the existing service, so the disposable key from Setup 2 can be used without registering its public key. For live issuance, use the CLI pod's resolvable hostname and IP in place of the CSR-only example `worker-1.example.test`:

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
# Expected result; example uses CLI pod IP 10.244.0.22
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
# Expected SAN entries, shown separately; example uses CLI pod IP 10.244.0.22
# DNS:idjag-learner.human.zts.athenz.cloud
# IP Address:10.244.0.22
# URI:athenz://hostname/10-244-0-22.athenz.pod.cluster.local
```

The command prints the remaining certificate metadata too. Confirm that its Subject CN is `human.idjag-learner`, the service DNS SAN is preserved, and the hostname URI matches the value saved in `/tmp/idthw-svccert-hostname/hostname.txt`. Its IP SAN must match the CLI pod IP. The issuer, serial number, validity period, and instance ID depend on the actual issuance.

## Clean-up 1. Remove the test files

After finishing the checks, remove the test key, CSRs, and issued certificate from the CLI pod:

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

If you completed Setup 4, remove its research policy and role:

```sh
./tools/athenz/delete-policy.sh sys.auth svccert-hostname-test_launch_hostname_athenz_pod_cluster_local &&
./tools/athenz/delete-role.sh sys.auth svccert-hostname-test
```

```sh
# Expected result
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
- [v1.12.48 HostnameResolver interface](https://github.com/AthenZ/athenz/blob/v1.12.48/libs/java/server_common/src/main/java/com/yahoo/athenz/common/server/dns/HostnameResolver.java)
- [Athenz PR #3494 — secure boot provider hostname fallback](https://github.com/AthenZ/athenz/pull/3494)
