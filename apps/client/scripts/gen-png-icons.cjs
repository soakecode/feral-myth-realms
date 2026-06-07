#!/usr/bin/env node
/**
 * Pure Node.js PNG icon generator — no external dependencies.
 * Generates 192x192 and 512x512 icons for the PWA manifest.
 * Run: node scripts/gen-png-icons.cjs
 */

'use strict';

const { deflateSync } = require('zlib');
const { writeFileSync, mkdirSync, existsSync } = require('fs');
const { join } = require('path');

const OUT_DIR = join(__dirname, '../public/icons');
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

// ---- CRC32 table ----
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u32(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; }

function pngChunk(type, data) {
  const t = Buffer.from(type);
  const d = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const crcBuf = Buffer.concat([t, d]);
  return Buffer.concat([u32(d.length), t, d, u32(crc32(crcBuf))]);
}

/** Draw the FMR icon design as RGBA pixel data */
function drawIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const cx = size / 2, cy = size / 2;
  const r = size / 2;

  function setPixel(x, y, rr, g, b, a = 255) {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    // Alpha blend over existing
    const srcA = a / 255;
    const dstA = pixels[i + 3] / 255;
    const outA = srcA + dstA * (1 - srcA);
    if (outA === 0) return;
    pixels[i]     = Math.round((rr * srcA + pixels[i]     * dstA * (1 - srcA)) / outA);
    pixels[i + 1] = Math.round((g  * srcA + pixels[i + 1] * dstA * (1 - srcA)) / outA);
    pixels[i + 2] = Math.round((b  * srcA + pixels[i + 2] * dstA * (1 - srcA)) / outA);
    pixels[i + 3] = Math.round(outA * 255);
  }

  function fillCircle(cx, cy, radius, rr, g, b, a = 255) {
    const ri = Math.ceil(radius);
    for (let dy = -ri; dy <= ri; dy++) {
      for (let dx = -ri; dx <= ri; dx++) {
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= radius) {
          const edge = Math.max(0, Math.min(1, radius - dist));
          setPixel(Math.round(cx + dx), Math.round(cy + dy), rr, g, b, Math.round(a * Math.min(1, edge * 2)));
        }
      }
    }
  }

  function strokeCircle(cx, cy, radius, thickness, rr, g, b, a = 255) {
    const outer = radius + thickness / 2;
    const inner = radius - thickness / 2;
    const ri = Math.ceil(outer);
    for (let dy = -ri; dy <= ri; dy++) {
      for (let dx = -ri; dx <= ri; dx++) {
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist >= inner && dist <= outer) {
          const edgeOuter = Math.max(0, Math.min(1, outer - dist));
          const edgeInner = Math.max(0, Math.min(1, dist - inner));
          const alpha = Math.min(edgeOuter, edgeInner);
          setPixel(Math.round(cx + dx), Math.round(cy + dy), rr, g, b, Math.round(a * alpha * 3));
        }
      }
    }
  }

  function strokeLine(x0, y0, x1, y1, thick, rr, g, b, a = 255) {
    const steps = Math.ceil(Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2)) * 2;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = x0 + (x1 - x0) * t;
      const py = y0 + (y1 - y0) * t;
      fillCircle(px, py, thick / 2, rr, g, b, a);
    }
  }

  // Background: dark gradient
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      const t = Math.min(1, dist / (r * 1.2));
      const bgR = Math.round(26 + (13 - 26) * t);
      const bgG = Math.round(26 + (13 - 26) * t);
      const bgB = Math.round(46 + (26 - 46) * t);
      const i = (y * size + x) * 4;
      pixels[i] = bgR; pixels[i + 1] = bgG; pixels[i + 2] = bgB; pixels[i + 3] = 255;
    }
  }

  // Rounded corners mask
  const cornerR = size * 0.18;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let inCorner = false;
      const corners = [[cornerR, cornerR], [size - cornerR, cornerR], [cornerR, size - cornerR], [size - cornerR, size - cornerR]];
      for (const [qx, qy] of corners) {
        const dx = x - qx, dy = y - qy;
        if (Math.abs(dx) >= cornerR && Math.abs(dy) >= cornerR) {
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > cornerR) { inCorner = true; break; }
        }
      }
      if (inCorner) {
        const i = (y * size + x) * 4;
        pixels[i + 3] = 0;
      }
    }
  }

  // Outer rune ring
  strokeCircle(cx, cy, r * 0.82, r * 0.025, 255, 215, 0, 178);
  // Inner ring
  strokeCircle(cx, cy, r * 0.65, r * 0.012, 255, 215, 0, 64);

  // 6-point rune lines
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2 - Math.PI / 2;
    const x0 = cx + Math.cos(angle) * r * 0.20;
    const y0 = cy + Math.sin(angle) * r * 0.20;
    const x1 = cx + Math.cos(angle) * r * 0.72;
    const y1 = cy + Math.sin(angle) * r * 0.72;
    strokeLine(x0, y0, x1, y1, r * 0.018, 255, 215, 0, 140);
  }

  // Center gem
  fillCircle(cx, cy, r * 0.20, 255, 215, 0, 230);
  fillCircle(cx * 0.92, cy * 0.92, r * 0.08, 255, 247, 200, 180);

  // Paw prints
  const pawR = r * 0.075;
  const paws = [
    { x: cx - r * 0.24, y: cy + r * 0.36 },
    { x: cx, y: cy + r * 0.44 },
    { x: cx + r * 0.24, y: cy + r * 0.36 },
    { x: cx - r * 0.35, y: cy + r * 0.16 },
    { x: cx + r * 0.35, y: cy + r * 0.16 },
  ];
  paws.forEach(p => fillCircle(p.x, p.y, pawR, 255, 111, 0, 217));

  return pixels;
}

function encodePNG(size, pixels) {
  const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // Raw image data (filter byte 0 = None per row)
  const rawRows = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    rawRows[y * (1 + size * 4)] = 0; // filter None
    pixels.copy(rawRows, y * (1 + size * 4) + 1, y * size * 4, (y + 1) * size * 4);
  }

  const idat = deflateSync(rawRows, { level: 6 });

  return Buffer.concat([
    PNG_SIG,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

[192, 512].forEach(size => {
  console.log(`Generating ${size}x${size} icon...`);
  const pixels = drawIcon(size);
  const png = encodePNG(size, pixels);
  const outPath = join(OUT_DIR, `icon-${size}.png`);
  writeFileSync(outPath, png);
  console.log(`  ✓ ${outPath} (${(png.length / 1024).toFixed(1)} KB)`);
});

console.log('\nIcons generated successfully!');
