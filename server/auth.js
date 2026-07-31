import {
  authenticateUser,
  changePassword,
  addUser,
  removeUser,
  getPublicSettings,
  setAudioRoots,
  setTableColumns,
  setDefaultWaveZoom,
} from './store.js';
import { ensureAudioDirs } from './paths.js';
import { TAG_FIELDS } from './routes/tags.js';

export function requireAuth(req, res, next) {
  if (req.session?.user) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

export function loginHandler(req, res) {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  if (authenticateUser(username, password)) {
    req.session.user = { username };
    return res.json({ ok: true, user: { username } });
  }
  return res.status(401).json({ error: 'Invalid credentials' });
}

export function logoutHandler(req, res) {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
}

export function meHandler(req, res) {
  if (!req.session?.user) return res.status(401).json({ error: 'Unauthorized' });
  return res.json({ user: req.session.user });
}

export function getSettingsHandler(req, res) {
  try {
    res.json({
      ...getPublicSettings(),
      availableColumns: TAG_FIELDS.map((f) => ({ key: f.key, label: f.label })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export function changePasswordHandler(req, res) {
  try {
    const { currentPassword, newPassword } = req.body || {};
    changePassword(req.session.user.username, currentPassword, newPassword);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export function addUserHandler(req, res) {
  try {
    const { username, password } = req.body || {};
    const user = addUser(username, password);
    res.json({ ok: true, user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export function removeUserHandler(req, res) {
  try {
    removeUser(req.params.username, req.session.user.username);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export function setRootsHandler(req, res) {
  try {
    const incoming = req.body?.audioRoots || req.body?.roots;
    if (!Array.isArray(incoming)) {
      return res.status(400).json({ error: 'audioRoots muss ein Array sein' });
    }
    const roots = setAudioRoots(incoming);
    try {
      ensureAudioDirs();
    } catch (err) {
      console.warn('ensureAudioDirs:', err.message);
    }
    res.json({ ok: true, audioRoots: roots });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export function setColumnsHandler(req, res) {
  try {
    const result = setTableColumns(
      req.body?.tableColumns || req.body?.columns || [],
      typeof req.body?.showActionsColumn === 'boolean' ? req.body.showActionsColumn : undefined
    );
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export function setWaveZoomHandler(req, res) {
  try {
    const zoom = setDefaultWaveZoom(req.body?.defaultWaveZoom ?? req.body?.zoom);
    res.json({ ok: true, defaultWaveZoom: zoom });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}
