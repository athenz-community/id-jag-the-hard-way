package com.mlajkim.athenz;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import com.yahoo.athenz.auth.token.OAuth2Token;
import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

public class KeycloakTokenExchangeProviderTest {

    private final KeycloakTokenExchangeProvider provider = new KeycloakTokenExchangeProvider();

    @Test
    public void mapsAthenzdClientToUserIdentity() {
        assertEquals("user.idjag-learner", provider.getTokenIdentity(token(
                "preferred_username", "idjag-learner",
                "azp", "athenzd")));
    }

    @Test
    public void mapsTutorialClientToHumanIdentity() {
        assertEquals("human.idjag-learner", provider.getTokenIdentity(token(
                "preferred_username", "idjag-learner",
                "azp", "human.idjag-learner.claude")));
    }

    @Test
    public void rejectsTokenWithoutPreferredUsername() {
        assertNull(provider.getTokenIdentity(token(
                "sub", "3b1ebc43-f64d-446f-a388-b0431801fe57",
                "azp", "athenzd")));
    }

    @Test
    public void returnsStringOrFirstListAudience() {
        assertEquals("athenzd", provider.getTokenAudience(token("aud", "athenzd")));
        assertEquals("first-client", provider.getTokenAudience(token(
                "aud", List.of("first-client", "second-client"))));
        assertEquals("", provider.getTokenAudience(token()));
    }

    @Test
    public void doesNotCopyExtraClaims() {
        assertTrue(provider.getTokenExchangeClaims().isEmpty());
    }

    private static OAuth2Token token(Object... claims) {
        Map<String, Object> values = new HashMap<>();
        for (int index = 0; index < claims.length; index += 2) {
            values.put((String) claims[index], claims[index + 1]);
        }
        return new StubOAuth2Token(values);
    }

    private static final class StubOAuth2Token extends OAuth2Token {
        private final Map<String, Object> claims;

        private StubOAuth2Token(Map<String, Object> claims) {
            this.claims = claims;
        }

        @Override
        public Object getClaim(String name) {
            return claims.get(name);
        }
    }
}
