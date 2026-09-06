FROM ghcr.io/ctyano/athenz-cli:latest AS athenz-cli
FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY src ./src
COPY --from=athenz-cli /usr/bin/zts-svccert /usr/local/bin/zts-svccert

ENV NODE_ENV=production \
    PORT=8082 \
    MCP_TARGET_URL=http://127.0.0.1:8080

USER node

EXPOSE 8082

CMD ["node", "--experimental-strip-types", "./src/index.ts"]
