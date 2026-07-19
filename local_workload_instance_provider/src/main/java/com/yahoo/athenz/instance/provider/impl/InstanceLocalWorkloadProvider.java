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

import com.nimbusds.jose.proc.SecurityContext;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.nimbusds.jwt.proc.ConfigurableJWTProcessor;
import com.yahoo.athenz.auth.KeyStore;
import com.yahoo.athenz.auth.token.jwts.JwtsHelper;
import com.yahoo.athenz.auth.token.jwts.JwtsSigningKeyResolver;
import com.yahoo.athenz.instance.provider.InstanceConfirmation;
import com.yahoo.athenz.instance.provider.InstanceProvider;
import com.yahoo.athenz.instance.provider.ProviderResourceException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.net.ssl.SSLContext;
import java.text.ParseException;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

/**
 * Class-based Copper Argos provider for local workloads.
 *
 * <p>The provider accepts an OIDC ID token as attestation, validates it only
 * against explicitly configured issuers and IdP signing keys, and restricts
 * the requested Athenz service domain to the authenticated user's configured
 * home-domain subtree.</p>
 */
public class InstanceLocalWorkloadProvider implements InstanceProvider {

    private static final Logger LOG = LoggerFactory.getLogger(InstanceLocalWorkloadProvider.class);

    public static final String LOCAL_WORKLOAD_PROP_ISSUER =
            "athenz.zts.local_workload.issuer";
    public static final String LOCAL_WORKLOAD_PROP_JWKS_URI =
            "athenz.zts.local_workload.jwks_uri";
    public static final String LOCAL_WORKLOAD_PROP_JWKS_URI_MAP =
            "athenz.zts.local_workload.jwks_uri_map";
    public static final String LOCAL_WORKLOAD_PROP_AUDIENCE =
            "athenz.zts.local_workload.audience";
    public static final String LOCAL_WORKLOAD_PROP_USER_NAME_CLAIM =
            "athenz.zts.local_workload.user_name_claim";
    public static final String LOCAL_WORKLOAD_PROP_USER_DOMAIN_TEMPLATE =
            "athenz.zts.local_workload.user_domain_template";
    public static final String LOCAL_WORKLOAD_PROP_EXTERNAL_DOMAIN =
            "athenz.zts.local_workload.external_domain";
    public static final String LOCAL_WORKLOAD_PROP_EXTERNAL_DOMAIN_MAP =
            "athenz.zts.local_workload.external_domain_map";
    public static final String LOCAL_WORKLOAD_PROP_BOOT_TIME_OFFSET =
            "athenz.zts.local_workload.boot_time_offset";

    static final String DEFAULT_USER_NAME_CLAIM = "athenz_user";
    static final String DEFAULT_USER_DOMAIN_TEMPLATE = "home.%s";
    static final long DEFAULT_BOOT_TIME_OFFSET_SECONDS = 0;
    static final long ALLOWED_FUTURE_ISSUE_TIME_SECONDS = 60;
    static final String BEARER_PREFIX = "Bearer ";
    static final Pattern SIMPLE_NAME_PATTERN =
            Pattern.compile("^[a-zA-Z0-9_][a-zA-Z0-9_-]*$");

    String provider;
    SSLContext sslContext;
    Set<String> audiences = Collections.emptySet();
    String userNameClaim = DEFAULT_USER_NAME_CLAIM;
    String userDomainTemplate = DEFAULT_USER_DOMAIN_TEMPLATE;
    long bootTimeOffsetSeconds = DEFAULT_BOOT_TIME_OFFSET_SECONDS;
    final JwtsHelper jwtsHelper = new JwtsHelper();
    final ConcurrentMap<String, IssuerConfig> issuerConfigs = new ConcurrentHashMap<>();

    @Override
    public Scheme getProviderScheme() {
        return Scheme.CLASS;
    }

    @Override
    public void initialize(final String provider, final String providerEndpoint, final SSLContext sslContext,
            final KeyStore keyStore) {
        if (isEmpty(provider)) {
            throw new IllegalArgumentException("Local workload provider name must be configured");
        }

        this.provider = provider;
        this.sslContext = sslContext;
        issuerConfigs.clear();

        audiences = parseCsvSet(System.getProperty(LOCAL_WORKLOAD_PROP_AUDIENCE));
        if (audiences.isEmpty()) {
            throw new IllegalArgumentException("Local workload audience must be configured");
        }

        final Set<String> configuredIssuers = parseCsvSet(System.getProperty(LOCAL_WORKLOAD_PROP_ISSUER));
        if (configuredIssuers.isEmpty()) {
            throw new IllegalArgumentException("At least one local workload issuer must be configured");
        }

        userNameClaim = trimmedProperty(LOCAL_WORKLOAD_PROP_USER_NAME_CLAIM, DEFAULT_USER_NAME_CLAIM);
        if (isEmpty(userNameClaim)) {
            throw new IllegalArgumentException("Local workload user name claim must be configured");
        }

        userDomainTemplate = trimmedProperty(
                LOCAL_WORKLOAD_PROP_USER_DOMAIN_TEMPLATE, DEFAULT_USER_DOMAIN_TEMPLATE);
        validateUserDomainTemplate(userDomainTemplate);
        bootTimeOffsetSeconds = parseNonNegativeLong(
                System.getProperty(LOCAL_WORKLOAD_PROP_BOOT_TIME_OFFSET), DEFAULT_BOOT_TIME_OFFSET_SECONDS);

        final Map<String, String> jwksUriMap = parseMap(
                System.getProperty(LOCAL_WORKLOAD_PROP_JWKS_URI_MAP));
        final Map<String, String> externalDomainMap = parseMap(
                System.getProperty(LOCAL_WORKLOAD_PROP_EXTERNAL_DOMAIN_MAP));
        requireMapKeysAllowed(LOCAL_WORKLOAD_PROP_JWKS_URI_MAP, configuredIssuers, jwksUriMap);
        requireMapKeysAllowed(LOCAL_WORKLOAD_PROP_EXTERNAL_DOMAIN_MAP, configuredIssuers, externalDomainMap);

        final String singleJwksUri = trimToNull(System.getProperty(LOCAL_WORKLOAD_PROP_JWKS_URI));
        final String singleExternalDomain = trimToNull(System.getProperty(LOCAL_WORKLOAD_PROP_EXTERNAL_DOMAIN));
        if (configuredIssuers.size() > 1 && singleJwksUri != null) {
            throw new IllegalArgumentException(
                    LOCAL_WORKLOAD_PROP_JWKS_URI + " requires exactly one configured issuer");
        }
        if (configuredIssuers.size() > 1 && singleExternalDomain != null) {
            throw new IllegalArgumentException(
                    LOCAL_WORKLOAD_PROP_EXTERNAL_DOMAIN + " requires exactly one configured issuer");
        }

        for (String issuer : configuredIssuers) {
            final String jwksUri = configuredIssuers.size() == 1 && singleJwksUri != null
                    ? singleJwksUri : jwksUriMap.get(issuer);
            final String externalDomain = configuredIssuers.size() == 1 && singleExternalDomain != null
                    ? singleExternalDomain : externalDomainMap.get(issuer);
            if (externalDomain != null) {
                validateDomain(externalDomain, "external domain");
            }
            issuerConfigs.put(issuer, new IssuerConfig(issuer, jwksUri, externalDomain));
        }
    }

    @Override
    public InstanceConfirmation confirmInstance(final InstanceConfirmation confirmation)
            throws ProviderResourceException {
        if (confirmation == null) {
            throw error("Instance confirmation request not provided", ProviderResourceException.BAD_REQUEST);
        }
        if (!Objects.equals(provider, confirmation.getProvider())) {
            throw error("Instance confirmation provider does not match configured provider",
                    ProviderResourceException.FORBIDDEN);
        }

        final String domain = confirmation.getDomain();
        final String service = confirmation.getService();
        if (isEmpty(domain) || isEmpty(service)) {
            throw error("Domain and service must be provided", ProviderResourceException.BAD_REQUEST);
        }

        final String attestationData = normalizeAttestationData(confirmation.getAttestationData());
        if (isEmpty(attestationData)) {
            throw error("Service credentials not provided", ProviderResourceException.FORBIDDEN);
        }

        final JWTClaimsSet claimsSet = validateToken(attestationData);
        final String allowedRootDomain = resolveAllowedRootDomain(claimsSet);
        if (isEmpty(allowedRootDomain)) {
            throw error("Unable to resolve allowed domain for token issuer", ProviderResourceException.FORBIDDEN);
        }

        if (!isDomainInScope(domain, allowedRootDomain)) {
            throw error("Requested service is outside the allowed domain", ProviderResourceException.FORBIDDEN);
        }

        final Map<String, String> attributes = new HashMap<>();
        attributes.put(ZTS_CERT_REFRESH, "false");
        attributes.put(ZTS_CERT_USAGE, ZTS_CERT_USAGE_CLIENT);
        confirmation.setAttributes(attributes);
        return confirmation;
    }

    @Override
    public InstanceConfirmation refreshInstance(final InstanceConfirmation confirmation)
            throws ProviderResourceException {
        throw error("Local workload certificates cannot be refreshed", ProviderResourceException.FORBIDDEN);
    }

    JWTClaimsSet validateToken(final String token) throws ProviderResourceException {
        final String tokenIssuer = extractIssuer(token);
        final IssuerConfig issuerConfig = issuerConfigs.get(tokenIssuer);
        if (issuerConfig == null) {
            throw error("Token issuer is not configured: " + tokenIssuer, ProviderResourceException.FORBIDDEN);
        }

        final ConfigurableJWTProcessor<SecurityContext> processor = getJwtProcessor(issuerConfig);
        if (processor == null) {
            throw error("JWT processor not initialized", ProviderResourceException.INTERNAL_SERVER_ERROR);
        }

        final JWTClaimsSet claimsSet;
        try {
            claimsSet = processor.process(token, null);
        } catch (Exception ex) {
            throw error("Unable to parse and validate token: " + ex.getMessage(),
                    ProviderResourceException.FORBIDDEN);
        }

        if (!issuerConfig.issuer.equals(claimsSet.getIssuer())) {
            throw error("Token issuer does not match configured issuer: " + claimsSet.getIssuer(),
                    ProviderResourceException.FORBIDDEN);
        }

        if (isEmpty(claimsSet.getSubject())) {
            throw error("Token does not contain required sub claim", ProviderResourceException.FORBIDDEN);
        }

        validateAudience(claimsSet);
        validateExpiration(claimsSet);
        validateIssueTime(claimsSet);
        return claimsSet;
    }

    String extractIssuer(final String token) throws ProviderResourceException {
        try {
            final SignedJWT signedJWT = SignedJWT.parse(token);
            final String issuer = signedJWT.getJWTClaimsSet().getIssuer();
            if (isEmpty(issuer)) {
                throw error("Token does not contain required iss claim", ProviderResourceException.FORBIDDEN);
            }
            return issuer;
        } catch (ParseException ex) {
            throw error("Unable to parse token: " + ex.getMessage(), ProviderResourceException.FORBIDDEN);
        }
    }

    ConfigurableJWTProcessor<SecurityContext> getJwtProcessor(final IssuerConfig issuerConfig) {
        ConfigurableJWTProcessor<SecurityContext> processor = issuerConfig.jwtProcessor;
        if (processor != null) {
            return processor;
        }

        synchronized (issuerConfig) {
            processor = issuerConfig.jwtProcessor;
            if (processor != null) {
                return processor;
            }

            String jwksUri = issuerConfig.jwksUri;
            if (isEmpty(jwksUri)) {
                jwksUri = extractIssuerJwksUri(issuerConfig.issuer);
            }
            if (isEmpty(jwksUri)) {
                jwksUri = issuerConfig.issuer + "/.well-known/jwks";
            }

            // skipConfig=true is intentional: only the configured IdP JWKS may
            // validate local-workload attestations. ZTS/SIA keys are excluded.
            issuerConfig.jwtProcessor = JwtsHelper.getJWTProcessor(
                    new JwtsSigningKeyResolver(jwksUri, sslContext, true));
            return issuerConfig.jwtProcessor;
        }
    }

    String extractIssuerJwksUri(final String issuer) {
        if (isEmpty(issuer)) {
            return null;
        }
        return jwtsHelper.extractJwksUri(issuer + "/.well-known/openid-configuration", sslContext);
    }

    void validateAudience(final JWTClaimsSet claimsSet) throws ProviderResourceException {
        if (audiences == null || audiences.isEmpty()) {
            throw error("Local workload audience not configured",
                    ProviderResourceException.INTERNAL_SERVER_ERROR);
        }

        final List<String> audienceList = claimsSet.getAudience();
        final Set<String> tokenAudiences = audienceList == null
                ? Collections.emptySet() : new HashSet<>(audienceList);
        if (tokenAudiences.stream().noneMatch(audiences::contains)) {
            throw error("Token audience is not configured local workload audience: " + tokenAudiences,
                    ProviderResourceException.FORBIDDEN);
        }
    }

    void validateExpiration(final JWTClaimsSet claimsSet) throws ProviderResourceException {
        if (claimsSet.getExpirationTime() == null) {
            throw error("Token does not contain required exp claim", ProviderResourceException.FORBIDDEN);
        }
        // Nimbus validates exp and nbf while processing the signed JWT. This
        // explicit check makes exp mandatory for the attestation contract.
    }

    void validateIssueTime(final JWTClaimsSet claimsSet) throws ProviderResourceException {
        final Date issueTime = claimsSet.getIssueTime();
        if (issueTime == null) {
            throw error("Token does not contain required iat claim", ProviderResourceException.FORBIDDEN);
        }

        final long now = System.currentTimeMillis();
        if (issueTime.getTime() > now + TimeUnit.SECONDS.toMillis(ALLOWED_FUTURE_ISSUE_TIME_SECONDS)) {
            throw error("Token issue time is in the future: " + issueTime, ProviderResourceException.FORBIDDEN);
        }
        if (bootTimeOffsetSeconds > 0
                && issueTime.getTime() < now - TimeUnit.SECONDS.toMillis(bootTimeOffsetSeconds)) {
            throw error("Token issue time is not recent enough: " + issueTime,
                    ProviderResourceException.FORBIDDEN);
        }
    }

    String resolveAllowedRootDomain(final JWTClaimsSet claimsSet) throws ProviderResourceException {
        final String rawUserName = JwtsHelper.getStringClaim(claimsSet, userNameClaim);
        if (!isEmpty(rawUserName)) {
            final String userName = normalizeUserName(rawUserName);
            if (!isValidSimpleName(userName)) {
                throw error("Token user name is not a valid Athenz simple name",
                        ProviderResourceException.FORBIDDEN);
            }
            return buildUserRootDomain(userName);
        }

        final IssuerConfig issuerConfig = issuerConfigs.get(claimsSet.getIssuer());
        return issuerConfig == null ? null : normalizeDomain(issuerConfig.externalDomain);
    }

    String buildUserRootDomain(final String userName) throws ProviderResourceException {
        if (isEmpty(userDomainTemplate) || !userDomainTemplate.contains("%s")) {
            throw error("User domain template must contain %s",
                    ProviderResourceException.INTERNAL_SERVER_ERROR);
        }
        if (!isValidSimpleName(userName)) {
            throw error("Token user name is not a valid Athenz simple name",
                    ProviderResourceException.FORBIDDEN);
        }

        final String domain = normalizeDomain(userDomainTemplate.replace("%s", userName));
        if (!isValidDomain(domain)) {
            throw error("User domain template produced an invalid Athenz domain",
                    ProviderResourceException.INTERNAL_SERVER_ERROR);
        }
        return domain;
    }

    boolean isDomainInScope(final String domain, final String rootDomain) {
        final String normalizedDomain = normalizeDomain(domain);
        final String normalizedRootDomain = normalizeDomain(rootDomain);
        if (isEmpty(normalizedDomain) || isEmpty(normalizedRootDomain)) {
            return false;
        }
        return normalizedDomain.equals(normalizedRootDomain)
                || normalizedDomain.startsWith(normalizedRootDomain + ".");
    }

    String normalizeAttestationData(final String attestationData) {
        final String trimmed = trimToNull(attestationData);
        if (trimmed == null) {
            return null;
        }
        return trimmed.regionMatches(true, 0, BEARER_PREFIX, 0, BEARER_PREFIX.length())
                ? trimToNull(trimmed.substring(BEARER_PREFIX.length())) : trimmed;
    }

    String normalizeUserName(final String userName) {
        final String trimmed = trimToNull(userName);
        if (trimmed == null) {
            return null;
        }
        String normalizedUserName = trimmed.toLowerCase(Locale.ROOT);
        if (normalizedUserName.startsWith("user.")) {
            normalizedUserName = normalizedUserName.substring("user.".length());
        }
        return trimToNull(normalizedUserName);
    }

    String normalizeDomain(final String domain) {
        final String trimmed = trimToNull(domain);
        return trimmed == null ? null : trimmed.toLowerCase(Locale.ROOT);
    }

    boolean isValidSimpleName(final String value) {
        return value != null && SIMPLE_NAME_PATTERN.matcher(value).matches();
    }

    boolean isValidDomain(final String value) {
        if (isEmpty(value)) {
            return false;
        }
        final String[] labels = value.split("\\.", -1);
        if (labels.length < 2) {
            return false;
        }
        for (String label : labels) {
            if (!isValidSimpleName(label)) {
                return false;
            }
        }
        return true;
    }

    Set<String> parseCsvSet(final String propertyValue) {
        if (isEmpty(propertyValue)) {
            return Collections.emptySet();
        }
        final Set<String> values = new LinkedHashSet<>();
        for (String value : propertyValue.split(",")) {
            final String trimmed = trimToNull(value);
            if (trimmed != null) {
                values.add(trimmed);
            }
        }
        return Collections.unmodifiableSet(values);
    }

    Map<String, String> parseMap(final String propertyValue) {
        if (isEmpty(propertyValue)) {
            return Collections.emptyMap();
        }
        final Map<String, String> values = new LinkedHashMap<>();
        for (String entry : propertyValue.split(";")) {
            final int separatorIdx = entry.indexOf('=');
            if (separatorIdx <= 0 || separatorIdx == entry.length() - 1) {
                throw new IllegalArgumentException("Invalid local workload map entry: " + entry);
            }
            final String key = trimToNull(entry.substring(0, separatorIdx));
            final String value = trimToNull(entry.substring(separatorIdx + 1));
            if (key == null || value == null) {
                throw new IllegalArgumentException("Invalid local workload map entry: " + entry);
            }
            if (values.put(key, value) != null) {
                throw new IllegalArgumentException("Duplicate local workload map key: " + key);
            }
        }
        return Collections.unmodifiableMap(values);
    }

    long parseNonNegativeLong(final String propertyValue, final long defaultValue) {
        final String trimmed = trimToNull(propertyValue);
        if (trimmed == null) {
            return defaultValue;
        }
        try {
            final long value = Long.parseLong(trimmed);
            if (value < 0) {
                throw new IllegalArgumentException("Local workload numeric property cannot be negative");
            }
            return value;
        } catch (NumberFormatException ex) {
            throw new IllegalArgumentException("Invalid local workload numeric property: " + propertyValue, ex);
        }
    }

    private String trimmedProperty(final String name, final String defaultValue) {
        return trimToNull(System.getProperty(name, defaultValue));
    }

    private void validateUserDomainTemplate(final String template) {
        if (isEmpty(template) || !template.contains("%s")) {
            throw new IllegalArgumentException("User domain template must be configured and contain %s");
        }
        final String sample = normalizeDomain(template.replace("%s", "sample_user"));
        validateDomain(sample, "user domain template");
    }

    private void validateDomain(final String domain, final String description) {
        if (!isValidDomain(normalizeDomain(domain))) {
            throw new IllegalArgumentException(description + " is not a valid Athenz domain: " + domain);
        }
    }

    private void requireMapKeysAllowed(final String propertyName, final Set<String> allowedIssuers,
            final Map<String, String> values) {
        for (String issuer : values.keySet()) {
            if (!allowedIssuers.contains(issuer)) {
                throw new IllegalArgumentException(
                        propertyName + " contains an issuer not present in " + LOCAL_WORKLOAD_PROP_ISSUER
                                + ": " + issuer);
            }
        }
    }

    private boolean isEmpty(final String value) {
        return value == null || value.trim().isEmpty();
    }

    private String trimToNull(final String value) {
        if (value == null) {
            return null;
        }
        final String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private ProviderResourceException error(final String message, final int code) {
        LOG.error(message);
        return new ProviderResourceException(code, message);
    }

    static final class IssuerConfig {

        final String issuer;
        final String jwksUri;
        final String externalDomain;
        volatile ConfigurableJWTProcessor<SecurityContext> jwtProcessor;

        IssuerConfig(final String issuer, final String jwksUri, final String externalDomain) {
            this.issuer = Objects.requireNonNull(issuer);
            this.jwksUri = jwksUri;
            this.externalDomain = externalDomain;
        }
    }
}
