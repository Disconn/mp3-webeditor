import fs from 'fs';
import { spawn } from 'child_process';
import { parseFile } from 'music-metadata';
import { config } from '../config.js';
import { resolveAudioPath } from '../paths.js';

const SAMPLE_RATE = 8000;
/** ~40 peak buckets per second of audio */
const BUCKETS_PER_SEC = 40;
const SAMPLES_PER_BUCKET = Math.max(1, Math.round(SAMPLE_RATE / BUCKETS_PER_SEC));
/** Soft cap so the response stays manageable for multi-hour files */
const MAX_BUCKETS = 100_000;

function float32ToBase64(arr) {
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).toString('base64');
}

/** Merge adjacent buckets when over the soft cap (preserves envelope). */
function downsampleBuckets(minsArr, maxsArr, targetCount) {
  const srcN = minsArr.length;
  if (srcN <= targetCount) {
    return {
      mins: Float32Array.from(minsArr),
      maxs: Float32Array.from(maxsArr),
    };
  }
  const mins = new Float32Array(targetCount);
  const maxs = new Float32Array(targetCount);
  for (let i = 0; i < targetCount; i += 1) {
    const a = Math.floor((i * srcN) / targetCount);
    const b = Math.max(a + 1, Math.floor(((i + 1) * srcN) / targetCount));
    let mn = minsArr[a];
    let mx = maxsArr[a];
    for (let j = a + 1; j < b; j += 1) {
      if (minsArr[j] < mn) mn = minsArr[j];
      if (maxsArr[j] > mx) mx = maxsArr[j];
    }
    mins[i] = mn;
    maxs[i] = mx;
  }
  return { mins, maxs };
}

/**
 * Build waveform overview peaks with ffmpeg (mono downsample + streaming buckets).
 *
 * Buckets are filled from the actual PCM stream (not a metadata time estimate),
 * so the peak timeline stays aligned with decoded audio — critical for long/VBR files.
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

    const mm = await parseFile(filePath, { duration: true }).catch(() => null);
    const metaDuration = Number(mm?.format?.duration) || 0;

    const args = [
      '-hide_banner',
      '-nostats',
      '-i',
      filePath,
      // First audio stream only (ignore attached-picture "video" streams)
      '-map',
      '0:a:0',
      '-vn',
      '-ac',
      '1',
      '-ar',
      String(SAMPLE_RATE),
      // Reset timestamps so PCM length matches audible content timeline
      '-af',
      'asetpts=N/SR/TB',
      '-f',
      'f32le',
      'pipe:1',
    ];

    const minsArr = [];
    const maxsArr = [];
    let samplesRead = 0;

    await new Promise((resolve, reject) => {
      const proc = spawn(config.ffmpegPath, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderr = '';
      let leftover = Buffer.alloc(0);
      let curMin = Number.POSITIVE_INFINITY;
      let curMax = Number.NEGATIVE_INFINITY;
      let inBucket = 0;
      let settled = false;

      function flushBucket() {
        if (inBucket <= 0) return;
        minsArr.push(Number.isFinite(curMin) ? curMin : 0);
        maxsArr.push(Number.isFinite(curMax) ? curMax : 0);
        curMin = Number.POSITIVE_INFINITY;
        curMax = Number.NEGATIVE_INFINITY;
        inBucket = 0;
      }

      function pushSample(v) {
        if (!Number.isFinite(v)) v = 0;
        if (v < curMin) curMin = v;
        if (v > curMax) curMax = v;
        inBucket += 1;
        samplesRead += 1;
        if (inBucket >= SAMPLES_PER_BUCKET) flushBucket();
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
        flushBucket();
        if (code === 0) done();
        else done(new Error(`ffmpeg peaks failed (${code}): ${stderr.slice(-600)}`));
      });
    });

    if (!samplesRead || !minsArr.length) {
      return res.status(400).json({ error: 'No audio samples decoded for peaks' });
    }

    const { mins, maxs } = downsampleBuckets(minsArr, maxsArr, MAX_BUCKETS);
    const length = samplesRead;
    const duration = length / SAMPLE_RATE;
    // Exact average samples/bucket so index math maps the full PCM timeline
    const bucketSize = length / mins.length;

    res.json({
      path: rel,
      duration,
      metaDuration,
      sampleRate: SAMPLE_RATE,
      bucketSize,
      length,
      mins: float32ToBase64(mins),
      maxs: float32ToBase64(maxs),
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}
