package io.github.mlajkim.idthw.cert;

import com.yahoo.athenz.common.server.dns.HostnameResolver;

/** Run in the ZTS container to check its DNS view without using credentials. */
public final class DnsHostnameResolverFactoryTest {
    public static void main(String[] args) {
        if (args.length != 2) {
            throw new IllegalArgumentException("Expected CLI pod hostname and IP address");
        }
        HostnameResolver resolver = new DnsHostnameResolverFactory().create();

        check(resolver.getAllByName(null).isEmpty(), "null must not resolve to loopback");
        check(resolver.getAllByName("").isEmpty(), "empty hostname must not resolve");
        check(resolver.getAllByName(" ").isEmpty(), "blank hostname must not resolve");
        check(!resolver.isValidHostname(null), "null hostname must be invalid");
        System.out.println("PASS: missing hostnames are rejected");

        String missingHost = "idthw-hostname-test.invalid.";
        check(resolver.getAllByName(missingHost).isEmpty(), "unknown hostname must not resolve");
        check(!resolver.isValidHostname(missingHost), "unknown hostname must be invalid");
        System.out.println("PASS: unresolved hostname is rejected");

        check(resolver.getAllByName(args[0]).contains(args[1]), "CLI hostname must resolve to its pod IP");
        check(resolver.isValidHostname(args[0]), "CLI pod hostname must be valid");
        System.out.println("PASS: " + args[0] + " resolves to " + args[1] + " from ZTS");
    }

    private static void check(boolean condition, String message) {
        if (!condition) {
            throw new AssertionError(message);
        }
    }
}
