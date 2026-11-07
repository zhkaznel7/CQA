FROM node:24-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY prisma.config.js ./
COPY prisma ./prisma
COPY src/config/database-url.js ./src/config/database-url.js
RUN npm run db:generate

COPY src ./src
COPY docker ./docker
COPY scripts ./scripts
RUN mkdir -p /app/results /app/.tmp && chown node:node /app/results /app/.tmp

ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
USER node
EXPOSE 3000
CMD ["node", "docker/start.js"]
