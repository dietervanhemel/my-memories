const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3000;

// Dashboard password — change this!
const DASHBOARD_PASSWORD = 'bruid2024';

// Ensure directories exist
const uploadsDir = path.join(__dirname, 'uploads');
const dataDir    = path.join(__dirname, 'data');
const bannerDir  = path.join(__dirname, 'public', 'banner');
[uploadsDir, dataDir, bannerDir].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

const dataFile     = path.join(dataDir, 'photos.json');
const settingsFile = path.join(dataDir, 'settings.json');
if (!fs.existsSync(dataFile))     fs.writeFileSync(dataFile,     JSON.stringify([]));
if (!fs.existsSync(settingsFile)) fs.writeFileSync(settingsFile, JSON.stringify({ theme: 'green', bannerUrl: null, guestPassword: '', welcomeTitle: '', welcomeSubtitle: '' }));

// ─── Helpers ────────────────────────────────────────────────────────────────

function readData() {
  try { return JSON.parse(fs.readFileSync(dataFile, 'utf-8')); } catch { return []; }
}
function writeData(data) { fs.writeFileSync(dataFile, JSON.stringify(data, null, 2)); }

function readSettings() {
  try { return JSON.parse(fs.readFileSync(settingsFile, 'utf-8')); }
  catch { return { theme: 'green', bannerUrl: null }; }
}
function writeSettings(s) { fs.writeFileSync(settingsFile, JSON.stringify(s, null, 2)); }

function auth(req, res, next) {
  if (req.query.password !== DASHBOARD_PASSWORD) return res.status(401).json({ error: 'Niet geautoriseerd' });
  next();
}

// ─── Multer: photos ──────────────────────────────────────────────────────────

const photoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename:    (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname).toLowerCase()}`)
});
const upload = multer({
  storage: photoStorage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /jpeg|jpg|png|gif|webp|heic|heif/.test(path.extname(file.originalname).toLowerCase())
            || /image\//.test(file.mimetype);
    cb(ok ? null : new Error('Alleen afbeeldingen zijn toegestaan'), ok);
  }
});

// ─── Multer: banner ──────────────────────────────────────────────────────────

const bannerStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, bannerDir),
  filename:    (req, file, cb) => cb(null, 'banner' + path.extname(file.originalname).toLowerCase())
});
const bannerUpload = multer({ storage: bannerStorage, limits: { fileSize: 10 * 1024 * 1024 } });

// ─── Middleware ──────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));

// ─── Public routes ───────────────────────────────────────────────────────────

// Guest photo upload
app.post('/api/upload', upload.array('photos', 30), (req, res) => {
  const { name, message } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Naam is verplicht' });
  if (!req.files?.length) return res.status(400).json({ error: "Geen foto's ontvangen" });

  const data  = readData();
  const entry = {
    id: uuidv4(),
    name: name.trim(),
    message: (message || '').trim(),
    uploadedAt: new Date().toISOString(),
    photos: req.files.map(f => ({
      id: uuidv4(),
      filename: f.filename,
      originalName: f.originalname,
      size: f.size,
      uploadedAt: new Date().toISOString()
    }))
  };
  data.push(entry);
  writeData(data);
  res.json({ success: true, count: req.files.length, uploadId: entry.id });
});

// Public settings — guests see theme + banner + whether a password is required.
// Authenticated callers (dashboard) also receive the actual guest password.
app.get('/api/settings', (req, res) => {
  const s = readSettings();
  const out = { theme: s.theme, bannerUrl: s.bannerUrl, hasGuestPassword: !!s.guestPassword, welcomeTitle: s.welcomeTitle || '', welcomeSubtitle: s.welcomeSubtitle || '' };
  if (req.query.password === DASHBOARD_PASSWORD) out.guestPassword = s.guestPassword || '';
  res.json(out);
});

// Guest password verification (public — never reveals the password itself)
app.post('/api/verify-guest-password', (req, res) => {
  const s = readSettings();
  if (!s.guestPassword) return res.json({ success: true }); // no password set
  req.body.password === s.guestPassword
    ? res.json({ success: true })
    : res.status(401).json({ error: 'Onjuist wachtwoord' });
});

// ─── Protected routes ────────────────────────────────────────────────────────

app.post('/api/auth', (req, res) => {
  req.body.password === DASHBOARD_PASSWORD
    ? res.json({ success: true })
    : res.status(401).json({ error: 'Onjuist wachtwoord' });
});

app.get('/api/photos', auth, (req, res) => res.json(readData()));

app.get('/api/stats', auth, (req, res) => {
  const data = readData();
  const totalPhotos = data.reduce((s, e) => s + e.photos.length, 0);
  const totalSize   = data.reduce((s, e) => s + e.photos.reduce((x, p) => x + p.size, 0), 0);
  res.json({ totalUploaders: data.length, totalPhotos, totalSizeMB: (totalSize / 1048576).toFixed(1) });
});

// Delete single photo
app.delete('/api/photos/:uploadId/:photoId', auth, (req, res) => {
  const data  = readData();
  const entry = data.find(e => e.id === req.params.uploadId);
  if (!entry) return res.status(404).json({ error: 'Niet gevonden' });
  const photo = entry.photos.find(p => p.id === req.params.photoId);
  if (!photo) return res.status(404).json({ error: 'Foto niet gevonden' });
  const fp = path.join(uploadsDir, photo.filename);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
  entry.photos = entry.photos.filter(p => p.id !== req.params.photoId);
  if (!entry.photos.length) data.splice(data.indexOf(entry), 1);
  writeData(data);
  res.json({ success: true });
});

// Delete entire upload group
app.delete('/api/uploads/:uploadId', auth, (req, res) => {
  const data = readData();
  const idx  = data.findIndex(e => e.id === req.params.uploadId);
  if (idx === -1) return res.status(404).json({ error: 'Niet gevonden' });
  data[idx].photos.forEach(p => {
    const fp = path.join(uploadsDir, p.filename);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  });
  data.splice(idx, 1);
  writeData(data);
  res.json({ success: true });
});

// QR code
app.get('/api/qrcode', auth, async (req, res) => {
  const baseUrl = req.query.url || `http://localhost:${PORT}`;
  try {
    const settings = readSettings();
    // Use theme accent colour for QR dots (fallback dark green)
    const THEME_COLORS = {
      green: '#1e4d28', rose: '#5c3d2e', navy: '#1a2d5a',
      lavender: '#4a2870', sage: '#4a3820', midnight: '#1a1a10'
    };
    const dark = THEME_COLORS[settings.theme] || '#1e4d28';
    const qr = await QRCode.toDataURL(baseUrl, { width: 400, margin: 2, color: { dark, light: '#ffffff' } });
    res.json({ qr, url: baseUrl });
  } catch { res.status(500).json({ error: 'QR generatie mislukt' }); }
});

// Save settings (theme, bannerUrl, guestPassword)
app.post('/api/settings', auth, (req, res) => {
  const s = readSettings();
  if (req.body.theme                  !== undefined) s.theme         = req.body.theme;
  if (req.body.bannerUrl              !== undefined) s.bannerUrl     = req.body.bannerUrl;
  if (req.body.guestPassword          !== undefined) s.guestPassword = req.body.guestPassword;
  writeSettings(s);
  res.json({ success: true });
});

// Upload banner image
app.post('/api/upload-banner', auth, bannerUpload.single('banner'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Geen bestand ontvangen' });
  const bannerUrl = '/banner/' + req.file.filename;
  const s = readSettings();
  s.bannerUrl = bannerUrl;
  writeSettings(s);
  res.json({ success: true, bannerUrl });
});

// Remove banner
app.delete('/api/banner', auth, (req, res) => {
  const s = readSettings();
  if (s.bannerUrl) {
    const fp = path.join(__dirname, 'public', s.bannerUrl);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }
  s.bannerUrl = null;
  writeSettings(s);
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`\n  Trouw Fotoapp draait op http://localhost:${PORT}`);
  console.log(`  Dashboard:  http://localhost:${PORT}/dashboard.html`);
  console.log(`  Wachtwoord: ${DASHBOARD_PASSWORD}\n`);
});
