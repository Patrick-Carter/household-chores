# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS builder

RUN apk add --no-cache python3 make g++ libc6-compat
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm ci

COPY shared/ ./shared/
COPY server/ ./server/
COPY client/ ./client/
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS runtime

RUN apk add --no-cache libc6-compat wget \
  && addgroup -g 1001 chores \
  && adduser -u 1001 -G chores -D chores

WORKDIR /app
COPY --from=builder --chown=chores:chores /app/node_modules ./node_modules
COPY --from=builder --chown=chores:chores /app/shared ./shared
COPY --from=builder --chown=chores:chores /app/server ./server
COPY --from=builder --chown=chores:chores /app/client ./client
COPY --from=builder --chown=chores:chores /app/package.json ./package.json

RUN mkdir -p /app/data && chown -R chores:chores /app/data

ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/app/data/chores.db \
    HOUSEHOLD_TIMEZONE=America/Chicago

USER chores
EXPOSE 3000

LABEL net.unraid.docker.webui="http://[IP]:[PORT:3000]/" \
      org.opencontainers.image.title="Carter House Ledger" \
      org.opencontainers.image.description="Shared household chore scheduling and workload tracker" \
      org.opencontainers.image.source="https://github.com/patrick-carter/household-chores"

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz >/dev/null 2>&1 || exit 1

CMD ["node", "server/dist/index.js"]
