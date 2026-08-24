FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json ./
COPY src ./src

ENV PORT=8080
ENV MCP_HUB_LABEL_SELECTOR=app.kubernetes.io/part-of=mcp-hub
ENV ROUTE_CACHE_TTL_MS=5000

EXPOSE 8080

CMD ["node", "--experimental-strip-types", "./src/index.ts"]
