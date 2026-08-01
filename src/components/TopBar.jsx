import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../auth';
import { useT } from '../i18n/I18nProvider';
import { useTheme } from '../theme/ThemeProvider';
import logoUrl from '../assets/logo.svg';

function UserAvatar({ name }) {
  const initials = useMemo(() => {
    const raw = String(name || '?').trim();
    if (!raw) return '?';
    const parts = raw.split(/[\s._-]+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
    }
    return raw.slice(0, 2).toUpperCase();
  }, [name]);

  const hue = useMemo(() => {
    let hash = 0;
    for (const ch of String(name || '')) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    return hash % 360;
  }, [name]);

  return (
    <span
      className="user-avatar"
      style={{ background: `hsl(${hue} 42% 36%)` }}
      aria-hidden
    >
      {initials}
    </span>
  );
}

export default function TopBar({ subtitle }) {
  const { user, logout } = useAuth();
  const loc = useLocation();
  const t = useT();
  const { theme, setTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return undefined;

    function onPointerDown(e) {
      if (!menuRef.current?.contains(e.target)) setMenuOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') setMenuOpen(false);
    }

    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

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

      <div className="topbar-right" ref={menuRef}>
        <button
          type="button"
          className={`user-menu-trigger${menuOpen ? ' open' : ''}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <UserAvatar name={user?.username} />
          <span className="user-menu-name">{user?.username}</span>
          <span className="user-menu-caret" aria-hidden>
            ▾
          </span>
        </button>

        {menuOpen && (
          <div className="user-menu" role="menu">
            <div className="user-menu-section">
              <p className="user-menu-label">{t('nav.theme')}</p>
              <div className="theme-toggle" role="group" aria-label={t('nav.theme')}>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={theme === 'light'}
                  className={`theme-option${theme === 'light' ? ' active' : ''}`}
                  onClick={() => setTheme('light')}
                >
                  {t('nav.themeLight')}
                </button>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={theme === 'dark'}
                  className={`theme-option${theme === 'dark' ? ' active' : ''}`}
                  onClick={() => setTheme('dark')}
                >
                  {t('nav.themeDark')}
                </button>
              </div>
            </div>
            <div className="user-menu-divider" />
            <button
              type="button"
              className="user-menu-item danger"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                logout();
              }}
            >
              {t('nav.logout')}
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
