PORT ?= 14443
AT_REQUIRED ?= true

local:
	@echo "Running Java Server... [PORT=$(PORT), AT_REQUIRED=$(AT_REQUIRED)]"
	PORT=$(PORT) AT_REQUIRED=$(AT_REQUIRED) mvn clean compile exec:java \
		-Dmaven.resolver.transport=wagon \
		-Dmaven.wagon.http.ssl.insecure=true \
		-Dmaven.wagon.http.ssl.allowall=true

MCP_PORT ?= 8101

# MCP_AUTHORIZATION_SERVER_URL ?= "https://athenz-zts-server.athenz:4443/zts/v1"
MCP_AUTHORIZATION_SERVER_URL ?= "https://localhost:8443/zts/v1"

mcp-local:
	@echo "🚀 Starting new OpenAPI server on port $(MCP_PORT)..."
	@cd mcp && \
	npm install && \
	PORT=$(MCP_PORT) \
	AUTHORIZATION_SERVER_URL=$(MCP_AUTHORIZATION_SERVER_URL) \
	PUBLIC_BASE_URL=http://localhost:$(MCP_PORT) \
	npx tsx ./src/index.ts

PROXY_PORT ?= 8102
TARGET_PORT ?= 8101
# PROXY_AT_REQUIRED ?= false
PROXY_AT_REQUIRED ?= true

mcp-proxy-local:
	@echo "Running Athenz Proxy Server [AT Required: $(PROXY_AT_REQUIRED) | $(PROXY_PORT) ➡️ $(TARGET_PORT)]..."
	(cd authorization_proxy && mvn clean spring-boot:run \
		-Dspring-boot.run.jvmArguments="-Dserver.port=$(PROXY_PORT) -Dmcp.target.url=http://localhost:$(TARGET_PORT) -Dathenz.at.required=$(PROXY_AT_REQUIRED)" \
		-Dmaven.resolver.transport=wagon \
		-Dmaven.wagon.http.ssl.insecure=true \
		-Dmaven.wagon.http.ssl.allowall=true)
