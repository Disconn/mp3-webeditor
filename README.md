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
