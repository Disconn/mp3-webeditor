import { useEffect, useState } from 'react';

function formatDuration(sec) {
  if (!Number.isFinite(sec)) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function TagForm({ fields, initialTags, cover, format, streamUrl, onSave, onOpenCover }) {
  const [tags, setTags] = useState(initialTags || {});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTags(initialTags || {});
    setDirty(false);
  }, [initialTags]);

  function setField(key, value) {
    setTags((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(tags);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="tag-form" onSubmit={submit}>
      <div className="tag-meta">
        <div className="cover-box">
          {cover?.dataUrl ? (
            <button
              type="button"
              className="cover-box-btn"
              title="Cover öffnen / croppen"
              onClick={onOpenCover}
            >
              <img src={cover.dataUrl} alt="Cover" />
            </button>
          ) : (
            <button type="button" className="cover-box-btn" title="Cover hinzufügen" onClick={onOpenCover}>
              <div className="cover-empty">Kein Cover</div>
            </button>
          )}
        </div>
        <div className="meta-stats">
          <div>
            <span className="muted">Dauer</span>
            <strong>{formatDuration(format?.duration)}</strong>
          </div>
          <div>
            <span className="muted">Bitrate</span>
            <strong>{format?.bitrate ? `${Math.round(format.bitrate / 1000)} kbps` : '—'}</strong>
          </div>
          <div>
            <span className="muted">Sample Rate</span>
            <strong>{format?.sampleRate ? `${format.sampleRate} Hz` : '—'}</strong>
          </div>
          {streamUrl && (
            <audio className="inline-audio" controls src={streamUrl} preload="none" />
          )}
        </div>
      </div>

      <div className="tag-grid">
        {(fields || []).map((field) => (
          <label key={field.key} className={field.multiline ? 'span-2' : undefined}>
            <span>
              {field.label}
              <span className="frame-id">{field.frame}</span>
            </span>
            {field.multiline ? (
              <textarea
                rows={field.key === 'unsynchronisedLyrics' ? 6 : 3}
                value={tags[field.key] ?? ''}
                onChange={(e) => setField(field.key, e.target.value)}
              />
            ) : (
              <input
                value={tags[field.key] ?? ''}
                onChange={(e) => setField(field.key, e.target.value)}
              />
            )}
          </label>
        ))}
      </div>

      <div className="form-footer">
        <p className="muted small">
          Comment enthält idealerweise die YouTube-URL für „Cover von YT“.
        </p>
        <button type="submit" className="btn primary" disabled={!dirty || saving}>
          {saving ? 'Speichern…' : dirty ? 'Tags speichern' : 'Gespeichert'}
        </button>
      </div>
    </form>
  );
}
