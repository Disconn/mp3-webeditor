import { useEffect, useState } from 'react';
import { api } from '../api';
import TopBar from '../components/TopBar';
import { useAuth } from '../auth';

export default function SettingsPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState([]);
  const [roots, setRoots] = useState([]);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newUser, setNewUser] = useState('');
  const [newUserPass, setNewUserPass] = useState('');
  const [cacheEntries, setCacheEntries] = useState(0);
  const [cacheCovers, setCacheCovers] = useState(0);
  const [defaultWaveZoom, setDefaultWaveZoom] = useState(1);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await api.settings();
      setUsers(data.users || []);
      setRoots(
        (data.audioRoots || []).map((r) => ({
          id: r.id,
          label: r.label,
          path: r.path,
        }))
      );
      const stats = await api.cacheStats().catch(() => ({ entries: 0, covers: 0 }));
      setCacheEntries(stats.entries || 0);
      setCacheCovers(stats.covers || 0);
      setDefaultWaveZoom(Number(data.defaultWaveZoom) || 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function onChangePassword(e) {
    e.preventDefault();
    setError('');
    setStatus('');
    try {
      await api.changePassword(currentPassword, newPassword);
      setStatus('Passwort geändert');
      setCurrentPassword('');
      setNewPassword('');
    } catch (err) {
      setError(err.message);
    }
  }

  async function onAddUser(e) {
    e.preventDefault();
    setError('');
    setStatus('');
    try {
      await api.addUser(newUser, newUserPass);
      setStatus(`Benutzer ${newUser} angelegt`);
      setNewUser('');
      setNewUserPass('');
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function onDeleteUser(username) {
    if (!confirm(`Benutzer „${username}“ löschen?`)) return;
    setError('');
    setStatus('');
    try {
      await api.removeUser(username);
      setStatus(`Benutzer ${username} gelöscht`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  function updateRoot(i, patch) {
    setRoots((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function addRoot() {
    setRoots((prev) => [...prev, { id: '', label: '', path: '' }]);
  }

  function removeRoot(i) {
    setRoots((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function onSaveRoots(e) {
    e?.preventDefault?.();
    setError('');
    setStatus('');

    const cleaned = roots.map((r, i) => ({
      ...r,
      label: String(r.label || '').trim(),
      path: String(r.path || '')
        .trim()
        .replace(/^["']|["']$/g, ''),
      id: String(r.id || '').trim(),
      _row: i + 1,
    }));

    for (const r of cleaned) {
      if (!r.label) {
        setError(`Label fehlt in Zeile ${r._row}`);
        return;
      }
      if (!r.path) {
        setError(`Pfad fehlt in Zeile ${r._row}`);
        return;
      }
    }

    try {
      const data = await api.saveRoots(
        cleaned.map(({ label, path, id }) => ({ label, path, id }))
      );
      setRoots(data.audioRoots || []);
      setStatus('Audio-Verzeichnisse gespeichert');
    } catch (err) {
      setError(err.message || 'Speichern fehlgeschlagen');
    }
  }

  return (
    <div className="app-shell">
      <TopBar subtitle={`Settings · ${user?.username || ''}`} />

      <main className="settings-page">
        {(status || error) && (
          <div className="status-row">
            {status && <p className="ok">{status}</p>}
            {error && <p className="error">{error}</p>}
          </div>
        )}

        {loading ? (
          <p className="muted">Laden…</p>
        ) : (
          <div className="settings-grid">
            <section className="settings-card">
              <h2>Passwort ändern</h2>
              <form className="stack-form" onSubmit={onChangePassword}>
                <label>
                  Aktuelles Passwort
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    required
                  />
                </label>
                <label>
                  Neues Passwort
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    minLength={3}
                  />
                </label>
                <button type="submit" className="btn primary">
                  Speichern
                </button>
              </form>
            </section>

            <section className="settings-card">
              <h2>Benutzer</h2>
              <ul className="user-list">
                {users.map((u) => (
                  <li key={u.username}>
                    <span>{u.username}</span>
                    {u.username !== user?.username && (
                      <button
                        type="button"
                        className="btn ghost tiny"
                        onClick={() => onDeleteUser(u.username)}
                      >
                        Löschen
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <form className="stack-form" onSubmit={onAddUser}>
                <label>
                  Neuer Benutzer
                  <input
                    value={newUser}
                    onChange={(e) => setNewUser(e.target.value)}
                    required
                    autoComplete="off"
                  />
                </label>
                <label>
                  Passwort
                  <input
                    type="password"
                    value={newUserPass}
                    onChange={(e) => setNewUserPass(e.target.value)}
                    required
                    minLength={3}
                  />
                </label>
                <button type="submit" className="btn secondary">
                  Benutzer hinzufügen
                </button>
              </form>
            </section>

            <section className="settings-card span-all">
              <div className="card-head">
                <h2>Audio-Verzeichnisse</h2>
                <button type="button" className="btn ghost" onClick={addRoot}>
                  + Verzeichnis
                </button>
              </div>
              <p className="muted small">
                Absolute Pfade zum Stammverzeichnis der MP3s. Mehrere Roots möglich.
              </p>
              <form className="roots-form" onSubmit={onSaveRoots}>
                {roots.map((root, i) => (
                  <div className="root-row" key={i}>
                    <label>
                      Label
                      <input
                        value={root.label}
                        onChange={(e) => updateRoot(i, { label: e.target.value })}
                        placeholder="z.B. Musik"
                        required
                      />
                    </label>
                    <label className="grow">
                      Pfad
                      <input
                        value={root.path}
                        onChange={(e) => updateRoot(i, { path: e.target.value })}
                        placeholder="E:/Audio"
                        required
                      />
                    </label>
                    <label>
                      ID
                      <input
                        value={root.id}
                        onChange={(e) => updateRoot(i, { id: e.target.value })}
                        placeholder="auto"
                      />
                    </label>
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => removeRoot(i)}
                      disabled={roots.length <= 1}
                    >
                      Entfernen
                    </button>
                  </div>
                ))}
                <button type="button" className="btn primary" onClick={onSaveRoots}>
                  Verzeichnisse speichern
                </button>
              </form>
            </section>

            <section className="settings-card">
              <h2>Crop-Editor</h2>
              <p className="muted small">Standard-Zoom der Wellenform beim Öffnen einer Datei (1–16×).</p>
              <label>
                Default-Zoom
                <div className="slider-row">
                  <input
                    type="range"
                    min={1}
                    max={16}
                    step={1}
                    value={defaultWaveZoom}
                    onChange={(e) => setDefaultWaveZoom(Number(e.target.value))}
                  />
                  <input
                    className="num"
                    type="number"
                    min={1}
                    max={16}
                    step={1}
                    value={defaultWaveZoom}
                    onChange={(e) =>
                      setDefaultWaveZoom(Math.min(16, Math.max(1, Number(e.target.value) || 1)))
                    }
                  />
                  <span className="unit">×</span>
                </div>
              </label>
              <button
                type="button"
                className="btn primary"
                onClick={async () => {
                  setError('');
                  setStatus('');
                  try {
                    const data = await api.saveWaveZoom(defaultWaveZoom);
                    setDefaultWaveZoom(data.defaultWaveZoom);
                    setStatus(`Default-Zoom auf ${data.defaultWaveZoom}× gesetzt`);
                  } catch (err) {
                    setError(err.message);
                  }
                }}
              >
                Zoom speichern
              </button>
            </section>

            <section className="settings-card">
              <h2>Datei-Cache</h2>
              <p className="muted small">
                Tags und Cover werden nach mtime/Größe gecacht. Externe Dateiänderungen werden
                beim nächsten Laden erkannt.
              </p>
              <p>
                Tags: <strong>{cacheEntries}</strong>
                {' · '}
                Cover: <strong>{cacheCovers}</strong>
              </p>
              <button
                type="button"
                className="btn secondary"
                onClick={async () => {
                  setError('');
                  setStatus('');
                  try {
                    const data = await api.clearCache();
                    setCacheEntries(data.entries || 0);
                    setCacheCovers(data.covers || 0);
                    setStatus('Cache geleert');
                  } catch (err) {
                    setError(err.message);
                  }
                }}
              >
                Cache leeren
              </button>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
