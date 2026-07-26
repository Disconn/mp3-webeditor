import express from 'express';
import session from 'express-session';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { ensureAudioDirs } from './paths.js';
import { loadSettings } from './store.js';
import {
  loginHandler,
  logoutHandler,
  meHandler,
  requireAuth,
  getSettingsHandler,
  changePasswordHandler,
  addUserHandler,
  removeUserHandler,
  setRootsHandler,
  setColumnsHandler,
  setWaveZoomHandler,
} from './auth.js';
import { listTree, listLibrary } from './routes/files.js';
import {
  readTags,
  writeTags,
  readRowMeta,
  clearCacheHandler,
  cacheStatsHandler,
} from './routes/tags.js';
import { fetchYtCover, streamCover, saveCover } from './routes/cover.js';
import { cropMp3, getDuration, streamAudio } from './routes/crop.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

loadSettings();
ensureAudioDirs();

app.use(
  cors({
    origin: config.isProd
      ? false
      : ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:5174', 'http://127.0.0.1:5174'],
    credentials: true,
  })
);
app.use(express.json({ limit: '10mb' }));
app.use(
  session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);

app.post('/api/login', loginHandler);
app.post('/api/logout', logoutHandler);
app.get('/api/me', meHandler);

app.get('/api/settings', requireAuth, getSettingsHandler);
app.put('/api/settings/password', requireAuth, changePasswordHandler);
app.post('/api/settings/users', requireAuth, addUserHandler);
app.delete('/api/settings/users/:username', requireAuth, removeUserHandler);
app.put('/api/settings/roots', requireAuth, setRootsHandler);
app.put('/api/settings/columns', requireAuth, setColumnsHandler);
app.put('/api/settings/wave-zoom', requireAuth, setWaveZoomHandler);

app.get('/api/files', requireAuth, listTree);
app.get('/api/library', requireAuth, listLibrary);
app.get('/api/library/meta', requireAuth, readRowMeta);
app.get('/api/cache/stats', requireAuth, cacheStatsHandler);
app.delete('/api/cache', requireAuth, clearCacheHandler);
app.get('/api/tags', requireAuth, readTags);
app.put('/api/tags', requireAuth, writeTags);
app.post('/api/cover/youtube', requireAuth, fetchYtCover);
app.put('/api/cover', requireAuth, saveCover);
app.get('/api/cover', requireAuth, streamCover);
app.get('/api/audio/duration', requireAuth, getDuration);
app.get('/api/audio/stream', requireAuth, streamAudio);
app.post('/api/audio/crop', requireAuth, cropMp3);

if (config.isProd) {
  const dist = path.join(__dirname, '..', 'dist');
  app.use(express.static(dist));
  app.get('*', (req, res) => {
    res.sendFile(path.join(dist, 'index.html'));
  });
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Server error' });
});

const server = app.listen(config.port, config.host, () => {
  const roots = loadSettings().audioRoots.map((r) => r.path).join(' | ');
  console.log(`MP3 WebEditor API on http://${config.host}:${config.port}`);
  console.log(`Audio roots: ${roots}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${config.port} ist belegt. Starte mit: npm run restart`);
    process.exit(1);
  }
  throw err;
});
