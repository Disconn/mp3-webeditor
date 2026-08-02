import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import NodeID3 from 'node-id3';
import { parseFile } from 'music-metadata';
import { config } from '../config.js';
import { resolveAudioPath } from '../paths.js';
import { refreshMetaCacheFor } from './tags.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_DIR = path.join(__dirname, '..', 'tmp');

function ensureTmp() {
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(config.ffmpegPath, args, { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg failed (${code}): ${stderr.slice(-800)}`));
    });
  });
}

export async function getDuration(req, res) {
  try {
    const filePath = resolveAudioPath(req.query.path);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    const mm = await parseFile(filePath, { duration: true });
    res.json({
      path: req.query.path,
      duration: mm.format.duration || 0,
      bitrate: mm.format.bitrate || null,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

/**
 * Crop audio: keep from trimStart to (duration - trimEnd).
 * Body: { path, trimStart, trimEnd, inPlace? }
 * Times in seconds.
 */
export async function cropMp3(req, res) {
  let tmpOut = null;
  try {
    const { path: relPath, trimStart = 0, trimEnd = 0, inPlace = true } = req.body || {};
    if (!relPath) return res.status(400).json({ error: 'path required' });

    const start = Math.max(0, Number(trimStart) || 0);
    const endTrim = Math.max(0, Number(trimEnd) || 0);

    if (start === 0 && endTrim === 0) {
      return res.status(400).json({ error: 'Nothing to crop' });
    }

    const filePath = resolveAudioPath(relPath);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const mm = await parseFile(filePath, { duration: true });
    const duration = mm.format.duration || 0;
    if (!duration || duration <= 0) {
      return res.status(400).json({ error: 'Could not determine duration' });
    }

    const keepEnd = duration - endTrim;
    if (keepEnd <= start + 0.05) {
      return res.status(400).json({ error: 'Crop would leave no audio' });
    }

    const keepDuration = keepEnd - start;

    ensureTmp();
    const stamp = Date.now();
    tmpOut = path.join(TMP_DIR, `crop-${stamp}.mp3`);

    // Stream copy when possible (fast, lossless for MP3 frames approx)
    // Using -ss before -i for input seek, -t for duration
    const args = [
      '-y',
      '-ss',
      String(start),
      '-i',
      filePath,
      '-t',
      String(keepDuration),
      '-vn',
      '-acodec',
      'copy',
      '-map_metadata',
      '0',
      '-id3v2_version',
      '3',
      tmpOut,
    ];

    try {
      await runFfmpeg(args);
    } catch {
      // Fallback: re-encode if stream copy fails
      await runFfmpeg([
        '-y',
        '-ss',
        String(start),
        '-i',
        filePath,
        '-t',
        String(keepDuration),
        '-vn',
        '-codec:a',
        'libmp3lame',
        '-q:a',
        '2',
        '-map_metadata',
        '0',
        '-id3v2_version',
        '3',
        tmpOut,
      ]);
    }

    // Re-apply ID3 tags from original (ffmpeg sometimes drops artwork)
    const tags = NodeID3.read(filePath);
    if (tags) {
      NodeID3.write(tags, tmpOut);
    }

    if (inPlace) {
      fs.copyFileSync(tmpOut, filePath);
      try {
        fs.unlinkSync(tmpOut);
      } catch {
        /* ignore */
      }
      tmpOut = null;
      // Respond first so the client can reload; refresh cache afterwards
      res.json({
        ok: true,
        path: relPath,
        trimStart: start,
        trimEnd: endTrim,
        newDuration: keepDuration,
      });
      try {
        refreshMetaCacheFor(relPath);
      } catch {
        /* non-fatal */
      }
      return;
    }

    const outName = path.basename(filePath, path.extname(filePath)) + '.cropped.mp3';
    const outPath = path.join(path.dirname(filePath), outName);
    fs.copyFileSync(tmpOut, outPath);
    fs.unlinkSync(tmpOut);
    tmpOut = null;

    res.json({
      ok: true,
      path: path.relative(path.dirname(filePath), outPath).replace(/\\/g, '/'),
      absoluteSibling: outName,
      newDuration: keepDuration,
    });
  } catch (err) {
    if (tmpOut && fs.existsSync(tmpOut)) {
      try {
        fs.unlinkSync(tmpOut);
      } catch {
        /* ignore */
      }
    }
    res.status(400).json({ error: err.message });
  }
}

/**
 * Stream original file (byte-range) OR a sync-friendly CBR re-encode.
 *
 * VBR MP3 + HTMLAudio drifts vs sample-accurate peaks (known browser limitation).
 * sync=1 pipes ffmpeg CBR from optional ss= so editor playhead matches peak timeline.
 */
export async function streamAudio(req, res) {
  try {
    const filePath = resolveAudioPath(req.query.path);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const sync =
      req.query.sync === '1' || req.query.sync === 'true' || req.query.sync === 'cbr';
    const ss = Math.max(0, Number(req.query.ss) || 0);

    if (sync) {
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Accept-Ranges', 'none');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');

      const args = ['-hide_banner', '-nostats', '-loglevel', 'error'];
      // Input seek: fast start on long files; CBR output removes VBR timing drift
      if (ss > 0.001) args.push('-ss', ss.toFixed(3));
      args.push(
        '-i',
        filePath,
        '-map',
        '0:a:0',
        '-vn',
        '-c:a',
        'libmp3lame',
        '-b:a',
        '192k',
        '-ac',
        '2',
        '-ar',
        '44100',
        '-write_xing',
        '1',
        '-f',
        'mp3',
        'pipe:1'
      );

      const proc = spawn(config.ffmpegPath, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderr = '';
      let settled = false;

      function fail(err) {
        if (settled) return;
        settled = true;
        try {
          proc.kill('SIGKILL');
        } catch {
          /* ignore */
        }
        if (!res.headersSent) {
          res.status(500).json({ error: err.message || String(err) });
        } else {
          res.destroy(err);
        }
      }

      proc.stderr.on('data', (d) => {
        stderr += d.toString();
        if (stderr.length > 4000) stderr = stderr.slice(-2000);
      });
      proc.on('error', (err) => fail(err));
      proc.on('close', (code) => {
        if (settled) return;
        settled = true;
        if (code && code !== 0 && !res.writableEnded) {
          if (!res.headersSent) {
            res.status(500).json({
              error: `ffmpeg stream failed (${code}): ${stderr.slice(-400)}`,
            });
          } else {
            res.destroy();
          }
        } else if (!res.writableEnded) {
          res.end();
        }
      });

      req.on('close', () => {
        if (settled) return;
        settled = true;
        try {
          proc.kill('SIGKILL');
        } catch {
          /* ignore */
        }
      });

      proc.stdout.pipe(res);
      return;
    }

    const stat = fs.statSync(filePath);
    const range = req.headers.range;

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    function pipeFile(start, end) {
      const stream = fs.createReadStream(filePath, start != null ? { start, end } : undefined);
      stream.on('error', (err) => {
        if (!res.headersSent) {
          res.status(500).json({ error: err.message });
        } else {
          res.destroy(err);
        }
      });
      stream.pipe(res);
    }

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= stat.size) {
        res.status(416);
        res.setHeader('Content-Range', `bytes */${stat.size}`);
        return res.end();
      }
      const chunk = end - start + 1;
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
      res.setHeader('Content-Length', chunk);
      pipeFile(start, end);
    } else {
      res.setHeader('Content-Length', stat.size);
      pipeFile();
    }
  } catch (err) {
    if (!res.headersSent) res.status(400).json({ error: err.message });
  }
}
