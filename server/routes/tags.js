import fs from 'fs';
import NodeID3 from 'node-id3';
import { parseFile } from 'music-metadata';
import { resolveAudioPath } from '../paths.js';
import {
  getCachedMeta,
  setCachedMeta,
  invalidateMeta,
  clearMetaCache,
  metaCacheStats,
} from '../metaCache.js';
import {
  getCachedCover,
  setCachedCover,
  invalidateCover,
  clearCoverCache,
  coverCacheStats,
} from '../coverCache.js';

/** All commonly used ID3 text/frame fields we expose in the UI */
export const TAG_FIELDS = [
  { key: 'title', label: 'Title', frame: 'TIT2' },
  { key: 'artist', label: 'Artist', frame: 'TPE1' },
  { key: 'album', label: 'Album', frame: 'TALB' },
  { key: 'albumartist', label: 'Album Artist', frame: 'TPE2' },
  { key: 'year', label: 'Year', frame: 'TYER' },
  { key: 'date', label: 'Date', frame: 'TDRC' },
  { key: 'genre', label: 'Genre', frame: 'TCON' },
  { key: 'trackNumber', label: 'Track', frame: 'TRCK' },
  { key: 'partOfSet', label: 'Disc', frame: 'TPOS' },
  { key: 'composer', label: 'Composer', frame: 'TCOM' },
  { key: 'conductor', label: 'Conductor', frame: 'TPE3' },
  { key: 'remixArtist', label: 'Remixer', frame: 'TPE4' },
  { key: 'lyricist', label: 'Lyricist', frame: 'TEXT' },
  { key: 'originalArtist', label: 'Original Artist', frame: 'TOPE' },
  { key: 'originalFilename', label: 'Original Filename', frame: 'TOFN' },
  { key: 'publisher', label: 'Publisher', frame: 'TPUB' },
  { key: 'encodedBy', label: 'Encoded By', frame: 'TENC' },
  { key: 'encoderSettings', label: 'Encoder Settings', frame: 'TSSE' },
  { key: 'copyright', label: 'Copyright', frame: 'TCOP' },
  { key: 'isrc', label: 'ISRC', frame: 'TSRC' },
  { key: 'bpm', label: 'BPM', frame: 'TBPM' },
  { key: 'contentGroup', label: 'Content Group', frame: 'TIT1' },
  { key: 'subtitle', label: 'Subtitle', frame: 'TIT3' },
  { key: 'language', label: 'Language', frame: 'TLAN' },
  { key: 'mediaType', label: 'Media Type', frame: 'TMED' },
  { key: 'fileOwner', label: 'File Owner', frame: 'TOWN' },
  { key: 'involvedPeople', label: 'Involved People', frame: 'TIPL' },
  { key: 'musicianCredits', label: 'Musician Credits', frame: 'TMCL' },
  { key: 'mood', label: 'Mood', frame: 'TMOO' },
  { key: 'length', label: 'Length (ms)', frame: 'TLEN' },
  { key: 'key', label: 'Initial Key', frame: 'TKEY' },
  { key: 'comment', label: 'Comment', frame: 'COMM', multiline: true },
  { key: 'unsynchronisedLyrics', label: 'Lyrics', frame: 'USLT', multiline: true },
  { key: 'userDefinedText', label: 'User Defined Text (TXXX)', frame: 'TXXX', multiline: true },
];

function normalizeComment(comment) {
  if (!comment) return '';
  if (typeof comment === 'string') return comment;
  if (Array.isArray(comment)) {
    return comment
      .map((c) => (typeof c === 'string' ? c : c?.text || ''))
      .filter(Boolean)
      .join('\n');
  }
  if (typeof comment === 'object' && comment.text != null) return String(comment.text);
  return String(comment);
}

function normalizeLyrics(lyrics) {
  if (!lyrics) return '';
  if (typeof lyrics === 'string') return lyrics;
  if (Array.isArray(lyrics)) {
    return lyrics
      .map((l) => (typeof l === 'string' ? l : l?.text || ''))
      .filter(Boolean)
      .join('\n');
  }
  if (typeof lyrics === 'object' && lyrics.text != null) return String(lyrics.text);
  return String(lyrics);
}

function normalizeUserDefined(udt) {
  if (!udt) return '';
  if (typeof udt === 'string') return udt;
  if (Array.isArray(udt)) {
    return udt
      .map((u) => {
        if (typeof u === 'string') return u;
        const desc = u?.description || '';
        const val = u?.value ?? u?.text ?? '';
        return desc ? `${desc}=${val}` : String(val);
      })
      .join('\n');
  }
  if (typeof udt === 'object') {
    const desc = udt.description || '';
    const val = udt.value ?? udt.text ?? '';
    return desc ? `${desc}=${val}` : String(val);
  }
  return String(udt);
}

function pickCover(image) {
  if (!image) return null;
  const img = Array.isArray(image) ? image[0] : image;
  if (!img?.imageBuffer) return null;
  const mime = img.mime || 'image/jpeg';
  const b64 = Buffer.from(img.imageBuffer).toString('base64');
  return {
    mime,
    dataUrl: `data:${mime};base64,${b64}`,
    type: img.type?.id ?? img.type ?? null,
    description: img.description || '',
  };
}

export async function readTags(req, res) {
  try {
    const filePath = resolveAudioPath(req.query.path);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const raw = NodeID3.read(filePath) || {};
    const mm = await parseFile(filePath, { duration: true }).catch(() => null);

    const tags = {};
    for (const field of TAG_FIELDS) {
      let value = raw[field.key];
      if (field.key === 'comment') value = normalizeComment(value);
      else if (field.key === 'unsynchronisedLyrics') value = normalizeLyrics(value);
      else if (field.key === 'userDefinedText') value = normalizeUserDefined(value);
      else if (value == null) value = '';
      else if (typeof value === 'object') value = JSON.stringify(value);
      else value = String(value);
      tags[field.key] = value;
    }

    // Prefer music-metadata for duration / format info
    const duration = mm?.format?.duration ?? null;
    const bitrate = mm?.format?.bitrate ?? null;
    const sampleRate = mm?.format?.sampleRate ?? null;

    const cover = pickCover(raw.image);

    res.json({
      path: req.query.path,
      fields: TAG_FIELDS,
      tags,
      cover,
      format: { duration, bitrate, sampleRate },
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

/** Lightweight row data for the library table (no duration parse, no cover payload) */
export async function readRowMeta(req, res) {
  try {
    const rel = req.query.path;
    if (!rel) return res.status(400).json({ error: 'path required' });

    const filePath = resolveAudioPath(rel);
    if (!fs.existsSync(filePath)) {
      invalidateMeta(rel);
      invalidateCover(rel);
      return res.status(404).json({ error: 'File not found' });
    }

    const allowed = new Set(TAG_FIELDS.map((f) => f.key));
    const columns = String(req.query.columns || '')
      .split(',')
      .map((c) => c.trim())
      .filter((c) => c && allowed.has(c));

    const force = req.query.refresh === '1' || req.query.refresh === 'true';
    const stat = fs.statSync(filePath);
    const mtime = stat.mtimeMs;
    const size = stat.size;

    if (!force) {
      const hit = getCachedMeta(rel, mtime, size);
      if (hit) {
        const tags = {};
        for (const key of columns) {
          tags[key] = hit.tags?.[key] ?? '';
        }
        return res.json({
          path: rel,
          tags,
          hasCover: hit.hasCover,
          cached: true,
          mtime,
          size,
        });
      }
    }

    const raw = NodeID3.read(filePath) || {};
    const allTags = extractAllTags(raw);
    const img = raw.image ? (Array.isArray(raw.image) ? raw.image[0] : raw.image) : null;
    const hasCover = Boolean(img?.imageBuffer?.length);

    setCachedMeta(rel, { mtime, size, tags: allTags, hasCover });
    if (hasCover) {
      setCachedCover(rel, {
        mtime,
        size,
        mime: img.mime || 'image/jpeg',
        buffer: img.imageBuffer,
      });
    } else {
      invalidateCover(rel);
    }

    const tags = {};
    for (const key of columns) {
      tags[key] = allTags[key] ?? '';
    }

    res.json({
      path: rel,
      tags,
      hasCover,
      cached: false,
      mtime,
      size,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

function extractAllTags(raw) {
  const tags = {};
  for (const field of TAG_FIELDS) {
    let value = raw?.[field.key];
    if (field.key === 'comment') value = normalizeComment(value);
    else if (field.key === 'unsynchronisedLyrics') value = normalizeLyrics(value);
    else if (field.key === 'userDefinedText') value = normalizeUserDefined(value);
    else if (value == null) value = '';
    else if (typeof value === 'object') value = JSON.stringify(value);
    else value = String(value);
    tags[field.key] = value;
  }
  return tags;
}

/** Re-read file and refresh cache entry (after writes). */
export function refreshMetaCacheFor(relPath) {
  try {
    const filePath = resolveAudioPath(relPath);
    if (!fs.existsSync(filePath)) {
      invalidateMeta(relPath);
      invalidateCover(relPath);
      return;
    }
    const stat = fs.statSync(filePath);
    const raw = NodeID3.read(filePath) || {};
    const img = raw.image ? (Array.isArray(raw.image) ? raw.image[0] : raw.image) : null;
    const hasCover = Boolean(img?.imageBuffer?.length);
    setCachedMeta(relPath, {
      mtime: stat.mtimeMs,
      size: stat.size,
      tags: extractAllTags(raw),
      hasCover,
    });
    if (hasCover) {
      setCachedCover(relPath, {
        mtime: stat.mtimeMs,
        size: stat.size,
        mime: img.mime || 'image/jpeg',
        buffer: img.imageBuffer,
      });
    } else {
      invalidateCover(relPath);
    }
  } catch {
    invalidateMeta(relPath);
    invalidateCover(relPath);
  }
}

export function clearCacheHandler(_req, res) {
  clearMetaCache();
  clearCoverCache();
  res.json({ ok: true, ...metaCacheStats(), ...coverCacheStats() });
}

export function cacheStatsHandler(_req, res) {
  res.json({ ...metaCacheStats(), ...coverCacheStats() });
}

function buildWritePayload(tags) {
  const payload = {};

  for (const field of TAG_FIELDS) {
    if (!(field.key in tags)) continue;
    let value = tags[field.key];
    if (value == null) value = '';
    value = String(value);

    if (field.key === 'comment') {
      payload.comment = { language: 'eng', text: value };
      continue;
    }
    if (field.key === 'unsynchronisedLyrics') {
      payload.unsynchronisedLyrics = { language: 'eng', text: value };
      continue;
    }
    if (field.key === 'userDefinedText') {
      const lines = value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      payload.userDefinedText = lines.map((line) => {
        const eq = line.indexOf('=');
        if (eq === -1) return { description: '', value: line };
        return { description: line.slice(0, eq), value: line.slice(eq + 1) };
      });
      continue;
    }

    if (value === '') {
      // omit empty to clear via separate clear logic if needed
      payload[field.key] = '';
    } else {
      payload[field.key] = value;
    }
  }

  return payload;
}

export async function writeTags(req, res) {
  try {
    const { path: relPath, tags } = req.body || {};
    if (!relPath || !tags || typeof tags !== 'object') {
      return res.status(400).json({ error: 'path and tags required' });
    }

    const filePath = resolveAudioPath(relPath);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const existing = NodeID3.read(filePath) || {};
    const updates = buildWritePayload(tags);
    const payload = { ...existing, ...updates };

    if (existing.image && !updates.image) {
      payload.image = existing.image;
    }

    const ok = NodeID3.write(payload, filePath);
    if (!ok) return res.status(500).json({ error: 'Failed to write tags' });

    refreshMetaCacheFor(relPath);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}
