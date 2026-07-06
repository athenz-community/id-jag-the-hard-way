FROM node:22-bookworm AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --maxsockets 1 --no-audit --no-fund

COPY src ./src

FROM node:22-bookworm-slim

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY package*.json ./

RUN mkdir -p /app/certs

ENV PORT=8081
ENV UPSTREAM_BASE_URL=http://api-server.api:8080
ENV PUBLIC_BASE_URL=http://mcp.api:8081
ENV MCP_CERT_DIR=/app/certs
ENV ATHENZ_CERT_PATH=/app/certs/api-mcp.crt
ENV ATHENZ_KEY_PATH=/app/certs/api-mcp.key
ENV ATHENZ_CA_PATH=/app/certs/ca.crt

EXPOSE 8081

CMD ["./node_modules/.bin/tsx", "./src/index.ts"]
