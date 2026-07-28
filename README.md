# MP3 WebEditor

React + Express app for browsing/editing MP3 ID3 tags, YouTube cover download, and cropping.

## Start

```bash
npm install
npm run dev
```

Restart (frees ports 3001/5173 first):

```bash
npm run restart
```

- Frontend: http://localhost:5173  
- API: http://127.0.0.1:3001  
- Login: `AUTH_USER` / `AUTH_PASS` from `.env` (default `admin` / `secret`)

## Features

- **Login** with user/password (multiple users in Settings)
- **Library**: table of all MP3s, freely selectable columns, tags editable inline
- **Settings**: change password, add/remove users, multiple audio root directories
- **Cover from YT**: YouTube URL in the comment field → thumbnail as front cover
- **Editor**: waveform with drag handles front/back (ffmpeg crop)

Users & roots are stored in `data/settings.json` (don't commit).

## Production

```bash
npm run build
set NODE_ENV=production
npm start
```

On Windows, set `NODE_ENV=production` for `start` via `cross-env` or manually if needed.

## Docker

### With docker compose (recommended)

```bash
cp .env.docker.example .env
# adjust .env: set AUDIO_HOST_PATH to your music folder, change passwords
docker compose up -d --build
```

Runs on http://localhost:3001 (port configurable via `PUBLISH_PORT` in `.env`).

The host folder from `AUDIO_HOST_PATH` is automatically mounted into the container at `/mnt/audio` (see `docker-compose.yml`).

### With `docker run`

```bash
docker build -t mp3-webeditor .

docker run -d \
  --name mp3-webeditor \
  -p 3001:3001 \
  -v /path/to/your/music:/mnt/audio \
  -v mp3-webeditor-data:/app/data \
  -e SESSION_SECRET=a-long-random-secret \
  -e AUTH_USER=admin \
  -e AUTH_PASS=secret \
  mp3-webeditor
```

- `-v /path/to/your/music:/mnt/audio` mounts your music directory into the container. **`/mnt/audio` is the expected default mount point** and is also used as the default audio root in Settings (`data/settings.json`) as long as `AUDIO_DIR` isn't set differently.
- `-v mp3-webeditor-data:/app/data` persists users, roots, and caches across container restarts.
- Additional roots can be added in the app's Settings after startup (e.g. when multiple directories are mounted).
