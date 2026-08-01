import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { config } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

const DEFAULT_COLUMNS = ['title', 'artist', 'album', 'year', 'genre', 'comment'];

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const check = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(check, 'hex'), Buffer.from(hash, 'hex'));
}

function defaultSettings() {
  const { salt, hash } = hashPassword(config.authPass);
  return {
    users: [
      {
        username: config.authUser,
        salt,
        hash,
      },
    ],
    audioRoots: [
      {
        id: 'main',
        label: 'Audio',
        path: config.audioDir,
      },
    ],
    tableColumns: DEFAULT_COLUMNS,
    showActionsColumn: true,
    defaultWaveZoom: 1,
    uiLanguage: 'de',
    uiTheme: 'dark',
  };
}

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(SETTINGS_FILE)) {
    const initial = defaultSettings();
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(initial, null, 2), 'utf8');
    return initial;
  }
  return null;
}

export function loadSettings() {
  const created = ensureStore();
  if (created) return created;
  const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data.users) || !data.users.length) {
    data.users = defaultSettings().users;
  }
  if (!Array.isArray(data.audioRoots) || !data.audioRoots.length) {
    data.audioRoots = defaultSettings().audioRoots;
  }
  if (!Array.isArray(data.tableColumns) || !data.tableColumns.length) {
    data.tableColumns = DEFAULT_COLUMNS;
  }
  if (typeof data.showActionsColumn !== 'boolean') {
    data.showActionsColumn = true;
  }
  data.defaultWaveZoom = clampWaveZoom(data.defaultWaveZoom);
  data.uiLanguage = clampUiLanguage(data.uiLanguage);
  data.uiTheme = clampUiTheme(data.uiTheme);
  return data;
}

function clampWaveZoom(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(64, Math.max(1, Math.round(n * 10) / 10));
}

function clampUiLanguage(value) {
  return value === 'en' ? 'en' : 'de';
}

function clampUiTheme(value) {
  return value === 'light' ? 'light' : 'dark';
}

export function saveSettings(data) {
  ensureStore();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

export function getPublicSettings() {
  const s = loadSettings();
  return {
    users: s.users.map((u) => ({ username: u.username })),
    audioRoots: s.audioRoots.map((r) => ({
      id: r.id,
      label: r.label,
      path: r.path,
    })),
    tableColumns: s.tableColumns,
    showActionsColumn: s.showActionsColumn !== false,
    defaultWaveZoom: clampWaveZoom(s.defaultWaveZoom),
    uiLanguage: clampUiLanguage(s.uiLanguage),
    uiTheme: clampUiTheme(s.uiTheme),
  };
}

export function authenticateUser(username, password) {
  const s = loadSettings();
  const user = s.users.find((u) => u.username === username);
  if (!user) return false;
  try {
    return verifyPassword(password, user.salt, user.hash);
  } catch {
    return false;
  }
}

export function changePassword(username, currentPassword, newPassword) {
  const s = loadSettings();
  const user = s.users.find((u) => u.username === username);
  if (!user) throw new Error('User not found');
  if (!verifyPassword(currentPassword, user.salt, user.hash)) {
    throw new Error('Current password incorrect');
  }
  if (!newPassword || String(newPassword).length < 3) {
    throw new Error('New password too short');
  }
  const { salt, hash } = hashPassword(newPassword);
  user.salt = salt;
  user.hash = hash;
  saveSettings(s);
}

export function addUser(username, password) {
  const s = loadSettings();
  const name = String(username || '').trim();
  if (!name) throw new Error('Username required');
  if (s.users.some((u) => u.username === name)) {
    throw new Error('User already exists');
  }
  if (!password || String(password).length < 3) {
    throw new Error('Password too short');
  }
  const { salt, hash } = hashPassword(password);
  s.users.push({ username: name, salt, hash });
  saveSettings(s);
  return { username: name };
}

export function removeUser(username, actor) {
  const s = loadSettings();
  if (username === actor) throw new Error('Cannot delete yourself');
  if (s.users.length <= 1) throw new Error('Cannot delete the last user');
  const next = s.users.filter((u) => u.username !== username);
  if (next.length === s.users.length) throw new Error('User not found');
  s.users = next;
  saveSettings(s);
}

function slugify(label) {
  return String(label || 'root')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32) || 'root';
}

function normalizeRootPath(input) {
  let p = String(input || '').trim();
  // Explorer "Copy as path" often wraps in quotes
  if (
    (p.startsWith('"') && p.endsWith('"')) ||
    (p.startsWith("'") && p.endsWith("'"))
  ) {
    p = p.slice(1, -1).trim();
  }
  p = p.replace(/\//g, path.sep);
  return p;
}

export function setAudioRoots(roots) {
  if (!Array.isArray(roots) || !roots.length) {
    throw new Error('Mindestens ein Audio-Verzeichnis erforderlich');
  }
  const used = new Set();
  const normalized = roots.map((r, i) => {
    const raw = normalizeRootPath(r.path);
    if (!raw) {
      throw new Error(`Pfad fehlt in Zeile ${i + 1}`);
    }
    if (!path.isAbsolute(raw)) {
      throw new Error(`Pfad muss absolut sein (Zeile ${i + 1}): ${raw}`);
    }
    const abs = path.resolve(raw);
    let id = String(r.id || slugify(r.label || path.basename(abs)) || `root${i}`);
    id = id.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!id) id = `root${i}`;
    let unique = id;
    let n = 2;
    while (used.has(unique)) {
      unique = `${id}${n++}`;
    }
    used.add(unique);
    return {
      id: unique,
      label: String(r.label || path.basename(abs) || unique).trim() || unique,
      path: abs,
    };
  });
  const s = loadSettings();
  s.audioRoots = normalized;
  saveSettings(s);
  return normalized;
}

export function setTableColumns(columns, showActionsColumn) {
  if (!Array.isArray(columns) || !columns.length) {
    throw new Error('At least one column required');
  }
  const s = loadSettings();
  s.tableColumns = columns.map(String);
  if (typeof showActionsColumn === 'boolean') {
    s.showActionsColumn = showActionsColumn;
  }
  saveSettings(s);
  return {
    tableColumns: s.tableColumns,
    showActionsColumn: s.showActionsColumn !== false,
  };
}

export function setDefaultWaveZoom(value) {
  const s = loadSettings();
  s.defaultWaveZoom = clampWaveZoom(value);
  saveSettings(s);
  return s.defaultWaveZoom;
}

export function setUiLanguage(value) {
  const s = loadSettings();
  s.uiLanguage = clampUiLanguage(value);
  saveSettings(s);
  return s.uiLanguage;
}

export function setUiTheme(value) {
  const s = loadSettings();
  s.uiTheme = clampUiTheme(value);
  saveSettings(s);
  return s.uiTheme;
}

export function getAudioRoots() {
  return loadSettings().audioRoots;
}

export { DEFAULT_COLUMNS, DATA_DIR };
