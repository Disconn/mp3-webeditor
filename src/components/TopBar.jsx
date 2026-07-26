import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../auth';

export default function TopBar({ subtitle }) {
  const { user, logout } = useAuth();
  const loc = useLocation();

  return (
    <header className="topbar">
      <div>
        <p className="brand">MP3 WebEditor</p>
        {subtitle && <p className="muted small">{subtitle}</p>}
      </div>
      <nav className="topbar-actions">
        <Link className={`btn ghost${loc.pathname === '/' ? ' nav-active' : ''}`} to="/">
          Bibliothek
        </Link>
        <Link
          className={`btn ghost${loc.pathname === '/settings' ? ' nav-active' : ''}`}
          to="/settings"
        >
          Settings
        </Link>
        <span className="user-pill">{user?.username}</span>
        <button type="button" className="btn ghost" onClick={logout}>
          Logout
        </button>
      </nav>
    </header>
  );
}
