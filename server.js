const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const os       = require('os');
const { v4: uuidv4 } = require('uuid');
const QRCode   = require('qrcode');
const archiver = require('archiver');

const app  = express();
const PORT = process.env.PORT || 3000;

const DASHBOARD_PASSWORD = 'bruid2024';

const uploadsDir = path.join(__dirname, 'uploads');
const dataDir    = path.join(__dirname, 'data');
const bannerDir  = path.join(__dirname, 'public', 'banner');
[uploadsDir, dataDir, bannerDir].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

const eventsFile = path.join(dataDir, 'events.json');

// ─── Helpers ────────────────────────────────────────────────────────────────

function readEvents() {
  try {
    const raw  = fs.readFileSync(eventsFile, 'utf-8').replace(/^\uFEFF/, '');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [data];
  } catch { return []; }
}
function writeEvents(data) { fs.writeFileSync(eventsFile, JSON.stringify(data, null, 2)); }

function auth(req, res, next) {
  if (req.query.password !== DASHBOARD_PASSWORD) return res.status(401).json({ error: 'Niet geautoriseerd' });
  next();
}

// ─── Slug helpers ────────────────────────────────────────────────────────────

function slugify(name) {
  return String(name)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'event';
}

function makeUniqueSlug(name, events, excludeId) {
  const base = slugify(name);
  let slug = base, n = 2;
  while (events.some(e => e.slug === slug && e.id !== excludeId)) {
    slug = base + '-' + n++;
  }
  return slug;
}

// ─── One-time migration from legacy single-event files ───────────────────────

if (!fs.existsSync(eventsFile)) {
  let s = { theme: 'green', eventType: '', bannerUrl: null, guestPassword: '', welcomeTitle: '', welcomeSubtitle: '' };
  let p = [];
  try { s = JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf-8')); } catch {}
  try { p = JSON.parse(fs.readFileSync(path.join(dataDir, 'photos.json'),   'utf-8')); } catch {}
  const name = s.welcomeTitle || 'Mijn evenement';
  writeEvents([{
    id: uuidv4(), name, slug: slugify(name), createdAt: new Date().toISOString(),
    theme: s.theme || 'green', eventType: s.eventType || '', bannerUrl: s.bannerUrl || null,
    guestPassword: s.guestPassword || '', welcomeTitle: name, welcomeSubtitle: s.welcomeSubtitle || '',
    photos: p
  }]);
}

// ─── Migration: add slugs to existing events that don't have one ─────────────

(function ensureSlugs() {
  const events = readEvents();
  let changed = false;
  events.forEach(e => {
    if (!e.slug) {
      e.slug = makeUniqueSlug(e.name || e.welcomeTitle || 'event', events, e.id);
      changed = true;
    }
  });
  if (changed) writeEvents(events);
})();

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

// ─── Auto-generate PWA icons on first run ────────────────────────────────────

try {
  require('./scripts/generate-icons');
} catch (e) {
  console.warn('[icons] could not generate icons:', e.message);
}

// ─── Dynamic PWA manifest + downloads (must be BEFORE express.static) ────────

app.use(express.json());

const EVENT_THEME_COLORS = {
  wedding:     { bg: '#5c3d2e', theme: '#c9806b' },
  birthday:    { bg: '#8b1048', theme: '#e0407a' },
  babyshower:  { bg: '#1e5f88', theme: '#5ba3d0' },
  anniversary: { bg: '#6a5010', theme: '#b09030' },
  graduation:  { bg: '#1a2d5a', theme: '#2c4a8a' },
  christmas:   { bg: '#7a1510', theme: '#c0392b' },
  corporate:   { bg: '#0d4a70', theme: '#1a7ab0' },
  nieuwjaar:   { bg: '#1a0a40', theme: '#c8a020' },
};

function buildManifest(evt) {
  const colors = (evt && EVENT_THEME_COLORS[evt.eventType]) || { bg: '#0f1f13', theme: '#3a7d44' };
  const name   = evt ? evt.name : 'My Memories';
  const slug   = evt ? (evt.slug || '') : '';
  return {
    name:             name + ' · My Memories',
    short_name:       name.length > 14 ? name.slice(0, 13) + '\u2026' : name,
    description:      'Upload jouw foto\'s naar ' + name,
    start_url:        slug ? '/e/' + slug : '/',
    display:          'standalone',
    orientation:      'portrait',
    background_color: colors.bg,
    theme_color:      colors.theme,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ],
  };
}

// /e/:slug/manifest.json – used by the guest page via relative href="manifest.json"
app.get('/e/:slug/manifest.json', (req, res) => {
  const evt = readEvents().find(e => e.slug === req.params.slug) || null;
  res.setHeader('Content-Type', 'application/manifest+json');
  res.json(buildManifest(evt));
});

// /manifest.json?slug=xxx – fallback; must be before express.static or static file wins
app.get('/manifest.json', (req, res) => {
  if (req.query.slug) {
    const evt = readEvents().find(e => e.slug === req.query.slug) || null;
    if (evt) {
      res.setHeader('Content-Type', 'application/manifest+json');
      return res.json(buildManifest(evt));
    }
  }
  res.sendFile(path.join(__dirname, 'public', 'manifest.json'));
});

// Download routes – serve installer files from the project root
app.get('/download/install.bat', (req, res) => {
  res.download(path.join(__dirname, 'install.bat'), 'My-Memories-install.bat');
});
app.get('/download/start.bat', (req, res) => {
  res.download(path.join(__dirname, 'start.bat'), 'My-Memories-start.bat');
});

// ─── Static middleware & uploads ─────────────────────────────────────────────

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));

// ─── Guest upload page by slug ───────────────────────────────────────────────

app.get('/e/:slug', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Auth ────────────────────────────────────────────────────────────────────

app.post('/api/auth', (req, res) => {
  req.body.password === DASHBOARD_PASSWORD
    ? res.json({ success: true })
    : res.status(401).json({ error: 'Onjuist wachtwoord' });
});

// ─── Events CRUD (protected) ─────────────────────────────────────────────────

app.get('/api/events', auth, (req, res) => {
  const events = readEvents();
  res.json(events.map(e => ({
    id: e.id, name: e.name, slug: e.slug || slugify(e.name),
    createdAt: e.createdAt, eventType: e.eventType || '', theme: e.theme || '',
    archived: e.archived || false,
    totalUploaders: (e.photos || []).length,
    totalPhotos: (e.photos || []).reduce((s, u) => s + u.photos.length, 0),
    totalSizeMB: parseFloat(((e.photos || []).reduce((s, u) => s + u.photos.reduce((x, p) => x + (p.size || 0), 0), 0) / 1048576).toFixed(2))
  })));
});

app.patch('/api/events/:eid/archive', auth, (req, res) => {
  const events = readEvents();
  const ei = events.findIndex(e => e.id === req.params.eid);
  if (ei === -1) return res.status(404).json({ error: 'Niet gevonden' });
  events[ei].archived = !events[ei].archived;
  writeEvents(events);
  res.json({ success: true, archived: events[ei].archived });
});

// ─── Download: single event as ZIP ──────────────────────────────────────────

function streamEventsZip(evtList, res, zipName) {
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', err => { console.error('[zip]', err); res.end(); });
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
  archive.pipe(res);
  evtList.forEach(evt => {
    const folder = evt.name.replace(/[\\/:*?"<>|]/g, '_').trim() || evt.id;
    (evt.photos || []).forEach(uploader => {
      const uploaderFolder = uploader.name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'gast';
      uploader.photos.forEach(photo => {
        const fp = path.join(uploadsDir, photo.filename);
        if (fs.existsSync(fp)) {
          const ext  = path.extname(photo.filename);
          const base = path.basename(photo.originalName || photo.filename, ext);
          archive.file(fp, { name: `${folder}/${uploaderFolder}/${base}${ext}` });
        }
      });
    });
  });
  archive.finalize();
}

app.get('/api/events/:eid/download', auth, (req, res) => {
  const evt = readEvents().find(e => e.id === req.params.eid);
  if (!evt) return res.status(404).json({ error: 'Niet gevonden' });
  const safeName = evt.name.replace(/[\\/:*?"<>|]/g, '_').trim() || evt.id;
  streamEventsZip([evt], res, `${safeName}.zip`);
});

// ─── Download: multiple events as ZIP ───────────────────────────────────────

app.get('/api/download-bulk', auth, (req, res) => {
  const ids    = req.query.ids ? String(req.query.ids).split(',').filter(Boolean) : [];
  if (!ids.length) return res.status(400).json({ error: 'Geen evenementen opgegeven' });
  const all    = readEvents();
  const evtList = ids.map(id => all.find(e => e.id === id)).filter(Boolean);
  if (!evtList.length) return res.status(404).json({ error: 'Geen van de opgegeven evenementen gevonden' });
  streamEventsZip(evtList, res, 'my-memories.zip');
});

app.post('/api/events', auth, (req, res) => {
  if (!req.body.name?.trim()) return res.status(400).json({ error: 'Naam is verplicht' });
  const events = readEvents();
  const name   = req.body.name.trim();
  const slug   = makeUniqueSlug(name, events, null);
  const evt = {
    id: uuidv4(), name, slug, createdAt: new Date().toISOString(),
    theme: '', eventType: '', bannerUrl: null,
    guestPassword: '', welcomeTitle: name, welcomeSubtitle: '', photos: []
  };
  events.push(evt);
  writeEvents(events);
  res.json({ success: true, id: evt.id, name: evt.name, slug: evt.slug,
    createdAt: evt.createdAt, eventType: '', theme: '', totalUploaders: 0, totalPhotos: 0 });
});

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

// ─── Public: event by slug ────────────────────────────────────────────────────

app.get('/api/events/by-slug/:slug', (req, res) => {
  const evt = readEvents().find(e => e.slug === req.params.slug);
  if (!evt) return res.status(404).json({ error: 'Niet gevonden' });
  res.json({
    id: evt.id, theme: evt.theme || '', eventType: evt.eventType || '',
    bannerUrl: evt.bannerUrl || null, hasGuestPassword: !!evt.guestPassword,
    welcomeTitle: evt.welcomeTitle || '', welcomeSubtitle: evt.welcomeSubtitle || ''
  });
});

// ─── Public: guest page (event-scoped) ───────────────────────────────────────

app.get('/api/events/:eid/settings', (req, res) => {
  const evt = readEvents().find(e => e.id === req.params.eid);
  if (!evt) return res.status(404).json({ error: 'Niet gevonden' });
  const out = { theme: evt.theme || '', eventType: evt.eventType || '', bannerUrl: evt.bannerUrl || null,
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
  ['theme','bannerUrl','guestPassword','eventType','welcomeTitle','welcomeSubtitle'].forEach(k => {
    if (req.body[k] !== undefined) events[ei][k] = req.body[k];
  });
  // If name is updated, regenerate slug
  if (req.body.name !== undefined && req.body.name.trim()) {
    events[ei].name = req.body.name.trim();
    events[ei].slug = makeUniqueSlug(req.body.name.trim(), events, events[ei].id);
  }
  writeEvents(events);
  res.json({ success: true, slug: events[ei].slug });
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
  try {
    const evt = readEvents().find(e => e.id === req.params.eid);
    const THEME_COLORS = { green:'#1e4d28', rose:'#5c3d2e', navy:'#1a2d5a', lavender:'#4a2870', sage:'#4a3820', midnight:'#1a1a10' };
    const EVENT_COLORS = { wedding:'#5c3d2e', birthday:'#8b1048', babyshower:'#1e5f88', anniversary:'#6a5010', graduation:'#1a2d5a', christmas:'#7a1510', corporate:'#0d4a70', nieuwjaar:'#1a0a40' };
    const dark = (evt && evt.theme && THEME_COLORS[evt.theme])
               ? THEME_COLORS[evt.theme]
               : (evt && evt.eventType && EVENT_COLORS[evt.eventType])
               ? EVENT_COLORS[evt.eventType]
               : '#1e4d28';
    // fullUrl: client sends the complete guest-page URL directly (e.g. http://host/e/slug)
    // Fallback: construct from base URL (legacy / custom-domain use)
    let url;
    if (req.query.fullUrl) {
      url = req.query.fullUrl;
    } else {
      const baseUrl = req.query.url || `http://localhost:${PORT}`;
      url = evt && evt.slug ? `${baseUrl}/e/${evt.slug}` : `${baseUrl}?event=${req.params.eid}`;
    }
    const qr = await QRCode.toDataURL(url, { width: 400, margin: 2, color: { dark, light: '#ffffff' } });
    res.json({ qr, url });
  } catch { res.status(500).json({ error: 'QR generatie mislukt' }); }
});

function getLocalIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return null;
}

const server = app.listen(PORT, '0.0.0.0', () => {
  const localIP = getLocalIP();
  console.log('\n  ╔══════════════════════════════════════════════════╗');
  console.log('  ║           My Memories – Fotoapp                  ║');
  console.log('  ╚══════════════════════════════════════════════════╝\n');
  console.log(`  Op deze computer:`);
  console.log(`    http://localhost:${PORT}/dashboard.html\n`);
  if (localIP) {
    console.log(`  Op het lokale netwerk (WiFi – deel dit met gasten):`);
    console.log(`    http://${localIP}:${PORT}\n`);
    console.log(`  Dashboard voor netwerk:`);
    console.log(`    http://${localIP}:${PORT}/dashboard.html\n`);
  }
  console.log(`  Dashboard wachtwoord: ${DASHBOARD_PASSWORD}`);
  console.log(`  Stoppen: Ctrl+C\n`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  [!] Poort ${PORT} is al in gebruik.`);
    console.error(`      Sluit het andere Node.js venster of dubbelklik opnieuw op start.bat\n`);
  } else {
    console.error('  Server fout:', err.message);
  }
  process.exit(1);
});
