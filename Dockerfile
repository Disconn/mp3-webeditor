# syntax=docker/dockerfile:1

# Binary source only — not used as the IDE-scanned app base.
FROM node:22-alpine AS node

# --- build frontend ---
# Base alpine:3.22 → 0 critical/high (unlike node:* which bundles vulnerable npm).
FROM alpine:3.22 AS build
WORKDIR /app

RUN apk upgrade --no-cache \
  && apk add --no-cache libstdc++ libgcc

COPY --from=node /usr/local /usr/local

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html vite.config.js ./
COPY src ./src
COPY public ./public

RUN npm run build \
  && rm -rf \
    /usr/local/lib/node_modules \
    /usr/local/bin/npm \
    /usr/local/bin/npx \
    /usr/local/bin/corepack \
    /root/.npm \
    /app/node_modules

FROM mwader/static-ffmpeg:8.0 AS ffmpeg

# Prod dependencies (npm removed afterwards)
FROM alpine:3.22 AS prod-deps
WORKDIR /app
RUN apk upgrade --no-cache && apk add --no-cache libstdc++ libgcc
COPY --from=node /usr/local /usr/local
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
  && npm cache clean --force \
  && rm -rf \
    /usr/local/lib/node_modules \
    /usr/local/bin/npm \
    /usr/local/bin/npx \
    /usr/local/bin/corepack \
    /root/.npm

# --- runtime ---
FROM alpine:3.22 AS runtime
WORKDIR /app

RUN apk upgrade --no-cache \
  && apk add --no-cache libstdc++ libgcc ca-certificates tini \
  && addgroup -S node && adduser -S node -G node \
  && rm -rf /var/cache/apk/*

COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=ffmpeg /ffmpeg /usr/local/bin/ffmpeg
COPY --from=ffmpeg /ffprobe /usr/local/bin/ffprobe

ENV NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0 \
    AUDIO_DIR=/mnt/audio \
    FFMPEG_PATH=/usr/local/bin/ffmpeg

COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY --from=build /app/dist ./dist

RUN mkdir -p /mnt/audio /app/data /app/server/tmp \
  && chown -R node:node /app /mnt/audio \
  && chmod 755 /usr/local/bin/node /usr/local/bin/ffmpeg /usr/local/bin/ffprobe

USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/me').then(r=>process.exit(r.status===401||r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server/index.js"]
