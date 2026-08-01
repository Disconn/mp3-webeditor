import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import TopBar from '../components/TopBar';
import TagForm from '../components/TagForm';
import RowPlayer from '../components/RowPlayer';
import { useT } from '../i18n/I18nProvider';

const META_CONCURRENCY = 6;

async function mapPool(items, limit, worker) {
  let next = 0;
  async function run() {
    while (next < items.length) {
      const i = next;
      next += 1;
      await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, () => run()));
}

function CoverThumb({ path, hasCover, loaded, bust, onOpen }) {
  const t = useT();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [path, bust, hasCover]);

  if (!loaded) {
    return (
      <div className="cover-thumb loading" title={t('library.coverLoading')}>
        <span className="spinner tiny" />
      </div>
    );
  }

  if (!hasCover || failed) {
    return (
      <button
        type="button"
        className="cover-thumb-btn"
        title={t('library.coverAdd')}
        onClick={(e) => {
          e.stopPropagation();
          onOpen?.();
        }}
      >
        <div className="cover-thumb placeholder">
          <span>♪</span>
        </div>
      </button>
    );
  }

  return (
    <button
      type="button"
      className="cover-thumb-btn"
      title={t('library.coverOpen')}
      onClick={(e) => {
        e.stopPropagation();
        onOpen?.();
      }}
    >
      <img
        className="cover-thumb"
        src={api.coverUrl(path, bust)}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </button>
  );
}

export default function LibraryPage() {
  const navigate = useNavigate();
  const t = useT();
  const [cwd, setCwd] = useState(null); // null until first load decides
  const [breadcrumbs, setBreadcrumbs] = useState([{ label: '', path: '' }]);
  const [folders, setFolders] = useState([]);
  const [files, setFiles] = useState([]);
  const [roots, setRoots] = useState([]);
  const [columns, setColumns] = useState([]);
  const [available, setAvailable] = useState([]);
  const [fields, setFields] = useState([]);
  const [listing, setListing] = useState(true);
  const [metaProgress, setMetaProgress] = useState({ done: 0, total: 0, cached: 0 });
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [savingCell, setSavingCell] = useState('');
  const [detailPath, setDetailPath] = useState(null);
  const [detailData, setDetailData] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [colOpen, setColOpen] = useState(false);
  const [draftCols, setDraftCols] = useState([]);
  const [showActions, setShowActions] = useState(true);
  const [draftShowActions, setDraftShowActions] = useState(true);
  const [showPlayer, setShowPlayer] = useState(true);
  const [draftShowPlayer, setDraftShowPlayer] = useState(true);
  const [filter, setFilter] = useState('');
  const [settingsReady, setSettingsReady] = useState(false);
  const [sortKey, setSortKey] = useState('name');
  const [sortDir, setSortDir] = useState('asc');
  const loadGen = useRef(0);
  const columnsRef = useRef([]);

  function openCoverPage(filePath, { bust, hasCover } = {}) {
    const qs = new URLSearchParams({ path: filePath });
    if (bust) qs.set('t', String(bust));
    if (hasCover === false) qs.set('hasCover', '0');
    navigate(`/cover?${qs.toString()}`);
  }

  function crumbLabel(crumb) {
    if (!crumb.path) return t('library.root');
    return crumb.label;
  }

  useEffect(() => {
    columnsRef.current = columns;
  }, [columns]);

  const loadMetas = useCallback(async (fileList, cols, gen, refresh = false) => {
    setMetaProgress({ done: 0, total: fileList.length, cached: 0 });
    if (!fileList.length) return;

    let done = 0;
    let cached = 0;
    await mapPool(fileList, META_CONCURRENCY, async (file) => {
      if (gen !== loadGen.current) return;
      try {
        const meta = await api.rowMeta(file.path, cols, { refresh });
        if (gen !== loadGen.current) return;
        if (meta.cached) cached += 1;
        setFiles((prev) =>
          prev.map((f) =>
            f.path === file.path
              ? {
                  ...f,
                  tags: meta.tags || {},
                  hasCover: Boolean(meta.hasCover),
                  metaStatus: 'ready',
                }
              : f
          )
        );
      } catch {
        if (gen !== loadGen.current) return;
        setFiles((prev) =>
          prev.map((f) =>
            f.path === file.path
              ? { ...f, tags: {}, hasCover: false, metaStatus: 'error' }
              : f
          )
        );
      } finally {
        done += 1;
        if (gen === loadGen.current) {
          setMetaProgress({ done, total: fileList.length, cached });
        }
      }
    });
  }, []);

  const loadDir = useCallback(
    async (dirPath, cols, refresh = false) => {
      const gen = ++loadGen.current;
      setListing(true);
      setError('');
      setMetaProgress({ done: 0, total: 0, cached: 0 });
      setDetailPath(null);
      try {
        const useCols = cols || columnsRef.current;
        const data = await api.library(dirPath ?? '');
        if (gen !== loadGen.current) return;

        const list = (data.files || []).map((f) => ({
          ...f,
          tags: {},
          hasCover: false,
          metaStatus: 'loading',
          coverBust: 0,
        }));

        setCwd(data.dir ?? dirPath ?? '');
        setBreadcrumbs(data.breadcrumbs || [{ label: '', path: '' }]);
        setFolders(data.folders || []);
        setFiles(list);
        setRoots(data.roots || []);
        setFields(data.fields || []);
        setListing(false);

        await loadMetas(list, useCols, gen, refresh);
      } catch (err) {
        if (gen === loadGen.current) {
          setError(err.message);
          setListing(false);
        }
      }
    },
    [loadMetas]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const settings = await api.settings();
        if (cancelled) return;
        const useCols = settings.tableColumns || [];
        const actionsVisible = settings.showActionsColumn !== false;
        const playerVisible = settings.showPlayerColumn !== false;
        setColumns(useCols);
        setDraftCols(useCols);
        setShowActions(actionsVisible);
        setDraftShowActions(actionsVisible);
        setShowPlayer(playerVisible);
        setDraftShowPlayer(playerVisible);
        setAvailable(settings.availableColumns || []);
        setSettingsReady(true);
        await loadDir('', useCols);
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          setListing(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      loadGen.current += 1;
    };
  }, [loadDir]);

  const labelFor = useMemo(() => {
    const map = {};
    for (const f of available) map[f.key] = f.label;
    for (const f of fields) map[f.key] = f.label;
    return map;
  }, [available, fields]);

  const filteredFolders = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return folders;
    return folders.filter(
      (f) => f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)
    );
  }, [folders, filter]);

  const filteredFiles = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return files;
    return files.filter((f) => {
      if (f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)) return true;
      return columns.some((c) => String(f.tags?.[c] || '').toLowerCase().includes(q));
    });
  }, [files, filter, columns]);

  function sortValue(item, key) {
    if (key === 'name') return String(item.name || '');
    if (key === 'hasCover') return item.hasCover ? 1 : 0;
    return String(item.tags?.[key] ?? '');
  }

  function compareItems(a, b) {
    const av = sortValue(a, sortKey);
    const bv = sortValue(b, sortKey);
    const aNum = Number(av);
    const bNum = Number(bv);
    let cmp;
    if (av !== '' && bv !== '' && Number.isFinite(aNum) && Number.isFinite(bNum)) {
      cmp = aNum - bNum;
    } else {
      cmp = String(av).localeCompare(String(bv), undefined, {
        sensitivity: 'base',
        numeric: true,
      });
    }
    if (cmp === 0) {
      cmp = String(a.name || '').localeCompare(String(b.name || ''), undefined, {
        sensitivity: 'base',
        numeric: true,
      });
    }
    return sortDir === 'asc' ? cmp : -cmp;
  }

  const sortedFolders = useMemo(() => {
    if (sortKey !== 'name' && sortKey !== 'hasCover') {
      // tag columns: keep folder name sort as secondary stable order
      return [...filteredFolders].sort((a, b) => {
        const cmp = String(a.name || '').localeCompare(String(b.name || ''), undefined, {
          sensitivity: 'base',
          numeric: true,
        });
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return [...filteredFolders].sort(compareItems);
  }, [filteredFolders, sortKey, sortDir]);

  const sortedFiles = useMemo(
    () => [...filteredFiles].sort(compareItems),
    [filteredFiles, sortKey, sortDir]
  );

  function toggleSort(key) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  function SortHeader({ columnKey, children, className }) {
    const active = sortKey === columnKey;
    return (
      <th className={className}>
        <button
          type="button"
          className={`sort-btn${active ? ' active' : ''}`}
          onClick={() => toggleSort(columnKey)}
        >
          <span>{children}</span>
          <span className="sort-ind" aria-hidden>
            {active ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}
          </span>
        </button>
      </th>
    );
  }

  const metaLoading = metaProgress.total > 0 && metaProgress.done < metaProgress.total;
  const parentPath = breadcrumbs.length > 1 ? breadcrumbs[breadcrumbs.length - 2].path : null;

  async function saveCell(filePath, key, value, original) {
    if (value === original) return;
    const cellId = `${filePath}:${key}`;
    setSavingCell(cellId);
    setStatus('');
    setError('');
    try {
      await api.saveTags(filePath, { [key]: value });
      setFiles((prev) =>
        prev.map((f) =>
          f.path === filePath ? { ...f, tags: { ...f.tags, [key]: value } } : f
        )
      );
      setStatus(t('library.saved'));
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingCell('');
    }
  }

  async function applyColumns() {
    try {
      await api.saveColumns(draftCols, {
        showActionsColumn: draftShowActions,
        showPlayerColumn: draftShowPlayer,
      });
      setColumns(draftCols);
      setShowActions(draftShowActions);
      setShowPlayer(draftShowPlayer);
      setColOpen(false);
      await loadDir(cwd || '', draftCols);
    } catch (err) {
      setError(err.message);
    }
  }

  async function openDetail(path) {
    setDetailPath(path);
    setDetailLoading(true);
    setDetailData(null);
    try {
      const data = await api.tags(path);
      setDetailData(data);
    } catch (err) {
      setError(err.message);
      setDetailPath(null);
    } finally {
      setDetailLoading(false);
    }
  }

  async function onYtCover(path) {
    setStatus(t('library.ytCoverStatus'));
    setError('');
    try {
      const data = await api.ytCover(path);
      setStatus(t('library.coverLoaded', { id: data.videoId }));
      setFiles((prev) =>
        prev.map((f) =>
          f.path === path
            ? { ...f, hasCover: true, coverBust: Date.now(), metaStatus: 'ready' }
            : f
        )
      );
      if (detailPath === path) await openDetail(path);
    } catch (err) {
      setError(err.message);
      setStatus('');
    }
  }

  async function onSaveDetail(tags) {
    await api.saveTags(detailPath, tags);
    setStatus(t('library.tagsSaved'));
    const meta = await api.rowMeta(detailPath, columns);
    setFiles((prev) =>
      prev.map((f) =>
        f.path === detailPath
          ? {
              ...f,
              tags: meta.tags || {},
              hasCover: Boolean(meta.hasCover),
              metaStatus: 'ready',
              coverBust: Date.now(),
            }
          : f
      )
    );
    await openDetail(detailPath);
  }

  return (
    <div className="app-shell">
      <TopBar
        subtitle={`${roots.map((r) => r.path).join(' · ') || '…'} · ${t('library.filesHere', { count: files.length })}`}
      />

      <main className="table-page">
        <div className="table-toolbar">
          <div className="nav-cluster">
            <button
              type="button"
              className="btn ghost"
              disabled={parentPath === null || listing}
              onClick={() => loadDir(parentPath ?? '', columns)}
            >
              {t('library.up')}
            </button>
            <nav className="breadcrumbs" aria-label={t('library.path')}>
              {breadcrumbs.map((crumb, i) => (
                <span key={`${crumb.path}-${i}`} className="crumb">
                  {i > 0 && <span className="crumb-sep">/</span>}
                  <button
                    type="button"
                    className="crumb-btn"
                    disabled={i === breadcrumbs.length - 1}
                    onClick={() => loadDir(crumb.path, columns)}
                  >
                    {crumbLabel(crumb)}
                  </button>
                </span>
              ))}
            </nav>
          </div>
          <input
            className="search"
            placeholder={t('library.search')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className="toolbar-actions">
            {metaLoading && (
              <span className="load-pill">
                <span className="spinner tiny" />
                {t('library.tagsProgress', {
                  done: metaProgress.done,
                  total: metaProgress.total,
                })}
                {metaProgress.cached > 0
                  ? ` · ${t('library.cacheCount', { count: metaProgress.cached })}`
                  : ''}
              </span>
            )}
            {!metaLoading && metaProgress.total > 0 && metaProgress.cached > 0 && (
              <span className="load-pill muted-pill">
                {metaProgress.cached}/{metaProgress.total} {t('library.fromCache')}
              </span>
            )}
            <button
              type="button"
              className="btn ghost"
              onClick={() => loadDir(cwd || '', columns, false)}
              disabled={listing || metaLoading || !settingsReady}
            >
              {t('library.refresh')}
            </button>
            <button
              type="button"
              className="btn ghost"
              title={t('library.rereadTitle')}
              onClick={() => loadDir(cwd || '', columns, true)}
              disabled={listing || metaLoading || !settingsReady}
            >
              {t('library.reread')}
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={() => {
                setDraftCols(columns);
                setDraftShowActions(showActions);
                setDraftShowPlayer(showPlayer);
                setColOpen((v) => !v);
              }}
            >
              {t('library.columns')}
            </button>
          </div>
        </div>

        {colOpen && (
          <div className="column-picker">
            <p className="muted small">{t('library.columnsHint')}</p>

            <div className="column-section">
              <h3 className="column-section-title">{t('library.columnsTags')}</h3>
              <div className="column-grid">
                {available.map((col) => {
                  const checked = draftCols.includes(col.key);
                  return (
                    <label key={col.key} className="check">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setDraftCols((prev) =>
                            checked ? prev.filter((k) => k !== col.key) : [...prev, col.key]
                          );
                        }}
                      />
                      {col.label}
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="column-section">
              <h3 className="column-section-title">{t('library.columnsSpecial')}</h3>
              <div className="column-grid">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={draftShowPlayer}
                    onChange={() => setDraftShowPlayer((v) => !v)}
                  />
                  {t('library.player')}
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={draftShowActions}
                    onChange={() => setDraftShowActions((v) => !v)}
                  />
                  {t('library.actions')}
                </label>
              </div>
            </div>

            <button type="button" className="btn primary" onClick={applyColumns}>
              {t('library.apply')}
            </button>
          </div>
        )}

        {(status || error) && (
          <div className="status-row">
            {status && <p className="ok">{status}</p>}
            {error && <p className="error">{error}</p>}
          </div>
        )}

        {listing ? (
          <div className="listing-state">
            <span className="spinner" />
            <p>{t('library.loadingFolder')}</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="lib-table">
              <thead>
                <tr>
                  <SortHeader columnKey="hasCover" className="cover-col">
                    {t('library.cover')}
                  </SortHeader>
                  <SortHeader columnKey="name">{t('library.name')}</SortHeader>
                  {showPlayer && <th className="player-col">{t('library.player')}</th>}
                  {columns.map((c) => (
                    <SortHeader key={c} columnKey={c}>
                      {labelFor[c] || c}
                    </SortHeader>
                  ))}
                  {showActions && <th className="actions-col">{t('library.actions')}</th>}
                </tr>
              </thead>
              <tbody>
                {sortedFolders.map((folder) => (
                  <tr
                    key={`dir:${folder.path}`}
                    className="folder-row"
                    onDoubleClick={() => loadDir(folder.path, columns)}
                  >
                    <td className="cover-col">
                      <div className="cover-thumb folder-icon" title={t('library.folder')} aria-hidden>
                        <span className="folder-glyph" />
                      </div>
                    </td>
                    <td className="name-cell" colSpan={columns.length + 1 + (showPlayer ? 1 : 0)}>
                      <button
                        type="button"
                        className="linkish folder-link"
                        onClick={() => loadDir(folder.path, columns)}
                      >
                        {folder.name}
                      </button>
                      <div className="muted small">{t('library.folder')}</div>
                    </td>
                    {showActions && (
                      <td className="actions-col">
                        <button
                          type="button"
                          className="btn secondary tiny"
                          onClick={() => loadDir(folder.path, columns)}
                        >
                          {t('library.open')}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}

                {sortedFiles.map((file) => {
                  const ready = file.metaStatus === 'ready' || file.metaStatus === 'error';
                  return (
                    <tr key={file.path} className={detailPath === file.path ? 'row-active' : ''}>
                      <td className="cover-col">
                        <CoverThumb
                          path={file.path}
                          hasCover={file.hasCover}
                          loaded={ready}
                          bust={file.coverBust}
                          onOpen={() =>
                            openCoverPage(file.path, {
                              bust: file.coverBust || Date.now(),
                              hasCover: Boolean(file.hasCover),
                            })
                          }
                        />
                      </td>
                      <td className="name-cell" title={file.path}>
                        <button type="button" className="linkish" onClick={() => openDetail(file.path)}>
                          {file.name}
                        </button>
                      </td>
                      {showPlayer && (
                        <td className="player-col">
                          <RowPlayer path={file.path} />
                        </td>
                      )}
                      {columns.map((c) => {
                        const cellId = `${file.path}:${c}`;
                        const val = file.tags?.[c] ?? '';
                        if (!ready) {
                          return (
                            <td key={c}>
                              <div className="cell-loading">
                                <span className="spinner tiny" />
                              </div>
                            </td>
                          );
                        }
                        return (
                          <td key={c}>
                            <input
                              className={`cell-input${savingCell === cellId ? ' saving' : ''}`}
                              defaultValue={val}
                              key={`${file.path}-${c}-${val}`}
                              onBlur={(e) => saveCell(file.path, c, e.target.value, val)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') e.currentTarget.blur();
                              }}
                            />
                          </td>
                        );
                      })}
                      {showActions && (
                        <td className="actions-col">
                          <div className="row-actions">
                            <button
                              type="button"
                              className="btn ghost tiny"
                              onClick={() => onYtCover(file.path)}
                            >
                              {t('library.yt')}
                            </button>
                            <Link
                              className="btn secondary tiny"
                              to={`/editor?path=${encodeURIComponent(file.path)}`}
                            >
                              {t('library.crop')}
                            </Link>
                            <button
                              type="button"
                              className="btn ghost tiny"
                              onClick={() => openDetail(file.path)}
                            >
                              {t('library.all')}
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}

                {!sortedFolders.length && !sortedFiles.length && (
                  <tr>
                    <td
                      colSpan={
                        columns.length + 2 + (showPlayer ? 1 : 0) + (showActions ? 1 : 0)
                      }
                      className="muted"
                    >
                      {t('library.empty')}
                    </td>
                  </tr>
                )}
              </tbody>            </table>
          </div>
        )}
      </main>

      {detailPath && (
        <aside className="detail-drawer">
          <div className="drawer-head">
            <div>
              <h2>{t('library.allTags')}</h2>
              <p className="muted mono small">{detailPath}</p>
            </div>
            <button type="button" className="btn ghost" onClick={() => setDetailPath(null)}>
              {t('library.close')}
            </button>
          </div>
          <div className="drawer-actions">
            <Link className="btn primary" to={`/editor?path=${encodeURIComponent(detailPath)}`}>
              {t('library.editor')}
            </Link>
          </div>
          {detailLoading && (
            <div className="listing-state compact">
              <span className="spinner" />
              <p>{t('library.loadingTags')}</p>
            </div>
          )}
          {!detailLoading && detailData && (
            <TagForm
              key={detailPath}
              fields={detailData.fields}
              initialTags={detailData.tags}
              cover={detailData.cover}
              format={detailData.format}
              streamUrl={api.streamUrl(detailPath)}
              onSave={onSaveDetail}
              onOpenCover={() =>
                openCoverPage(detailPath, {
                  bust: files.find((f) => f.path === detailPath)?.coverBust || Date.now(),
                  hasCover: Boolean(detailData.cover),
                })
              }
            />
          )}
        </aside>
      )}
    </div>
  );
}
