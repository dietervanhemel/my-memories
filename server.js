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
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const dataFile = path.join(dataDir, 'photos.json');
if (!fs.existsSync(dataFile)) fs.writeFileSync(dataFile, JSON.stringify([]));

// Multer storage config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB per file
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|heic|heif/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype) || file.mimetype === 'image/heic' || file.mimetype === 'image/heif';
    if (ext || mime) return cb(null, true);
    cb(new Error('Alleen afbeeldingen zijn toegestaan'));
  }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));

// Helper: read/write data
function readData() {
  try { return JSON.parse(fs.readFileSync(dataFile, 'utf-8')); }
  catch { return []; }
}
function writeData(data) {
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
}

// ─── Guest routes ───────────────────────────────────────────────────────────

// Upload photos
app.post('/api/upload', upload.array('photos', 30), (req, res) => {
  const { name, message } = req.body;
  if (!name || name.trim() === '') {
    return res.status(400).json({ error: 'Naam is verplicht' });
  }
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'Geen foto\'s ontvangen' });
  }

  const data = readData();
  const uploadId = uuidv4();
  const entry = {
    id: uploadId,
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

  res.json({ success: true, count: req.files.length, uploadId });
});

// ─── Dashboard routes ────────────────────────────────────────────────────────

// Auth check
app.post('/api/auth', (req, res) => {
  const { password } = req.body;
  if (password === DASHBOARD_PASSWORD) {
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Onjuist wachtwoord' });
  }
});

// Get all uploads (protected by password query param)
app.get('/api/photos', (req, res) => {
  if (req.query.password !== DASHBOARD_PASSWORD) {
    return res.status(401).json({ error: 'Niet geautoriseerd' });
  }
  const data = readData();
  res.json(data);
});

// Delete a single photo
app.delete('/api/photos/:uploadId/:photoId', (req, res) => {
  if (req.query.password !== DASHBOARD_PASSWORD) {
    return res.status(401).json({ error: 'Niet geautoriseerd' });
  }
  const data = readData();
  const entry = data.find(e => e.id === req.params.uploadId);
  if (!entry) return res.status(404).json({ error: 'Niet gevonden' });

  const photo = entry.photos.find(p => p.id === req.params.photoId);
  if (!photo) return res.status(404).json({ error: 'Foto niet gevonden' });

  const filePath = path.join(uploadsDir, photo.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  entry.photos = entry.photos.filter(p => p.id !== req.params.photoId);
  if (entry.photos.length === 0) {
    const idx = data.indexOf(entry);
    data.splice(idx, 1);
  }
  writeData(data);
  res.json({ success: true });
});

// Delete an entire upload group
app.delete('/api/uploads/:uploadId', (req, res) => {
  if (req.query.password !== DASHBOARD_PASSWORD) {
    return res.status(401).json({ error: 'Niet geautoriseerd' });
  }
  const data = readData();
  const idx = data.findIndex(e => e.id === req.params.uploadId);
  if (idx === -1) return res.status(404).json({ error: 'Niet gevonden' });

  const entry = data[idx];
  entry.photos.forEach(p => {
    const filePath = path.join(uploadsDir, p.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });
  data.splice(idx, 1);
  writeData(data);
  res.json({ success: true });
});

// Generate QR code for the upload page
app.get('/api/qrcode', async (req, res) => {
  if (req.query.password !== DASHBOARD_PASSWORD) {
    return res.status(401).json({ error: 'Niet geautoriseerd' });
  }
  const baseUrl = req.query.url || `http://localhost:${PORT}`;
  try {
    const qr = await QRCode.toDataURL(baseUrl, {
      width: 400,
      margin: 2,
      color: { dark: '#5c3d2e', light: '#fff8f0' }
    });
    res.json({ qr, url: baseUrl });
  } catch (err) {
    res.status(500).json({ error: 'QR generatie mislukt' });
  }
});

// Stats endpoint
app.get('/api/stats', (req, res) => {
  if (req.query.password !== DASHBOARD_PASSWORD) {
    return res.status(401).json({ error: 'Niet geautoriseerd' });
  }
  const data = readData();
  const totalPhotos = data.reduce((sum, e) => sum + e.photos.length, 0);
  const totalSize = data.reduce((sum, e) =>
    sum + e.photos.reduce((s, p) => s + p.size, 0), 0);
  res.json({
    totalUploaders: data.length,
    totalPhotos,
    totalSizeMB: (totalSize / (1024 * 1024)).toFixed(1)
  });
});

app.listen(PORT, () => {
  console.log(`\n  Trouw Fotoapp draait op http://localhost:${PORT}`);
  console.log(`  Dashboard: http://localhost:${PORT}/dashboard.html`);
  console.log(`  Wachtwoord: ${DASHBOARD_PASSWORD}\n`);
});
