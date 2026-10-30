package io.github.mlajkim.idthw.cert;

import com.yahoo.athenz.common.server.dns.HostnameResolver;
import com.yahoo.athenz.common.server.dns.HostnameResolverFactory;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.HashSet;
import java.util.Set;

/** DNS resolution for the local IDTHW certificate-issuance experiment. */
public final class DnsHostnameResolverFactory implements HostnameResolverFactory {
    @Override
    public HostnameResolver create() {
        return new HostnameResolver() {
            @Override
            public boolean isValidHostname(String hostname) {
                return !getAllByName(hostname).isEmpty();
            }

            /**
             * Resolves one hostname to its IP addresses from the ZTS container.
             *
             * <p>Run the same Java lookup inside ZTS with the command below. Update the
             * CLI pod hostname if its IP changes. The writable preferences directory
             * prevents JShell's user-preferences warnings.
             *
             * <pre>{@code
             * kubectl -n athenz exec -i deploy/athenz-zts-server -c athenz-zts-server -- sh <<'SH'
             * mkdir -p /tmp/idthw-svccert-jshell/.java/.userPrefs &&
             * jshell -J-Djava.util.prefs.userRoot=/tmp/idthw-svccert-jshell - <<'JAVA'
             * import java.net.InetAddress;
             *
             * System.out.println("ZTS pod IP: " + InetAddress.getLocalHost().getHostAddress());
             * for (InetAddress address : InetAddress.getAllByName("10-244-0-22.athenz.pod.cluster.local")) {
             *     System.out.println("athenz-cli pod IP: " + address.getHostAddress());
             * }
             * /exit
             * JAVA
             * SH
             * }</pre>
             * <pre>{@code
             * # Captured output — Oct 30, 2026
             * # ZTS pod IP: 10.244.0.24
             * # athenz-cli pod IP: 10.244.0.22
             * }</pre>
             *
             * @param hostname the single hostname to resolve
             * @return its IP addresses, or an empty set for a missing or unresolved hostname
             */
            @Override
            public Set<String> getAllByName(String hostname) {
                if (hostname == null || hostname.isBlank()) {
                    return Set.of();
                }
                Set<String> addresses = new HashSet<>();
                try {
                    for (InetAddress address : InetAddress.getAllByName(hostname)) {
                        addresses.add(address.getHostAddress());
                    }
                } catch (UnknownHostException error) {
                    return Set.of();
                }
                return addresses;
            }
        };
    }
}
