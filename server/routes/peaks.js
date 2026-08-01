import fs from 'fs';
import { spawn } from 'child_process';
import { parseFile } from 'music-metadata';
import { config } from '../config.js';
import { resolveAudioPath } from '../paths.js';

const SAMPLE_RATE = 8000;
/** Soft cap so the response stays manageable for multi-hour files */
const MAX_BUCKETS = 100_000;

function float32ToBase64(arr) {
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).toString('base64');
}

/**
 * Build waveform overview peaks with ffmpeg (mono downsample + streaming buckets).
 * Avoids browser decodeAudioData for large files.
 *
 * GET /api/audio/peaks?path=
 */
export async function getPeaks(req, res) {
  try {
    const rel = req.query.path;
    if (!rel) return res.status(400).json({ error: 'path required' });

    const filePath = resolveAudioPath(rel);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const mm = await parseFile(filePath, { duration: true });
    const duration = Number(mm.format?.duration) || 0;
    if (!(duration > 0)) {
      return res.status(400).json({ error: 'Could not determine duration' });
    }

    const totalSamples = Math.max(1, Math.round(duration * SAMPLE_RATE));
    // ~40 buckets/sec, clamped
    const bucketCount = Math.min(MAX_BUCKETS, Math.max(800, Math.ceil(duration * 40)));
    const bucketSize = Math.max(1, Math.ceil(totalSamples / bucketCount));
    const n = Math.ceil(totalSamples / bucketSize);

    const mins = new Float32Array(n);
    const maxs = new Float32Array(n);

    const args = [
      '-hide_banner',
      '-nostats',
      '-i',
      filePath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      String(SAMPLE_RATE),
      '-f',
      'f32le',
      'pipe:1',
    ];

    await new Promise((resolve, reject) => {
      const proc = spawn(config.ffmpegPath, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderr = '';
      let leftover = Buffer.alloc(0);
      let sampleIndex = 0;
      let bucketIndex = 0;
      let curMin = Number.POSITIVE_INFINITY;
      let curMax = Number.NEGATIVE_INFINITY;
      let inBucket = 0;
      let settled = false;

      function finishBucket() {
        if (bucketIndex >= n) return;
        if (inBucket > 0) {
          mins[bucketIndex] = Number.isFinite(curMin) ? curMin : 0;
          maxs[bucketIndex] = Number.isFinite(curMax) ? curMax : 0;
        } else {
          mins[bucketIndex] = 0;
          maxs[bucketIndex] = 0;
        }
        bucketIndex += 1;
        curMin = Number.POSITIVE_INFINITY;
        curMax = Number.NEGATIVE_INFINITY;
        inBucket = 0;
      }

      function pushSample(v) {
        if (!Number.isFinite(v)) v = 0;
        const bi = Math.min(n - 1, Math.floor(sampleIndex / bucketSize));
        while (bucketIndex < bi) finishBucket();
        if (v < curMin) curMin = v;
        if (v > curMax) curMax = v;
        inBucket += 1;
        sampleIndex += 1;
      }

      function done(err) {
        if (settled) return;
        settled = true;
        if (err) reject(err);
        else resolve();
      }

      proc.stderr.on('data', (d) => {
        stderr += d.toString();
        if (stderr.length > 8000) stderr = stderr.slice(-4000);
      });

      proc.stdout.on('data', (chunk) => {
        const buf = leftover.length ? Buffer.concat([leftover, chunk]) : chunk;
        const usable = buf.length - (buf.length % 4);
        leftover = usable < buf.length ? Buffer.from(buf.subarray(usable)) : Buffer.alloc(0);
        for (let off = 0; off < usable; off += 4) {
          pushSample(buf.readFloatLE(off));
        }
      });

      proc.on('error', (err) => done(err));
      proc.on('close', (code) => {
        while (bucketIndex < n) finishBucket();
        if (code === 0) done();
        else done(new Error(`ffmpeg peaks failed (${code}): ${stderr.slice(-600)}`));
      });
    });

    res.json({
      path: rel,
      duration,
      sampleRate: SAMPLE_RATE,
      bucketSize,
      length: totalSamples,
      mins: float32ToBase64(mins),
      maxs: float32ToBase64(maxs),
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}
