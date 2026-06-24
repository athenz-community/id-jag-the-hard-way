FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    AUTH_KEYCLOAK_ISSUER=http://keycloak.idp:8080/realms/master \
    API_SERVER_URL=http://api-server.api:8080 \
    ZTS_URL=https://athenz-zts-server.athenz:4443/zts/v1 \
    ZTS_AUDIENCE=https://athenz-zts-server.athenz:4443/zts/v1 \
    UI_CERT_PATH=/app/certs/org.idjag-ui.crt \
    UI_KEY_PATH=/app/certs/org.idjag-ui.key

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

RUN mkdir -p /app/certs

EXPOSE 3000

CMD ["node", "server.js"]
