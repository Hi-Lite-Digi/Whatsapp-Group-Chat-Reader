FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY client ./client
COPY src ./src
COPY test ./test
COPY vite.config.js ./
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node scripts ./scripts

RUN mkdir -p /app/runtime/auth /app/runtime/data /app/runtime/media /app/runtime/backups \
    && chown -R node:node /app/runtime

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=8s --start-period=45s --retries=3 \
  CMD ["node", "scripts/healthcheck.mjs"]

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/server/index.js"]
