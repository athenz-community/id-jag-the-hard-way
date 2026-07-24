FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

FROM registry.k8s.io/kubectl:v1.34.2 AS kubectl

FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3102

COPY --from=kubectl /bin/kubectl /usr/local/bin/kubectl
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

RUN mkdir -p /app/certs /root/.kube

EXPOSE 3102

CMD ["node", "server.js"]
