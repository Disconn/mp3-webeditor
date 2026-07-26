import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = path.join(__dirname, '..', 'data', 'meta-cache.json');

/** @type {Map<string, { mtime: number, size: number, tags: Record<string, string>, hasCover: boolean, updatedAt: number }>} */
const memory = new Map();
let loaded = false;
let saveTimer = null;
let dirty = false;

function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  try {
    if (!fs.existsSync(CACHE_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    const entries = raw?.entries && typeof raw.entries === 'object' ? raw.entries : raw;
    for (const [key, value] of Object.entries(entries || {})) {
      if (!value || typeof value !== 'object') continue;
      memory.set(key, {
        mtime: Number(value.mtime) || 0,
        size: Number(value.size) || 0,
        tags: value.tags && typeof value.tags === 'object' ? value.tags : {},
        hasCover: Boolean(value.hasCover),
        updatedAt: Number(value.updatedAt) || Date.now(),
      });
    }
  } catch (err) {
    console.warn('meta-cache load failed:', err.message);
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

export function flushMetaCache() {
  flush();
}

function flush() {
  if (!dirty) return;
  try {
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const entries = {};
    for (const [key, value] of memory.entries()) {
      entries[key] = value;
    }
    fs.writeFileSync(
      CACHE_FILE,
      JSON.stringify({ version: 1, savedAt: Date.now(), entries }, null, 0),
      'utf8'
    );
    dirty = false;
  } catch (err) {
    console.warn('meta-cache save failed:', err.message);
  }
}

export function getCachedMeta(relPath, mtime, size) {
  ensureLoaded();
  const hit = memory.get(relPath);
  if (!hit) return null;
  if (hit.mtime !== mtime || hit.size !== size) return null;
  return hit;
}

export function setCachedMeta(relPath, { mtime, size, tags, hasCover }) {
  ensureLoaded();
  memory.set(relPath, {
    mtime,
    size,
    tags: { ...tags },
    hasCover: Boolean(hasCover),
    updatedAt: Date.now(),
  });
  scheduleSave();
}

export function invalidateMeta(relPath) {
  ensureLoaded();
  if (memory.delete(relPath)) scheduleSave();
}

export function clearMetaCache() {
  ensureLoaded();
  memory.clear();
  dirty = true;
  flush();
}

export function metaCacheStats() {
  ensureLoaded();
  return { entries: memory.size };
}
