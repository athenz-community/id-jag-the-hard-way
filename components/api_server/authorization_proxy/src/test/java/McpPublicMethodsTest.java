package com.example.mcpproxy;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class McpPublicMethodsTest {
    @Test
    void allowsProtocolBootstrapAndToolListing() {
        assertTrue(isPublic("initialize"));
        assertTrue(isPublic("notifications/initialized"));
        assertTrue(isPublic("ping"));
        assertTrue(isPublic("tools/list"));
    }

    @Test
    void keepsToolCallsProtected() {
        assertFalse(isPublic("tools/call"));
        assertFalse(McpPublicMethods.contains("not-json".getBytes(StandardCharsets.UTF_8)));
    }

    private boolean isPublic(String method) {
        String body = String.format("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"%s\"}", method);
        return McpPublicMethods.contains(body.getBytes(StandardCharsets.UTF_8));
    }
}
