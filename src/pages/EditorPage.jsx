import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import TopBar from '../components/TopBar';
import WaveformCrop from '../components/WaveformCrop';
import { useT } from '../i18n/I18nProvider';

function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00.0';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

function base64ToFloat32(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

export default function EditorPage() {
  const t = useT();
  const [params] = useSearchParams();
  const path = params.get('path') || '';

  const [duration, setDuration] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [playing, setPlaying] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [playhead, setPlayhead] = useState(0);
  const [waveKey, setWaveKey] = useState(0);
  const [mediaRev, setMediaRev] = useState(0);
  const [defaultWaveZoom, setDefaultWaveZoom] = useState(1);
  const [zoomReady, setZoomReady] = useState(false);
  const [samples, setSamples] = useState(null);
  const [waveLoading, setWaveLoading] = useState(false);
  const [waveError, setWaveError] = useState('');
  const [loadProgress, setLoadProgress] = useState({
    phase: '',
    percent: 0,
    partPercent: 0,
    detail: '',
  });

  // Streamed HTMLAudioElement for playback (no full-file browser decode)
  const audioRef = useRef(null);
  const playingRef = useRef(false);
  const playheadClockRef = useRef(0);

  function ensureAudioEl() {
    if (!audioRef.current) {
      const el = new Audio();
      el.preload = 'metadata';
      audioRef.current = el;
    }
    return audioRef.current;
  }

  function stopAudioOnly() {
    const el = audioRef.current;
    if (!el) return;
    el.pause();
  }

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    setError('');
    setStatus('');
    setTrimStart(0);
    setTrimEnd(0);
    setCursor(0);
    setPlayhead(0);
    setPlaying(false);
    playingRef.current = false;
    setZoomReady(false);
    setSamples(null);
    stopAudioOnly();

    (async () => {
      try {
        const s = await api.settings();
        if (cancelled) return;
        setDefaultWaveZoom(Number(s.defaultWaveZoom) || 1);
      } catch {
        if (!cancelled) setDefaultWaveZoom(1);
      } finally {
        if (!cancelled) setZoomReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [path]);

  const streamUrl = useMemo(
    () => (path ? api.streamUrl(path, mediaRev || undefined) : ''),
    [path, mediaRev]
  );

  // Keep playback element pointed at current stream
  useEffect(() => {
    if (!streamUrl) return undefined;
    const el = ensureAudioEl();
    el.src = streamUrl;
    return undefined;
  }, [streamUrl]);

  // Server-side peaks (ffmpeg) — avoids browser decodeAudioData OOM/hangs on large files
  useEffect(() => {
    if (!path || !streamUrl) return undefined;

    const ac = new AbortController();
    let cancelled = false;
    let progressTick = 0;

    async function load() {
      stopAudioOnly();
      setPlaying(false);
      playingRef.current = false;
      setWaveLoading(true);
      setWaveError('');
      setSamples(null);
      setLoadProgress({
        phase: 'peaks',
        percent: 2,
        partPercent: 0,
        detail: t('editor.peaksBuilding'),
      });

      const started = performance.now();
      progressTick = window.setInterval(() => {
        if (cancelled) return;
        const elapsed = performance.now() - started;
        // Asymptotic progress while ffmpeg works — keeps moving past old 93% fake cap
        const part = Math.min(97, Math.round((1 - Math.exp(-elapsed / 12000)) * 100));
        setLoadProgress({
          phase: 'peaks',
          percent: Math.min(96, Math.round(part * 0.95)),
          partPercent: part,
          detail: t('editor.buildPeaks', { pct: part }),
        });
      }, 150);

      try {
        const data = await api.peaks(path);
        if (cancelled || ac.signal.aborted) return;

        const overview = {
          mins: base64ToFloat32(data.mins),
          maxs: base64ToFloat32(data.maxs),
          bucketSize: data.bucketSize,
          length: data.length,
        };
        const dur = Number(data.duration) || 0;
        setDuration(dur);
        setSamples({
          data: null,
          sampleRate: data.sampleRate,
          duration: dur,
          overview,
        });
        setCursor(0);
        setPlayhead(0);
        playheadClockRef.current = 0;
        setLoadProgress({
          phase: 'done',
          percent: 100,
          partPercent: 100,
          detail: t('editor.done'),
        });
      } catch (err) {
        if (cancelled || ac.signal.aborted || err?.name === 'AbortError') return;
        setWaveError(err.message || t('editor.decodeFailed'));
        setSamples(null);
        setLoadProgress({ phase: '', percent: 0, partPercent: 0, detail: '' });
      } finally {
        if (progressTick) window.clearInterval(progressTick);
        if (!cancelled && !ac.signal.aborted) setWaveLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
      ac.abort();
      if (progressTick) window.clearInterval(progressTick);
      stopAudioOnly();
    };
  }, [path, streamUrl, t]);

  // Playhead from HTMLAudioElement
  useEffect(() => {
    if (!playing) return undefined;
    let raf = 0;
    let lastUi = 0;
    function tick(now) {
      const el = audioRef.current;
      if (el && playingRef.current) {
        const tNow = el.currentTime || 0;
        if (el.ended) {
          playingRef.current = false;
          const endT = duration || tNow;
          playheadClockRef.current = endT;
          setPlaying(false);
          setPlayhead(endT);
          setCursor(endT);
        } else {
          playheadClockRef.current = tNow;
          if (now - lastUi > 50) {
            lastUi = now;
            setPlayhead(tNow);
          }
        }
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, duration]);

  async function playFromCursor() {
    const el = ensureAudioEl();
    if (!duration || !streamUrl) return;

    const start = Math.min(Math.max(0, cursor), Math.max(0, duration - 0.02));
    try {
      if (el.getAttribute('src') !== streamUrl) el.src = streamUrl;
      el.currentTime = start;
      await el.play();
      playheadClockRef.current = start;
      setPlayhead(start);
      playingRef.current = true;
      setPlaying(true);
    } catch (err) {
      setError(err.message || t('editor.audioCtxFailed'));
      playingRef.current = false;
      setPlaying(false);
    }
  }

  function stopPlayback() {
    const el = audioRef.current;
    let tNow = cursor;
    if (el && playingRef.current) {
      tNow = Math.min(duration, Math.max(0, el.currentTime || 0));
    }
    stopAudioOnly();
    playingRef.current = false;
    setPlaying(false);
    playheadClockRef.current = tNow;
    setCursor(tNow);
    setPlayhead(tNow);
  }

  const playFnRef = useRef(playFromCursor);
  const stopFnRef = useRef(stopPlayback);
  playFnRef.current = playFromCursor;
  stopFnRef.current = stopPlayback;

  useEffect(() => {
    function onKeyDown(e) {
      if (e.code !== 'Space' && e.key !== ' ') return;
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) {
        return;
      }
      e.preventDefault();
      if (e.repeat) return;
      if (playingRef.current) stopFnRef.current();
      else playFnRef.current();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    return () => {
      stopAudioOnly();
      const el = audioRef.current;
      audioRef.current = null;
      if (el) {
        el.removeAttribute('src');
        try {
          el.load();
        } catch {
          /* ignore */
        }
      }
    };
  }, []);

  function onCursorChange(tPos) {
    const next = Math.min(Math.max(0, tPos), Math.max(0, duration));
    setCursor(next);
    setPlayhead(next);
    playheadClockRef.current = next;
    const el = audioRef.current;
    if (el) {
      try {
        el.currentTime = next;
      } catch {
        /* ignore seek errors while not loaded */
      }
    }
  }

  async function applyCrop() {
    if (!path) return;
    if (trimStart === 0 && trimEnd === 0) {
      setError(t('editor.needTrim'));
      return;
    }
    stopPlayback();
    setBusy(true);
    setError('');
    setStatus(t('editor.cutting'));
    try {
      const data = await api.crop(path, trimStart, trimEnd);
      setTrimStart(0);
      setTrimEnd(0);
      setCursor(0);
      setPlayhead(0);
      playheadClockRef.current = 0;
      setPlaying(false);
      playingRef.current = false;
      setStatus(t('editor.saved', { time: formatTime(data.newDuration) }));
      await new Promise((r) => setTimeout(r, 200));
      setWaveKey((k) => k + 1);
      setMediaRev(Date.now());
    } catch (err) {
      setError(err.message);
      setStatus('');
    } finally {
      setBusy(false);
    }
  }

  if (!path) {
    return (
      <div className="app-shell narrow">
        <TopBar subtitle={t('editor.subtitle')} />
        <div className="empty-state">
          <h2>{t('editor.noFile')}</h2>
          <p className="muted">{t('editor.pickHint')}</p>
          <Link className="btn primary" to="/">
            {t('nav.toLibrary')}
          </Link>
        </div>
      </div>
    );
  }

  const fileName = path.split('/').pop();
  const keepStart = trimStart;
  const keepEnd = Math.max(0, duration - trimEnd);
  const keepLen = Math.max(0, keepEnd - keepStart);

  return (
    <div className="app-shell">
      <TopBar subtitle={t('editor.subtitle')} />

      <main className="editor-main full">
        <div className="editor-head">
          <div>
            <h1>{fileName}</h1>
            <p className="muted mono small">{path}</p>
          </div>
          <p className="duration-badge">{t('editor.total', { time: formatTime(duration) })}</p>
        </div>

        <div className="waveform-panel full">
          {!zoomReady ? (
            <div className="listing-state compact">
              <span className="spinner" />
              <p>{t('editor.loading')}</p>
            </div>
          ) : (
            <WaveformCrop
              key={`${path}-${waveKey}-${defaultWaveZoom}`}
              samples={samples}
              loading={waveLoading}
              loadProgress={loadProgress}
              loadError={waveError}
              duration={duration}
              trimStart={trimStart}
              trimEnd={trimEnd}
              onChangeStart={setTrimStart}
              onChangeEnd={setTrimEnd}
              cursorTime={cursor}
              onCursorChange={onCursorChange}
              playheadTime={playing ? playhead : cursor}
              playheadClockRef={playheadClockRef}
              playing={playing}
              initialZoom={defaultWaveZoom}
            />
          )}

          <div className="crop-summary">
            <div>
              <span className="muted">{t('editor.keepFrom')}</span>
              <strong>{formatTime(keepStart)}</strong>
            </div>
            <div>
              <span className="muted">{t('editor.until')}</span>
              <strong>{formatTime(keepEnd)}</strong>
            </div>
            <div>
              <span className="muted">{t('editor.length')}</span>
              <strong>{formatTime(keepLen)}</strong>
            </div>
            <div>
              <span className="muted">{t('editor.playhead')}</span>
              <strong>{formatTime(playing ? playhead : cursor)}</strong>
            </div>
          </div>

          {(status || error) && (
            <div className="status-row">
              {status && <p className="ok">{status}</p>}
              {error && <p className="error">{error}</p>}
            </div>
          )}

          <div className="editor-actions">
            {!playing ? (
              <button
                type="button"
                className="btn secondary"
                onClick={playFromCursor}
                disabled={!duration || waveLoading || !samples}
              >
                {t('editor.play')} <span className="kbd">Space</span>
              </button>
            ) : (
              <button type="button" className="btn secondary" onClick={stopPlayback}>
                {t('editor.stop')} <span className="kbd">Space</span>
              </button>
            )}
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                stopPlayback();
                setTrimStart(0);
                setTrimEnd(0);
              }}
            >
              {t('editor.resetCrop')}
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={() => {
                const pos = playing ? playhead : cursor;
                const minGap = 0.05;
                const max = Math.max(0, keepEnd - minGap);
                setTrimStart(Math.min(Math.max(0, pos), max));
              }}
              disabled={!duration}
            >
              {t('editor.cropStartAtPos')}
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={() => {
                const pos = playing ? playhead : cursor;
                const minGap = 0.05;
                const min = trimStart + minGap;
                const absEnd = Math.min(Math.max(min, pos), duration);
                setTrimEnd(Math.max(0, duration - absEnd));
              }}
              disabled={!duration}
            >
              {t('editor.cropEndAtPos')}
            </button>
            <button type="button" className="btn primary" onClick={applyCrop} disabled={busy || !duration}>
              {busy ? t('editor.cutting') : t('editor.saveCrop')}
            </button>
          </div>
          <p className="muted small warn-note">{t('editor.warn')}</p>
        </div>
      </main>
    </div>
  );
}
