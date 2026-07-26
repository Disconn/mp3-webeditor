import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COVER_DIR = path.join(__dirname, '..', 'data', 'cover-cache');
const INDEX_FILE = path.join(COVER_DIR, 'index.json');

/** @type {Map<string, { mtime: number, size: number, mime: string, file: string }>} */
const index = new Map();
let loaded = false;
let saveTimer = null;
let dirty = false;

function hashPath(relPath) {
  return crypto.createHash('sha1').update(String(relPath)).digest('hex');
}

function extForMime(mime) {
  if (mime === 'image/png') return '.png';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'image/gif') return '.gif';
  return '.jpg';
}

function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  try {
    if (!fs.existsSync(COVER_DIR)) fs.mkdirSync(COVER_DIR, { recursive: true });
    if (!fs.existsSync(INDEX_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
    const entries = raw?.entries && typeof raw.entries === 'object' ? raw.entries : {};
    for (const [key, value] of Object.entries(entries)) {
      if (!value?.file) continue;
      index.set(key, {
        mtime: Number(value.mtime) || 0,
        size: Number(value.size) || 0,
        mime: value.mime || 'image/jpeg',
        file: value.file,
      });
    }
  } catch (err) {
    console.warn('cover-cache load failed:', err.message);
  }
}

function scheduleSave() {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flush();
  }, 750);
}

function flush() {
  if (!dirty) return;
  try {
    if (!fs.existsSync(COVER_DIR)) fs.mkdirSync(COVER_DIR, { recursive: true });
    const entries = {};
    for (const [key, value] of index.entries()) {
      entries[key] = value;
    }
    fs.writeFileSync(
      INDEX_FILE,
      JSON.stringify({ version: 1, savedAt: Date.now(), entries }, null, 0),
      'utf8'
    );
    dirty = false;
  } catch (err) {
    console.warn('cover-cache save failed:', err.message);
  }
}

function removeFile(fileName) {
  if (!fileName) return;
  const abs = path.join(COVER_DIR, fileName);
  try {
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch {
    /* ignore */
  }
}

export function getCachedCover(relPath, mtime, size) {
  ensureLoaded();
  const hit = index.get(relPath);
  if (!hit) return null;
  if (hit.mtime !== mtime || hit.size !== size) return null;
  const abs = path.join(COVER_DIR, hit.file);
  if (!fs.existsSync(abs)) {
    index.delete(relPath);
    scheduleSave();
    return null;
  }
  try {
    const buffer = fs.readFileSync(abs);
    if (!buffer.length) return null;
    return { buffer, mime: hit.mime || 'image/jpeg', cached: true };
  } catch {
    return null;
  }
}

export function setCachedCover(relPath, { mtime, size, mime, buffer }) {
  ensureLoaded();
  if (!buffer?.length) {
    invalidateCover(relPath);
    return;
  }
  const safeMime = mime || 'image/jpeg';
  const file = `${hashPath(relPath)}${extForMime(safeMime)}`;
  const abs = path.join(COVER_DIR, file);

  const prev = index.get(relPath);
  if (prev?.file && prev.file !== file) removeFile(prev.file);

  if (!fs.existsSync(COVER_DIR)) fs.mkdirSync(COVER_DIR, { recursive: true });
  fs.writeFileSync(abs, Buffer.from(buffer));

  index.set(relPath, {
    mtime,
    size,
    mime: safeMime,
    file,
  });
  scheduleSave();
}

export function invalidateCover(relPath) {
  ensureLoaded();
  const prev = index.get(relPath);
  if (prev) {
    removeFile(prev.file);
    index.delete(relPath);
    scheduleSave();
  }
}

export function clearCoverCache() {
  ensureLoaded();
  for (const value of index.values()) {
    removeFile(value.file);
  }
  index.clear();
  dirty = true;
  flush();
  try {
    if (fs.existsSync(COVER_DIR)) {
      for (const name of fs.readdirSync(COVER_DIR)) {
        if (name === 'index.json') continue;
        removeFile(name);
      }
    }
  } catch {
    /* ignore */
  }
}

export function coverCacheStats() {
  ensureLoaded();
  return { covers: index.size };
}

export function flushCoverCache() {
  flush();
}
