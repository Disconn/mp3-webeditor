import fs from 'fs/promises';
import path from 'path';
import { getAudioRoots } from '../store.js';
import { getRootById, parseVirtualPath, resolveAudioPath, toVirtualPath } from '../paths.js';
import { TAG_FIELDS } from './tags.js';

const AUDIO_EXT = new Set(['.mp3', '.MP3']);

async function listDirEntries(dirAbs, rootId, baseRel) {
  let entries;
  try {
    entries = await fs.readdir(dirAbs, { withFileTypes: true });
  } catch (err) {
    throw new Error(err.message);
  }

  const dirs = [];
  const files = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) dirs.push(entry);
    else if (entry.isFile() && AUDIO_EXT.has(path.extname(entry.name))) files.push(entry);
  }

  dirs.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  files.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  const folders = [];
  for (const entry of dirs) {
    const abs = path.join(dirAbs, entry.name);
    folders.push({
      type: 'dir',
      name: entry.name,
      rootId,
      path: toVirtualPath(rootId, abs),
      folder: baseRel || '',
    });
  }

  const fileRows = [];
  for (const entry of files) {
    const abs = path.join(dirAbs, entry.name);
    const stat = await fs.stat(abs);
    fileRows.push({
      type: 'file',
      name: entry.name,
      rootId,
      path: toVirtualPath(rootId, abs),
      folder: baseRel || '',
      size: stat.size,
      mtime: stat.mtimeMs,
    });
  }

  return { folders, files: fileRows };
}

function breadcrumbsFor(dir) {
  const cleaned = String(dir || '')
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');
  if (!cleaned) return [{ label: 'Bibliothek', path: '' }];

  const parts = cleaned.split('/');
  const crumbs = [{ label: 'Bibliothek', path: '' }];
  let acc = '';
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    let label = part;
    try {
      if (!acc.includes('/')) {
        const root = getRootById(part);
        label = root.label || part;
      }
    } catch {
      /* keep part */
    }
    crumbs.push({ label, path: acc });
  }
  return crumbs;
}

/**
 * Browse one directory level.
 * ?dir=           → audio roots as folders (or root contents if only one root)
 * ?dir=main       → immediate children of that root
 * ?dir=main/sub   → children of subfolder
 */
export async function listLibrary(req, res) {
  try {
    const roots = getAudioRoots();
    const dir = String(req.query.dir || '')
      .replace(/\\/g, '/')
      .replace(/^\/+|\/+$/g, '');

    if (!dir) {
      if (roots.length === 1) {
        const root = roots[0];
        const { folders, files } = await listDirEntries(root.path, root.id, '');
        return res.json({
          roots: roots.map((r) => ({ id: r.id, label: r.label, path: r.path })),
          dir: root.id,
          breadcrumbs: breadcrumbsFor(root.id),
          folders,
          files,
          fields: TAG_FIELDS,
        });
      }

      return res.json({
        roots: roots.map((r) => ({ id: r.id, label: r.label, path: r.path })),
        dir: '',
        breadcrumbs: breadcrumbsFor(''),
        folders: roots.map((r) => ({
          type: 'dir',
          name: r.label,
          rootId: r.id,
          path: r.id,
          folder: '',
          isRoot: true,
        })),
        files: [],
        fields: TAG_FIELDS,
      });
    }

    const { rootId, rest } = parseVirtualPath(dir);
    const root = getRootById(rootId);
    const abs = resolveAudioPath(dir);
    const { folders, files } = await listDirEntries(abs, rootId, rest);

    res.json({
      roots: roots.map((r) => ({ id: r.id, label: r.label, path: r.path })),
      dir,
      breadcrumbs: breadcrumbsFor(dir),
      folders,
      files,
      fields: TAG_FIELDS,
      rootPath: root.path,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function listTree(req, res) {
  try {
    const roots = getAudioRoots();
    res.json({
      roots: roots.map((r) => ({ id: r.id, label: r.label, path: r.path })),
      tree: roots.map((r) => ({
        type: 'dir',
        name: r.label,
        path: r.id,
        rootId: r.id,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
