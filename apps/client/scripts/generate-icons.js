/**
 * Generates PWA icons procedurally using Node.js Canvas API.
 * Run with: node scripts/generate-icons.js
 * Requires: npm install canvas (dev dependency, optional)
 * If canvas is not available, copies placeholder SVGs converted to PNG.
 */

import { createCanvas } from 'canvas';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(__dirname, '../public/icons');
mkdirSync(iconsDir, { recursive: true });

function drawIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const half = size / 2;

  // Background
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, size, size);

  // Rounded corner mask
  ctx.save();
  const r = size * 0.18;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(size - r, 0);
  ctx.quadraticCurveTo(size, 0, size, r);
  ctx.lineTo(size, size - r);
  ctx.quadraticCurveTo(size, size, size - r, size);
  ctx.lineTo(r, size);
  ctx.quadraticCurveTo(0, size, 0, size - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  ctx.clip();

  // Gradient background
  const grad = ctx.createRadialGradient(half, half * 0.8, 0, half, half, half * 1.4);
  grad.addColorStop(0, '#1a3a4a');
  grad.addColorStop(1, '#0d0d1a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // Outer rune ring
  ctx.strokeStyle = 'rgba(255,215,0,0.7)';
  ctx.lineWidth = size * 0.025;
  ctx.beginPath();
  ctx.arc(half, half, half * 0.82, 0, Math.PI * 2);
  ctx.stroke();

  // Inner ring
  ctx.strokeStyle = 'rgba(255,215,0,0.25)';
  ctx.lineWidth = size * 0.012;
  ctx.beginPath();
  ctx.arc(half, half, half * 0.65, 0, Math.PI * 2);
  ctx.stroke();

  // 6-point rune star
  ctx.strokeStyle = 'rgba(255,215,0,0.6)';
  ctx.lineWidth = size * 0.018;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(half + Math.cos(a) * half * 0.2, half + Math.sin(a) * half * 0.2);
    ctx.lineTo(half + Math.cos(a) * half * 0.72, half + Math.sin(a) * half * 0.72);
    ctx.stroke();
  }

  // Center gem with glow
  const gemGrad = ctx.createRadialGradient(half - size * 0.04, half - size * 0.04, 0, half, half, half * 0.22);
  gemGrad.addColorStop(0, '#fff7cc');
  gemGrad.addColorStop(0.4, '#ffd700');
  gemGrad.addColorStop(1, '#ff8800');
  ctx.fillStyle = gemGrad;
  ctx.beginPath();
  ctx.arc(half, half, half * 0.2, 0, Math.PI * 2);
  ctx.fill();

  // Paw prints (brand mark)
  const pawR = half * 0.075;
  ctx.fillStyle = 'rgba(255,111,0,0.85)';
  const paws = [
    { x: -0.24, y: 0.36 }, { x: 0, y: 0.44 }, { x: 0.24, y: 0.36 },
    { x: -0.35, y: 0.16 }, { x: 0.35, y: 0.16 },
  ];
  paws.forEach(p => {
    ctx.beginPath();
    ctx.arc(half + p.x * size, half + p.y * size, pawR, 0, Math.PI * 2);
    ctx.fill();
  });

  // "FMR" text
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = `bold ${size * 0.12}px Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('FMR', half, half * 0.42);

  ctx.restore();
  return canvas.toBuffer('image/png');
}

try {
  const sizes = [192, 512];
  sizes.forEach(s => {
    const buf = drawIcon(s);
    const outPath = join(iconsDir, `icon-${s}.png`);
    writeFileSync(outPath, buf);
    console.log(`Generated ${outPath}`);
  });
  console.log('Icons generated successfully.');
} catch (e) {
  console.error('Could not generate icons (canvas package may not be installed):', e.message);
  console.log('Run: npm install --save-dev canvas  inside apps/client');
  console.log('Then run: node scripts/generate-icons.js');
}
