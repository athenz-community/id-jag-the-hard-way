FROM node:22-bookworm AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install --no-audit --no-fund

COPY src ./src

FROM node:22-bookworm-slim

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY package*.json ./

ENV PORT=3101
ENV UPSTREAM_BASE_URL=http://api-server.api:8080
ENV PUBLIC_BASE_URL=http://ai-client-gateway.api:3101
ENV CORS_ORIGINS=*

EXPOSE 3101

CMD ["./node_modules/.bin/tsx", "./src/index.ts"]
