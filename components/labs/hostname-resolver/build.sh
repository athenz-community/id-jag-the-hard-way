#!/usr/bin/env bash
set -euo pipefail

_svccert_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${_svccert_dir}/../../../tools/color.sh"

info "Reading the CLI pod IP for the resolver test..."
_svccert_ip=$(kubectl -n athenz exec deploy/athenz-cli -- hostname -i | awk '{print $1}')
if ! [[ "${_svccert_ip}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  fatal "This lab procedure requires an IPv4 CLI pod address: ${_svccert_ip}"
fi
_svccert_hostname="${_svccert_ip//./-}.athenz.pod.cluster.local"

mkdir -p "${_svccert_dir}/target"
_svccert_artifact=$(mktemp "${_svccert_dir}/target/build.XXXXXX")

info "Compiling and testing the resolver with the ZTS container's JDK and Athenz APIs..."
if ! tar --no-xattrs -C "${_svccert_dir}" -cf - \
  DnsHostnameResolverFactory.java DnsHostnameResolverFactoryTest.java \
  | kubectl -n athenz exec -i deploy/athenz-zts-server -c athenz-zts-server -- \
    sh -c '
      build_dir=$(mktemp -d) &&
      tar -xf - -C "${build_dir}" &&
      mkdir "${build_dir}/classes" "${build_dir}/test-classes" &&
      javac --release 17 \
        -cp "/athenz/plugins/athenz-plugins.jar:/opt/athenz/zts/lib/jars/*" \
        -d "${build_dir}/classes" "${build_dir}/DnsHostnameResolverFactory.java" &&
      javac --release 17 \
        -cp "${build_dir}/classes:/athenz/plugins/athenz-plugins.jar:/opt/athenz/zts/lib/jars/*" \
        -d "${build_dir}/test-classes" "${build_dir}/DnsHostnameResolverFactoryTest.java" &&
      java -cp "${build_dir}/test-classes:${build_dir}/classes:/athenz/plugins/athenz-plugins.jar:/opt/athenz/zts/lib/jars/*" \
        io.github.mlajkim.idthw.cert.DnsHostnameResolverFactoryTest "$1" "$2" >&2 &&
      jar --create --file "${build_dir}/idthw-hostname-resolver.jar" -C "${build_dir}/classes" . &&
      cat "${build_dir}/idthw-hostname-resolver.jar"
    ' sh "${_svccert_hostname}" "${_svccert_ip}" > "${_svccert_artifact}"; then
  fatal "Resolver build or DNS test failed; diagnostic output is above"
fi

mv "${_svccert_artifact}" "${_svccert_dir}/target/idthw-hostname-resolver.jar"
ok "Built ${_svccert_dir}/target/idthw-hostname-resolver.jar"
