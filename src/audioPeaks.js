/**
 * Progressive peak overview for long audio — keeps UI responsive and reports progress.
 */

export function yieldToUi() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/**
 * Build min/max buckets across the full PCM buffer.
 * @param {Float32Array} channelData
 * @param {(ratio: number) => void} onProgress 0..1
 * @param {() => boolean} isCancelled
 * @param {number} [bucketSize=256]
 */
export async function buildOverviewPeaks(channelData, onProgress, isCancelled, bucketSize = 256) {
  const len = channelData?.length || 0;
  if (!len) {
    onProgress?.(1);
    return { mins: new Float32Array(0), maxs: new Float32Array(0), bucketSize, length: 0 };
  }

  const n = Math.max(1, Math.ceil(len / bucketSize));
  const mins = new Float32Array(n);
  const maxs = new Float32Array(n);
  const chunkBars = Math.max(4, Math.ceil(n / 100));

  for (let start = 0; start < n; start += chunkBars) {
    if (isCancelled?.()) return null;
    const end = Math.min(n, start + chunkBars);
    for (let i = start; i < end; i += 1) {
      const a = i * bucketSize;
      const b = Math.min(len, a + bucketSize);
      let min = channelData[a] || 0;
      let max = min;
      for (let j = a + 1; j < b; j += 1) {
        const v = channelData[j];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      mins[i] = min;
      maxs[i] = max;
    }
    onProgress?.(end / n);
    await yieldToUi();
  }

  return { mins, maxs, bucketSize, length: len };
}

/** Peaks for a time window from a precomputed overview (fast). */
export function peaksFromOverview(overview, sampleRate, startSec, endSec, bars) {
  const n = Math.max(1, bars | 0);
  const mins = new Float32Array(n);
  const maxs = new Float32Array(n);
  if (!overview?.mins?.length || !sampleRate) return { mins, maxs };

  const { mins: oMins, maxs: oMaxs, length } = overview;
  const bucketCount = oMins.length;
  const totalSamples = length > 0 ? length : bucketCount;
  // Map via sample fraction so float bucketSize / downsampled overviews stay linear
  const startSample = Math.max(0, Math.floor(startSec * sampleRate));
  const endSample = Math.min(totalSamples, Math.ceil(endSec * sampleRate));
  const span = Math.max(1, endSample - startSample);

  for (let i = 0; i < n; i += 1) {
    const a = startSample + Math.floor((i / n) * span);
    const b = Math.max(a + 1, startSample + Math.floor(((i + 1) / n) * span));
    let b0 = Math.floor((a / totalSamples) * bucketCount);
    let b1 = Math.ceil((b / totalSamples) * bucketCount);
    b0 = Math.max(0, Math.min(bucketCount - 1, b0));
    b1 = Math.max(b0 + 1, Math.min(bucketCount, b1));
    let min = oMins[b0];
    let max = oMaxs[b0];
    for (let j = b0 + 1; j < b1; j += 1) {
      if (oMins[j] < min) min = oMins[j];
      if (oMaxs[j] > max) max = oMaxs[j];
    }
    mins[i] = min;
    maxs[i] = max;
  }
  return { mins, maxs };
}

/**
 * Peaks from raw PCM. Steps through dense regions so zoomed-out views stay usable
 * even before/without overview.
 */
export function peaksForWindow(channelData, sampleRate, startSec, endSec, bars) {
  const n = Math.max(1, bars | 0);
  const mins = new Float32Array(n);
  const maxs = new Float32Array(n);
  if (!channelData?.length || !sampleRate) return { mins, maxs };

  const startSample = Math.max(0, Math.floor(startSec * sampleRate));
  const endSample = Math.min(channelData.length, Math.ceil(endSec * sampleRate));
  const span = Math.max(1, endSample - startSample);

  for (let i = 0; i < n; i += 1) {
    const a = startSample + Math.floor((i / n) * span);
    const b = Math.max(a + 1, startSample + Math.floor(((i + 1) / n) * span));
    const step = Math.max(1, Math.floor((b - a) / 2048));
    let min = 0;
    let max = 0;
    let first = true;
    for (let j = a; j < b; j += step) {
      const v = channelData[j] || 0;
      if (first) {
        min = v;
        max = v;
        first = false;
      } else {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    mins[i] = min;
    maxs[i] = max;
  }
  return { mins, maxs };
}
