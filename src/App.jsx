import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { useT } from './i18n/I18nProvider';
import LoginPage from './pages/LoginPage';
import LibraryPage from './pages/LibraryPage';
import EditorPage from './pages/EditorPage';
import CoverPage from './pages/CoverPage';
import SettingsPage from './pages/SettingsPage';

function Protected({ children }) {
  const { user, loading } = useAuth();
  const t = useT();
  if (loading) {
    return (
      <div className="boot">
        <div className="boot-spinner" />
        <p>{t('app.loading')}</p>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <Protected>
            <LibraryPage />
          </Protected>
        }
      />
      <Route
        path="/editor"
        element={
          <Protected>
            <EditorPage />
          </Protected>
        }
      />
      <Route
        path="/cover"
        element={
          <Protected>
            <CoverPage />
          </Protected>
        }
      />
      <Route
        path="/settings"
        element={
          <Protected>
            <SettingsPage />
          </Protected>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
