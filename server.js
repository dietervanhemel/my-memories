const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { v4: uuidv4 } = require('uuid');
const QRCode  = require('qrcode');

const app  = express();
const PORT = process.env.PORT || 3000;

// Dashboard password — change this!
const DASHBOARD_PASSWORD = 'bruid2024';

// Ensure directories exist
const uploadsDir = path.join(__dirname, 'uploads');
const dataDir    = path.join(__dirname, 'data');
const bannerDir  = path.join(__dirname, 'public', 'banner');
[uploadsDir, dataDir, bannerDir].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

const eventsFile = path.join(dataDir, 'events.json');

// ─── Helpers ────────────────────────────────────────────────────────────────

function readEvents() {
  try {
    const raw  = fs.readFileSync(eventsFile, 'utf-8').replace(/^\uFEFF/, ''); // strip BOM
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [data]; // guard against PS serialisation bug
  } catch { return []; }
}
function writeEvents(data) { fs.writeFileSync(eventsFile, JSON.stringify(data, null, 2)); }

function auth(req, res, next) {
  if (req.query.password !== DASHBOARD_PASSWORD) return res.status(401).json({ error: 'Niet geautoriseerd' });
  next();
}

// ─── One-time migration from legacy single-event files ───────────────────────

if (!fs.existsSync(eventsFile)) {
  let s = { theme: 'green', eventType: '', bannerUrl: null, guestPassword: '', welcomeTitle: '', welcomeSubtitle: '' };
  let p = [];
  try { s = JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf-8')); } catch {}
  try { p = JSON.parse(fs.readFileSync(path.join(dataDir, 'photos.json'),   'utf-8')); } catch {}
  writeEvents([{
    id: uuidv4(), name: s.welcomeTitle || 'Mijn evenement', createdAt: new Date().toISOString(),
    theme: s.theme || 'green', eventType: s.eventType || '', bannerUrl: s.bannerUrl || null,
    guestPassword: s.guestPassword || '', welcomeTitle: s.welcomeTitle || '', welcomeSubtitle: s.welcomeSubtitle || '',
    photos: p
  }]);
}

// ─── Multer: photos ──────────────────────────────────────────────────────────

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename:    (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /jpeg|jpg|png|gif|webp|heic|heif/.test(path.extname(file.originalname).toLowerCase())
            || /image\//.test(file.mimetype);
    cb(ok ? null : new Error('Alleen afbeeldingen zijn toegestaan'), ok);
  }
});

// ─── Multer: banner ──────────────────────────────────────────────────────────

const bannerUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, bannerDir),
    filename:    (req, file, cb) => cb(null, `banner-${req.params.eid}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: 10 * 1024 * 1024 }
});

// ─── Middleware ──────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));

// ─── Auth ────────────────────────────────────────────────────────────────────

app.post('/api/auth', (req, res) => {
  req.body.password === DASHBOARD_PASSWORD
    ? res.json({ success: true })
    : res.status(401).json({ error: 'Onjuist wachtwoord' });
});

// ─── Events CRUD (protected) ─────────────────────────────────────────────────

// List all events (summary — no photo payloads)
app.get('/api/events', auth, (req, res) => {
  const events = readEvents();
  res.json(events.map(e => ({
    id: e.id, name: e.name, createdAt: e.createdAt,
    eventType: e.eventType || '', theme: e.theme || 'green',
    totalUploaders: (e.photos || []).length,
    totalPhotos: (e.photos || []).reduce((s, u) => s + u.photos.length, 0)
  })));
});

// Create new event
app.post('/api/events', auth, (req, res) => {
  if (!req.body.name?.trim()) return res.status(400).json({ error: 'Naam is verplicht' });
  const events = readEvents();
  const evt = {
    id: uuidv4(), name: req.body.name.trim(), createdAt: new Date().toISOString(),
    theme: 'green', eventType: '', bannerUrl: null,
    guestPassword: '', welcomeTitle: req.body.name.trim(), welcomeSubtitle: '', photos: []
  };
  events.push(evt);
  writeEvents(events);
  res.json({ success: true, id: evt.id, name: evt.name, createdAt: evt.createdAt, eventType: '', theme: 'green', totalUploaders: 0, totalPhotos: 0 });
});

// Delete event
app.delete('/api/events/:eid', auth, (req, res) => {
  const events = readEvents();
  const idx    = events.findIndex(e => e.id === req.params.eid);
  if (idx === -1) return res.status(404).json({ error: 'Niet gevonden' });
  (events[idx].photos || []).forEach(u => u.photos.forEach(p => {
    const fp = path.join(uploadsDir, p.filename); if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }));
  if (events[idx].bannerUrl) {
    const fp = path.join(__dirname, 'public', events[idx].bannerUrl);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }
  events.splice(idx, 1);
  writeEvents(events);
  res.json({ success: true });
});

// ─── Public: guest page (event-scoped) ───────────────────────────────────────

app.get('/api/events/:eid/settings', (req, res) => {
  const evt = readEvents().find(e => e.id === req.params.eid);
  if (!evt) return res.status(404).json({ error: 'Niet gevonden' });
  const out = { theme: evt.theme || 'green', eventType: evt.eventType || '', bannerUrl: evt.bannerUrl || null,
    hasGuestPassword: !!evt.guestPassword, welcomeTitle: evt.welcomeTitle || '', welcomeSubtitle: evt.welcomeSubtitle || '' };
  if (req.query.password === DASHBOARD_PASSWORD) out.guestPassword = evt.guestPassword || '';
  res.json(out);
});

app.post('/api/events/:eid/verify-guest-password', (req, res) => {
  const evt = readEvents().find(e => e.id === req.params.eid);
  if (!evt) return res.status(404).json({ error: 'Niet gevonden' });
  if (!evt.guestPassword) return res.json({ success: true });
  req.body.password === evt.guestPassword
    ? res.json({ success: true })
    : res.status(401).json({ error: 'Onjuist wachtwoord' });
});

app.post('/api/events/:eid/upload', upload.array('photos', 30), (req, res) => {
  const events = readEvents();
  const idx    = events.findIndex(e => e.id === req.params.eid);
  if (idx === -1) return res.status(404).json({ error: 'Evenement niet gevonden' });
  if (!req.body.name?.trim()) return res.status(400).json({ error: 'Naam is verplicht' });
  if (!req.files?.length)     return res.status(400).json({ error: "Geen foto's ontvangen" });
  const entry = {
    id: uuidv4(), name: req.body.name.trim(), message: (req.body.message || '').trim(),
    uploadedAt: new Date().toISOString(),
    photos: req.files.map(f => ({ id: uuidv4(), filename: f.filename, originalName: f.originalname, size: f.size, uploadedAt: new Date().toISOString() }))
  };
  if (!events[idx].photos) events[idx].photos = [];
  events[idx].photos.push(entry);
  writeEvents(events);
  res.json({ success: true, count: req.files.length, uploadId: entry.id });
});

// ─── Protected: photos & stats (event-scoped) ────────────────────────────────

app.get('/api/events/:eid/photos', auth, (req, res) => {
  const evt = readEvents().find(e => e.id === req.params.eid);
  if (!evt) return res.status(404).json({ error: 'Niet gevonden' });
  res.json(evt.photos || []);
});

app.get('/api/events/:eid/stats', auth, (req, res) => {
  const evt = readEvents().find(e => e.id === req.params.eid);
  if (!evt) return res.status(404).json({ error: 'Niet gevonden' });
  const photos = evt.photos || [];
  const totalPhotos = photos.reduce((s, u) => s + u.photos.length, 0);
  const totalSize   = photos.reduce((s, u) => s + u.photos.reduce((x, p) => x + p.size, 0), 0);
  res.json({ totalUploaders: photos.length, totalPhotos, totalSizeMB: (totalSize / 1048576).toFixed(1) });
});

app.delete('/api/events/:eid/photos/:uid/:pid', auth, (req, res) => {
  const events = readEvents();
  const ei     = events.findIndex(e => e.id === req.params.eid);
  if (ei === -1) return res.status(404).json({ error: 'Niet gevonden' });
  const entry  = (events[ei].photos || []).find(u => u.id === req.params.uid);
  if (!entry) return res.status(404).json({ error: 'Niet gevonden' });
  const photo  = entry.photos.find(p => p.id === req.params.pid);
  if (!photo) return res.status(404).json({ error: 'Niet gevonden' });
  const fp = path.join(uploadsDir, photo.filename); if (fs.existsSync(fp)) fs.unlinkSync(fp);
  entry.photos = entry.photos.filter(p => p.id !== req.params.pid);
  if (!entry.photos.length) events[ei].photos = events[ei].photos.filter(u => u.id !== req.params.uid);
  writeEvents(events);
  res.json({ success: true });
});

app.delete('/api/events/:eid/uploads/:uid', auth, (req, res) => {
  const events = readEvents();
  const ei     = events.findIndex(e => e.id === req.params.eid);
  if (ei === -1) return res.status(404).json({ error: 'Niet gevonden' });
  const idx    = (events[ei].photos || []).findIndex(u => u.id === req.params.uid);
  if (idx === -1) return res.status(404).json({ error: 'Niet gevonden' });
  events[ei].photos[idx].photos.forEach(p => { const fp = path.join(uploadsDir, p.filename); if (fs.existsSync(fp)) fs.unlinkSync(fp); });
  events[ei].photos.splice(idx, 1);
  writeEvents(events);
  res.json({ success: true });
});

// ─── Protected: settings, banner, QR ─────────────────────────────────────────

app.post('/api/events/:eid/settings', auth, (req, res) => {
  const events = readEvents();
  const ei     = events.findIndex(e => e.id === req.params.eid);
  if (ei === -1) return res.status(404).json({ error: 'Niet gevonden' });
  ['name','theme','bannerUrl','guestPassword','eventType','welcomeTitle','welcomeSubtitle'].forEach(k => {
    if (req.body[k] !== undefined) events[ei][k] = req.body[k];
  });
  writeEvents(events);
  res.json({ success: true });
});

app.post('/api/events/:eid/upload-banner', auth, bannerUpload.single('banner'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Geen bestand ontvangen' });
  const events = readEvents();
  const ei     = events.findIndex(e => e.id === req.params.eid);
  if (ei === -1) return res.status(404).json({ error: 'Niet gevonden' });
  if (events[ei].bannerUrl) {
    const fp = path.join(__dirname, 'public', events[ei].bannerUrl);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }
  events[ei].bannerUrl = '/banner/' + req.file.filename;
  writeEvents(events);
  res.json({ success: true, bannerUrl: events[ei].bannerUrl });
});

app.delete('/api/events/:eid/banner', auth, (req, res) => {
  const events = readEvents();
  const ei     = events.findIndex(e => e.id === req.params.eid);
  if (ei === -1) return res.status(404).json({ error: 'Niet gevonden' });
  if (events[ei].bannerUrl) {
    const fp = path.join(__dirname, 'public', events[ei].bannerUrl);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }
  events[ei].bannerUrl = null;
  writeEvents(events);
  res.json({ success: true });
});

app.get('/api/events/:eid/qrcode', auth, async (req, res) => {
  const baseUrl = req.query.url || `http://localhost:${PORT}`;
  try {
    const evt = readEvents().find(e => e.id === req.params.eid);
    const COLORS = { green:'#1e4d28', rose:'#5c3d2e', navy:'#1a2d5a', lavender:'#4a2870', sage:'#4a3820', midnight:'#1a1a10' };
    const dark   = COLORS[(evt && evt.theme) || 'green'] || '#1e4d28';
    const url    = `${baseUrl}?event=${req.params.eid}`;
    const qr     = await QRCode.toDataURL(url, { width: 400, margin: 2, color: { dark, light: '#ffffff' } });
    res.json({ qr, url });
  } catch { res.status(500).json({ error: 'QR generatie mislukt' }); }
});

app.listen(PORT, () => {
  console.log(`\n  My Memories draait op http://localhost:${PORT}`);
  console.log(`  Dashboard:  http://localhost:${PORT}/dashboard.html`);
  console.log(`  Wachtwoord: ${DASHBOARD_PASSWORD}\n`);
});
