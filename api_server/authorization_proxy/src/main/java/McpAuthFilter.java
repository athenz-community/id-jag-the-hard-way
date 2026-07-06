package com.example.mcpproxy;

import com.yahoo.athenz.zpe.AuthZpeClient;
import jakarta.annotation.PostConstruct;
import jakarta.servlet.*;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;
import java.io.IOException;
import java.security.cert.X509Certificate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

@Component
public class McpAuthFilter implements Filter {
    @Value("${mcp.resource:mcp}")
    private String mcpResource;

    @Value("${athenz.at.required:true}")
    private boolean isRequired;

    private static final String DEFAULT_JWK_URI = "https://localhost:8443/zts/v1/oauth2/keys?rfc=true";

    private String getTimestamp() {
        return LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
    }

    @PostConstruct
    public void init() {
        if (!isRequired) {
            System.out.println(String.format("[%s] [WARN] [MCP-Auth-Proxy] ⚠️ AT_REQUIRED is false. Athenz auth is DISABLED. Passing through to MCP Server.", getTimestamp()));
            return;
        }

        disableSslVerification();

        // Athenz ZPE System Properties
        if (System.getProperty("athenz.zpe.jwk_uri") == null) {
            System.setProperty("athenz.zpe.jwk_uri", DEFAULT_JWK_URI);
        }
        if (System.getProperty("athenz.zpe.policy_dir") == null) {
            System.setProperty("athenz.zpe.policy_dir", "/app/policies");
        }
        if (System.getProperty("athenz.zpe.monitor_timeout_secs") == null) {
            System.setProperty("athenz.zpe.monitor_timeout_secs", "5");
        }
        if (System.getProperty("athenz.zpe.skip_policy_dir_check") == null) {
            System.setProperty("athenz.zpe.skip_policy_dir_check", "false");
        }
        if (System.getProperty("athenz.zpe.check_policy_zms_signature") == null) {
            System.setProperty("athenz.zpe.check_policy_zms_signature", "false");
        }
        AuthZpeClient.init();
        System.out.println(String.format("[%s] [INFO] [MCP-Auth-Proxy] 🛡️ Athenz ZPE Initialized! Securing API Server's MCP endpoints.", getTimestamp()));
    }

    private void disableSslVerification() {
        try {
            TrustManager[] trustAllCerts = new TrustManager[]{
                new X509TrustManager() {
                    public X509Certificate[] getAcceptedIssuers() { return null; }
                    public void checkClientTrusted(X509Certificate[] certs, String authType) {}
                    public void checkServerTrusted(X509Certificate[] certs, String authType) {}
                }
            };
            SSLContext sc = SSLContext.getInstance("SSL");
            sc.init(null, trustAllCerts, new java.security.SecureRandom());
            HttpsURLConnection.setDefaultSSLSocketFactory(sc.getSocketFactory());
            HttpsURLConnection.setDefaultHostnameVerifier((hostname, session) -> true);
        } catch (Exception e) {
            System.err.println(String.format("[%s] [ERROR] [MCP-Auth-Proxy] 🔥 Failed to disable SSL Verification: %s", getTimestamp(), e.getMessage()));
        }
    }

    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
            throws IOException, ServletException {

        HttpServletRequest request = (HttpServletRequest) req;
        HttpServletResponse response = (HttpServletResponse) res;

        if (!isRequired) {
            chain.doFilter(request, response);
            return;
        }

        if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
            chain.doFilter(req, res);
            return;
        }
        
        if ("GET".equalsIgnoreCase(request.getMethod()) && "/openapi.json".equals(request.getRequestURI())) {
            // simple logger only:
            System.out.println(String.format("[%s] [INFO] [MCP-Auth-Proxy] Authorization check skipped for GET /openapi.json", getTimestamp()));
            chain.doFilter(req, res);
            return;
        }

        String authHeader = request.getHeader("Authorization");
        String token = (authHeader != null && authHeader.startsWith("Bearer ")) ? authHeader.substring(7) : null;

        if (token == null || token.isEmpty()) {
            System.out.println(String.format("[%s] [WARN] [MCP-Auth-Proxy] ❌ REJECTED: Missing Bearer token for MCP access. (Target: %s %s)", 
                    getTimestamp(), request.getMethod(), request.getRequestURI()));

            sendJsonError(response, HttpServletResponse.SC_UNAUTHORIZED, 
                "Missing Credentials", 
                "Authorization Bearer token is required to access this MCP server.");
            return;
        }

        try {
            String action = "access"; // accessing the MCP server
            String safeToken = token.length() > 10 ? token.substring(0, 10) + "..." : token;
            
            AuthZpeClient.AccessCheckStatus status = AuthZpeClient.allowAccess(token, mcpResource, action);

            if (status != AuthZpeClient.AccessCheckStatus.ALLOW) {
                String detailMsg = String.format("Athenz security policy explicitly denied your request. (Action: '%s', Resource: '%s')", action, mcpResource);
                
                System.out.println(String.format("[%s] [WARN] [MCP-Auth-Proxy] ❌ REJECTED: Policy denied access. (Action: '%s', Resource: '%s', Token: %s)", 
                        getTimestamp(), action, mcpResource, safeToken));
                
                sendJsonError(response, HttpServletResponse.SC_FORBIDDEN, 
                    "Athenz Authorization Failed", 
                    detailMsg);
                return;
            } else {
                System.out.println(String.format("[%s] [INFO] [MCP-Auth-Proxy] ✅ AUTHORIZED: '%s' on '%s' (Token: %s)",
                    getTimestamp(), action, mcpResource, safeToken));
            }

            
            
            System.out.println(String.format("[%s] [INFO] [MCP-Auth-Proxy] ➡️ Forwarding to downstream MCP Server for API Server", 
                    getTimestamp()));
            
            chain.doFilter(request, response);

        } catch (Exception e) {
            System.err.println(String.format("[%s] [ERROR] [MCP-Auth-Proxy] 🔥 Auth Engine Error during %s %s: %s", 
                    getTimestamp(), request.getMethod(), request.getRequestURI(), e.getMessage()));
            e.printStackTrace();
            sendJsonError(response, HttpServletResponse.SC_INTERNAL_SERVER_ERROR, "Auth Engine Error", e.getMessage());
        }
    }

    /**
     * sendJsonError generates AI friendly error response.
     * @param origin The origin of the error (Athenz-Auth-Proxy)
     * @param statusCode The status code of the error
     * @param reason The reason for the error
     * @param details The details of the error
     */
    private void sendJsonError(HttpServletResponse response, int statusCode, String reason, String details) throws IOException {
        response.setStatus(statusCode);
        response.setContentType("application/json");
        response.setCharacterEncoding("UTF-8");

        String jsonBody = String.format(
            "{\"error\": {\"origin\": \"Athenz-Auth-Proxy\", \"code\": %d, \"reason\": \"%s\", \"message\": \"%s\", \"instruction\": \"Please check your Athenz role policies or provide a valid access token.\"}}",
            statusCode, reason, details
        );

        response.getWriter().write(jsonBody);
    }
}
