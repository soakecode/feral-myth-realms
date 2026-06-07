// ============================================================
// Pure utility functions — no side effects, no imports
// ============================================================

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function distance(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

export function normalize(dx: number, dy: number): { x: number; y: number } {
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return { x: 0, y: 0 };
  return { x: dx / len, y: dy / len };
}

export function isCooldownReady(lastUsed: number, cooldownMs: number, now: number): boolean {
  return now - lastUsed >= cooldownMs;
}

export function remainingCooldown(lastUsed: number, cooldownMs: number, now: number): number {
  return Math.max(0, cooldownMs - (now - lastUsed));
}

export function sanitizeAlias(raw: string, minLen = 2, maxLen = 20): string {
  return raw
    .replace(/[^\w\s\-]/g, '')
    .trim()
    .slice(0, maxLen)
    .padEnd(minLen, '_');
}

export function generateGuestId(): string {
  return `guest_${Math.random().toString(36).slice(2, 10)}`;
}

export function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export function generateFriendCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function xpForLevel(level: number): number {
  return level * 100;
}

export function levelFromXp(xp: number): number {
  let level = 1;
  let remaining = xp;
  while (remaining >= xpForLevel(level)) {
    remaining -= xpForLevel(level);
    level++;
  }
  return level;
}
