import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';

const STORAGE_KEY = 'mp3we-uiTheme';

const ThemeContext = createContext({
  theme: 'dark',
  setTheme: async () => {},
});

export function normalizeTheme(value) {
  return value === 'light' ? 'light' : 'dark';
}

function readStoredTheme() {
  try {
    return normalizeTheme(localStorage.getItem(STORAGE_KEY));
  } catch {
    return 'dark';
  }
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.style.colorScheme = theme;
}

export function ThemeProvider({ children }) {
  const { user } = useAuth();
  const [theme, setThemeState] = useState(readStoredTheme);

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const settings = await api.settings();
        if (cancelled) return;
        if (settings.uiTheme === 'light' || settings.uiTheme === 'dark') {
          setThemeState(settings.uiTheme);
        }
      } catch {
        /* keep local theme */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const setTheme = useCallback(async (next, { persist = true } = {}) => {
    const value = normalizeTheme(next);
    setThemeState(value);
    if (persist && user) {
      try {
        const data = await api.saveTheme(value);
        setThemeState(normalizeTheme(data.uiTheme));
        return data.uiTheme;
      } catch {
        return value;
      }
    }
    return value;
  }, [user]);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
