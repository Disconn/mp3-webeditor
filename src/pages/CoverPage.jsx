import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import TopBar from '../components/TopBar';
import CoverEditor from '../components/CoverEditor';
import { useT } from '../i18n/I18nProvider';

export default function CoverPage() {
  const t = useT();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const path = params.get('path') || '';
  const bustParam = Number(params.get('t')) || 0;

  const [hasCover, setHasCover] = useState(params.get('hasCover') !== '0');
  const [bust, setBust] = useState(bustParam || Date.now());
  const [ready, setReady] = useState(Boolean(bustParam) || params.has('hasCover'));
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const fileName = useMemo(() => (path ? path.split('/').pop() : ''), [path]);

  useEffect(() => {
    if (!path || ready) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const meta = await api.rowMeta(path, []);
        if (cancelled) return;
        setHasCover(Boolean(meta.hasCover));
        setBust(Date.now());
        setReady(true);
      } catch (err) {
        if (!cancelled) {
          setError(err.message || t('cover.infoFailed'));
          setReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path, ready, t]);

  if (!path) {
    return (
      <div className="app-shell narrow">
        <TopBar subtitle={t('cover.subtitle')} />
        <div className="empty-state">
          <h2>{t('cover.noFile')}</h2>
          <p className="muted">{t('cover.openHint')}</p>
          <Link className="btn primary" to="/">
            {t('nav.toLibrary')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <TopBar subtitle={t('cover.subtitleEdit')} />
      <main className="cover-page">
        <div className="cover-page-head">
          <div>
            <Link className="btn ghost tiny" to="/">
              {t('cover.backLibrary')}
            </Link>
            <h1>{t('cover.subtitle')}</h1>
            <p className="muted mono small">{fileName}</p>
            <p className="muted mono small">{path}</p>
          </div>
          {(status || error) && (
            <div className="status-row">
              {status && <p className="ok">{status}</p>}
              {error && <p className="error">{error}</p>}
            </div>
          )}
        </div>

        {!ready ? (
          <div className="listing-state compact">
            <span className="spinner" />
            <p>{t('cover.loading')}</p>
          </div>
        ) : (
          <CoverEditor
            key={`${path}-${bust}`}
            path={path}
            bust={bust}
            hasCover={hasCover}
            onCancel={() => navigate(-1)}
            onSaved={({ bust: nextBust, fromYt }) => {
              setHasCover(true);
              setBust(nextBust);
              setStatus(fromYt ? t('cover.ytApplied') : t('cover.saved'));
              setError('');
              if (!fromYt) {
                navigate(-1);
              }
            }}
          />
        )}
      </main>
    </div>
  );
}
