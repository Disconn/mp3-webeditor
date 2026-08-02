const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function parse(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText || 'Request failed');
  return data;
}

export const api = {
  me: () =>
    fetch('/api/me', { credentials: 'include' }).then(async (res) => {
      if (res.status === 401) return null;
      return parse(res);
    }),
  login: (username, password) =>
    fetch('/api/login', {
      method: 'POST',
      credentials: 'include',
      headers: JSON_HEADERS,
      body: JSON.stringify({ username, password }),
    }).then(parse),
  logout: () =>
    fetch('/api/logout', { method: 'POST', credentials: 'include' }).then(parse),
  library: (dir = '') => {
    const q = dir ? `?dir=${encodeURIComponent(dir)}` : '';
    return fetch(`/api/library${q}`, { credentials: 'include' }).then(parse);
  },
  rowMeta: (path, columns, opts = {}) => {
    const q = new URLSearchParams({ path });
    if (columns?.length) q.set('columns', columns.join(','));
    if (opts.refresh) q.set('refresh', '1');
    return fetch(`/api/library/meta?${q}`, { credentials: 'include' }).then(parse);
  },
  cacheStats: () => fetch('/api/cache/stats', { credentials: 'include' }).then(parse),
  clearCache: () =>
    fetch('/api/cache', { method: 'DELETE', credentials: 'include' }).then(parse),
  files: () => fetch('/api/files', { credentials: 'include' }).then(parse),
  tags: (path) =>
    fetch(`/api/tags?path=${encodeURIComponent(path)}`, { credentials: 'include' }).then(parse),
  saveTags: (path, tags) =>
    fetch('/api/tags', {
      method: 'PUT',
      credentials: 'include',
      headers: JSON_HEADERS,
      body: JSON.stringify({ path, tags }),
    }).then(parse),
  ytCover: (path) =>
    fetch('/api/cover/youtube', {
      method: 'POST',
      credentials: 'include',
      headers: JSON_HEADERS,
      body: JSON.stringify({ path }),
    }).then(parse),
  coverFromUrl: (url) =>
    fetch('/api/cover/from-url', {
      method: 'POST',
      credentials: 'include',
      headers: JSON_HEADERS,
      body: JSON.stringify({ url }),
    }).then(parse),
  saveCover: (path, dataUrl) =>
    fetch('/api/cover', {
      method: 'PUT',
      credentials: 'include',
      headers: JSON_HEADERS,
      body: JSON.stringify({ path, dataUrl }),
    }).then(parse),
  coverUrl: (path, bust) => {
    const q = `path=${encodeURIComponent(path)}${bust ? `&t=${bust}` : ''}`;
    return `/api/cover?${q}`;
  },
  duration: (path) =>
    fetch(`/api/audio/duration?path=${encodeURIComponent(path)}`, {
      credentials: 'include',
    }).then(parse),
  peaks: (path) =>
    fetch(`/api/audio/peaks?path=${encodeURIComponent(path)}`, {
      credentials: 'include',
    }).then(parse),
  chapters: (path) =>
    fetch(`/api/chapters?path=${encodeURIComponent(path)}`, {
      credentials: 'include',
    }).then(parse),
  saveChapters: (path, chapters, duration) =>
    fetch('/api/chapters', {
      method: 'PUT',
      credentials: 'include',
      headers: JSON_HEADERS,
      body: JSON.stringify({ path, chapters, duration }),
    }).then(parse),
  crop: (path, trimStart, trimEnd) =>
    fetch('/api/audio/crop', {
      method: 'POST',
      credentials: 'include',
      headers: JSON_HEADERS,
      body: JSON.stringify({ path, trimStart, trimEnd, inPlace: true }),
    }).then(parse),
  streamUrl: (path, bust, opts = {}) => {
    const q = new URLSearchParams({ path });
    if (bust) q.set('t', String(bust));
    if (opts.sync) q.set('sync', '1');
    if (opts.ss != null && Number(opts.ss) > 0) q.set('ss', String(Number(opts.ss)));
    return `/api/audio/stream?${q}`;
  },
  settings: () => fetch('/api/settings', { credentials: 'include' }).then(parse),
  changePassword: (currentPassword, newPassword) =>
    fetch('/api/settings/password', {
      method: 'PUT',
      credentials: 'include',
      headers: JSON_HEADERS,
      body: JSON.stringify({ currentPassword, newPassword }),
    }).then(parse),
  addUser: (username, password) =>
    fetch('/api/settings/users', {
      method: 'POST',
      credentials: 'include',
      headers: JSON_HEADERS,
      body: JSON.stringify({ username, password }),
    }).then(parse),
  removeUser: (username) =>
    fetch(`/api/settings/users/${encodeURIComponent(username)}`, {
      method: 'DELETE',
      credentials: 'include',
    }).then(parse),
  saveRoots: (audioRoots) =>
    fetch('/api/settings/roots', {
      method: 'PUT',
      credentials: 'include',
      headers: JSON_HEADERS,
      body: JSON.stringify({ audioRoots }),
    }).then(parse),
  saveColumns: (tableColumns, options = {}) =>
    fetch('/api/settings/columns', {
      method: 'PUT',
      credentials: 'include',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        tableColumns,
        showActionsColumn: options.showActionsColumn,
        showPlayerColumn: options.showPlayerColumn,
      }),
    }).then(parse),
  saveWaveZoom: (defaultWaveZoom) =>
    fetch('/api/settings/wave-zoom', {
      method: 'PUT',
      credentials: 'include',
      headers: JSON_HEADERS,
      body: JSON.stringify({ defaultWaveZoom }),
    }).then(parse),
  saveLanguage: (uiLanguage) =>
    fetch('/api/settings/language', {
      method: 'PUT',
      credentials: 'include',
      headers: JSON_HEADERS,
      body: JSON.stringify({ uiLanguage }),
    }).then(parse),
  saveTheme: (uiTheme) =>
    fetch('/api/settings/theme', {
      method: 'PUT',
      credentials: 'include',
      headers: JSON_HEADERS,
      body: JSON.stringify({ uiTheme }),
    }).then(parse),
};
