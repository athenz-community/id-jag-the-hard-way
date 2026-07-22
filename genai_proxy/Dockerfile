FROM node:22-bookworm-slim

WORKDIR /app

COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src

ENV PORT=8080 \
    HOST=0.0.0.0

EXPOSE 8080

USER node

CMD ["node", "--experimental-strip-types", "./src/index.ts"]
