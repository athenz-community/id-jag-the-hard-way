# Goal

The goal of this document is to build the latest multi-domain access-token ZTS branch locally and deploy its commit-specific image to the existing ID-JAG The Hard Way `kind` cluster, without relying on the repository's private `make multi` shortcut, with the following steps:

<!-- TOC depthFrom:2 depthTo:2 -->

- [Step 1. Verify the local prerequisites and clean source checkout](#step-1-verify-the-local-prerequisites-and-clean-source-checkout)
- [Step 2. Fetch and fast-forward to the latest feature-branch commit](#step-2-fetch-and-fast-forward-to-the-latest-feature-branch-commit)
- [Step 3. Install the RDL build tools](#step-3-install-the-rdl-build-tools)
- [Step 4. Build the ZTS distribution](#step-4-build-the-zts-distribution)
- [Step 5. Build and tag the local ZTS image](#step-5-build-and-tag-the-local-zts-image)
- [Step 6. Enable multiple access-token scope domains](#step-6-enable-multiple-access-token-scope-domains)
- [Step 7. Load and deploy the local image](#step-7-load-and-deploy-the-local-image)
- [Step 8. Verify the deployed revision](#step-8-verify-the-deployed-revision)

<!-- /TOC -->

<details>
<summary>Last verified on Aug 26, 2026 — ✅ Success</summary>

| # | Date         | Confirmed Working |
|---|--------------|-------------------|
| 1 | Aug 26, 2026 | ✅ — built Athenz `1.12.47-SNAPSHOT` from feature-branch commit `49d2d1182149c258a6bfc435d8988e8e021eec81`, loaded the local image into `kind`, and completed the ZTS rollout |

</details>

# Prerequisites

This tutorial requires the following to be completed:

1. Complete the main [ID-JAG The Hard Way tutorial](../../../tutorials/16-id-jag.md).
1. Keep the existing IDTHW `kind` cluster and Athenz deployment running.
1. Install Git, Go, Java, Maven, Docker, `kind`, and `kubectl`.

# Steps

Here is the procedure to get to the goals.

## Step 1. Verify the local prerequisites and clean source checkout

Run every command in this document from the ID-JAG The Hard Way repository root. Define the source, branch, and deployment values once:

```sh
_athenz_dir=./athenz_dist/athenz
_multi_scope_repository=https://github.com/mlajkim/athenz.git
_multi_scope_remote=multi-scope
_multi_scope_branch=feat/scope-with-domain-name
_kind_cluster=kind
_namespace=athenz
_deployment=athenz-zts-server
_container=athenz-zts-server
```

Verify the required local services and context:

```sh
docker info >/dev/null
kind get clusters | grep -Fx "$_kind_cluster"
test "$(kubectl config current-context)" = "kind-kind"
kubectl -n "$_namespace" get deployment "$_deployment"
```

Do not switch or pull while the nested Athenz checkout has local changes. Review any output and commit, stash, or otherwise preserve it before continuing:

```sh
git -C "$_athenz_dir" status --short
test -z "$(git -C "$_athenz_dir" status --porcelain)"
```

## Step 2. Fetch and fast-forward to the latest feature-branch commit

Use a dedicated remote so the feature source is explicit and does not depend on what `origin` currently means:

```sh
if git -C "$_athenz_dir" remote get-url "$_multi_scope_remote" >/dev/null 2>&1; then
  test "$(git -C "$_athenz_dir" remote get-url "$_multi_scope_remote")" = "$_multi_scope_repository"
else
  git -C "$_athenz_dir" remote add "$_multi_scope_remote" "$_multi_scope_repository"
fi
```

Fetch the branch, switch to it, and accept only a fast-forward update:

```sh
git -C "$_athenz_dir" fetch --prune "$_multi_scope_remote" "$_multi_scope_branch"

if git -C "$_athenz_dir" show-ref --verify --quiet "refs/heads/$_multi_scope_branch"; then
  git -C "$_athenz_dir" switch "$_multi_scope_branch"
else
  git -C "$_athenz_dir" switch --create "$_multi_scope_branch" \
    --track "$_multi_scope_remote/$_multi_scope_branch"
fi

git -C "$_athenz_dir" branch \
  --set-upstream-to="$_multi_scope_remote/$_multi_scope_branch" \
  "$_multi_scope_branch"
git -C "$_athenz_dir" pull --ff-only "$_multi_scope_remote" "$_multi_scope_branch"
```

Resolve and compare both revisions after the pull. The equality check prevents an unpushed local commit from being deployed as though it were the current feature branch:

```sh
_revision=$(git -C "$_athenz_dir" rev-parse HEAD)
_remote_revision=$(git -C "$_athenz_dir" rev-parse "$_multi_scope_remote/$_multi_scope_branch")
test "$_revision" = "$_remote_revision"
printf 'Athenz revision: %s\n' "$_revision"
```

```sh
# Athenz revision: 49d2d1182149c258a6bfc435d8988e8e021eec81
```

Read the version from the fetched source rather than assuming a released version:

```sh
_version=$(sed -E -n \
  's|.*<version>([0-9]+\.[0-9]+\.[0-9]+(-SNAPSHOT)?)</version>.*|\1|p' \
  "$_athenz_dir/pom.xml" | head -n 1)
test -n "$_version"
printf 'Athenz version: %s\n' "$_version"
```

```sh
# Athenz version: 1.12.47-SNAPSHOT
```

## Step 3. Install the RDL build tools

The Maven reactor expects the Athenz RDL generators in each Go client directory. Install them when absent, then copy the complete `rdl*` tool set into the three expected directories:

```sh
_gopath=$(go env GOPATH)
_rdl_tools_ready=true

for _tool in \
  rdl \
  rdl-gen-athenz-go-client \
  rdl-gen-athenz-go-model \
  rdl-gen-athenz-java-client \
  rdl-gen-athenz-java-model \
  rdl-gen-athenz-server; do
  if [ ! -x "$_gopath/bin/$_tool" ]; then
    _rdl_tools_ready=false
  fi
done

if [ "$_rdl_tools_ready" = false ]; then
  go install github.com/ardielle/ardielle-go/...@master
  go install github.com/ardielle/ardielle-tools/...@master
fi

for _client in zms zts msd; do
  mkdir -p "$_athenz_dir/clients/go/$_client/bin"
  cp "$_gopath"/bin/rdl* "$_athenz_dir/clients/go/$_client/bin/"
  chmod a+x "$_athenz_dir/clients/go/$_client/bin/"*
done
```

## Step 4. Build the ZTS distribution

Build only the `assembly/zts` reactor and its required dependencies. This produces the tarball consumed by the distribution's ZTS Dockerfile without building or publishing unrelated images:

```sh
mvn -B -q clean package \
  -f "$_athenz_dir/pom.xml" \
  -Dproject.basedir="$_athenz_dir" \
  -Dproject.build.directory="$_athenz_dir" \
  -Dmaven.test.skip=true \
  -Djacoco.skip=true \
  -Dcheckstyle.skip=true \
  -Dmaven.javadoc.skip=true \
  -Dmaven.source.skip=true \
  -Dcyclonedx.skip=true \
  -am \
  -pl assembly/zts

test -f "$_athenz_dir/assembly/zts/target/athenz-zts-${_version}-bin.tar.gz"
```

## Step 5. Build and tag the local ZTS image

There is no prebuilt image for this feature branch. Build from the distribution's `docker/zts/Dockerfile` and include the full source commit in the local tag:

```sh
_image="local/athenz-zts-server:multi-scope-${_revision}"
_build_date=$(date -u +'%Y-%m-%dT%H:%M:%SZ')

docker build \
  --build-arg "VERSION=$_version" \
  --build-arg "BUILD_DATE=$_build_date" \
  --build-arg "VCS_REF=$_revision" \
  -t "$_image" \
  -f ./athenz_dist/docker/zts/Dockerfile \
  ./athenz_dist

docker image inspect "$_image" >/dev/null
```

For the verified revision, the resulting tag was:

```text
local/athenz-zts-server:multi-scope-49d2d1182149c258a6bfc435d8988e8e021eec81
```

Do not substitute a `ghcr.io/ctyano/athenz-zts-server` tag here: the feature artifact was built locally and was never pulled from or pushed to a registry.

## Step 6. Enable multiple access-token scope domains

The feature branch is conservative by default: `athenz.zts.access_token_max_domains` defaults to `1`. Merely deploying the branch therefore still rejects a two-domain scope. For this distribution, retain its existing `JAVA_OPTS` values and append a non-default limit:

```sh
kubectl -n "$_namespace" set env "deployment/$_deployment" \
  --containers="$_container" \
  JAVA_OPTS='-Dathenz.root_dir=/opt/athenz/zts -Dathenz.jetty_home=/opt/athenz/zts -Dathenz.access_log_dir=/opt/athenz/zts/logs -Dathenz.zts.access_token_max_domains=10'
```

Ten is a test-environment ceiling, not a required protocol value. Choose an operational limit appropriate for the deployment, but it must be at least `2` for the `mcp-hub.multi-scoped` plus `api.multi-scoped` test.

## Step 7. Load and deploy the local image

Load the commit-specific image directly into `kind`, update only the ZTS container, and wait for the rollout:

```sh
kind load docker-image "$_image" --name "$_kind_cluster"

kubectl -n "$_namespace" set image "deployment/$_deployment" \
  "${_container}=${_image}"

kubectl -n "$_namespace" rollout status "deployment/$_deployment" --timeout=300s
```

```sh
# deployment "athenz-zts-server" successfully rolled out
```

The deployment must retain `imagePullPolicy: IfNotPresent`; otherwise Kubernetes may try to find the `local/...` tag in an external registry.

## Step 8. Verify the deployed revision

Verify the running image, the multi-domain limit, and pod readiness:

```sh
_deployed_image=$(kubectl -n "$_namespace" get deployment "$_deployment" \
  -o jsonpath='{.spec.template.spec.containers[?(@.name=="athenz-zts-server")].image}')
test "$_deployed_image" = "$_image"

kubectl -n "$_namespace" get deployment "$_deployment" \
  -o jsonpath='{.spec.template.spec.containers[?(@.name=="athenz-zts-server")].env[?(@.name=="JAVA_OPTS")].value}{"\n"}' \
  | grep -F -- '-Dathenz.zts.access_token_max_domains=10'

kubectl -n "$_namespace" get pods \
  -l app.kubernetes.io/name=athenz-zts-server
```

```sh
# NAME                                 READY   STATUS    RESTARTS   AGE
# athenz-zts-server-...                1/1     Running   0          ...
```

# Reference

- [Athenz PR #3407 — Support scopes with domain names](https://github.com/AthenZ/athenz/pull/3407)
- [Feature source branch — `mlajkim:feat/scope-with-domain-name`](https://github.com/mlajkim/athenz/tree/feat/scope-with-domain-name)
- [Athenz ZTS access-token guide](https://github.com/mlajkim/athenz/blob/feat/scope-with-domain-name/docs/zts_access_token_guide.md)
