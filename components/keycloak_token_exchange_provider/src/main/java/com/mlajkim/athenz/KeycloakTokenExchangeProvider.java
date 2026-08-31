package com.mlajkim.athenz;

import java.util.Collections;
import java.util.List;

import com.yahoo.athenz.auth.TokenExchangeIdentityProvider;
import com.yahoo.athenz.auth.token.OAuth2Token;

public class KeycloakTokenExchangeProvider implements TokenExchangeIdentityProvider {

    /** Maps the Keycloak username to user.* for athenzd and human.* for existing tutorial clients. */
    @Override
    public String getTokenIdentity(OAuth2Token token) {
        Object preferredUsername = token.getClaim("preferred_username");
        if (preferredUsername == null) {
            return null;
        }

        String domain = "athenzd".equals(token.getClaim("azp")) ? "user" : "human";
        return domain + "." + preferredUsername;
    }

    /** Returns the token audience that ZTS compares with the requesting service client ID. */
    @Override
    public String getTokenAudience(OAuth2Token token) {
        Object aud = token.getClaim("aud");
        if (aud instanceof List && !((List<?>) aud).isEmpty()) {
            return ((List<?>) aud).get(0).toString();
        } else if (aud != null) {
            return aud.toString();
        }

        return "";
    }

    /** Declares that no extra Keycloak claims are copied into exchanged tokens. */
    @Override
    public List<String> getTokenExchangeClaims() {
        return Collections.emptyList();
    }
}

// Sample for id-token:
//
// # {
// #   "alg": "RS256",
// #   "typ": "JWT",
// #   "kid": "y9uTPjyMxWjkWWco4LWCbWKojma_7KaABqaQ77ptND8"
// # }
// # {
// #   "exp": 1777336513,
// #   "iat": 1777336213,
// #   "jti": "806bd010-1d23-a384-d2a2-63eeea28f7f8",
// #   "iss": "https://localhost:9089/realms/local-openwebui",
// #   "aud": "local-open-webui",
// #   "sub": "d438e2cf-5deb-4b12-8c1d-a213375e46e1",
// #   "typ": "ID",
// #   "azp": "local-open-webui",
// #   "sid": "SM8K11PbzPeDQ3Uibn0zkI72",
// #   "at_hash": "SK7KD6TrT9hax2KbHit3HQ",
// #   "acr": "1",
// #   "email_verified": false,
// #   "name": "jeongwoo kim",
// #   "preferred_username": "jeongwoo",
// #   "given_name": "jeongwoo",
// #   "family_name": "kim",
// #   "email": "jkim67cloud@gmail.com"
// # }
