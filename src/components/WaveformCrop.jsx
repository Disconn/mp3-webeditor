import { useCallback, useEffect, useRef, useState } from 'react';
import { peaksForWindow, peaksFromOverview } from '../audioPeaks';
import { useT } from '../i18n/I18nProvider';

function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00.0';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 16;
const HEIGHT = 220;

function clampZoom(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(n * 10) / 10));
}

/**
 * Waveform display — samples must be the same PCM used for Web Audio playback
 * so quiet/loud passages line up with what you hear.
 */
export default function WaveformCrop({
  samples, // { data, sampleRate, duration } | null
  loading = false,
  loadProgress = null,
  loadError = '',
  duration,
  trimStart,
  trimEnd,
  onChangeStart,
  onChangeEnd,
  cursorTime = 0,
  onCursorChange,
  playheadTime = null,
  playheadClockRef = null,
  playing = false,
  initialZoom = 1,
}) {
  const t = useT();
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [zoom, setZoom] = useState(() => clampZoom(initialZoom));
  const defaultZoomRef = useRef(clampZoom(initialZoom));
  const [viewStart, setViewStart] = useState(0);
  const [viewWidth, setViewWidth] = useState(800);
  const dragRef = useRef(null);
  const panRef = useRef(null);
  const pointerStartRef = useRef(null);
  const peaksCacheRef = useRef({ key: '', mins: null, maxs: null });
  const waveLayerRef = useRef(null); // offscreen: waveform without playhead
  const waveLayerKeyRef = useRef('');

  const timelineDuration = duration > 0 ? duration : samples?.duration || 0;
  const keepEnd = Math.max(0, timelineDuration - (trimEnd || 0));
  const visibleDuration = timelineDuration > 0 ? timelineDuration / zoom : 0;
  const maxViewStart = Math.max(0, timelineDuration - visibleDuration);
  const head = playheadTime != null ? playheadTime : cursorTime;
  const headRef = useRef(head);
  headRef.current = head;
  const viewStartRef = useRef(viewStart);
  viewStartRef.current = viewStart;
  const visibleDurationRef = useRef(visibleDuration);
  visibleDurationRef.current = visibleDuration;
  const maxViewStartRef = useRef(maxViewStart);
  maxViewStartRef.current = maxViewStart;

  useEffect(() => {
    const z = clampZoom(initialZoom);
    defaultZoomRef.current = z;
    setZoom(z);
    setViewStart(0);
  }, [initialZoom]);

  useEffect(() => {
    setViewStart(0);
  }, [samples]);

  useEffect(() => {
    setViewStart((v) => Math.min(v, maxViewStart));
  }, [maxViewStart]);

  // Auto-follow only when not in the playing rAF loop (stopped / cursor jumps)
  useEffect(() => {
    if (playing || playheadTime == null || !visibleDuration) return;
    if (playheadTime < viewStart) {
      setViewStart(Math.max(0, playheadTime));
    } else if (playheadTime > viewStart + visibleDuration) {
      setViewStart(Math.min(maxViewStart, playheadTime - visibleDuration * 0.15));
    }
  }, [playing, playheadTime, viewStart, visibleDuration, maxViewStart]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const measure = () => setViewWidth(Math.max(320, el.clientWidth || 800));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const timeToX = useCallback(
    (t) => {
      if (!visibleDuration) return 0;
      return ((t - viewStart) / visibleDuration) * viewWidth;
    },
    [viewStart, visibleDuration, viewWidth]
  );

  const clientToTime = useCallback(
    (clientX) => {
      const rect = canvasRef.current.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return viewStart + ratio * visibleDuration;
    },
    [viewStart, visibleDuration]
  );

  const drawWaveLayer = useCallback(() => {
    if (!timelineDuration || !viewWidth) return null;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = viewWidth;
    const height = HEIGHT;
    const bw = Math.floor(width * dpr);
    const bh = Math.floor(height * dpr);
    const viewEnd = viewStart + visibleDuration;
    const bars = Math.max(64, Math.floor(width));
    const layerKey = [
      samples?.data?.length || 0,
      samples?.overview?.mins?.length || 0,
      samples?.sampleRate || 0,
      viewStart.toFixed(5),
      viewEnd.toFixed(5),
      bars,
      trimStart,
      keepEnd,
      zoom,
      bw,
      bh,
    ].join('|');

    let layer = waveLayerRef.current;
    if (layer && layer.width === bw && layer.height === bh && waveLayerKeyRef.current === layerKey) {
      return layer;
    }

    if (!layer || layer.width !== bw || layer.height !== bh) {
      layer = document.createElement('canvas');
      layer.width = bw;
      layer.height = bh;
      waveLayerRef.current = layer;
      peaksCacheRef.current = { key: '', mins: null, maxs: null };
    }

    const g = layer.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, height);

    g.fillStyle = '#121916';
    g.fillRect(0, 0, width, height);

    const mid = height / 2;

    if (samples?.data?.length && visibleDuration > 0) {
      const cacheKey = layerKey;
      let mins = peaksCacheRef.current.mins;
      let maxs = peaksCacheRef.current.maxs;
      if (peaksCacheRef.current.key !== cacheKey || !mins || !maxs) {
        const samplesInView = visibleDuration * samples.sampleRate;
        const samplesPerBar = samplesInView / bars;
        const useOverview =
          samples.overview && samplesPerBar > (samples.overview.bucketSize || 256) * 0.75;
        ({ mins, maxs } = useOverview
          ? peaksFromOverview(samples.overview, samples.sampleRate, viewStart, viewEnd, bars)
          : peaksForWindow(samples.data, samples.sampleRate, viewStart, viewEnd, bars));
        peaksCacheRef.current = { key: cacheKey, mins, maxs };
      }

      const barW = width / bars;
      for (let i = 0; i < bars; i += 1) {
        const t = viewStart + ((i + 0.5) / bars) * visibleDuration;
        const inKeep = t >= trimStart && t <= keepEnd;
        g.fillStyle = inKeep ? '#3ecf8e' : '#3ecf8e48';
        const y0 = mid + mins[i] * (height * 0.43);
        const y1 = mid + maxs[i] * (height * 0.43);
        const top = Math.min(y0, y1);
        const h = Math.max(1, Math.abs(y1 - y0));
        g.fillRect(i * barW, top, Math.max(1, barW * 0.9), h);
      }
    } else {
      g.strokeStyle = '#2c3832';
      g.beginPath();
      g.moveTo(0, mid);
      g.lineTo(width, mid);
      g.stroke();
    }

    g.fillStyle = 'rgba(5,8,7,0.72)';
    if (trimStart > viewStart) {
      const x = Math.max(0, timeToX(Math.min(trimStart, viewEnd)));
      g.fillRect(0, 0, x, height);
    }
    if (keepEnd < viewEnd) {
      const x = Math.min(width, Math.max(0, timeToX(Math.max(keepEnd, viewStart))));
      g.fillRect(x, 0, width - x, height);
    }

    const keepX0 = Math.max(0, timeToX(Math.max(trimStart, viewStart)));
    const keepX1 = Math.min(width, timeToX(Math.min(keepEnd, viewEnd)));
    if (keepX1 > keepX0) {
      g.fillStyle = 'rgba(62,207,142,0.08)';
      g.fillRect(keepX0, 0, keepX1 - keepX0, height);
    }

    if (zoom >= 2 && visibleDuration > 0) {
      const step = visibleDuration <= 10 ? 0.5 : visibleDuration <= 30 ? 1 : visibleDuration <= 60 ? 2 : 5;
      g.fillStyle = '#5f7368';
      g.font = '10px JetBrains Mono, monospace';
      const first = Math.ceil(viewStart / step) * step;
      for (let t = first; t <= viewEnd + 0.001; t += step) {
        const x = timeToX(t);
        g.globalAlpha = 0.35;
        g.fillRect(x, 0, 1, height);
        g.globalAlpha = 0.9;
        g.fillText(formatTime(t), x + 3, 14);
      }
      g.globalAlpha = 1;
    }

    function drawHandle(t, label) {
      if (t < viewStart - 0.01 || t > viewEnd + 0.01) return;
      const x = timeToX(t);
      g.fillStyle = '#3ecf8e';
      g.fillRect(x - 1.5, 0, 3, height);
      g.beginPath();
      g.moveTo(x, 8);
      g.lineTo(x + 10, 18);
      g.lineTo(x - 10, 18);
      g.closePath();
      g.fill();
      g.fillStyle = '#e8efe9';
      g.font = '11px JetBrains Mono, monospace';
      g.fillText(label, Math.min(Math.max(x - 18, 4), width - 48), height - 8);
    }

    drawHandle(trimStart, formatTime(trimStart));
    drawHandle(keepEnd, formatTime(keepEnd));
    waveLayerKeyRef.current = layerKey;
    return layer;
  }, [
    samples,
    timelineDuration,
    trimStart,
    keepEnd,
    viewWidth,
    zoom,
    viewStart,
    visibleDuration,
    timeToX,
  ]);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !timelineDuration || !viewWidth) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = viewWidth;
    const height = HEIGHT;
    const bw = Math.floor(width * dpr);
    const bh = Math.floor(height * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }

    const layer = drawWaveLayer();
    const g = canvas.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, bw, bh);
    if (layer) g.drawImage(layer, 0, 0);

    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const headNow = headRef.current;
    const viewEnd = viewStart + visibleDuration;
    if (Number.isFinite(headNow) && headNow >= viewStart - 0.01 && headNow <= viewEnd + 0.01) {
      const x = timeToX(headNow);
      g.strokeStyle = '#e8b84a';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, height);
      g.stroke();
      g.fillStyle = '#e8b84a';
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x + 7, 10);
      g.lineTo(x - 7, 10);
      g.closePath();
      g.fill();
      g.fillStyle = '#e8efe9';
      g.font = '11px JetBrains Mono, monospace';
      g.fillText(formatTime(headNow), Math.min(Math.max(x + 8, 4), width - 52), 22);
    }
  }, [drawWaveLayer, timelineDuration, viewWidth, viewStart, visibleDuration, timeToX]);

  // Redraw when view / crop / samples change
  useEffect(() => {
    paint();
  }, [paint]);

  // Smooth playhead while playing — composite only, wave layer stays cached
  useEffect(() => {
    if (!playing || !playheadClockRef) {
      paint();
      return undefined;
    }
    let raf = 0;
    function loop() {
      const t = playheadClockRef.current;
      if (Number.isFinite(t)) {
        headRef.current = t;
        const vs = viewStartRef.current;
        const vd = visibleDurationRef.current;
        const maxVs = maxViewStartRef.current;
        if (vd > 0) {
          if (t < vs) {
            setViewStart(Math.max(0, t));
          } else if (t > vs + vd) {
            setViewStart(Math.min(maxVs, t - vd * 0.15));
          }
        }
      }
      paint();
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, playheadClockRef, paint]);

  // Cursor / stopped playhead updates
  useEffect(() => {
    if (playing) return;
    paint();
  }, [head, playing, paint]);

  function applyDrag(t, handle) {
    const minGap = 0.05;
    if (handle === 'start') {
      const max = Math.max(0, keepEnd - minGap);
      onChangeStart(Math.min(Math.max(0, t), max));
    } else {
      const min = trimStart + minGap;
      const absEnd = Math.min(Math.max(min, t), timelineDuration);
      onChangeEnd(Math.max(0, timelineDuration - absEnd));
    }
  }

  function hitHandle(clientX) {
    const rect = canvasRef.current.getBoundingClientRect();
    const startX = rect.left + timeToX(trimStart);
    const endX = rect.left + timeToX(keepEnd);
    const grabPx = 12;
    const dStart = Math.abs(clientX - startX);
    const dEnd = Math.abs(clientX - endX);
    if (dStart <= dEnd && dStart <= grabPx) return 'start';
    if (dEnd <= grabPx) return 'end';
    return null;
  }

  function onPointerDown(e) {
    if (!timelineDuration || !visibleDuration) return;
    const t = clientToTime(e.clientX);
    const handle = hitHandle(e.clientX);

    pointerStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      t,
      moved: false,
      mode: handle || 'cursor',
    };
    dragRef.current = null;
    panRef.current = handle
      ? null
      : {
          startX: e.clientX,
          origin: viewStart,
        };
    canvasRef.current.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    const start = pointerStartRef.current;
    if (!start) return;

    const dx = Math.abs(e.clientX - start.x);
    const dy = Math.abs(e.clientY - start.y);
    if (dx > 4 || dy > 4) start.moved = true;

    if (!start.moved) return;

    if (start.mode === 'start' || start.mode === 'end') {
      dragRef.current = start.mode;
      applyDrag(clientToTime(e.clientX), start.mode);
      const rect = canvasRef.current.getBoundingClientRect();
      const edge = 28;
      if (e.clientX < rect.left + edge) {
        setViewStart((v) => Math.max(0, v - visibleDuration * 0.02));
      } else if (e.clientX > rect.right - edge) {
        setViewStart((v) => Math.min(maxViewStart, v + visibleDuration * 0.02));
      }
      return;
    }

    if (panRef.current && visibleDuration > 0) {
      const panDx = e.clientX - panRef.current.startX;
      const dt = -(panDx / viewWidth) * visibleDuration;
      setViewStart(Math.min(maxViewStart, Math.max(0, panRef.current.origin + dt)));
    }
  }

  function onPointerUp(e) {
    const start = pointerStartRef.current;
    const wasClick = start && !start.moved;

    dragRef.current = null;
    panRef.current = null;
    pointerStartRef.current = null;

    try {
      canvasRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }

    if (wasClick && onCursorChange && timelineDuration) {
      onCursorChange(Math.min(Math.max(0, clientToTime(e.clientX)), timelineDuration));
    }
  }

  function zoomAt(nextZoom, anchorClientX) {
    if (!timelineDuration) return;
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
    const anchorTime = clientToTime(anchorClientX);
    const newVisible = timelineDuration / clamped;
    const newStart = Math.min(
      Math.max(0, timelineDuration - newVisible),
      Math.max(0, anchorTime - (anchorTime - viewStart) * (newVisible / (visibleDuration || timelineDuration)))
    );
    setZoom(clamped);
    setViewStart(newStart);
  }

  function onWheel(e) {
    if (!timelineDuration) return;
    e.preventDefault();
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      const delta = (e.deltaY || e.deltaX) / viewWidth;
      setViewStart((v) => Math.min(maxViewStart, Math.max(0, v + delta * visibleDuration)));
      return;
    }
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    zoomAt(zoom * factor, e.clientX);
  }

  function zoomBy(factor) {
    const rect = canvasRef.current?.getBoundingClientRect();
    const cx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    zoomAt(zoom * factor, cx);
  }

  const scrollRatio = maxViewStart > 0 ? viewStart / maxViewStart : 0;
  const percent = Math.min(100, Math.max(0, Number(loadProgress?.percent) || 0));
  const progressLabel =
    loadProgress?.detail ||
    (loading ? t('wave.loading') : '');

  return (
    <div className="wave-wrap" ref={wrapRef}>
      <div className="wave-toolbar">
        <div className="wave-zoom-controls">
          <button
            type="button"
            className="btn ghost tiny"
            onClick={() => zoomBy(1 / 1.25)}
            disabled={zoom <= MIN_ZOOM || loading}
          >
            −
          </button>
          <span className="zoom-label">{zoom.toFixed(1)}×</span>
          <button
            type="button"
            className="btn ghost tiny"
            onClick={() => zoomBy(1.25)}
            disabled={zoom >= MAX_ZOOM || loading}
          >
            +
          </button>
          <button
            type="button"
            className="btn ghost tiny"
            onClick={() => {
              setZoom(defaultZoomRef.current);
              setViewStart(0);
            }}
            disabled={loading || (zoom === defaultZoomRef.current && viewStart === 0)}
          >
            {t('wave.reset')}
          </button>
        </div>
        <span className="muted small">{t('wave.hint')}</span>
      </div>

      <div className={`wave-viewport${loading ? ' is-loading' : ''}`} onWheel={onWheel}>
        <canvas
          ref={canvasRef}
          className="wave-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
        {loading && (
          <div className="wave-load-overlay" role="status" aria-live="polite">
            <div className="wave-load-card">
              <div className="wave-load-label">
                <span>{progressLabel}</span>
                <span className="wave-load-pct">{percent}%</span>
              </div>
              <div
                className="wave-load-track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                aria-label={t('wave.progress')}
              >
                <div
                  className={`wave-load-fill${
                    loadProgress?.phase === 'decode' || loadProgress?.phase === 'peaks' ? ' decode' : ''
                  }`}
                  style={{ width: `${percent}%` }}
                />
              </div>
              <p className="wave-load-phases muted small">
                {loadProgress?.phase === 'peaks'
                  ? t('wave.peaks')
                  : loadProgress?.phase === 'decode'
                    ? t('wave.decoding')
                    : t('wave.fileLoading')}
              </p>
            </div>
          </div>
        )}
      </div>

      {zoom > 1 && !loading && (
        <input
          className="wave-pan"
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={scrollRatio}
          onChange={(e) => setViewStart(Number(e.target.value) * maxViewStart)}
          aria-label={t('wave.pan')}
        />
      )}

      <div className="wave-meta">
        {loading && (
          <span className="muted small">
            {progressLabel} ({percent}%)
          </span>
        )}
        {loadError && <span className="error small">{loadError}</span>}
        {!loading && !loadError && (
          <span className="muted small">
            {t('wave.cursor', { time: formatTime(cursorTime) })}
            {playheadTime != null ? t('wave.play', { time: formatTime(playheadTime) }) : ''}
          </span>
        )}
      </div>
    </div>
  );
}
