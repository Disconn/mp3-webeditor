import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { normalizeLanguage, translate } from './messages';

const STORAGE_KEY = 'mp3we-uiLanguage';

const I18nContext = createContext({
  language: 'de',
  setLanguage: async () => {},
  t: (key) => key,
});

function readStoredLanguage() {
  try {
    return normalizeLanguage(localStorage.getItem(STORAGE_KEY));
  } catch {
    return 'de';
  }
}

export function I18nProvider({ children }) {
  const { user } = useAuth();
  const [language, setLanguageState] = useState(readStoredLanguage);

  useEffect(() => {
    document.documentElement.lang = language;
    try {
      localStorage.setItem(STORAGE_KEY, language);
    } catch {
      /* ignore */
    }
  }, [language]);

  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const settings = await api.settings();
        if (cancelled) return;
        if (settings.uiLanguage === 'en' || settings.uiLanguage === 'de') {
          setLanguageState(settings.uiLanguage);
        }
      } catch {
        /* keep local language */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const setLanguage = useCallback(async (next, { persist = false } = {}) => {
    const lang = normalizeLanguage(next);
    setLanguageState(lang);
    if (persist) {
      const data = await api.saveLanguage(lang);
      setLanguageState(normalizeLanguage(data.uiLanguage));
      return data.uiLanguage;
    }
    return lang;
  }, []);

  const t = useCallback((key, vars) => translate(language, key, vars), [language]);

  const value = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}

export function useT() {
  return useI18n().t;
}
