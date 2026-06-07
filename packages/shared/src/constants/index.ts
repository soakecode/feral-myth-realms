// ============================================================
// Shared constants: server, client and shared logic use these
// ============================================================

export const TICK_RATE = 20; // server ticks per second
export const TICK_MS = 1000 / TICK_RATE;

// Legacy aliases — the authoritative world size lives in `world/index.ts` (WORLD).
export const MAP_WIDTH = 4000;
export const MAP_HEIGHT = 3000;

export const RESPAWN_TIME_MS = 5000;
export const ENEMY_RESPAWN_TIME_MS = 15000;

export const DUEL_DURATION_MS = 3 * 60 * 1000; // 3 minutes

export const MAX_PLAYERS_REALM = 6;
export const MAX_PLAYERS_DUEL = 2;

export const XP_PER_ENEMY_KILL: Record<string, number> = {
  wisp: 10,
  bramble_beast: 25,
  rune_imp: 15,
};

export const XP_PER_LEVEL = 100;

export const SANCTUARY_CAPTURE_RADIUS = 80;
export const SANCTUARY_CAPTURE_SPEED = 0.5; // progress per tick
export const SANCTUARY_CAPTURE_SPEED_MULTI = 0.8; // bonus per extra ally
export const SANCTUARY_MAX_PROGRESS = 100;

export const CHAT_MAX_LENGTH = 120;
export const ALIAS_MAX_LENGTH = 20;
export const ALIAS_MIN_LENGTH = 2;

export const FRIEND_CODE_LENGTH = 8;

export const ENERGY_REGEN_PER_TICK = 0.5;
