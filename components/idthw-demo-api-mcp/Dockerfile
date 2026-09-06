FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY src ./src

ENV NODE_ENV=production \
    PORT=8080 \
    UPSTREAM_BASE_URL=http://api-server.api:8080

USER node

EXPOSE 8080

CMD ["node", "--experimental-strip-types", "./src/index.ts"]
