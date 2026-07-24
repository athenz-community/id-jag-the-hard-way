/*
 * Copyright The Athenz Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package com.yahoo.athenz.instance.provider.impl;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.ECDSASigner;
import com.nimbusds.jose.jwk.Curve;
import com.nimbusds.jose.jwk.ECKey;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.sun.net.httpserver.HttpServer;
import com.yahoo.athenz.instance.provider.InstanceConfirmation;
import com.yahoo.athenz.instance.provider.InstanceProvider;
import com.yahoo.athenz.instance.provider.ProviderResourceException;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.ECPrivateKey;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.time.Instant;
import java.util.Date;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class InstanceLocalWorkloadProviderTest {

    private static final String PROVIDER = "sys.auth.localworkload";
    private static final String ISSUER = "https://idp.example.test";
    private static final String OTHER_ISSUER = "https://other-idp.example.test";
    private static final String AUDIENCE = "athenzd";
    private static final String USER_NAME_CLAIM = "preferred_username";
    private static final String KEY_ID = "test-key";

    private static KeyPair keyPair;
    private static HttpServer jwksServer;
    private static String jwksUri;

    @BeforeAll
    static void startJwksServer() throws Exception {
        final KeyPairGenerator generator = KeyPairGenerator.getInstance("EC");
        generator.initialize(new ECGenParameterSpec("secp256r1"));
        keyPair = generator.generateKeyPair();

        final ECKey publicJwk = new ECKey.Builder(Curve.P_256, (ECPublicKey) keyPair.getPublic())
                .keyID(KEY_ID)
                .build();
        final byte[] response = new JWKSet(publicJwk).toString().getBytes(StandardCharsets.UTF_8);

        jwksServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        jwksServer.createContext("/jwks", exchange -> {
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        jwksServer.start();
        jwksUri = "http://127.0.0.1:" + jwksServer.getAddress().getPort() + "/jwks";
    }

    @AfterAll
    static void stopJwksServer() {
        if (jwksServer != null) {
            jwksServer.stop(0);
        }
    }

    @AfterEach
    void clearProperties() {
        System.clearProperty(InstanceLocalWorkloadProvider.LOCAL_WORKLOAD_PROP_ISSUER);
        System.clearProperty(InstanceLocalWorkloadProvider.LOCAL_WORKLOAD_PROP_JWKS_URI);
        System.clearProperty(InstanceLocalWorkloadProvider.LOCAL_WORKLOAD_PROP_JWKS_URI_MAP);
        System.clearProperty(InstanceLocalWorkloadProvider.LOCAL_WORKLOAD_PROP_AUDIENCE);
        System.clearProperty(InstanceLocalWorkloadProvider.LOCAL_WORKLOAD_PROP_USER_NAME_CLAIM);
        System.clearProperty(InstanceLocalWorkloadProvider.LOCAL_WORKLOAD_PROP_USER_DOMAIN_TEMPLATE);
        System.clearProperty(InstanceLocalWorkloadProvider.LOCAL_WORKLOAD_PROP_EXTERNAL_DOMAIN);
        System.clearProperty(InstanceLocalWorkloadProvider.LOCAL_WORKLOAD_PROP_EXTERNAL_DOMAIN_MAP);
        System.clearProperty(InstanceLocalWorkloadProvider.LOCAL_WORKLOAD_PROP_BOOT_TIME_OFFSET);
    }

    @Test
    void confirmsIdTokenForUserLocalDomain() throws Exception {
        final InstanceLocalWorkloadProvider provider = configuredProvider();
        final InstanceConfirmation confirmation = confirmation(
                "home.alice.local", "athenzd", "bearer " + validToken("Alice"));

        final InstanceConfirmation result = provider.confirmInstance(confirmation);

        assertSame(confirmation, result);
        assertEquals("false", result.getAttributes().get(InstanceProvider.ZTS_CERT_REFRESH));
        assertEquals("client", result.getAttributes().get(InstanceProvider.ZTS_CERT_USAGE));
    }

    @Test
    void acceptsUserPrincipalPrefix() throws Exception {
        final InstanceLocalWorkloadProvider provider = configuredProvider();

        final InstanceConfirmation result = provider.confirmInstance(confirmation(
                "home.alice.local.team", "athenzd", validToken("user.Alice")));

        assertNotNull(result);
    }

    @Test
    void rejectsAnotherUsersDomain() throws Exception {
        final InstanceLocalWorkloadProvider provider = configuredProvider();

        final ProviderResourceException error = assertThrows(ProviderResourceException.class,
                () -> provider.confirmInstance(confirmation(
                        "home.bob.local", "athenzd", validToken("alice"))));

        assertEquals(ProviderResourceException.FORBIDDEN, error.getCode());
        assertTrue(error.getMessage().contains("outside the allowed domain"));
    }

    @Test
    void rejectsDomainPrefixThatIsNotAChild() throws Exception {
        final InstanceLocalWorkloadProvider provider = configuredProvider();

        final ProviderResourceException error = assertThrows(ProviderResourceException.class,
                () -> provider.confirmInstance(confirmation(
                        "home.alice.locality", "athenzd", validToken("alice"))));

        assertTrue(error.getMessage().contains("outside the allowed domain"));
    }

    @Test
    void rejectsMismatchedProvider() throws Exception {
        final InstanceLocalWorkloadProvider provider = configuredProvider();
        final InstanceConfirmation confirmation = confirmation(
                "home.alice.local", "athenzd", validToken("alice"));
        confirmation.setProvider("sys.auth.other");

        final ProviderResourceException error = assertThrows(ProviderResourceException.class,
                () -> provider.confirmInstance(confirmation));

        assertTrue(error.getMessage().contains("does not match"));
    }

    @Test
    void rejectsInvalidAthenzUserName() throws Exception {
        final InstanceLocalWorkloadProvider provider = configuredProvider();

        final ProviderResourceException error = assertThrows(ProviderResourceException.class,
                () -> provider.confirmInstance(confirmation(
                        "home.alice.local", "athenzd", validToken("alice.local"))));

        assertTrue(error.getMessage().contains("not a valid Athenz simple name"));
    }

    @Test
    void rejectsWrongAudience() throws Exception {
        final InstanceLocalWorkloadProvider provider = configuredProvider();
        final String token = token(ISSUER, "other-client", "alice", now(), now().plusSeconds(3600), null,
                "user-token", true, true);

        final ProviderResourceException error = assertThrows(ProviderResourceException.class,
                () -> provider.confirmInstance(confirmation("home.alice.local", "athenzd", token)));

        assertTrue(error.getMessage().contains("audience"));
    }

    @Test
    void rejectsUnconfiguredIssuerBeforeKeyLookup() throws Exception {
        final InstanceLocalWorkloadProvider provider = configuredProvider();
        final String token = token(OTHER_ISSUER, AUDIENCE, "alice", now(), now().plusSeconds(3600), null,
                "user-token", true, true);

        final ProviderResourceException error = assertThrows(ProviderResourceException.class,
                () -> provider.confirmInstance(confirmation("home.alice.local", "athenzd", token)));

        assertTrue(error.getMessage().contains("issuer is not configured"));
    }

    @Test
    void rejectsTamperedSignature() throws Exception {
        final InstanceLocalWorkloadProvider provider = configuredProvider();
        final String token = validToken("alice");
        final int signatureStart = token.lastIndexOf('.') + 1;
        final char signatureFirstCharacter = token.charAt(signatureStart);
        final char replacement = signatureFirstCharacter == 'a' ? 'b' : 'a';
        final String tampered = token.substring(0, signatureStart) + replacement
                + token.substring(signatureStart + 1);

        final ProviderResourceException error = assertThrows(ProviderResourceException.class,
                () -> provider.confirmInstance(confirmation("home.alice.local", "athenzd", tampered)));

        assertTrue(error.getMessage().contains("parse and validate"));
    }

    @Test
    void rejectsExpiredToken() throws Exception {
        final InstanceLocalWorkloadProvider provider = configuredProvider();
        final String token = token(ISSUER, AUDIENCE, "alice", now().minusSeconds(600), now().minusSeconds(120),
                null, "user-token", true, true);

        final ProviderResourceException error = assertThrows(ProviderResourceException.class,
                () -> provider.confirmInstance(confirmation("home.alice.local", "athenzd", token)));

        assertTrue(error.getMessage().contains("parse and validate"));
    }

    @Test
    void rejectsFutureNotBeforeToken() throws Exception {
        final InstanceLocalWorkloadProvider provider = configuredProvider();
        final String token = token(ISSUER, AUDIENCE, "alice", now(), now().plusSeconds(3600),
                now().plusSeconds(300), "user-token", true, true);

        final ProviderResourceException error = assertThrows(ProviderResourceException.class,
                () -> provider.confirmInstance(confirmation("home.alice.local", "athenzd", token)));

        assertTrue(error.getMessage().contains("parse and validate"));
    }

    @Test
    void rejectsStaleIssueTimeWhenFreshnessWindowConfigured() throws Exception {
        configureBaseProperties();
        System.setProperty(InstanceLocalWorkloadProvider.LOCAL_WORKLOAD_PROP_BOOT_TIME_OFFSET, "300");
        final InstanceLocalWorkloadProvider provider = newProvider();
        final String token = token(ISSUER, AUDIENCE, "alice", now().minusSeconds(600), now().plusSeconds(3600),
                null, "user-token", true, true);

        final ProviderResourceException error = assertThrows(ProviderResourceException.class,
                () -> provider.confirmInstance(confirmation("home.alice.local", "athenzd", token)));

        assertTrue(error.getMessage().contains("not recent enough"));
    }

    @Test
    void rejectsFutureIssueTime() throws Exception {
        final InstanceLocalWorkloadProvider provider = configuredProvider();
        final String token = token(ISSUER, AUDIENCE, "alice", now().plusSeconds(120), now().plusSeconds(3600),
                null, "user-token", true, true);

        final ProviderResourceException error = assertThrows(ProviderResourceException.class,
                () -> provider.confirmInstance(confirmation("home.alice.local", "athenzd", token)));

        assertTrue(error.getMessage().contains("issue time is in the future"));
    }

    @Test
    void requiresExpirationIssueTimeAndSubject() throws Exception {
        final InstanceLocalWorkloadProvider providerWithoutExpiration = configuredProvider();
        final String withoutExpiration = token(ISSUER, AUDIENCE, "alice", now(), now().plusSeconds(3600),
                null, "user-token", true, false);
        assertTrue(assertThrows(ProviderResourceException.class,
                () -> providerWithoutExpiration.confirmInstance(
                        confirmation("home.alice.local", "athenzd", withoutExpiration)))
                .getMessage().contains("required exp"));

        final InstanceLocalWorkloadProvider providerWithoutIssueTime = configuredProvider();
        final String withoutIssueTime = token(ISSUER, AUDIENCE, "alice", now(), now().plusSeconds(3600),
                null, "user-token", false, true);
        assertTrue(assertThrows(ProviderResourceException.class,
                () -> providerWithoutIssueTime.confirmInstance(
                        confirmation("home.alice.local", "athenzd", withoutIssueTime)))
                .getMessage().contains("required iat"));

        final InstanceLocalWorkloadProvider providerWithoutSubject = configuredProvider();
        final String withoutSubject = token(ISSUER, AUDIENCE, "alice", now(), now().plusSeconds(3600),
                null, null, true, true);
        assertTrue(assertThrows(ProviderResourceException.class,
                () -> providerWithoutSubject.confirmInstance(
                        confirmation("home.alice.local", "athenzd", withoutSubject)))
                .getMessage().contains("required sub"));
    }

    @Test
    void supportsExplicitExternalDomainWhenUserClaimIsAbsent() throws Exception {
        configureBaseProperties();
        System.setProperty(InstanceLocalWorkloadProvider.LOCAL_WORKLOAD_PROP_EXTERNAL_DOMAIN,
                "external.partner.workloads");
        final InstanceLocalWorkloadProvider provider = newProvider();
        final String token = token(ISSUER, AUDIENCE, null, now(), now().plusSeconds(3600), null,
                "external-token", true, true);

        final InstanceConfirmation result = provider.confirmInstance(confirmation(
                "external.partner.workloads.team", "api", token));

        assertNotNull(result);
    }

    @Test
    void missingUserClaimWithoutExternalDomainFailsClosed() throws Exception {
        final InstanceLocalWorkloadProvider provider = configuredProvider();
        final String token = token(ISSUER, AUDIENCE, null, now(), now().plusSeconds(3600), null,
                "user-token", true, true);

        final ProviderResourceException error = assertThrows(ProviderResourceException.class,
                () -> provider.confirmInstance(confirmation("home.alice.local", "athenzd", token)));

        assertTrue(error.getMessage().contains("Unable to resolve allowed domain"));
    }

    @Test
    void validatesRequiredRequestFields() throws Exception {
        final InstanceLocalWorkloadProvider provider = configuredProvider();

        assertEquals(ProviderResourceException.BAD_REQUEST,
                assertThrows(ProviderResourceException.class, () -> provider.confirmInstance(null)).getCode());
        assertEquals(ProviderResourceException.BAD_REQUEST,
                assertThrows(ProviderResourceException.class,
                        () -> provider.confirmInstance(confirmation(null, "athenzd", "token"))).getCode());
        assertEquals(ProviderResourceException.FORBIDDEN,
                assertThrows(ProviderResourceException.class,
                        () -> provider.confirmInstance(confirmation("home.alice.local", "athenzd", "  ")))
                        .getCode());
    }

    @Test
    void initializationRequiresAudienceAndIssuer() {
        System.setProperty(InstanceLocalWorkloadProvider.LOCAL_WORKLOAD_PROP_ISSUER, ISSUER);
        assertTrue(assertThrows(IllegalArgumentException.class, this::newProvider)
                .getMessage().contains("audience"));

        clearProperties();
        System.setProperty(InstanceLocalWorkloadProvider.LOCAL_WORKLOAD_PROP_AUDIENCE, AUDIENCE);
        assertTrue(assertThrows(IllegalArgumentException.class, this::newProvider)
                .getMessage().contains("issuer"));
    }

    @Test
    void initializationRejectsUnsafeConfiguration() {
        configureBaseProperties();
        System.setProperty(InstanceLocalWorkloadProvider.LOCAL_WORKLOAD_PROP_USER_DOMAIN_TEMPLATE, "home.static");
        assertTrue(assertThrows(IllegalArgumentException.class, this::newProvider)
                .getMessage().contains("contain %s"));

        configureBaseProperties();
        System.setProperty(InstanceLocalWorkloadProvider.LOCAL_WORKLOAD_PROP_JWKS_URI_MAP,
                OTHER_ISSUER + "=" + jwksUri);
        assertTrue(assertThrows(IllegalArgumentException.class, this::newProvider)
                .getMessage().contains("not present"));

        configureBaseProperties();
        System.setProperty(InstanceLocalWorkloadProvider.LOCAL_WORKLOAD_PROP_BOOT_TIME_OFFSET, "-1");
        assertTrue(assertThrows(IllegalArgumentException.class, this::newProvider)
                .getMessage().contains("cannot be negative"));
    }

    @Test
    void refreshIsNotSupported() {
        final InstanceLocalWorkloadProvider provider = new InstanceLocalWorkloadProvider();

        final ProviderResourceException error = assertThrows(ProviderResourceException.class,
                () -> provider.refreshInstance(new InstanceConfirmation()));

        assertEquals(ProviderResourceException.FORBIDDEN, error.getCode());
        assertTrue(error.getMessage().contains("cannot be refreshed"));
    }

    @Test
    void reportsClassProviderScheme() {
        assertEquals(InstanceProvider.Scheme.CLASS,
                new InstanceLocalWorkloadProvider().getProviderScheme());
    }

    private InstanceLocalWorkloadProvider configuredProvider() {
        configureBaseProperties();
        return newProvider();
    }

    private void configureBaseProperties() {
        System.setProperty(InstanceLocalWorkloadProvider.LOCAL_WORKLOAD_PROP_ISSUER, ISSUER);
        System.setProperty(InstanceLocalWorkloadProvider.LOCAL_WORKLOAD_PROP_JWKS_URI, jwksUri);
        System.setProperty(InstanceLocalWorkloadProvider.LOCAL_WORKLOAD_PROP_AUDIENCE, AUDIENCE);
        System.setProperty(InstanceLocalWorkloadProvider.LOCAL_WORKLOAD_PROP_USER_NAME_CLAIM, USER_NAME_CLAIM);
        System.setProperty(InstanceLocalWorkloadProvider.LOCAL_WORKLOAD_PROP_USER_DOMAIN_TEMPLATE,
                "home.%s.local");
    }

    private InstanceLocalWorkloadProvider newProvider() {
        final InstanceLocalWorkloadProvider provider = new InstanceLocalWorkloadProvider();
        provider.initialize(PROVIDER,
                "class://com.yahoo.athenz.instance.provider.impl.InstanceLocalWorkloadProvider", null, null);
        return provider;
    }

    private InstanceConfirmation confirmation(final String domain, final String service,
            final String attestationData) {
        return new InstanceConfirmation()
                .setProvider(PROVIDER)
                .setDomain(domain)
                .setService(service)
                .setAttestationData(attestationData);
    }

    private String validToken(final String userName) throws Exception {
        return token(ISSUER, AUDIENCE, userName, now(), now().plusSeconds(3600), null,
                "user-token", true, true);
    }

    private String token(final String issuer, final String audience, final String userName,
            final Instant issueTime, final Instant expirationTime, final Instant notBefore,
            final String subject, final boolean includeIssueTime, final boolean includeExpiration)
            throws Exception {
        final JWTClaimsSet.Builder builder = new JWTClaimsSet.Builder()
                .issuer(issuer)
                .audience(audience);
        if (subject != null) {
            builder.subject(subject);
        }
        if (includeIssueTime) {
            builder.issueTime(Date.from(issueTime));
        }
        if (includeExpiration) {
            builder.expirationTime(Date.from(expirationTime));
        }
        if (notBefore != null) {
            builder.notBeforeTime(Date.from(notBefore));
        }
        if (userName != null) {
            builder.claim(USER_NAME_CLAIM, userName);
        }

        final SignedJWT jwt = new SignedJWT(
                new JWSHeader.Builder(JWSAlgorithm.ES256).keyID(KEY_ID).build(), builder.build());
        jwt.sign(new ECDSASigner((ECPrivateKey) keyPair.getPrivate()));
        return jwt.serialize();
    }

    private Instant now() {
        return Instant.now();
    }
}
