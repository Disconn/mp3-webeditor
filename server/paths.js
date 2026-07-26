import path from 'path';
import fs from 'fs';
import { getAudioRoots } from './store.js';

/**
 * Virtual path format: `{rootId}/relative/path.mp3`
 */
export function parseVirtualPath(relPath = '') {
  const cleaned = String(relPath || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  if (!cleaned) return { rootId: null, rest: '' };

  const parts = cleaned.split('/');
  const rootId = parts[0];
  const rest = parts.slice(1).join('/');
  return { rootId, rest };
}

export function getRootById(rootId) {
  const roots = getAudioRoots();
  const root = roots.find((r) => r.id === rootId);
  if (!root) throw new Error(`Unknown audio root: ${rootId}`);
  return root;
}

/**
 * Resolve a virtual path under one of the configured audio roots.
 */
export function resolveAudioPath(relPath = '') {
  const { rootId, rest } = parseVirtualPath(relPath);
  if (!rootId) {
    throw new Error('Path must start with a root id');
  }
  const root = getRootById(rootId);
  const absolute = path.resolve(root.path, rest || '.');
  const rootAbs = path.resolve(root.path);
  const rel = path.relative(rootAbs, absolute);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Path outside audio directory');
  }
  return absolute;
}

export function toVirtualPath(rootId, absolutePath) {
  const root = getRootById(rootId);
  const rel = path.relative(root.path, absolutePath).split(path.sep).join('/');
  return rel ? `${rootId}/${rel}` : rootId;
}

export function ensureAudioDirs() {
  for (const root of getAudioRoots()) {
    if (!fs.existsSync(root.path)) {
      fs.mkdirSync(root.path, { recursive: true });
    }
  }
}
