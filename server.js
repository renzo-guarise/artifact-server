import express from 'express';
import { randomBytes } from 'crypto';
import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3456;
const TOKEN = process.env.ARTIFACT_TOKEN;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const ARTIFACTS_DIR = join(__dirname, 'artifacts');

if (!TOKEN) {
  console.error('ERROR: ARTIFACT_TOKEN env var is required');
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: '10mb' }));

function auth(req, res, next) {
  const header = req.headers['authorization'] || '';
  if (header !== `Bearer ${TOKEN}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function newId() {
  return randomBytes(6).toString('hex');
}

// Deploy an HTML artifact
app.post('/deploy', auth, (req, res) => {
  const { html, title } = req.body;
  if (!html || typeof html !== 'string') {
    return res.status(400).json({ error: 'html field required' });
  }

  const id = newId();
  const filename = `${id}.html`;
  const filepath = join(ARTIFACTS_DIR, filename);

  // Inject a title meta if provided and not already present
  let content = html;
  if (title && !html.includes('<title>')) {
    content = html.replace('<head>', `<head><title>${title}</title>`);
    if (!content.includes('<title>')) {
      content = `<!DOCTYPE html><html><head><title>${title}</title></head><body>${html}</body></html>`;
    }
  }

  writeFileSync(filepath, content, 'utf8');

  const url = `${BASE_URL}/${id}`;
  console.log(`[deploy] ${id} — ${title || '(no title)'}`);
  res.json({ id, url, title: title || null });
});

// Serve an artifact
app.get('/:id', (req, res) => {
  const { id } = req.params;
  if (!/^[a-f0-9]{12}$/.test(id)) {
    return res.status(404).send('Not found');
  }
  const filepath = join(ARTIFACTS_DIR, `${id}.html`);
  if (!existsSync(filepath)) {
    return res.status(404).send('Artifact not found');
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(readFileSync(filepath, 'utf8'));
});

// List artifacts
app.get('/', auth, (req, res) => {
  const files = readdirSync(ARTIFACTS_DIR)
    .filter(f => f.endsWith('.html'))
    .map(f => {
      const id = f.replace('.html', '');
      const stat = statSync(join(ARTIFACTS_DIR, f));
      return { id, url: `${BASE_URL}/${id}`, createdAt: stat.birthtime };
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ count: files.length, artifacts: files });
});

// Delete an artifact
app.delete('/:id', auth, (req, res) => {
  const { id } = req.params;
  if (!/^[a-f0-9]{12}$/.test(id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }
  const filepath = join(ARTIFACTS_DIR, `${id}.html`);
  if (!existsSync(filepath)) {
    return res.status(404).json({ error: 'Not found' });
  }
  unlinkSync(filepath);
  res.json({ deleted: id });
});

app.listen(PORT, () => {
  console.log(`artifact-server running on port ${PORT}`);
  console.log(`BASE_URL: ${BASE_URL}`);
});
