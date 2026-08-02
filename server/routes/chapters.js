import fs from 'fs';
import NodeID3 from 'node-id3';
import { parseFile } from 'music-metadata';
import { resolveAudioPath } from '../paths.js';
import { refreshMetaCacheFor } from './tags.js';

const TOC_ID = 'toc';

function asArray(v) {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

/** Normalize node-id3 / music-metadata chapters → UI shape (seconds). */
export function normalizeChapters(rawChapters, durationSec) {
  const list = asArray(rawChapters)
    .map((ch, i) => {
      const startMs = Number(ch.startTimeMs ?? ch.start ?? 0);
      const endMs = Number(ch.endTimeMs ?? ch.end ?? startMs);
      const title =
        (typeof ch.tags?.title === 'string' && ch.tags.title) ||
        (typeof ch.title === 'string' && ch.title) ||
        `Chapter ${i + 1}`;
      const id = String(ch.elementID || ch.id || `ch${i + 1}`).replace(/[^\w.-]/g, '_') || `ch${i + 1}`;
      return {
        id,
        title: String(title).trim() || `Chapter ${i + 1}`,
        start: Math.max(0, startMs / 1000),
        end: Math.max(0, endMs / 1000),
      };
    })
    .filter((ch) => Number.isFinite(ch.start))
    .sort((a, b) => a.start - b.start);

  // Prefer start markers; end is derived on write from next chapter / duration
  return list.map((ch, i) => ({
    id: ch.id,
    title: ch.title,
    start: ch.start,
    end:
      Number.isFinite(ch.end) && ch.end > ch.start
        ? ch.end
        : i + 1 < list.length
          ? list[i + 1].start
          : durationSec > 0
            ? durationSec
            : ch.start,
  }));
}

/** Build node-id3 chapter + CTOC payloads from UI chapters (seconds). */
export function buildChapterFrames(chapters, durationSec) {
  const sorted = [...(chapters || [])]
    .map((ch, i) => ({
      id: String(ch.id || `ch${i + 1}`).replace(/[^\w.-]/g, '_') || `ch${i + 1}`,
      title: String(ch.title || `Chapter ${i + 1}`).trim() || `Chapter ${i + 1}`,
      start: Math.max(0, Number(ch.start) || 0),
    }))
    .filter((ch) => Number.isFinite(ch.start))
    .sort((a, b) => a.start - b.start);

  // Unique IDs
  const seen = new Set();
  for (const ch of sorted) {
    let id = ch.id;
    let n = 2;
    while (seen.has(id)) {
      id = `${ch.id}_${n}`;
      n += 1;
    }
    seen.add(id);
    ch.id = id;
  }

  const durMs = Math.max(0, Math.round((Number(durationSec) || 0) * 1000));
  const frames = sorted.map((ch, i) => {
    const startMs = Math.round(ch.start * 1000);
    const nextStart = i + 1 < sorted.length ? Math.round(sorted[i + 1].start * 1000) : durMs || startMs + 1;
    const endMs = Math.max(startMs + 1, nextStart);
    return {
      elementID: ch.id,
      startTimeMs: startMs,
      endTimeMs: endMs,
      tags: { title: ch.title },
    };
  });

  const toc =
    frames.length > 0
      ? [
          {
            elementID: TOC_ID,
            isOrdered: true,
            elements: frames.map((f) => f.elementID),
            tags: { title: 'Table of Contents' },
          },
        ]
      : [];

  return { chapter: frames, tableOfContents: toc };
}

/** Shift/filter chapters after a crop (trimStart/trimEnd in seconds). */
export function shiftChaptersForCrop(rawTags, trimStartSec, newDurationSec) {
  const shiftMs = Math.round((Number(trimStartSec) || 0) * 1000);
  const newDurMs = Math.max(0, Math.round((Number(newDurationSec) || 0) * 1000));
  const chapters = asArray(rawTags?.chapter)
    .map((ch) => {
      const start = Number(ch.startTimeMs) - shiftMs;
      const end = Number(ch.endTimeMs) - shiftMs;
      return {
        ...ch,
        startTimeMs: start,
        endTimeMs: end,
      };
    })
    .filter((ch) => Number.isFinite(ch.startTimeMs) && ch.startTimeMs < newDurMs && ch.endTimeMs > 0)
    .map((ch) => ({
      ...ch,
      startTimeMs: Math.max(0, Math.round(ch.startTimeMs)),
      endTimeMs: Math.min(newDurMs || ch.endTimeMs, Math.max(Math.round(ch.startTimeMs) + 1, Math.round(ch.endTimeMs))),
    }))
    .sort((a, b) => a.startTimeMs - b.startTimeMs);

  if (!chapters.length) {
    const next = { ...rawTags };
    delete next.chapter;
    delete next.tableOfContents;
    if (next.raw && typeof next.raw === 'object') {
      next.raw = { ...next.raw };
      delete next.raw.CHAP;
      delete next.raw.CTOC;
    }
    return next;
  }

  const toc = [
    {
      elementID: TOC_ID,
      isOrdered: true,
      elements: chapters.map((c) => c.elementID),
      tags: { title: 'Table of Contents' },
    },
  ];

  return {
    ...rawTags,
    chapter: chapters,
    tableOfContents: toc,
  };
}

/**
 * GET /api/chapters?path=
 */
export async function getChapters(req, res) {
  try {
    const rel = req.query.path;
    if (!rel) return res.status(400).json({ error: 'path required' });
    const filePath = resolveAudioPath(rel);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

    const raw = NodeID3.read(filePath) || {};
    const mm = await parseFile(filePath, { duration: true }).catch(() => null);
    const duration = Number(mm?.format?.duration) || 0;
    const chapters = normalizeChapters(raw.chapter, duration);

    res.json({ path: rel, duration, chapters });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

/**
 * PUT /api/chapters  body: { path, chapters: [{ id?, title, start }], duration? }
 */
export async function putChapters(req, res) {
  try {
    const { path: rel, chapters, duration: durationHint } = req.body || {};
    if (!rel) return res.status(400).json({ error: 'path required' });
    if (!Array.isArray(chapters)) return res.status(400).json({ error: 'chapters array required' });

    const filePath = resolveAudioPath(rel);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

    let durationSec = Number(durationHint) || 0;
    if (!(durationSec > 0)) {
      const mm = await parseFile(filePath, { duration: true }).catch(() => null);
      durationSec = Number(mm?.format?.duration) || 0;
    }

    const existing = NodeID3.read(filePath) || {};
    const { chapter, tableOfContents } = buildChapterFrames(chapters, durationSec);

    const payload = { ...existing };
    if (chapter.length) {
      payload.chapter = chapter;
      payload.tableOfContents = tableOfContents;
    } else {
      delete payload.chapter;
      delete payload.tableOfContents;
      if (payload.raw && typeof payload.raw === 'object') {
        payload.raw = { ...payload.raw };
        delete payload.raw.CHAP;
        delete payload.raw.CTOC;
      }
    }

    const ok = NodeID3.write(payload, filePath);
    if (!ok) return res.status(500).json({ error: 'Failed to write chapters' });

    try {
      refreshMetaCacheFor(rel);
    } catch {
      /* non-fatal */
    }

    res.json({
      ok: true,
      path: rel,
      chapters: normalizeChapters(chapter, durationSec),
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}
