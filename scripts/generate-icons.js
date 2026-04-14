/**
 * generate-icons.js
 * Generates PNG app icons using only Node.js built-ins (no extra dependencies).
 * Outputs: public/icons/icon-192.png, icon-512.png, apple-touch-icon.png
 */
'use strict';
const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

// ── CRC32 (required by PNG format) ────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ── PNG encoder ────────────────────────────────────────────────────────────────
function pngChunk(type, data) {
  const tb = Buffer.from(type, 'ascii');
  const lb = Buffer.alloc(4); lb.writeUInt32BE(data.length, 0);
  const cb = Buffer.alloc(4); cb.writeUInt32BE(crc32(Buffer.concat([tb, data])), 0);
  return Buffer.concat([lb, tb, data, cb]);
}

function encodePNG(rgba, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA

  // One filter byte (0 = None) per row, then raw RGBA pixels
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      const d = y * (w * 4 + 1) + 1 + x * 4;
      raw[d]   = rgba[s];
      raw[d+1] = rgba[s+1];
      raw[d+2] = rgba[s+2];
      raw[d+3] = rgba[s+3];
    }
  }

  const PNG_SIG = Buffer.from([137,80,78,71,13,10,26,10]);
  return Buffer.concat([
    PNG_SIG,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

// ── Drawing helpers ────────────────────────────────────────────────────────────
function lerp(a, b, t) { return Math.round(a + (b - a) * Math.max(0, Math.min(1, t))); }
function dist2(ax, ay, bx, by) { return Math.sqrt((ax-bx)**2 + (ay-by)**2); }

function inRRect(px, py, x1, x2, y1, y2, r) {
  if (px < x1 || px > x2 || py < y1 || py > y2) return false;
  if (px < x1+r && py < y1+r) return dist2(px,py,x1+r,y1+r) <= r;
  if (px > x2-r && py < y1+r) return dist2(px,py,x2-r,y1+r) <= r;
  if (px < x1+r && py > y2-r) return dist2(px,py,x1+r,y2-r) <= r;
  if (px > x2-r && py > y2-r) return dist2(px,py,x2-r,y2-r) <= r;
  return true;
}

// ── Icon renderer ──────────────────────────────────────────────────────────────
function createIcon(size) {
  const buf = new Uint8Array(size * size * 4);
  const cx  = size / 2;
  const cy  = size / 2;
  const sc  = size / 192; // scale relative to 192 baseline

  function get(x, y) { return (Math.round(y) * size + Math.round(x)) * 4; }
  function setBlend(x, y, r, g, b, a) {
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 0 || xi >= size || yi < 0 || yi >= size) return;
    const i = get(xi, yi);
    const f = a / 255;
    buf[i]   = Math.round(buf[i]   * (1-f) + r * f);
    buf[i+1] = Math.round(buf[i+1] * (1-f) + g * f);
    buf[i+2] = Math.round(buf[i+2] * (1-f) + b * f);
    buf[i+3] = 255;
  }

  // ── 1. Background: dark-to-mid green vertical gradient ──────────────────────
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = y / (size - 1);
      const i = (y * size + x) * 4;
      buf[i]   = lerp(0x0d, 0x2e, t);
      buf[i+1] = lerp(0x20, 0x62, t);
      buf[i+2] = lerp(0x14, 0x36, t);
      buf[i+3] = 255;
    }
  }

  // ── 2. Camera body (white rounded rect) ─────────────────────────────────────
  const bpad = Math.round(34 * sc);
  const bx1  = bpad, bx2 = size - bpad;
  const by1  = Math.round(62 * sc), by2 = size - Math.round(40 * sc);
  const br   = Math.round(14 * sc);

  // Viewfinder bump (top centre)
  const vw  = Math.round(44 * sc), vh = Math.round(18 * sc);
  const vx1 = Math.round(cx - vw/2), vx2 = Math.round(cx + vw/2);
  const vy1 = by1 - vh, vy2 = by1 + 1;
  const vbr = Math.round(7 * sc);

  for (let y = vy1 - 1; y <= by2 + 1; y++) {
    for (let x = bx1 - 1; x <= bx2 + 1; x++) {
      if (inRRect(x, y, bx1, bx2, by1, by2, br) ||
          inRRect(x, y, vx1, vx2, vy1, vy2, vbr)) {
        setBlend(x, y, 255, 255, 255, 238);
      }
    }
  }

  // ── 3. Lens ──────────────────────────────────────────────────────────────────
  const lcy = Math.round(cy + 9 * sc);
  const lrO = Math.round(40 * sc); // outer ring
  const lrI = Math.round(26 * sc); // inner dark circle

  for (let y = lcy - lrO - 1; y <= lcy + lrO + 1; y++) {
    for (let x = cx - lrO - 1; x <= cx + lrO + 1; x++) {
      const d = dist2(x, y, cx, lcy);
      if (d > lrO + 0.5) continue;

      // Outer ring: dark teal-green gradient
      const ring = d / lrO;
      setBlend(x, y,
        lerp(0x10, 0x24, ring),
        lerp(0x2a, 0x52, ring),
        lerp(0x18, 0x2e, ring),
        255);

      // Inner circle: deeper green
      if (d <= lrI + 0.5) {
        const inner = d / lrI;
        setBlend(x, y,
          lerp(0x06, 0x14, inner),
          lerp(0x14, 0x30, inner),
          lerp(0x0c, 0x1c, inner),
          255);
      }

      // Specular highlight (top-left arc)
      const hd = dist2(x, y, cx - lrI * 0.3, lcy - lrI * 0.3);
      if (hd < lrI * 0.26) {
        const hf = Math.max(0, 1 - hd / (lrI * 0.26));
        setBlend(x, y, 255, 255, 255, Math.round(150 * hf));
      }
    }
  }

  return buf;
}

// ── Generate & write ───────────────────────────────────────────────────────────
const iconsDir = path.join(__dirname, '..', 'public', 'icons');
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });

const targets = [
  { file: 'icon-192.png',         size: 192 },
  { file: 'icon-512.png',         size: 512 },
  { file: 'apple-touch-icon.png', size: 180 },
];

let generated = 0;
targets.forEach(({ file, size }) => {
  const dest = path.join(iconsDir, file);
  if (!fs.existsSync(dest)) {
    const pixels = createIcon(size);
    fs.writeFileSync(dest, encodePNG(pixels, size, size));
    console.log('  [icons] created', file);
    generated++;
  }
});

if (generated === 0) console.log('  [icons] all icon files already exist, skipping');
