package com.example.mcpproxy;

import org.json.JSONException;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.util.Set;

final class McpPublicMethods {
    private static final Set<String> METHODS = Set.of(
            "initialize",
            "notifications/initialized",
            "ping",
            "tools/list"
    );

    private McpPublicMethods() {
    }

    static boolean contains(byte[] requestBody) {
        try {
            JSONObject request = new JSONObject(new String(requestBody, StandardCharsets.UTF_8));
            return METHODS.contains(request.optString("method"));
        } catch (JSONException error) {
            return false;
        }
    }
}
