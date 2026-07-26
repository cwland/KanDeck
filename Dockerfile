# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# KanDeck production image.
# Multi-arch friendly: build for the server's arch with buildx (see below).
# ---------------------------------------------------------------------------
FROM node:20-alpine AS deps
WORKDIR /app
# Install only production deps for a small final image.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# tini for correct signal handling (graceful shutdown of cron/server).
RUN apk add --no-cache tini
# Non-root runtime user.
RUN addgroup -S kandeck && adduser -S kandeck -G kandeck

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

# Data dir is a bind/volume mount at runtime; create + own it.
RUN mkdir -p /app/data/boards /app/data/backups && chown -R kandeck:kandeck /app
USER kandeck

EXPOSE 8080
ENV PORT=8080 HOST=0.0.0.0 DATA_DIR=/app/data

HEALTHCHECK --interval=30s --timeout=4s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]
