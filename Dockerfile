# syntax=docker/dockerfile:1

# --- build frontend ---
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html vite.config.js ./
COPY src ./src

RUN npm run build

# --- runtime ---
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0 \
    AUDIO_DIR=/audio \
    FFMPEG_PATH=ffmpeg \
    SESSION_SECRET=change-me-in-production \
    AUTH_USER=admin \
    AUTH_PASS=secret

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY --from=build /app/dist ./dist

RUN mkdir -p /audio /app/data /app/server/tmp \
  && chown -R node:node /app /audio

USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/me').then(r=>process.exit(r.status===401||r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
