import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { buildOverviewPeaks } from '../audioPeaks';
import TopBar from '../components/TopBar';
import WaveformCrop from '../components/WaveformCrop';
import { useT } from '../i18n/I18nProvider';

function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00.0';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
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

  // Same AudioContext + AudioBuffer for waveform peaks and playback → perfect sync
  const ctxRef = useRef(null);
  const bufferRef = useRef(null);
  const sourceRef = useRef(null);
  const playOriginRef = useRef({ ctxTime: 0, offset: 0 });
  const playingRef = useRef(false);
  const playheadClockRef = useRef(0);

  function getAudioCtx() {
    if (!ctxRef.current) {
      ctxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    return ctxRef.current;
  }

  function stopSourceOnly() {
    const src = sourceRef.current;
    sourceRef.current = null;
    if (!src) return;
    try {
      src.onended = null;
      src.stop();
    } catch {
      /* already stopped */
    }
    try {
      src.disconnect();
    } catch {
      /* ignore */
    }
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
    bufferRef.current = null;

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

  // Decode once — peaks + playback share this buffer
  useEffect(() => {
    if (!streamUrl) return undefined;

    const ac = new AbortController();
    let cancelled = false;
    let decodeTick = 0;
    const ctx = getAudioCtx();

    function delay(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async function readBodyWithProgress(res) {
      const total = Number(res.headers.get('content-length')) || 0;
      if (!res.body?.getReader) {
        const raw = await res.arrayBuffer();
        if (!cancelled) {
          setLoadProgress({
            phase: 'download',
            percent: 40,
            partPercent: 100,
            detail: t('editor.fileLoaded'),
          });
        }
        return raw;
      }

      const reader = res.body.getReader();
      const chunks = [];
      let received = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (cancelled || ac.signal.aborted) {
          try {
            await reader.cancel();
          } catch {
            /* ignore */
          }
          throw new DOMException('Aborted', 'AbortError');
        }
        chunks.push(value);
        received += value.byteLength;
        if (total > 0) {
          const part = Math.min(100, Math.round((received / total) * 100));
          const mb = (received / (1024 * 1024)).toFixed(1);
          const totalMb = (total / (1024 * 1024)).toFixed(1);
          setLoadProgress({
            phase: 'download',
            percent: Math.min(40, Math.round(part * 0.4)),
            partPercent: part,
            detail: t('editor.loadingFile', { current: mb, total: totalMb }),
          });
        } else {
          const mb = (received / (1024 * 1024)).toFixed(1);
          const part = Math.min(95, 8 + Math.round(Math.log10(received + 1) * 18));
          setLoadProgress({
            phase: 'download',
            percent: Math.min(38, Math.round(part * 0.4)),
            partPercent: part,
            detail: t('editor.loadingFileMb', { current: mb }),
          });
        }
      }

      const out = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return out.buffer;
    }

    async function fetchAudioBuffer() {
      const res = await fetch(streamUrl, {
        credentials: 'include',
        cache: 'no-store',
        signal: ac.signal,
      });
      if (!res.ok) throw new Error(t('editor.loadFailedStatus', { status: res.status }));
      if (!cancelled) {
        setLoadProgress({
          phase: 'download',
          percent: 2,
          partPercent: 0,
          detail: t('editor.download'),
        });
      }
      return readBodyWithProgress(res);
    }

    async function load() {
      stopSourceOnly();
      setPlaying(false);
      playingRef.current = false;
      setWaveLoading(true);
      setWaveError('');
      setSamples(null);
      bufferRef.current = null;
      setLoadProgress({
        phase: 'download',
        percent: 1,
        partPercent: 0,
        detail: t('editor.connecting'),
      });

      try {
        let raw = null;
        let lastErr = null;
        for (let attempt = 1; attempt <= 4; attempt += 1) {
          if (cancelled || ac.signal.aborted) return;
          try {
            if (attempt > 1) {
              setLoadProgress({
                phase: 'download',
                percent: 1,
                partPercent: 0,
                detail: t('editor.retry', { attempt }),
              });
              await delay(150 * attempt);
            }
            raw = await fetchAudioBuffer();
            lastErr = null;
            break;
          } catch (err) {
            lastErr = err;
            if (err?.name === 'AbortError' || cancelled || ac.signal.aborted) return;
            // Retry — file may still be flushing after crop (esp. network drives)
          }
        }
        if (!raw) throw lastErr || new Error(t('editor.loadFailed'));
        if (cancelled || ac.signal.aborted) return;

        const estMs = Math.min(45000, Math.max(600, (raw.byteLength / (6 * 1024 * 1024)) * 1000));
        const decodeStarted = performance.now();
        setLoadProgress({
          phase: 'decode',
          percent: 40,
          partPercent: 0,
          detail: t('editor.decode'),
        });
        decodeTick = window.setInterval(() => {
          if (cancelled) return;
          const progress = Math.min(0.93, (performance.now() - decodeStarted) / estMs);
          const part = Math.round(progress * 100);
          setLoadProgress({
            phase: 'decode',
            percent: 40 + Math.round(progress * 15),
            partPercent: part,
            detail: t('editor.decode'),
          });
        }, 120);

        let audio;
        try {
          if (ctx.state === 'suspended') await ctx.resume();
          audio = await ctx.decodeAudioData(raw.slice(0));
        } finally {
          window.clearInterval(decodeTick);
          decodeTick = 0;
        }
        if (cancelled || ac.signal.aborted) return;

        bufferRef.current = audio;
        const src = audio.getChannelData(0);
        const data = new Float32Array(src.length);
        data.set(src);
        const dur = audio.duration || data.length / audio.sampleRate;
        setDuration(dur);

        setLoadProgress({
          phase: 'peaks',
          percent: 55,
          partPercent: 0,
          detail: t('editor.buildPeaks0'),
        });

        const overview = await buildOverviewPeaks(
          data,
          (ratio) => {
            if (cancelled) return;
            const buildPct = Math.round(ratio * 100);
            setLoadProgress({
              phase: 'peaks',
              percent: Math.min(99, 55 + Math.round(ratio * 44)),
              partPercent: buildPct,
              detail: t('editor.buildPeaks', { pct: buildPct }),
            });
          },
          () => cancelled || ac.signal.aborted,
          256
        );
        if (cancelled || ac.signal.aborted || !overview) return;

        setSamples({ data, sampleRate: audio.sampleRate, duration: dur, overview });
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
        if (decodeTick) window.clearInterval(decodeTick);
        if (!cancelled && !ac.signal.aborted) setWaveLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
      ac.abort();
      if (decodeTick) window.clearInterval(decodeTick);
      stopSourceOnly();
    };
  }, [streamUrl, t]);

  // Playhead from AudioContext clock (same buffer as waveform)
  useEffect(() => {
    if (!playing) return undefined;
    let raf = 0;
    let lastUi = 0;
    function tick(now) {
      const ctx = ctxRef.current;
      const buf = bufferRef.current;
      if (ctx && buf && playingRef.current) {
        const { ctxTime, offset } = playOriginRef.current;
        const t = offset + (ctx.currentTime - ctxTime);
        if (t >= buf.duration) {
          stopSourceOnly();
          playingRef.current = false;
          playheadClockRef.current = buf.duration;
          setPlaying(false);
          setPlayhead(buf.duration);
          setCursor(buf.duration);
        } else {
          playheadClockRef.current = t;
          // UI label ~20fps — waveform reads playheadClockRef directly
          if (now - lastUi > 50) {
            lastUi = now;
            setPlayhead(t);
          }
        }
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  async function playFromCursor() {
    const ctx = getAudioCtx();
    const buf = bufferRef.current;
    if (!buf || !duration) return;

    try {
      if (ctx.state === 'suspended') await ctx.resume();
    } catch (err) {
      setError(err.message || t('editor.audioCtxFailed'));
      return;
    }

    stopSourceOnly();

    const start = Math.min(Math.max(0, cursor), Math.max(0, duration - 0.02));
    const source = ctx.createBufferSource();
    source.buffer = buf;
    source.connect(ctx.destination);
    source.onended = () => {
      if (sourceRef.current !== source) return;
      sourceRef.current = null;
      if (!playingRef.current) return;
      playingRef.current = false;
      setPlaying(false);
      const endT = buf.duration;
      setPlayhead(endT);
      setCursor(endT);
    };

    playOriginRef.current = { ctxTime: ctx.currentTime, offset: start };
    sourceRef.current = source;
    source.start(0, start);
    playheadClockRef.current = start;
    setPlayhead(start);
    playingRef.current = true;
    setPlaying(true);
  }

  function stopPlayback() {
    const ctx = ctxRef.current;
    let t = cursor;
    if (playingRef.current && ctx) {
      const { ctxTime, offset } = playOriginRef.current;
      t = Math.min(duration, Math.max(0, offset + (ctx.currentTime - ctxTime)));
    }
    stopSourceOnly();
    playingRef.current = false;
    setPlaying(false);
    playheadClockRef.current = t;
    setCursor(t);
    setPlayhead(t);
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
      // Full unmount (e.g. navigating back to the library) — drop the big
      // decoded PCM buffer immediately instead of waiting on GC to notice
      // the component tree is gone. A single "Full Set" mix can hold >1GB here.
      stopSourceOnly();
      bufferRef.current = null;
      const ctx = ctxRef.current;
      ctxRef.current = null;
      if (ctx) ctx.close().catch(() => {});
    };
  }, []);

  function onCursorChange(t) {
    const next = Math.min(Math.max(0, t), Math.max(0, duration));
    setCursor(next);
    setPlayhead(next);
    playheadClockRef.current = next;
    if (playingRef.current) {
      // Restart buffer source at new offset
      const ctx = ctxRef.current;
      const buf = bufferRef.current;
      if (!ctx || !buf) return;
      stopSourceOnly();
      const source = ctx.createBufferSource();
      source.buffer = buf;
      source.connect(ctx.destination);
      source.onended = () => {
        if (sourceRef.current !== source) return;
        sourceRef.current = null;
        if (!playingRef.current) return;
        playingRef.current = false;
        setPlaying(false);
        playheadClockRef.current = buf.duration;
        setPlayhead(buf.duration);
        setCursor(buf.duration);
      };
      playOriginRef.current = { ctxTime: ctx.currentTime, offset: next };
      sourceRef.current = source;
      source.start(0, next);
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
      // Brief pause so the filesystem releases the rewritten file, then force reload
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
