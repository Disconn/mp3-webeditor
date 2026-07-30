# syntax=docker/dockerfile:1

# Node musl build (not the official `node:*` image — Scout flags those for npm CVEs).
ARG NODE_VERSION=22.23.2
ARG NODE_DIST_ARCH=x64
# sha256 of node-v${NODE_VERSION}-linux-${NODE_DIST_ARCH}-musl.tar.xz
ARG NODE_MUSL_SHA256=2d18b5731055f7efa6c899004909b00ee110e38d3775745f60ec9ccf1f9982e7

# Full Node+npm toolkit (copied into build/deps, never shipped as final).
FROM alpine:3.22 AS node-toolkit
ARG NODE_VERSION
ARG NODE_DIST_ARCH
ARG NODE_MUSL_SHA256
RUN apk upgrade --no-cache \
  && apk add --no-cache ca-certificates curl xz libstdc++ libgcc \
  && curl -fsSL -o /tmp/node.tar.xz \
    "https://unofficial-builds.nodejs.org/download/release/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_DIST_ARCH}-musl.tar.xz" \
  && echo "${NODE_MUSL_SHA256}  /tmp/node.tar.xz" | sha256sum -c - \
  && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
  && rm /tmp/node.tar.xz \
  && node -v && npm -v

# Runtime node binary only (no npm → no npm package CVEs).
FROM alpine:3.22 AS node
RUN apk upgrade --no-cache && apk add --no-cache libstdc++ libgcc
COPY --from=node-toolkit /usr/local/bin/node /usr/local/bin/node

# --- build frontend ---
FROM alpine:3.22 AS build
WORKDIR /app

RUN apk upgrade --no-cache \
  && apk add --no-cache libstdc++ libgcc

COPY --from=node-toolkit /usr/local /usr/local

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
COPY --from=node-toolkit /usr/local /usr/local
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
