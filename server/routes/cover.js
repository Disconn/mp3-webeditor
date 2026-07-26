import fs from 'fs';
import https from 'https';
import http from 'http';
import NodeID3 from 'node-id3';
import { resolveAudioPath } from '../paths.js';
import { refreshMetaCacheFor } from './tags.js';
import { getCachedCover, setCachedCover, invalidateCover } from '../coverCache.js';

function extractYoutubeId(input) {
  if (!input || typeof input !== 'string') return null;
  const text = input.trim();

  // bare 11-char id
  if (/^[\w-]{11}$/.test(text)) return text;

  const patterns = [
    /(?:youtube\.com\/watch\?(?:[^#]*&)?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/|youtube\.com\/v\/)([\w-]{11})/,
    /(?:youtube\.com\/.*[?&]v=)([\w-]{11})/,
    /(?:music\.youtube\.com\/watch\?(?:[^#]*&)?v=)([\w-]{11})/,
  ];

  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) return m[1];
  }

  // search any youtu URL in multi-line comment
  const any = text.match(/https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be|music\.youtube\.com)[^\s]*/i);
  if (any) return extractYoutubeId(any[0]);

  return null;
}

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(
      url,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; mp3-webeditor/1.0)',
          Accept: 'image/*,*/*',
        },
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return fetchBuffer(res.headers.location).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.setTimeout(20000, () => {
      req.destroy();
      reject(new Error('Timeout fetching cover'));
    });
  });
}

async function downloadBestThumbnail(videoId) {
  const candidates = [
    `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
    `https://i.ytimg.com/vi/${videoId}/sddefault.jpg`,
    `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
    `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
  ];

  let lastErr;
  for (const url of candidates) {
    try {
      const buf = await fetchBuffer(url);
      // YouTube returns a tiny placeholder (~1KB) for missing maxres
      if (buf.length < 5000) {
        lastErr = new Error(`Placeholder image from ${url}`);
        continue;
      }
      return { buffer: buf, mime: 'image/jpeg', source: url };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('Could not download thumbnail');
}

export async function fetchYtCover(req, res) {
  try {
    const { path: relPath } = req.body || {};
    if (!relPath) return res.status(400).json({ error: 'path required' });

    const filePath = resolveAudioPath(relPath);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const raw = NodeID3.read(filePath) || {};
    let comment = raw.comment;
    if (comment && typeof comment === 'object') {
      comment = Array.isArray(comment)
        ? comment.map((c) => c?.text || '').join('\n')
        : comment.text || '';
    }
    comment = String(comment || '');

    const videoId = extractYoutubeId(comment);
    if (!videoId) {
      return res.status(400).json({
        error: 'No YouTube URL found in comment field',
        comment,
      });
    }

    const { buffer, mime, source } = await downloadBestThumbnail(videoId);

    const tags = {
      ...raw,
      image: {
        mime,
        type: { id: 3, name: 'front cover' },
        description: 'Cover',
        imageBuffer: buffer,
      },
    };

    // Keep comment structure
    if (raw.comment) tags.comment = raw.comment;

    const ok = NodeID3.write(tags, filePath);
    if (!ok) return res.status(500).json({ error: 'Failed to write cover' });

    refreshMetaCacheFor(relPath);

    const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;
    res.json({
      ok: true,
      videoId,
      source,
      cover: { mime, dataUrl },
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

/** Stream embedded cover art as an image response (disk-cached by mtime/size) */
export async function streamCover(req, res) {
  try {
    const rel = req.query.path;
    if (!rel) return res.status(400).json({ error: 'path required' });
    const filePath = resolveAudioPath(rel);
    if (!fs.existsSync(filePath)) {
      invalidateCover(rel);
      return res.status(404).json({ error: 'File not found' });
    }

    const force = req.query.refresh === '1' || req.query.refresh === 'true';
    const stat = fs.statSync(filePath);
    const mtime = stat.mtimeMs;
    const size = stat.size;

    if (!force) {
      const hit = getCachedCover(rel, mtime, size);
      if (hit) {
        res.setHeader('Content-Type', hit.mime);
        res.setHeader('Cache-Control', 'private, max-age=3600');
        res.setHeader('X-Cover-Cache', 'HIT');
        res.setHeader('Content-Length', hit.buffer.length);
        return res.end(hit.buffer);
      }
    }

    const raw = NodeID3.read(filePath) || {};
    const img = raw.image ? (Array.isArray(raw.image) ? raw.image[0] : raw.image) : null;
    if (!img?.imageBuffer?.length) {
      invalidateCover(rel);
      return res.status(404).json({ error: 'No cover' });
    }

    const mime = img.mime || 'image/jpeg';
    const buffer = Buffer.from(img.imageBuffer);
    setCachedCover(rel, { mtime, size, mime, buffer });

    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Cover-Cache', 'MISS');
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

/**
 * Replace embedded cover with a client-cropped image.
 * Body: { path, dataUrl } — dataUrl is data:image/jpeg;base64,... or image/png
 */
export async function saveCover(req, res) {
  try {
    const { path: relPath, dataUrl } = req.body || {};
    if (!relPath || !dataUrl) {
      return res.status(400).json({ error: 'path and dataUrl required' });
    }

    const filePath = resolveAudioPath(relPath);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const match = String(dataUrl).match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/i);
    if (!match) {
      return res.status(400).json({ error: 'Invalid image dataUrl (jpeg/png/webp expected)' });
    }

    let mime = match[1].toLowerCase();
    if (mime === 'image/jpg') mime = 'image/jpeg';
    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length || buffer.length > 8 * 1024 * 1024) {
      return res.status(400).json({ error: 'Image empty or too large (max 8MB)' });
    }

    const raw = NodeID3.read(filePath) || {};
    const tags = {
      ...raw,
      image: {
        mime,
        type: { id: 3, name: 'front cover' },
        description: 'Cover',
        imageBuffer: buffer,
      },
    };
    if (raw.comment) tags.comment = raw.comment;

    const ok = NodeID3.write(tags, filePath);
    if (!ok) return res.status(500).json({ error: 'Failed to write cover' });

    invalidateCover(relPath);
    refreshMetaCacheFor(relPath);

    res.json({
      ok: true,
      path: relPath,
      mime,
      bytes: buffer.length,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}
