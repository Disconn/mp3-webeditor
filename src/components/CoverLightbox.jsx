import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';

const MIN_CROP = 24;

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Lightbox to view + crop album art via four corner handles.
 * Crop rect is in natural image pixels; display maps via scale/offset.
 */
export default function CoverLightbox({ path, bust, fileName, onClose, onSaved }) {
  const stageRef = useRef(null);
  const imgRef = useRef(null);
  const dragRef = useRef(null);

  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [layout, setLayout] = useState({ scale: 1, ox: 0, oy: 0, dw: 0, dh: 0 });
  const [crop, setCrop] = useState(null); // { x, y, w, h } natural px
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  const src = api.coverUrl(path, bust || Date.now());

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
      if (e.key === 'Escape' && !busy) onClose?.();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

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
    dragRef.current = {
      corner: handle,
      start: { ...crop },
    };
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

    setCrop({
      x: left,
      y: top,
      w: right - left,
      h: bottom - top,
    });
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
      onClose?.();
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

  return (
    <div
      className="cover-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="Cover bearbeiten"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose?.();
      }}
    >
      <div className="cover-lightbox-panel" onMouseDown={(e) => e.stopPropagation()}>
        <header className="cover-lightbox-head">
          <div>
            <h2>Cover</h2>
            <p className="muted small mono">{fileName || path}</p>
          </div>
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
            Schließen
          </button>
        </header>

        <div
          className="cover-lightbox-stage"
          ref={stageRef}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {!loaded && (
            <div className="cover-lightbox-loading">
              <span className="spinner" />
              <span className="muted">Cover laden…</span>
            </div>
          )}
          <img
            ref={imgRef}
            className="cover-lightbox-img"
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
              setError('Cover konnte nicht geladen werden');
            }}
          />

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
        </div>

        <footer className="cover-lightbox-foot">
          <p className="muted small">
            An Ecken und Seitenmitten ziehen zum Zuschneiden
            {imgSize.w ? ` · ${imgSize.w}×${imgSize.h}px` : ''}
            {cropChanged && crop
              ? ` → ${Math.round(crop.w)}×${Math.round(crop.h)}px`
              : ''}
          </p>
          {error && <p className="error small">{error}</p>}
          <div className="cover-lightbox-actions">
            <button type="button" className="btn ghost" onClick={resetCrop} disabled={busy || !cropChanged}>
              Reset
            </button>
            <button type="button" className="btn secondary" onClick={onClose} disabled={busy}>
              Abbrechen
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={saveCrop}
              disabled={busy || !loaded || !crop}
            >
              {busy ? 'Speichern…' : 'Crop speichern'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
