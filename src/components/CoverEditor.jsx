import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';

const MIN_CROP = 24;
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Cover crop / replace editor (page content — not a modal).
 * Sources: embedded cover, upload, URL, paste/drop, YouTube (via comment).
 */
export default function CoverEditor({ path, bust, hasCover = true, onCancel, onSaved }) {
  const stageRef = useRef(null);
  const imgRef = useRef(null);
  const dragRef = useRef(null);
  const fileInputRef = useRef(null);

  const [src, setSrc] = useState(() => (hasCover ? api.coverUrl(path, bust || Date.now()) : ''));
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [layout, setLayout] = useState({ scale: 1, ox: 0, oy: 0, dw: 0, dh: 0 });
  const [crop, setCrop] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [urlLoading, setUrlLoading] = useState(false);
  const [ytLoading, setYtLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const measure = useCallback(() => {
    const stage = stageRef.current;
    const img = imgRef.current;
    if (!stage || !img?.naturalWidth) return;

    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    const pad = 16;
    const maxW = Math.max(120, stage.clientWidth - pad * 2);
    const maxH = Math.max(120, stage.clientHeight - pad * 2);
    const scale = Math.min(maxW / nw, maxH / nh, 1);
    const dw = nw * scale;
    const dh = nh * scale;
    const ox = (stage.clientWidth - dw) / 2;
    const oy = (stage.clientHeight - dh) / 2;
    setImgSize({ w: nw, h: nh });
    setLayout({ scale, ox, oy, dw, dh });
    setCrop((prev) => {
      if (prev && prev.w > 0 && prev.h > 0) {
        return {
          x: clamp(prev.x, 0, nw - MIN_CROP),
          y: clamp(prev.y, 0, nh - MIN_CROP),
          w: clamp(prev.w, MIN_CROP, nw - clamp(prev.x, 0, nw - MIN_CROP)),
          h: clamp(prev.h, MIN_CROP, nh - clamp(prev.y, 0, nh - MIN_CROP)),
        };
      }
      return { x: 0, y: 0, w: nw, h: nh };
    });
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const ro = new ResizeObserver(() => measure());
    ro.observe(stage);
    return () => ro.disconnect();
  }, [measure]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && !busy) onCancel?.();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  function loadFromDataUrl(dataUrl) {
    setError('');
    setStatus('');
    setLoaded(false);
    setImgSize({ w: 0, h: 0 });
    setCrop(null);
    setSrc(dataUrl);
  }

  function handleFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Datei ist kein Bild');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError('Bild zu groß (max 20MB)');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => loadFromDataUrl(reader.result);
    reader.onerror = () => setError('Datei konnte nicht gelesen werden');
    reader.readAsDataURL(file);
  }

  useEffect(() => {
    function onPaste(e) {
      const item = Array.from(e.clipboardData?.items || []).find((it) => it.type.startsWith('image/'));
      if (!item) return;
      const file = item.getAsFile();
      if (file) handleFile(file);
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  async function loadFromUrl() {
    const url = urlInput.trim();
    if (!url || urlLoading || busy) return;
    setUrlLoading(true);
    setError('');
    try {
      const res = await api.coverFromUrl(url);
      loadFromDataUrl(res.cover.dataUrl);
    } catch (err) {
      setError(err.message || 'Bild konnte nicht von der URL geladen werden');
    } finally {
      setUrlLoading(false);
    }
  }

  async function loadFromYoutube() {
    if (!path || ytLoading || busy) return;
    setYtLoading(true);
    setError('');
    setStatus('Cover von YouTube laden…');
    try {
      const data = await api.ytCover(path);
      const nextBust = Date.now();
      setStatus(`Cover von YT geladen (${data.videoId})`);
      onSaved?.({ path, bust: nextBust, fromYt: true });
    } catch (err) {
      setError(err.message || 'YouTube-Cover fehlgeschlagen');
      setStatus('');
    } finally {
      setYtLoading(false);
    }
  }

  function toNatural(clientX, clientY) {
    const rect = stageRef.current.getBoundingClientRect();
    const x = (clientX - rect.left - layout.ox) / layout.scale;
    const y = (clientY - rect.top - layout.oy) / layout.scale;
    return { x, y };
  }

  function onHandleDown(handle, e) {
    e.preventDefault();
    e.stopPropagation();
    if (!crop || busy) return;
    dragRef.current = { corner: handle, start: { ...crop } };
    stageRef.current?.setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e) {
    const drag = dragRef.current;
    if (!drag || !imgSize.w) return;
    const p = toNatural(e.clientX, e.clientY);
    const { start, corner } = drag;
    let x1 = start.x;
    let y1 = start.y;
    let x2 = start.x + start.w;
    let y2 = start.y + start.h;

    if (corner.includes('w')) x1 = p.x;
    if (corner.includes('e')) x2 = p.x;
    if (corner.includes('n')) y1 = p.y;
    if (corner.includes('s')) y2 = p.y;

    let left = Math.min(x1, x2);
    let right = Math.max(x1, x2);
    let top = Math.min(y1, y2);
    let bottom = Math.max(y1, y2);

    left = clamp(left, 0, imgSize.w - MIN_CROP);
    top = clamp(top, 0, imgSize.h - MIN_CROP);
    right = clamp(right, left + MIN_CROP, imgSize.w);
    bottom = clamp(bottom, top + MIN_CROP, imgSize.h);

    setCrop({ x: left, y: top, w: right - left, h: bottom - top });
  }

  function onPointerUp(e) {
    if (!dragRef.current) return;
    try {
      stageRef.current?.releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
    dragRef.current = null;
  }

  function resetCrop() {
    if (!imgSize.w) return;
    setCrop({ x: 0, y: 0, w: imgSize.w, h: imgSize.h });
  }

  async function saveCrop() {
    const img = imgRef.current;
    if (!img || !crop || busy) return;
    setBusy(true);
    setError('');
    try {
      const sx = Math.round(crop.x);
      const sy = Math.round(crop.y);
      const sw = Math.max(1, Math.round(crop.w));
      const sh = Math.max(1, Math.round(crop.h));
      const canvas = document.createElement('canvas');
      canvas.width = sw;
      canvas.height = sh;
      const g = canvas.getContext('2d');
      g.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
      await api.saveCover(path, dataUrl);
      onSaved?.({ path, bust: Date.now() });
    } catch (err) {
      setError(err.message || 'Cover speichern fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }

  const cropChanged =
    crop &&
    imgSize.w > 0 &&
    (crop.x > 0.5 || crop.y > 0.5 || crop.w < imgSize.w - 0.5 || crop.h < imgSize.h - 0.5);

  const cropStyle =
    crop && layout.scale
      ? {
          left: layout.ox + crop.x * layout.scale,
          top: layout.oy + crop.y * layout.scale,
          width: crop.w * layout.scale,
          height: crop.h * layout.scale,
        }
      : null;

  const blocked = busy || urlLoading || ytLoading;

  return (
    <div className="cover-editor">
      <div className="cover-editor-sources">
        <button
          type="button"
          className="btn secondary"
          onClick={() => fileInputRef.current?.click()}
          disabled={blocked}
        >
          Bild hochladen
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            handleFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          className="btn secondary"
          onClick={loadFromYoutube}
          disabled={blocked}
          title="Cover aus YouTube-URL im Comment-Feld laden"
        >
          {ytLoading ? 'YT lädt…' : 'Cover von YT'}
        </button>
        <form
          className="cover-url-form"
          onSubmit={(e) => {
            e.preventDefault();
            loadFromUrl();
          }}
        >
          <input
            type="url"
            inputMode="url"
            placeholder="Bild-URL einfügen…"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            disabled={blocked}
          />
          <button type="submit" className="btn secondary" disabled={blocked || !urlInput.trim()}>
            {urlLoading ? 'Lädt…' : 'Von URL'}
          </button>
        </form>
        <span className="muted small">Ziehen / Einfügen (Strg+V)</span>
      </div>

      <div
        className={`cover-editor-stage${dragOver ? ' drag-over' : ''}`}
        ref={stageRef}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDragOver={(e) => {
          e.preventDefault();
          if (!blocked) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (blocked) return;
          const file = e.dataTransfer?.files?.[0];
          if (file) handleFile(file);
        }}
      >
        {!src && (
          <div className="cover-editor-empty">
            <p>Kein Bild geladen</p>
            <p className="muted small">Hochladen, YT, URL oder hierher ziehen</p>
          </div>
        )}

        {src && !loaded && (
          <div className="cover-editor-loading">
            <span className="spinner" />
            <span className="muted">Bild laden…</span>
          </div>
        )}

        {src && (
          <img
            ref={imgRef}
            className="cover-editor-img"
            src={src}
            alt=""
            draggable={false}
            style={{
              width: layout.dw || undefined,
              height: layout.dh || undefined,
              left: layout.ox,
              top: layout.oy,
              opacity: loaded ? 1 : 0,
            }}
            onLoad={() => {
              setLoaded(true);
              measure();
            }}
            onError={() => {
              setLoaded(true);
              setError('Bild konnte nicht geladen werden');
            }}
          />
        )}

        {loaded && cropStyle && (
          <div className="cover-crop" style={cropStyle}>
            {['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((handle) => (
              <button
                key={handle}
                type="button"
                className={`cover-handle cover-handle-${handle}`}
                aria-label={`Griff ${handle}`}
                onPointerDown={(e) => onHandleDown(handle, e)}
              />
            ))}
          </div>
        )}

        {dragOver && (
          <div className="cover-editor-drophint">
            <p>Bild hier ablegen</p>
          </div>
        )}
      </div>

      <footer className="cover-editor-foot">
        <p className="muted small">
          An Ecken und Seitenmitten ziehen zum Zuschneiden
          {imgSize.w ? ` · ${imgSize.w}×${imgSize.h}px` : ''}
          {cropChanged && crop ? ` → ${Math.round(crop.w)}×${Math.round(crop.h)}px` : ''}
        </p>
        {status && <p className="ok small">{status}</p>}
        {error && <p className="error small">{error}</p>}
        <div className="cover-editor-actions">
          <button type="button" className="btn ghost" onClick={resetCrop} disabled={blocked || !cropChanged}>
            Reset
          </button>
          <button type="button" className="btn secondary" onClick={onCancel} disabled={busy}>
            Zurück
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={saveCrop}
            disabled={blocked || !loaded || !crop}
          >
            {busy ? 'Speichern…' : 'Crop speichern'}
          </button>
        </div>
      </footer>
    </div>
  );
}
