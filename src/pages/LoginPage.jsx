import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { useT } from '../i18n/I18nProvider';
import logoUrl from '../assets/logo.svg';

export default function LoginPage() {
  const { user, login } = useAuth();
  const t = useT();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(username, password);
    } catch (err) {
      setError(err.message || t('login.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-shell">
      <div className="login-glow" aria-hidden />
      <form className="login-card" onSubmit={onSubmit}>
        <img className="login-logo" src={logoUrl} alt="MP3 WebEditor" width="56" height="56" />
        <p className="brand">MP3 WebEditor</p>
        <h1>{t('login.title')}</h1>
        <p className="muted">{t('login.subtitle')}</p>

        <label>
          {t('login.user')}
          <input
            autoFocus
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </label>
        <label>
          {t('login.password')}
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        {error && <p className="error">{error}</p>}

        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? t('login.checking') : t('login.submit')}
        </button>
      </form>
    </div>
  );
}
