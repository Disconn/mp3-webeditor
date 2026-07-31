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
      <div className="topbar-left">
        <Link className="brand-row" to="/" title={t('nav.toLibrary')}>
          <img className="brand-logo" src={logoUrl} alt="" width="22" height="22" />
          <p className="brand">
            MP3 WebEditor
            {subtitle ? <span className="brand-sub"> · {subtitle}</span> : null}
          </p>
        </Link>
        <nav className="topbar-nav">
          <Link className={`btn ghost tiny${loc.pathname === '/' ? ' nav-active' : ''}`} to="/">
            {t('nav.library')}
          </Link>
          <Link
            className={`btn ghost tiny${loc.pathname === '/settings' ? ' nav-active' : ''}`}
            to="/settings"
          >
            {t('nav.settings')}
          </Link>
        </nav>
      </div>
      <div className="topbar-right">
        <span className="user-pill">{user?.username}</span>
        <button type="button" className="btn ghost tiny" onClick={logout}>
          {t('nav.logout')}
        </button>
      </div>
    </header>
  );
}
