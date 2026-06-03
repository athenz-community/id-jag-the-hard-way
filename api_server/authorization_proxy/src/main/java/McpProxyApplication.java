package com.example.mcpproxy;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.web.servlet.function.RouterFunction;
import org.springframework.web.servlet.function.ServerResponse;

import static org.springframework.cloud.gateway.server.mvc.handler.GatewayRouterFunctions.route;
import static org.springframework.cloud.gateway.server.mvc.handler.HandlerFunctions.http;
import static org.springframework.web.servlet.function.RequestPredicates.all;

@SpringBootApplication
public class McpProxyApplication {
    private static final String DEFAULT_TARGET_URL = "http://localhost:8081";
    private static final String DEFAULT_PORT = "8082";

    public static void main(String[] args) {
        SpringApplication.run(McpProxyApplication.class, args);
    }

    @Bean
    public RouterFunction<ServerResponse> proxyRoute(@Value("${mcp.target.url:" + DEFAULT_TARGET_URL + "}") String targetUrl) {
        return route("mcp-proxy-route")
                .route(all(), http(targetUrl))
                .build();
    }

    @Bean
    public CommandLineRunner startupLogging(
            @Value("${server.port:" + DEFAULT_PORT + "}") String port,
            @Value("${mcp.target.url:" + DEFAULT_TARGET_URL + "}") String targetUrl) {
        
        return args -> {
            // Spring Boot 내장 Tomcat은 기본적으로 "0.0.0.0"에 바인딩됩니다.
            String publicBaseUrl = "http://0.0.0.0:" + port;
            
            System.out.println("\n=========================================================");
            System.out.println(String.format("🚀 OpenAPI MCP Auth Proxy Server listening on: %s", publicBaseUrl));
            System.out.println(String.format("🔗 Upstream API: %s", targetUrl));
            System.out.println(String.format("📄 OpenAPI Spec available at: %s/openapi.json", publicBaseUrl));
            System.out.println("=========================================================\n");
        };
    }
}
