import { useEffect, useState } from 'react';
import { api } from '../api';
import TopBar from '../components/TopBar';
import { useAuth } from '../auth';
import { useI18n, useT } from '../i18n/I18nProvider';
import { LOCALES, translate } from '../i18n/messages';

export default function SettingsPage() {
  const { user } = useAuth();
  const t = useT();
  const { language, setLanguage } = useI18n();
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
  const [draftLanguage, setDraftLanguage] = useState(language);

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
      if (data.uiLanguage === 'en' || data.uiLanguage === 'de') {
        setDraftLanguage(data.uiLanguage);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    setDraftLanguage(language);
  }, [language]);

  async function onChangePassword(e) {
    e.preventDefault();
    setError('');
    setStatus('');
    try {
      await api.changePassword(currentPassword, newPassword);
      setStatus(t('settings.passwordChanged'));
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
      setStatus(t('settings.userCreated', { user: newUser }));
      setNewUser('');
      setNewUserPass('');
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function onDeleteUser(username) {
    if (!confirm(t('settings.deleteConfirm', { user: username }))) return;
    setError('');
    setStatus('');
    try {
      await api.removeUser(username);
      setStatus(t('settings.userDeleted', { user: username }));
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
        setError(t('settings.labelMissing', { row: r._row }));
        return;
      }
      if (!r.path) {
        setError(t('settings.pathMissing', { row: r._row }));
        return;
      }
    }

    try {
      const data = await api.saveRoots(
        cleaned.map(({ label, path, id }) => ({ label, path, id }))
      );
      setRoots(data.audioRoots || []);
      setStatus(t('settings.rootsSaved'));
    } catch (err) {
      setError(err.message || t('settings.saveFailed'));
    }
  }

  async function onSaveLanguage() {
    setError('');
    setStatus('');
    try {
      await setLanguage(draftLanguage, { persist: true });
      setStatus(translate(draftLanguage, 'settings.languageSaved'));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="app-shell">
      <TopBar subtitle={t('settings.subtitle', { user: user?.username || '' })} />

      <main className="settings-page">
        {(status || error) && (
          <div className="status-row">
            {status && <p className="ok">{status}</p>}
            {error && <p className="error">{error}</p>}
          </div>
        )}

        {loading ? (
          <p className="muted">{t('app.loading')}</p>
        ) : (
          <div className="settings-grid">
            <section className="settings-card">
              <h2>{t('settings.language')}</h2>
              <p className="muted small">{t('settings.languageHint')}</p>
              <div className="lang-options">
                {LOCALES.map((loc) => (
                  <label key={loc.code} className="check">
                    <input
                      type="radio"
                      name="uiLanguage"
                      checked={draftLanguage === loc.code}
                      onChange={() => setDraftLanguage(loc.code)}
                    />
                    {t(loc.labelKey)}
                  </label>
                ))}
              </div>
              <button
                type="button"
                className="btn primary"
                onClick={onSaveLanguage}
                disabled={draftLanguage === language}
              >
                {t('settings.saveLanguage')}
              </button>
            </section>

            <section className="settings-card">
              <h2>{t('settings.password')}</h2>
              <form className="stack-form" onSubmit={onChangePassword}>
                <label>
                  {t('settings.currentPassword')}
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    required
                  />
                </label>
                <label>
                  {t('settings.newPassword')}
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    minLength={3}
                  />
                </label>
                <button type="submit" className="btn primary">
                  {t('settings.save')}
                </button>
              </form>
            </section>

            <section className="settings-card">
              <h2>{t('settings.users')}</h2>
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
                        {t('settings.delete')}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <form className="stack-form" onSubmit={onAddUser}>
                <label>
                  {t('settings.newUser')}
                  <input
                    value={newUser}
                    onChange={(e) => setNewUser(e.target.value)}
                    required
                    autoComplete="off"
                  />
                </label>
                <label>
                  {t('settings.passwordLabel')}
                  <input
                    type="password"
                    value={newUserPass}
                    onChange={(e) => setNewUserPass(e.target.value)}
                    required
                    minLength={3}
                  />
                </label>
                <button type="submit" className="btn secondary">
                  {t('settings.addUser')}
                </button>
              </form>
            </section>

            <section className="settings-card span-all">
              <div className="card-head">
                <h2>{t('settings.roots')}</h2>
                <button type="button" className="btn ghost" onClick={addRoot}>
                  {t('settings.addRoot')}
                </button>
              </div>
              <p className="muted small">{t('settings.rootsHint')}</p>
              <form className="roots-form" onSubmit={onSaveRoots}>
                {roots.map((root, i) => (
                  <div className="root-row" key={i}>
                    <label>
                      {t('settings.label')}
                      <input
                        value={root.label}
                        onChange={(e) => updateRoot(i, { label: e.target.value })}
                        placeholder={t('settings.labelPlaceholder')}
                        required
                      />
                    </label>
                    <label className="grow">
                      {t('settings.path')}
                      <input
                        value={root.path}
                        onChange={(e) => updateRoot(i, { path: e.target.value })}
                        placeholder="E:/Audio"
                        required
                      />
                    </label>
                    <label>
                      {t('settings.id')}
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
                      {t('settings.remove')}
                    </button>
                  </div>
                ))}
                <button type="button" className="btn primary" onClick={onSaveRoots}>
                  {t('settings.saveRoots')}
                </button>
              </form>
            </section>

            <section className="settings-card">
              <h2>{t('settings.cropEditor')}</h2>
              <p className="muted small">{t('settings.zoomHint')}</p>
              <label>
                {t('settings.defaultZoom')}
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
                    setStatus(t('settings.zoomSaved', { zoom: data.defaultWaveZoom }));
                  } catch (err) {
                    setError(err.message);
                  }
                }}
              >
                {t('settings.saveZoom')}
              </button>
            </section>

            <section className="settings-card">
              <h2>{t('settings.cache')}</h2>
              <p className="muted small">{t('settings.cacheHint')}</p>
              <p>
                {t('settings.cacheTags')}: <strong>{cacheEntries}</strong>
                {' · '}
                {t('settings.cacheCovers')}: <strong>{cacheCovers}</strong>
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
                    setStatus(t('settings.cacheCleared'));
                  } catch (err) {
                    setError(err.message);
                  }
                }}
              >
                {t('settings.clearCache')}
              </button>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
