import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../auth';
import { useT } from '../i18n/I18nProvider';
import logoUrl from '../assets/logo.svg';

export default function TopBar({ subtitle }) {
  const { user, logout } = useAuth();
  const loc = useLocation();
  const t = useT();

  return (
    <header className="topbar">
      <Link className="brand-row" to="/" title={t('nav.toLibrary')}>
        <img className="brand-logo" src={logoUrl} alt="" width="28" height="28" />
        <div>
          <p className="brand">MP3 WebEditor</p>
          {subtitle && <p className="muted small">{subtitle}</p>}
        </div>
      </Link>
      <nav className="topbar-actions">
        <Link className={`btn ghost${loc.pathname === '/' ? ' nav-active' : ''}`} to="/">
          {t('nav.library')}
        </Link>
        <Link
          className={`btn ghost${loc.pathname === '/settings' ? ' nav-active' : ''}`}
          to="/settings"
        >
          {t('nav.settings')}
        </Link>
        <span className="user-pill">{user?.username}</span>
        <button type="button" className="btn ghost" onClick={logout}>
          {t('nav.logout')}
        </button>
      </nav>
    </header>
  );
}
