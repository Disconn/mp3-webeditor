import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { buildOverviewPeaks } from '../audioPeaks';
import TopBar from '../components/TopBar';
import WaveformCrop from '../components/WaveformCrop';
import { useT } from '../i18n/I18nProvider';

/** Below this size we decode in-browser so waveform + playback share one PCM timeline */
const CLIENT_DECODE_MAX_BYTES = 48 * 1024 * 1024;

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

/** Stretch overview buckets evenly across a playback duration (HTMLAudio timeline). */
function alignOverviewToDuration(overview, sampleRate, audioDur) {
  if (!overview?.mins?.length || !(audioDur > 0) || !(sampleRate > 0)) return overview;
  const length = Math.max(1, Math.round(audioDur * sampleRate));
  const bucketSize = Math.max(1, Math.ceil(length / overview.mins.length));
  return {
    mins: overview.mins,
    maxs: overview.maxs,
    bucketSize,
    length,
  };
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

  // mode: 'webaudio' (perfect sync) | 'element' (large files, peaks + HTMLAudio)
  const modeRef = useRef('element');
  const ctxRef = useRef(null);
  const bufferRef = useRef(null);
  const sourceRef = useRef(null);
  const playOriginRef = useRef({ ctxTime: 0, offset: 0 });
  const audioRef = useRef(null);
  const playingRef = useRef(false);
  const playheadClockRef = useRef(0);
  const durationRef = useRef(0);
  durationRef.current = duration;

  function getAudioCtx() {
    if (!ctxRef.current) {
      ctxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    return ctxRef.current;
  }

  function ensureAudioEl() {
    if (!audioRef.current) {
      const el = new Audio();
      el.preload = 'auto';
      audioRef.current = el;
    }
    return audioRef.current;
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

  function stopAudioOnly() {
    const el = audioRef.current;
    if (!el) return;
    el.pause();
  }

  function stopAllPlayback() {
    stopSourceOnly();
    stopAudioOnly();
  }

  function applyElementDuration(audioDur) {
    if (!(audioDur > 0) || !Number.isFinite(audioDur)) return;
    setDuration(audioDur);
    setSamples((prev) => {
      if (!prev?.overview?.mins?.length) {
        return prev ? { ...prev, duration: audioDur } : prev;
      }
      return {
        ...prev,
        duration: audioDur,
        overview: alignOverviewToDuration(prev.overview, prev.sampleRate, audioDur),
      };
    });
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
    stopAllPlayback();

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

  useEffect(() => {
    if (!streamUrl) return undefined;

    const ac = new AbortController();
    let cancelled = false;
    let progressTick = 0;

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
          setLoadProgress({
            phase: 'download',
            percent: Math.min(40, Math.round(part * 0.4)),
            partPercent: part,
            detail: t('editor.loadingFile', {
              current: (received / (1024 * 1024)).toFixed(1),
              total: (total / (1024 * 1024)).toFixed(1),
            }),
          });
        } else {
          const part = Math.min(95, 8 + Math.round(Math.log10(received + 1) * 18));
          setLoadProgress({
            phase: 'download',
            percent: Math.min(38, Math.round(part * 0.4)),
            partPercent: part,
            detail: t('editor.loadingFileMb', {
              current: (received / (1024 * 1024)).toFixed(1),
            }),
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

    async function loadClientDecode() {
      modeRef.current = 'webaudio';
      const ctx = getAudioCtx();
      setLoadProgress({
        phase: 'download',
        percent: 2,
        partPercent: 0,
        detail: t('editor.download'),
      });

      const res = await fetch(streamUrl, {
        credentials: 'include',
        cache: 'no-store',
        signal: ac.signal,
      });
      if (!res.ok) throw new Error(t('editor.loadFailedStatus', { status: res.status }));
      const raw = await readBodyWithProgress(res);
      if (cancelled || ac.signal.aborted) return;

      const estMs = Math.min(
        180000,
        Math.max(800, (raw.byteLength / (4 * 1024 * 1024)) * 1000)
      );
      const decodeStarted = performance.now();
      setLoadProgress({
        phase: 'decode',
        percent: 40,
        partPercent: 0,
        detail: t('editor.decode'),
      });
      progressTick = window.setInterval(() => {
        if (cancelled) return;
        const elapsed = performance.now() - decodeStarted;
        const part = Math.min(97, Math.round((1 - Math.exp(-elapsed / estMs)) * 100));
        setLoadProgress({
          phase: 'decode',
          percent: 40 + Math.round(part * 0.15),
          partPercent: part,
          detail: t('editor.decode'),
        });
      }, 120);

      let audio;
      try {
        if (ctx.state === 'suspended') await ctx.resume();
        // decode in place — avoids doubling memory with .slice()
        audio = await ctx.decodeAudioData(raw);
      } finally {
        window.clearInterval(progressTick);
        progressTick = 0;
      }
      if (cancelled || ac.signal.aborted) return;

      bufferRef.current = audio;
      // Same channel data reference as playback buffer → sample-accurate sync
      const data = audio.getChannelData(0);
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
    }

    async function loadServerPeaks() {
      modeRef.current = 'element';
      bufferRef.current = null;
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
        const part = Math.min(97, Math.round((1 - Math.exp(-elapsed / 12000)) * 100));
        setLoadProgress({
          phase: 'peaks',
          percent: Math.min(96, Math.round(part * 0.95)),
          partPercent: part,
          detail: t('editor.buildPeaks', { pct: part }),
        });
      }, 150);

      const data = await api.peaks(path);
      if (cancelled || ac.signal.aborted) return;

      const overview = {
        mins: base64ToFloat32(data.mins),
        maxs: base64ToFloat32(data.maxs),
        bucketSize: data.bucketSize,
        length: data.length,
      };
      const peakDur = Number(data.duration) || 0;
      setDuration(peakDur);
      setSamples({
        data: null,
        sampleRate: data.sampleRate,
        duration: peakDur,
        overview,
      });

      // Align peak timeline to the HTMLAudio clock (browser MP3 duration)
      const el = ensureAudioEl();
      el.src = streamUrl;

      const syncFromElement = () => {
        if (cancelled) return;
        if (el.duration > 0 && Number.isFinite(el.duration)) {
          applyElementDuration(el.duration);
        }
      };
      el.addEventListener('loadedmetadata', syncFromElement);
      el.addEventListener('durationchange', syncFromElement);
      // In case metadata is already there
      syncFromElement();

      // Cleanup listeners when this load generation ends
      ac.signal.addEventListener('abort', () => {
        el.removeEventListener('loadedmetadata', syncFromElement);
        el.removeEventListener('durationchange', syncFromElement);
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
    }

    async function load() {
      stopAllPlayback();
      setPlaying(false);
      playingRef.current = false;
      setWaveLoading(true);
      setWaveError('');
      setSamples(null);
      bufferRef.current = null;

      try {
        let size = 0;
        try {
          const head = await fetch(streamUrl, {
            method: 'HEAD',
            credentials: 'include',
            cache: 'no-store',
            signal: ac.signal,
          });
          size = Number(head.headers.get('content-length')) || 0;
        } catch {
          size = 0;
        }
        if (cancelled || ac.signal.aborted) return;

        if (size > 0 && size <= CLIENT_DECODE_MAX_BYTES) {
          await loadClientDecode();
        } else {
          await loadServerPeaks();
        }
      } catch (err) {
        if (cancelled || ac.signal.aborted || err?.name === 'AbortError') return;
        // If client decode fails (OOM etc.), fall back to server peaks
        if (modeRef.current === 'webaudio') {
          try {
            await loadServerPeaks();
            return;
          } catch (err2) {
            if (cancelled || ac.signal.aborted || err2?.name === 'AbortError') return;
            setWaveError(err2.message || err.message || t('editor.decodeFailed'));
            setSamples(null);
            setLoadProgress({ phase: '', percent: 0, partPercent: 0, detail: '' });
            return;
          }
        }
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
      stopAllPlayback();
    };
  }, [path, streamUrl, t]);

  // Playhead clock
  useEffect(() => {
    if (!playing) return undefined;
    let raf = 0;
    let lastUi = 0;
    function tick(now) {
      if (!playingRef.current) return;

      if (modeRef.current === 'webaudio') {
        const ctx = ctxRef.current;
        const buf = bufferRef.current;
        if (ctx && buf) {
          const { ctxTime, offset } = playOriginRef.current;
          const tNow = offset + (ctx.currentTime - ctxTime);
          if (tNow >= buf.duration) {
            stopSourceOnly();
            playingRef.current = false;
            playheadClockRef.current = buf.duration;
            setPlaying(false);
            setPlayhead(buf.duration);
            setCursor(buf.duration);
          } else {
            playheadClockRef.current = tNow;
            if (now - lastUi > 50) {
              lastUi = now;
              setPlayhead(tNow);
            }
          }
        }
      } else {
        const el = audioRef.current;
        if (el) {
          const tNow = el.currentTime || 0;
          if (el.ended) {
            playingRef.current = false;
            const endT = durationRef.current || tNow;
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
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  async function playFromCursor() {
    if (!duration) return;
    const start = Math.min(Math.max(0, cursor), Math.max(0, duration - 0.02));

    if (modeRef.current === 'webaudio') {
      const ctx = getAudioCtx();
      const buf = bufferRef.current;
      if (!buf) return;
      try {
        if (ctx.state === 'suspended') await ctx.resume();
      } catch (err) {
        setError(err.message || t('editor.audioCtxFailed'));
        return;
      }
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
      return;
    }

    const el = ensureAudioEl();
    try {
      if (el.getAttribute('src') !== streamUrl) el.src = streamUrl;
      if (el.duration > 0) applyElementDuration(el.duration);
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
    let tNow = cursor;
    if (playingRef.current) {
      if (modeRef.current === 'webaudio') {
        const ctx = ctxRef.current;
        if (ctx) {
          const { ctxTime, offset } = playOriginRef.current;
          tNow = Math.min(duration, Math.max(0, offset + (ctx.currentTime - ctxTime)));
        }
      } else if (audioRef.current) {
        tNow = Math.min(duration, Math.max(0, audioRef.current.currentTime || 0));
      }
    }
    stopAllPlayback();
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
      stopAllPlayback();
      bufferRef.current = null;
      const ctx = ctxRef.current;
      ctxRef.current = null;
      if (ctx) ctx.close().catch(() => {});
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

    if (modeRef.current === 'webaudio') {
      if (playingRef.current) {
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
      return;
    }

    const el = audioRef.current;
    if (el) {
      try {
        el.currentTime = next;
      } catch {
        /* ignore */
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
