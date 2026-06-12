import express from 'express';
import { randomBytes } from 'crypto';
import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import session from 'express-session';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3456;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const SESSION_SECRET = process.env.SESSION_SECRET || randomBytes(32).toString('hex');
const EMPUJON_API = process.env.EMPUJON_API_URL || 'https://api.empujoneducativo.com';
const ARTIFACTS_DIR = join(__dirname, 'artifacts');
const DB_PATH = join(__dirname, 'db.sqlite');

// ── DB ────────────────────────────────────────────────────────────────────────

const db = new Database(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    empujon_user_id INTEGER UNIQUE NOT NULL,
    email TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    api_token TEXT UNIQUE NOT NULL,
    first_login_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_login_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    artifact_id TEXT NOT NULL,
    email TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ── Express ───────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 },
}));

// ── Auth helpers ──────────────────────────────────────────────────────────────

function decodeJwtPayload(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  } catch { return null; }
}

function requireAuth(req, res, next) {
  if (req.session?.user) return next();
  res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (req.session?.user?.is_admin) return next();
  res.status(403).send(page('Sin acceso', '<p>Solo admins.</p>'));
}

function apiAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  if (header.startsWith('Bearer ')) {
    const user = db.prepare('SELECT * FROM users WHERE api_token = ?').get(header.slice(7));
    if (!user) return res.status(401).json({ error: 'Token inválido' });
    req.apiUser = user;
    return next();
  }
  if (req.session?.user) {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
    if (!user) return res.status(401).json({ error: 'Sesión inválida' });
    req.apiUser = user;
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
}

// ── Artifact helpers ──────────────────────────────────────────────────────────

const VALID_ID = /^[a-f0-9]{12}$/;

function metaPath(id) { return join(ARTIFACTS_DIR, `${id}.meta.json`); }
function commentsPath(id) { return join(ARTIFACTS_DIR, `${id}.comments.json`); }
function versionPath(id, v) { return join(ARTIFACTS_DIR, `${id}_v${v}.html`); }

function readMeta(id) {
  try { return JSON.parse(readFileSync(metaPath(id), 'utf8')); } catch { return {}; }
}
function writeMeta(id, data) { writeFileSync(metaPath(id), JSON.stringify(data), 'utf8'); }

function readComments(id) {
  try { return JSON.parse(readFileSync(commentsPath(id), 'utf8')); } catch { return []; }
}
function writeComments(id, comments) { writeFileSync(commentsPath(id), JSON.stringify(comments), 'utf8'); }

function listArtifacts(filterEmail = null) {
  return readdirSync(ARTIFACTS_DIR)
    .filter(f => /^[a-f0-9]{12}\.html$/.test(f))
    .map(f => {
      const id = f.replace('.html', '');
      const meta = readMeta(id);
      const stat = statSync(join(ARTIFACTS_DIR, f));
      return { id, url: `${BASE_URL}/${id}`, viewUrl: `${BASE_URL}/${id}/view`, ...meta, createdAt: meta.createdAt || stat.birthtime };
    })
    .filter(a => !filterEmail || a.email === filterEmail)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function saveArtifactContent(id, htmlContent, title) {
  let content = htmlContent;
  if (title && !htmlContent.includes('<title>')) {
    content = htmlContent.replace('<head>', `<head><title>${title}</title>`);
    if (!content.includes('<title>')) {
      content = `<!DOCTYPE html><html><head><title>${title}</title></head><body>${htmlContent}</body></html>`;
    }
  }
  writeFileSync(join(ARTIFACTS_DIR, `${id}.html`), content, 'utf8');
  return content;
}

function newId() { return randomBytes(6).toString('hex'); }

// ── UI ────────────────────────────────────────────────────────────────────────

const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0f2f5;color:#1a1a1a;min-height:100vh}
.wrap{max-width:940px;margin:0 auto;padding:24px 16px}
.card{background:#fff;border-radius:12px;padding:36px;box-shadow:0 1px 3px rgba(0,0,0,.07),0 4px 16px rgba(0,0,0,.04)}
h1{font-size:1.35rem;font-weight:700;margin-bottom:4px}
.sub{color:#888;font-size:.875rem;margin-bottom:24px}
nav{display:flex;justify-content:space-between;align-items:center;margin-bottom:28px}
.logo{font-weight:800;font-size:.95rem;color:#1a1a1a;text-decoration:none;letter-spacing:-.01em}
.logo span{color:#6366f1}
nav a{color:#666;text-decoration:none;font-size:.875rem}
nav a:hover{color:#1a1a1a}
label{display:block;font-size:.8rem;font-weight:600;color:#555;margin-bottom:5px;letter-spacing:.01em;text-transform:uppercase}
input[type=text],input[type=password],input[type=email],textarea{width:100%;padding:10px 13px;border:1.5px solid #e5e7eb;border-radius:8px;font-size:.93rem;margin-bottom:14px;outline:none;transition:border .15s,box-shadow .15s;font-family:inherit}
input:focus,textarea:focus{border-color:#6366f1;box-shadow:0 0 0 3px rgba(99,102,241,.12)}
textarea{resize:vertical;min-height:80px}
.btn{display:inline-block;padding:10px 20px;border-radius:8px;font-size:.875rem;font-weight:600;cursor:pointer;border:none;text-decoration:none;transition:all .15s;letter-spacing:.01em}
.btn-primary{background:#6366f1;color:#fff}
.btn-primary:hover{background:#4f46e5;box-shadow:0 2px 8px rgba(99,102,241,.3)}
.btn-danger{background:#ef4444;color:#fff}
.btn-danger:hover{background:#dc2626}
.btn-ghost{background:#fff;color:#6366f1;border:1.5px solid #e0e7ff}
.btn-ghost:hover{background:#eef2ff}
.btn-sm{padding:5px 12px;font-size:.8rem}
.alert{padding:11px 15px;border-radius:8px;margin-bottom:16px;font-size:.875rem}
.alert-error{background:#fef2f2;color:#b91c1c;border:1px solid #fecaca}
.alert-success{background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0}
table{width:100%;border-collapse:collapse;margin-top:8px}
th{text-align:left;font-size:.74rem;font-weight:700;color:#9ca3af;padding:8px 10px;border-bottom:2px solid #f3f4f6;text-transform:uppercase;letter-spacing:.05em}
td{padding:11px 10px;font-size:.875rem;border-bottom:1px solid #f9fafb;vertical-align:middle}
tr:last-child td{border:none}
tr:hover td{background:#fafafa}
.badge{display:inline-block;padding:2px 9px;border-radius:99px;font-size:.73rem;font-weight:700;letter-spacing:.02em}
.badge-indigo{background:#eef2ff;color:#4338ca}
.badge-amber{background:#fffbeb;color:#92400e}
.badge-green{background:#f0fdf4;color:#15803d}
.mono{font-family:'SF Mono',Consolas,monospace;font-size:.78rem;background:#f4f4f5;padding:3px 7px;border-radius:5px;word-break:break-all}
.empty{text-align:center;color:#bbb;padding:48px;font-size:.9rem}
.row{display:flex;gap:10px;align-items:flex-end}
.row>*{flex:1}
.row>.action{flex:0 0 auto;padding-bottom:14px}
details{margin-bottom:20px}
details>summary{cursor:pointer;font-size:.83rem;color:#9ca3af;user-select:none;padding:10px 0}
.token-card{background:#f8f8fc;border:1.5px solid #e0e7ff;border-radius:8px;padding:14px 16px;margin-top:8px}
.token-val{font-family:'SF Mono',Consolas,monospace;font-size:.8rem;word-break:break-all;color:#3730a3;margin-bottom:8px}
.hint{font-size:.78rem;color:#9ca3af;line-height:1.6;font-family:'SF Mono',Consolas,monospace}
.sep{height:1px;background:#f3f4f6;margin:24px 0}
.comment{padding:14px 0;border-bottom:1px solid #f3f4f6}
.comment:last-child{border:none}
.comment-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
.comment-author{font-weight:600;font-size:.85rem}
.comment-date{font-size:.78rem;color:#bbb}
.comment-text{font-size:.9rem;color:#444;line-height:1.6;white-space:pre-wrap}
.version-pill{display:inline-block;padding:2px 7px;border-radius:99px;font-size:.72rem;font-weight:700;background:#f3f4f6;color:#666;margin-left:6px}
`;

function page(title, body, user = null) {
  const nav = user ? `
    <nav>
      <div style="display:flex;gap:22px;align-items:center">
        <a href="/dashboard" class="logo">empujón<span>.</span>artifacts</a>
        <a href="/dashboard">Mis artefactos</a>
        ${user.is_admin ? '<a href="/admin">Admin</a>' : ''}
      </div>
      <div style="display:flex;gap:14px;align-items:center">
        <span style="font-size:.85rem;color:#888">${user.email}</span>
        <a href="/logout" style="color:#bbb;font-size:.85rem">Salir</a>
      </div>
    </nav>` : '';
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — Artifacts</title><style>${CSS}</style></head><body><div class="wrap">${nav}<div class="card">${body}</div></div></body></html>`;
}

// ── Auth routes ───────────────────────────────────────────────────────────────

app.get('/', (req, res) => res.redirect(req.session?.user ? '/dashboard' : '/login'));

app.get('/login', (req, res) => {
  if (req.session?.user) return res.redirect('/dashboard');
  const err = req.query.error;
  const errMsg = {
    credentials: 'Email o contraseña incorrectos.',
    norole: 'Tu cuenta no tiene un rol asignado en Empujón Educativo.',
    api: 'No se pudo conectar con Empujón Educativo. Intentá más tarde.',
  }[err] || '';
  res.send(page('Ingresar', `
    <div style="max-width:380px;margin:0 auto">
      <div style="text-align:center;margin-bottom:28px">
        <div style="font-size:1.8rem;font-weight:800;letter-spacing:-.02em;margin-bottom:6px">
          empujón<span style="color:#6366f1">.</span>artifacts
        </div>
        <p style="color:#9ca3af;font-size:.9rem">Ingresá con tu cuenta de Empujón Educativo</p>
      </div>
      ${errMsg ? `<div class="alert alert-error">${errMsg}</div>` : ''}
      <form method="POST" action="/login">
        <label>Email</label>
        <input type="email" name="username" autofocus autocomplete="email" required placeholder="tu@email.com">
        <label>Contraseña</label>
        <input type="password" name="password" autocomplete="current-password" required>
        <button type="submit" class="btn btn-primary" style="width:100%;padding:12px;font-size:.95rem;margin-top:4px">Ingresar</button>
      </form>
    </div>
  `));
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.redirect('/login?error=credentials');
  let empujonRes;
  try {
    empujonRes = await fetch(`${EMPUJON_API}/api/token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.trim().toLowerCase(), password }),
    });
  } catch { return res.redirect('/login?error=api'); }

  if (empujonRes.status === 403) return res.redirect('/login?error=norole');
  if (!empujonRes.ok) return res.redirect('/login?error=credentials');

  const data = await empujonRes.json();
  const payload = decodeJwtPayload(data.access);
  if (!payload?.user_id) return res.redirect('/login?error=credentials');

  const empujonUserId = payload.user_id;
  const email = username.trim().toLowerCase();
  const isAdmin = data.is_admin || data.is_staff ? 1 : 0;

  let user = db.prepare('SELECT * FROM users WHERE empujon_user_id = ?').get(empujonUserId);
  if (!user) {
    const apiToken = randomBytes(32).toString('hex');
    db.prepare('INSERT INTO users (empujon_user_id, email, is_admin, api_token) VALUES (?,?,?,?)')
      .run(empujonUserId, email, isAdmin, apiToken);
    user = db.prepare('SELECT * FROM users WHERE empujon_user_id = ?').get(empujonUserId);
  } else {
    db.prepare("UPDATE users SET email=?, is_admin=?, last_login_at=datetime('now') WHERE id=?")
      .run(email, isAdmin, user.id);
    user = { ...user, email, is_admin: isAdmin };
  }
  req.session.user = { id: user.id, email: user.email, is_admin: user.is_admin };
  console.log(`[login] ${email} (empujon_id=${empujonUserId}, admin=${isAdmin})`);
  res.redirect('/dashboard');
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });

// ── Dashboard ─────────────────────────────────────────────────────────────────

app.get('/dashboard', requireAuth, (req, res) => {
  const { user } = req.session;
  const dbUser = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  const all = listArtifacts(user.is_admin ? null : user.email);

  const adminCol = user.is_admin ? '<th>Usuario</th>' : '';
  const rows = all.length ? all.map(a => {
    const commentCount = db.prepare('SELECT COUNT(*) as c FROM comments WHERE artifact_id=?').get(a.id).c;
    const v = a.version || 1;
    return `
    <tr>
      <td>
        <a href="/${a.id}/view" style="color:#4f46e5;font-weight:500">${a.title || '(sin título)'}</a>
        <span class="version-pill">v${v}</span>
        ${commentCount > 0 ? `<span class="badge badge-indigo" style="margin-left:4px">💬 ${commentCount}</span>` : ''}
      </td>
      ${user.is_admin ? `<td><span class="badge badge-indigo">${(a.email || '').split('@')[0]}</span></td>` : ''}
      <td><span class="mono">${a.id}</span></td>
      <td style="color:#bbb;font-size:.82rem">${new Date(a.createdAt).toLocaleDateString('es-AR')}</td>
      <td style="text-align:right;white-space:nowrap">
        <a href="/${a.id}" target="_blank" class="btn btn-ghost btn-sm" style="margin-right:4px">Ver</a>
        <a href="/${a.id}/view" class="btn btn-ghost btn-sm" style="margin-right:4px">💬</a>
        <form method="POST" action="/dashboard/delete/${a.id}" style="display:inline"
          onsubmit="return confirm('¿Eliminar este artefacto y todas sus versiones?')">
          <button class="btn btn-danger btn-sm">Borrar</button>
        </form>
      </td>
    </tr>`;
  }).join('')
    : `<tr><td colspan="${user.is_admin ? 5 : 4}" class="empty">No hay artefactos todavía</td></tr>`;

  res.send(page('Dashboard', `
    <h1>Mis artefactos</h1>
    <p class="sub">${all.length} artefacto${all.length !== 1 ? 's' : ''}</p>
    <details>
      <summary>API token para el skill de Claude</summary>
      <div class="token-card">
        <div class="token-val">${dbUser.api_token}</div>
        <div class="hint">export ARTIFACT_TOKEN="${dbUser.api_token}"</div>
      </div>
    </details>
    <div class="sep"></div>
    <table>
      <thead><tr><th>Título</th>${adminCol}<th>ID</th><th>Fecha</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `, user));
});

app.post('/dashboard/delete/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  if (!VALID_ID.test(id)) return res.status(400).send('ID inválido');
  const meta = readMeta(id);
  const { user } = req.session;
  if (!user.is_admin && meta.email !== user.email) return res.status(403).send('Sin permiso');
  // Delete all versions + metadata + comments
  const versions = meta.version || 1;
  for (let v = 1; v <= versions; v++) {
    const vp = versionPath(id, v);
    if (existsSync(vp)) unlinkSync(vp);
  }
  [join(ARTIFACTS_DIR, `${id}.html`), metaPath(id), commentsPath(id)].forEach(p => {
    if (existsSync(p)) unlinkSync(p);
  });
  db.prepare('DELETE FROM comments WHERE artifact_id=?').run(id);
  res.redirect('/dashboard');
});

// ── Admin ─────────────────────────────────────────────────────────────────────

app.get('/admin', requireAuth, requireAdmin, (req, res) => {
  const { user } = req.session;
  const users = db.prepare('SELECT * FROM users ORDER BY first_login_at').all();
  const rows = users.map(u => `
    <tr>
      <td><strong>${u.email}</strong>${u.is_admin ? ' <span class="badge badge-amber">admin</span>' : ''}</td>
      <td><span class="mono">${u.api_token.slice(0, 18)}…</span></td>
      <td style="color:#bbb;font-size:.82rem">${new Date(u.last_login_at).toLocaleDateString('es-AR')}</td>
      <td style="text-align:right">
        ${u.id !== user.id ? `
          <form method="POST" action="/admin/users/${u.id}/delete" style="display:inline"
            onsubmit="return confirm('¿Revocar acceso de ${u.email}?')">
            <button class="btn btn-danger btn-sm">Revocar</button>
          </form>` : '<span style="color:#e5e7eb;font-size:.8rem">tú</span>'}
      </td>
    </tr>`).join('');
  res.send(page('Admin', `
    <h1>Administración</h1>
    <p class="sub">Usuarios que han ingresado con su cuenta de Empujón Educativo</p>
    <table>
      <thead><tr><th>Email</th><th>API Token</th><th>Último login</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="4" class="empty">Sin usuarios aún</td></tr>`}</tbody>
    </table>
  `, user));
});

app.post('/admin/users/:id/delete', requireAuth, requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  if (id === req.session.user.id) return res.redirect('/admin');
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.redirect('/admin');
});

// ── View page (artifact + comments) ──────────────────────────────────────────

app.get('/:id/view', (req, res) => {
  const { id } = req.params;
  if (!VALID_ID.test(id)) return res.status(404).send('No encontrado');
  const fp = join(ARTIFACTS_DIR, `${id}.html`);
  if (!existsSync(fp)) return res.status(404).send('Artefacto no encontrado');

  const meta = readMeta(id);
  const comments = db.prepare('SELECT * FROM comments WHERE artifact_id=? ORDER BY created_at ASC').all(id);
  const sessionUser = req.session?.user;
  const v = meta.version || 1;

  const versionLinks = v > 1 ? Array.from({ length: v }, (_, i) => i + 1).map(n =>
    `<a href="/${id}/v/${n}" target="_blank" class="btn btn-ghost btn-sm" style="font-size:.75rem">v${n}</a>`
  ).join(' ') : '';

  const commentItems = comments.map(c => `
    <div class="comment">
      <div class="comment-header">
        <span class="comment-author">${c.email.split('@')[0]}</span>
        <div style="display:flex;gap:8px;align-items:center">
          <span class="comment-date">${new Date(c.created_at).toLocaleString('es-AR')}</span>
          ${sessionUser && (sessionUser.email === c.email || sessionUser.is_admin) ? `
            <form method="POST" action="/${id}/comments/${c.id}/delete" style="display:inline">
              <button class="btn btn-danger btn-sm" style="padding:2px 8px;font-size:.72rem">×</button>
            </form>` : ''}
        </div>
      </div>
      <div class="comment-text">${c.text.replace(/</g, '&lt;')}</div>
    </div>`).join('');

  const commentForm = sessionUser ? `
    <form method="POST" action="/${id}/comments" style="margin-top:20px">
      <label>Tu comentario</label>
      <textarea name="text" required placeholder="Escribí tu comentario..."></textarea>
      <button type="submit" class="btn btn-primary btn-sm">Comentar</button>
    </form>` : `
    <p style="margin-top:20px;font-size:.85rem;color:#aaa">
      <a href="/login" style="color:#6366f1">Ingresá</a> para comentar.
    </p>`;

  res.send(page(meta.title || id, `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;flex-wrap:wrap;gap:8px">
      <div>
        <h1>${meta.title || id} <span class="version-pill">v${v}</span></h1>
        <p class="sub" style="margin-bottom:0">${(meta.email || '').split('@')[0]} · ${new Date(meta.createdAt).toLocaleDateString('es-AR')}
          ${v > 1 ? `· <span style="font-size:.8rem">Versiones: ${versionLinks}</span>` : ''}
        </p>
      </div>
      <a href="/${id}" target="_blank" class="btn btn-ghost btn-sm">Abrir ↗</a>
    </div>
    <iframe src="/${id}" style="width:100%;height:560px;border:1.5px solid #e5e7eb;border-radius:8px;background:#fff" loading="lazy"></iframe>
    <div class="sep"></div>
    <h2 style="font-size:1rem;font-weight:700;margin-bottom:16px">Comentarios (${comments.length})</h2>
    ${commentItems || '<p style="color:#bbb;font-size:.88rem">Sin comentarios todavía.</p>'}
    ${commentForm}
  `, sessionUser));
});

app.post('/:id/comments', requireAuth, (req, res) => {
  const { id } = req.params;
  if (!VALID_ID.test(id)) return res.status(400).send('ID inválido');
  const { text } = req.body;
  if (!text?.trim()) return res.redirect(`/${id}/view`);
  db.prepare("INSERT INTO comments (artifact_id, email, text) VALUES (?,?,?)")
    .run(id, req.session.user.email, text.trim());
  res.redirect(`/${id}/view`);
});

app.post('/:id/comments/:commentId/delete', requireAuth, (req, res) => {
  const { id, commentId } = req.params;
  const comment = db.prepare('SELECT * FROM comments WHERE id=? AND artifact_id=?').get(commentId, id);
  if (!comment) return res.redirect(`/${id}/view`);
  const { user } = req.session;
  if (user.email !== comment.email && !user.is_admin) return res.status(403).send('Sin permiso');
  db.prepare('DELETE FROM comments WHERE id=?').run(commentId);
  res.redirect(`/${id}/view`);
});

// ── API ───────────────────────────────────────────────────────────────────────

app.post('/deploy', apiAuth, (req, res) => {
  const { html: htmlContent, title, id: existingId } = req.body;
  if (!htmlContent || typeof htmlContent !== 'string') {
    return res.status(400).json({ error: 'html field required' });
  }

  // Update existing artifact (new version)
  if (existingId) {
    if (!VALID_ID.test(existingId)) return res.status(400).json({ error: 'id inválido' });
    const meta = readMeta(existingId);
    if (!meta.id) return res.status(404).json({ error: 'Artefacto no encontrado' });
    if (!req.apiUser.is_admin && meta.email !== req.apiUser.email) {
      return res.status(403).json({ error: 'Sin permiso para actualizar este artefacto' });
    }
    const currentVersion = meta.version || 1;
    // Archive current version
    const currentHtml = readFileSync(join(ARTIFACTS_DIR, `${existingId}.html`), 'utf8');
    writeFileSync(versionPath(existingId, currentVersion), currentHtml, 'utf8');
    // Save new version as latest
    const newVersion = currentVersion + 1;
    saveArtifactContent(existingId, htmlContent, title || meta.title);
    writeMeta(existingId, {
      ...meta,
      title: title || meta.title,
      version: newVersion,
      updatedAt: new Date().toISOString(),
      versions: [...(meta.versions || [{ v: 1, createdAt: meta.createdAt }]),
        { v: newVersion, createdAt: new Date().toISOString(), email: req.apiUser.email }],
    });
    console.log(`[update] ${existingId} → v${newVersion} by ${req.apiUser.email}`);
    return res.json({ id: existingId, url: `${BASE_URL}/${existingId}`, viewUrl: `${BASE_URL}/${existingId}/view`, version: newVersion });
  }

  // New artifact
  const id = newId();
  saveArtifactContent(id, htmlContent, title);
  writeMeta(id, { id, title: title || null, email: req.apiUser.email, createdAt: new Date().toISOString(), version: 1, versions: [{ v: 1, createdAt: new Date().toISOString() }] });
  console.log(`[deploy] ${id} — "${title || ''}" by ${req.apiUser.email}`);
  res.json({ id, url: `${BASE_URL}/${id}`, viewUrl: `${BASE_URL}/${id}/view`, version: 1, title: title || null });
});

app.get('/api/artifacts', apiAuth, (req, res) => {
  const artifacts = listArtifacts(req.apiUser.is_admin ? null : req.apiUser.email);
  res.json({ count: artifacts.length, artifacts });
});

app.delete('/api/artifacts/:id', apiAuth, (req, res) => {
  const { id } = req.params;
  if (!VALID_ID.test(id)) return res.status(400).json({ error: 'ID inválido' });
  const meta = readMeta(id);
  if (!req.apiUser.is_admin && meta.email !== req.apiUser.email) {
    return res.status(403).json({ error: 'Sin permiso' });
  }
  const fp = join(ARTIFACTS_DIR, `${id}.html`);
  if (!existsSync(fp)) return res.status(404).json({ error: 'No encontrado' });
  const versions = meta.version || 1;
  for (let v = 1; v <= versions; v++) {
    const vp = versionPath(id, v);
    if (existsSync(vp)) unlinkSync(vp);
  }
  [fp, metaPath(id), commentsPath(id)].forEach(p => { if (existsSync(p)) unlinkSync(p); });
  db.prepare('DELETE FROM comments WHERE artifact_id=?').run(id);
  res.json({ deleted: id });
});

// ── Public artifact serving ───────────────────────────────────────────────────

app.get('/:id/v/:version', (req, res) => {
  const { id, version } = req.params;
  if (!VALID_ID.test(id)) return res.status(404).send('No encontrado');
  const vNum = parseInt(version);
  if (isNaN(vNum) || vNum < 1) return res.status(400).send('Versión inválida');
  const meta = readMeta(id);
  const latest = meta.version || 1;
  // Latest version is the main file
  const fp = vNum === latest
    ? join(ARTIFACTS_DIR, `${id}.html`)
    : versionPath(id, vNum);
  if (!existsSync(fp)) return res.status(404).send(`Versión ${vNum} no encontrada`);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(readFileSync(fp, 'utf8'));
});

app.get('/:id', (req, res) => {
  const { id } = req.params;
  if (!VALID_ID.test(id)) return res.status(404).send('No encontrado');
  const fp = join(ARTIFACTS_DIR, `${id}.html`);
  if (!existsSync(fp)) return res.status(404).send('Artefacto no encontrado');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(readFileSync(fp, 'utf8'));
});

app.listen(PORT, () => {
  console.log(`artifact-server on :${PORT} — ${BASE_URL}`);
  console.log(`Empujón API: ${EMPUJON_API}`);
});
