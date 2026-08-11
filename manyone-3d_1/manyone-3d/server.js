'use strict';

/**
 * Manyone 3D — minimal GLB sharing + true-scale AR
 *
 * Flow:
 *   Desktop  (/)        upload a .glb, inspect it in 3D, click "Create Link"
 *   Upload   (/api/upload)  stores the .glb + an auto-generated .usdz, returns a link
 *   Mobile   (/v/:id)   clean loading screen -> 3D viewer -> "AR" (iOS Quick Look, 1:1 scale)
 *   Assets   (/m/:id/model.glb | model.usdz)  the stored model files
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---- retention: a shared model is kept for 7 days, then auto-deleted --------
// (Anything the user uploads but never turns into a link is never sent here,
//  so it is never stored in the first place.)
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function dirAgeMs(dir) {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    const t = Date.parse(meta.created);
    if (!Number.isNaN(t)) return Date.now() - t;
  } catch (_) { /* fall through */ }
  try { return Date.now() - fs.statSync(dir).mtimeMs; } catch (_) { return Infinity; }
}
function isExpired(dir) { return dirAgeMs(dir) > RETENTION_MS; }
function removeDir(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} }

// Lazily expire on access, and sweep everything hourly.
function expiredThenGone(id) {
  const dir = path.join(UPLOAD_DIR, id);
  if (!fs.existsSync(dir)) return true;
  if (isExpired(dir)) { removeDir(dir); return true; }
  return false;
}
function sweepExpired() {
  try {
    for (const id of fs.readdirSync(UPLOAD_DIR)) {
      const dir = path.join(UPLOAD_DIR, id);
      try { if (!fs.statSync(dir).isDirectory()) continue; } catch (_) { continue; }
      if (isExpired(dir)) removeDir(dir);
    }
  } catch (_) {}
}
sweepExpired();
setInterval(sweepExpired, 60 * 60 * 1000).unref();

// ---- helpers ---------------------------------------------------------------

// Short, URL-safe, unguessable id (base64url, letters+digits only).
function makeId() {
  return crypto.randomBytes(12).toString('base64url').replace(/[^A-Za-z0-9]/g, '').slice(0, 12);
}

const MAX_BYTES = 150 * 1024 * 1024; // 150 MB per file

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 2 }
});

// ---- static ----------------------------------------------------------------

app.use('/assets', express.static(path.join(PUBLIC_DIR, 'assets'), { maxAge: '1h' }));

// ---- pages -----------------------------------------------------------------

app.get('/', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'desktop.html'));
});

app.get('/v/:id', (req, res) => {
  const id = req.params.id;
  const dir = path.join(UPLOAD_DIR, id);
  if (!/^[A-Za-z0-9]+$/.test(id) || expiredThenGone(id) || !fs.existsSync(path.join(dir, 'model.glb'))) {
    return res.status(404).sendFile(path.join(PUBLIC_DIR, 'notfound.html'));
  }
  res.sendFile(path.join(PUBLIC_DIR, 'view.html'));
});

// ---- model files -----------------------------------------------------------

const TYPES = {
  'model.glb': 'model/gltf-binary',
  // Correct MIME is required for iOS Quick Look to trigger AR.
  'model.usdz': 'model/vnd.usdz+zip'
};

app.get('/m/:id/:file', (req, res) => {
  const { id, file } = req.params;
  if (!/^[A-Za-z0-9]+$/.test(id) || !TYPES[file]) return res.status(404).end();
  if (expiredThenGone(id)) return res.status(404).end();
  const filePath = path.join(UPLOAD_DIR, id, file);
  if (!fs.existsSync(filePath)) return res.status(404).end();
  res.setHeader('Content-Type', TYPES[file]);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  fs.createReadStream(filePath).pipe(res);
});

// ---- upload ----------------------------------------------------------------

app.post('/api/upload', upload.fields([{ name: 'glb', maxCount: 1 }, { name: 'usdz', maxCount: 1 }]), (req, res) => {
  try {
    const glb = req.files && req.files.glb && req.files.glb[0];
    const usdz = req.files && req.files.usdz && req.files.usdz[0];
    if (!glb) return res.status(400).json({ error: 'Missing GLB file.' });

    const id = makeId();
    const dir = path.join(UPLOAD_DIR, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'model.glb'), glb.buffer);
    if (usdz && usdz.buffer && usdz.buffer.length > 0) {
      fs.writeFileSync(path.join(dir, 'model.usdz'), usdz.buffer);
    }
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({
      id,
      name: (req.body && req.body.name) || glb.originalname || 'model.glb',
      hasUSDZ: Boolean(usdz),
      created: new Date().toISOString()
    }, null, 2));

    res.json({ id, view: `/v/${id}` });
  } catch (err) {
    console.error('upload failed:', err);
    res.status(500).json({ error: 'Upload failed.' });
  }
});

// Small endpoint so the viewer can show the original file name (optional/quiet).
app.get('/api/meta/:id', (req, res) => {
  const id = req.params.id;
  if (!/^[A-Za-z0-9]+$/.test(id) || expiredThenGone(id)) return res.status(404).json({});
  const metaPath = path.join(UPLOAD_DIR, id, 'meta.json');
  if (!fs.existsSync(metaPath)) return res.status(404).json({});
  res.type('application/json').send(fs.readFileSync(metaPath, 'utf8'));
});

app.use((err, _req, res, _next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large (max 150 MB).' });
  console.error(err);
  res.status(500).json({ error: 'Server error.' });
});

app.listen(PORT, () => {
  console.log(`Manyone 3D running on http://localhost:${PORT}`);
});
