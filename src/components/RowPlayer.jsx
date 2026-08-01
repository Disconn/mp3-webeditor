import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useT } from '../i18n/I18nProvider';

const claimListeners = new Set();

function claimPlayback(id) {
  for (const fn of claimListeners) fn(id);
}

function unloadAudio(audio) {
  if (!audio) return;
  audio.pause();
  audio.removeAttribute('src');
  // Abort network + release decoded buffer
  try {
    audio.load();
  } catch {
    /* ignore */
  }
}

function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Compact per-row MP3 player. Only one row plays at a time;
 * inactive players unload their media to free memory.
 */
export default function RowPlayer({ path }) {
  const t = useT();
  const audioRef = useRef(null);
  const idRef = useRef(`player-${path}`);
  const streamUrl = api.streamUrl(path);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.85);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    idRef.current = `player-${path}`;
  }, [path]);

  useEffect(() => {
    const id = idRef.current;
    function onClaim(activeId) {
      if (activeId === id) return;
      const audio = audioRef.current;
      if (!audio) return;
      unloadAudio(audio);
      setPlaying(false);
      setCurrent(0);
      setDuration(0);
      setReady(false);
    }
    claimListeners.add(onClaim);
    return () => {
      claimListeners.delete(onClaim);
      unloadAudio(audioRef.current);
    };
  }, [path]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.volume = volume;
  }, [volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;

    function onTime() {
      setCurrent(audio.currentTime || 0);
    }
    function onMeta() {
      setDuration(audio.duration || 0);
      setReady(true);
    }
    function onEnded() {
      setPlaying(false);
      setCurrent(0);
      unloadAudio(audio);
      setDuration(0);
      setReady(false);
    }
    function onPlay() {
      setPlaying(true);
    }
    function onPause() {
      setPlaying(false);
    }

    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('durationchange', onMeta);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('durationchange', onMeta);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
    };
  }, [path]);

  async function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      return;
    }
    claimPlayback(idRef.current);
    if (audio.getAttribute('src') !== streamUrl) {
      audio.src = streamUrl;
    }
    try {
      await audio.play();
    } catch {
      setPlaying(false);
    }
  }

  function stop() {
    const audio = audioRef.current;
    if (!audio) return;
    unloadAudio(audio);
    setCurrent(0);
    setDuration(0);
    setReady(false);
    setPlaying(false);
  }

  return (
    <div className="row-player" onClick={(e) => e.stopPropagation()}>
      <audio ref={audioRef} preload="none" />
      <button
        type="button"
        className="btn ghost tiny row-player-btn"
        onClick={togglePlay}
        title={playing ? t('player.pause') : t('player.play')}
        aria-label={playing ? t('player.pause') : t('player.play')}
      >
        {playing ? '❚❚' : '▶'}
      </button>
      <button
        type="button"
        className="btn ghost tiny row-player-btn"
        onClick={stop}
        title={t('player.stop')}
        aria-label={t('player.stop')}
        disabled={!playing && current === 0 && !ready}
      >
        ■
      </button>
      <input
        className="row-player-vol"
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={volume}
        onChange={(e) => setVolume(Number(e.target.value))}
        title={t('player.volume')}
        aria-label={t('player.volume')}
      />
      <span className="row-player-time mono small">
        {formatTime(current)}/{ready ? formatTime(duration) : '—:——'}
      </span>
    </div>
  );
}
