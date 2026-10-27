FROM node:22-bookworm-slim AS build

WORKDIR /app
ARG VERSION=v1.12.50

COPY package.json package-lock.json upstream.json upstream-v1.12.46.json ./
COPY scripts/fetch-library.mjs scripts/releases.cjs ./scripts/
RUN node scripts/fetch-library.mjs "${VERSION}" /app/selected-upstream.json
RUN npm ci --install-links --ignore-scripts --no-audit --no-fund

COPY src ./src
RUN node --check src/server.cjs && node --check src/logging.cjs

FROM node:22-bookworm-slim

WORKDIR /app
ARG VERSION=v1.12.50
LABEL org.opencontainers.image.title="IDTHW Athenz Node.js provider lab" \
      org.opencontainers.image.version="${VERSION}"

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=18080

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/src ./src
COPY --from=build /app/selected-upstream.json ./upstream.json
COPY --from=build /app/vendor/LICENSE ./LICENSE

USER node
EXPOSE 18080
CMD ["node", "src/server.cjs"]
