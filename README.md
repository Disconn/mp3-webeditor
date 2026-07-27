# MP3 WebEditor

React + Express App zum Browse/Edit von MP3-ID3-Tags, YouTube-Cover-Download und Crop.

## Start

```bash
npm install
npm run dev
```

Neustart (belegt Ports 3001/5173 zuerst freigeben):

```bash
npm run restart
```

- Frontend: http://localhost:5173  
- API: http://127.0.0.1:3001  
- Login: `AUTH_USER` / `AUTH_PASS` aus `.env` (Standard `admin` / `secret`)

## Funktionen

- **Login** mit User/Pass (mehrere Benutzer in Settings)
- **Bibliothek**: Tabelle aller MP3s, Spalten frei wählbar, Tags inline editierbar
- **Settings**: Passwort ändern, Benutzer anlegen/löschen, mehrere Audio-Stammverzeichnisse
- **Cover von YT**: YouTube-URL im Comment-Feld → Thumbnail als Front Cover
- **Editor**: Wellenform mit Zieh-Griffen vorne/hinten (ffmpeg Crop)

Benutzer & Roots werden in `data/settings.json` gespeichert (nicht committen).

## Produktion

```bash
npm run build
set NODE_ENV=production
npm start
```

Unter Windows für `start` ggf. `NODE_ENV=production` per `cross-env` oder manuell setzen.

## Docker

### Mit docker compose (empfohlen)

```bash
cp .env.docker.example .env
# .env anpassen: AUDIO_HOST_PATH auf deinen Musik-Ordner setzen, Passwörter ändern
docker compose up -d --build
```

Läuft dann auf http://localhost:3001 (Port über `PUBLISH_PORT` in `.env` änderbar).

Der Host-Ordner aus `AUDIO_HOST_PATH` wird dabei automatisch nach `/mnt/audio` in den Container gemountet (siehe `docker-compose.yml`).

### Mit `docker run`

```bash
docker build -t mp3-webeditor .

docker run -d \
  --name mp3-webeditor \
  -p 3001:3001 \
  -v /pfad/zu/deiner/musik:/mnt/audio \
  -v mp3-webeditor-data:/app/data \
  -e SESSION_SECRET=ein-langes-zufaelliges-secret \
  -e AUTH_USER=admin \
  -e AUTH_PASS=secret \
  mp3-webeditor
```

- `-v /pfad/zu/deiner/musik:/mnt/audio` mountet dein Musikverzeichnis in den Container. **`/mnt/audio` ist der erwartete Default-Mountpunkt** und wird auch als Standard-Audio-Root in Settings (`data/settings.json`) verwendet, solange `AUDIO_DIR` nicht anders gesetzt wird.
- `-v mp3-webeditor-data:/app/data` persistiert Benutzer, Roots und Caches über Container-Neustarts hinweg.
- Weitere Roots lassen sich nach dem Start in den Settings der App hinzufügen (z. B. wenn mehrere Verzeichnisse gemountet werden).
