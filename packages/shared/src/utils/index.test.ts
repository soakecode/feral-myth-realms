import { describe, it, expect } from 'vitest';
import {
  clamp,
  distance,
  isCooldownReady,
  remainingCooldown,
  sanitizeAlias,
  generateRoomCode,
  levelFromXp,
  xpForLevel,
  normalize,
} from './index.js';

describe('clamp', () => {
  it('returns value within range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });
  it('clamps to min', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });
  it('clamps to max', () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });
});

describe('distance', () => {
  it('returns 0 for same point', () => {
    expect(distance(0, 0, 0, 0)).toBe(0);
  });
  it('returns correct distance', () => {
    expect(distance(0, 0, 3, 4)).toBe(5);
  });
});

describe('normalize', () => {
  it('returns zero vector for zero input', () => {
    expect(normalize(0, 0)).toEqual({ x: 0, y: 0 });
  });
  it('normalizes horizontal vector', () => {
    const n = normalize(5, 0);
    expect(n.x).toBe(1);
    expect(n.y).toBe(0);
  });
});

describe('cooldown helpers', () => {
  it('isCooldownReady returns true when enough time passed', () => {
    expect(isCooldownReady(1000, 500, 1600)).toBe(true);
  });
  it('isCooldownReady returns false when not enough time passed', () => {
    expect(isCooldownReady(1000, 500, 1400)).toBe(false);
  });
  it('remainingCooldown returns 0 when ready', () => {
    expect(remainingCooldown(1000, 500, 2000)).toBe(0);
  });
  it('remainingCooldown returns positive when not ready', () => {
    expect(remainingCooldown(1000, 500, 1200)).toBe(300);
  });
});

describe('sanitizeAlias', () => {
  it('trims and removes special chars', () => {
    const result = sanitizeAlias('  <h4x0r>  ');
    expect(result).toBe('h4x0r');
  });
  it('pads short alias', () => {
    const result = sanitizeAlias('a');
    expect(result.length).toBeGreaterThanOrEqual(2);
  });
  it('truncates long alias', () => {
    const result = sanitizeAlias('a'.repeat(50));
    expect(result.length).toBeLessThanOrEqual(20);
  });
});

describe('generateRoomCode', () => {
  it('generates 6 char code', () => {
    expect(generateRoomCode().length).toBe(6);
  });
  it('generates different codes', () => {
    expect(generateRoomCode()).not.toBe(generateRoomCode());
  });
});

describe('xp / level helpers', () => {
  it('level 1 requires 100 xp', () => {
    expect(xpForLevel(1)).toBe(100);
  });
  it('levelFromXp returns 1 for 0 xp', () => {
    expect(levelFromXp(0)).toBe(1);
  });
  it('levelFromXp returns 2 after 100 xp', () => {
    expect(levelFromXp(100)).toBe(2);
  });
});
