import Phaser from 'phaser';
import { CLASS_DEFINITIONS } from '@fmr/shared';
import type { PlayerClass } from '@fmr/shared';

const CLASS_COLORS: Record<PlayerClass, number> = {
  stag_druid: 0x4caf50,
  raven_witch: 0x7c4dff,
  wolf_guardian: 0x607d8b,
  fox_trickster: 0xff6f00,
};

const CLASS_SHAPES: Record<PlayerClass, 'circle' | 'diamond' | 'square' | 'triangle'> = {
  stag_druid: 'circle',
  raven_witch: 'diamond',
  wolf_guardian: 'square',
  fox_trickster: 'triangle',
};

// Generate a procedural texture for a player class
export function generateClassTexture(scene: Phaser.Scene, classKey: PlayerClass, size = 48): string {
  const key = `char_${classKey}_${size}`;
  if (scene.textures.exists(key)) return key;

  const gfx = scene.make.graphics({ x: 0, y: 0 }, false);
  const color = CLASS_COLORS[classKey] ?? 0xffffff;
  const shape = CLASS_SHAPES[classKey] ?? 'circle';
  const half = size / 2;
  const shadow = 0x000000;

  // Shadow
  gfx.fillStyle(shadow, 0.3);
  gfx.fillEllipse(half, size - 4, size * 0.8, size * 0.3);

  // Body
  gfx.fillStyle(color, 1);
  gfx.lineStyle(2, 0xffffff, 0.6);

  switch (shape) {
    case 'circle':
      gfx.fillCircle(half, half - 2, half - 4);
      gfx.strokeCircle(half, half - 2, half - 4);
      // Antlers (two lines)
      gfx.lineStyle(3, 0x2e7d32, 1);
      gfx.lineBetween(half - 8, 10, half - 12, 2);
      gfx.lineBetween(half + 8, 10, half + 12, 2);
      gfx.lineBetween(half - 12, 2, half - 8, 0);
      gfx.lineBetween(half + 12, 2, half + 8, 0);
      break;

    case 'diamond':
      gfx.fillTriangle(half, 4, size - 4, half, half, size - 8);
      gfx.fillTriangle(half, 4, 4, half, half, size - 8);
      // Raven beak
      gfx.fillStyle(0xffd700, 1);
      gfx.fillTriangle(half - 3, half, half + 3, half, half, half + 10);
      break;

    case 'square':
      gfx.fillRoundedRect(6, 6, size - 12, size - 14, 4);
      gfx.strokeRoundedRect(6, 6, size - 12, size - 14, 4);
      // Wolf ears
      gfx.fillStyle(color, 1);
      gfx.fillTriangle(8, 10, 16, 2, 16, 12);
      gfx.fillTriangle(size - 8, 10, size - 16, 2, size - 16, 12);
      break;

    case 'triangle':
      gfx.fillTriangle(half, 4, size - 4, size - 8, 4, size - 8);
      gfx.strokeTriangle(half, 4, size - 4, size - 8, 4, size - 8);
      // Fox tail tip
      gfx.fillStyle(0xffffff, 0.8);
      gfx.fillCircle(half, size - 6, 5);
      break;
  }

  // Eyes
  gfx.fillStyle(0xffffff, 0.9);
  gfx.fillCircle(half - 6, half - 2, 3);
  gfx.fillCircle(half + 6, half - 2, 3);
  gfx.fillStyle(0x000000, 1);
  gfx.fillCircle(half - 6, half - 2, 1.5);
  gfx.fillCircle(half + 6, half - 2, 1.5);

  gfx.generateTexture(key, size, size);
  gfx.destroy();
  return key;
}

export function generateEnemyTexture(scene: Phaser.Scene, type: string, size = 36): string {
  const key = `enemy_${type}_${size}`;
  if (scene.textures.exists(key)) return key;

  const colors: Record<string, number> = {
    wisp: 0x80deea,
    bramble_beast: 0x6d4c41,
    rune_imp: 0xce93d8,
  };

  const gfx = scene.make.graphics({ x: 0, y: 0 }, false);
  const color = colors[type] ?? 0xff0000;
  const half = size / 2;

  // Shadow
  gfx.fillStyle(0x000000, 0.25);
  gfx.fillEllipse(half, size - 3, size * 0.7, size * 0.25);

  gfx.fillStyle(color, 1);
  gfx.lineStyle(2, 0xffffff, 0.4);

  switch (type) {
    case 'wisp':
      gfx.fillCircle(half, half - 2, half - 6);
      gfx.strokeCircle(half, half - 2, half - 6);
      // Glow effect rings
      gfx.lineStyle(1, color, 0.3);
      gfx.strokeCircle(half, half - 2, half - 2);
      break;
    case 'bramble_beast':
      gfx.fillRoundedRect(4, 4, size - 8, size - 10, 6);
      // Thorns
      gfx.fillStyle(0x388e3c, 1);
      gfx.fillTriangle(half - 8, 4, half - 4, 0, half - 2, 4);
      gfx.fillTriangle(half + 2, 4, half + 6, 0, half + 10, 4);
      break;
    case 'rune_imp':
      gfx.fillTriangle(half, 3, size - 4, size - 6, 4, size - 6);
      // Rune mark
      gfx.lineStyle(1, 0xffffff, 0.7);
      gfx.lineBetween(half, 12, half, size - 12);
      gfx.lineBetween(half - 6, half, half + 6, half);
      break;
  }

  // Eyes
  gfx.fillStyle(0xff4444, 0.9);
  gfx.fillCircle(half - 5, half - 3, 2.5);
  gfx.fillCircle(half + 5, half - 3, 2.5);

  gfx.generateTexture(key, size, size);
  gfx.destroy();
  return key;
}

export function generateSanctuaryTexture(scene: Phaser.Scene): string {
  const key = 'sanctuary_icon';
  if (scene.textures.exists(key)) return key;

  const size = 64;
  const gfx = scene.make.graphics({ x: 0, y: 0 }, false);
  const half = size / 2;

  // Base ring
  gfx.lineStyle(4, 0xffd700, 0.9);
  gfx.strokeCircle(half, half, half - 8);

  // Rune star
  gfx.lineStyle(2, 0xffd700, 1);
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const x = half + Math.cos(angle) * (half - 10);
    const y = half + Math.sin(angle) * (half - 10);
    gfx.lineBetween(half, half, x, y);
  }

  // Inner gem
  gfx.fillStyle(0xffd700, 0.8);
  gfx.fillCircle(half, half, 8);

  gfx.generateTexture(key, size, size);
  gfx.destroy();
  return key;
}

export function generatePickupTexture(scene: Phaser.Scene, type: 'hp' | 'energy'): string {
  const key = `pickup_${type}`;
  if (scene.textures.exists(key)) return key;

  const size = 24;
  const gfx = scene.make.graphics({ x: 0, y: 0 }, false);
  const half = size / 2;
  const color = type === 'hp' ? 0xff4444 : 0x4488ff;

  gfx.fillStyle(color, 0.9);
  gfx.fillCircle(half, half, half - 2);
  gfx.lineStyle(2, 0xffffff, 0.7);
  gfx.strokeCircle(half, half, half - 2);

  // Cross symbol
  gfx.lineStyle(2, 0xffffff, 1);
  gfx.lineBetween(half, 6, half, size - 6);
  gfx.lineBetween(6, half, size - 6, half);

  gfx.generateTexture(key, size, size);
  gfx.destroy();
  return key;
}
