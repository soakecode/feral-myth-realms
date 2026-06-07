// ============================================================
// Core enums and type unions shared across client and server
// ============================================================

export type PlayerClass = 'stag_druid' | 'raven_witch' | 'wolf_guardian' | 'fox_trickster';

export type GameMode = 'realm' | 'duel';

export type AbilityKey = 'basic' | 'q' | 'e' | 'r' | 'space';

export type EnemyType = 'wisp' | 'bramble_beast' | 'rune_imp';

export type SanctuaryState = 'neutral' | 'capturing' | 'captured_a' | 'captured_b';

export type AuthMode = 'guest' | 'registered';

export type Direction = 'up' | 'down' | 'left' | 'right' | 'idle';

export type AnimationState = 'idle' | 'walk' | 'attack' | 'hit' | 'death';

// ---- Player State (synchronized via Colyseus schema) ----

export interface PlayerState {
  id: string;
  userId: string | null;
  guestId: string | null;
  alias: string;
  classKey: PlayerClass;
  x: number;
  y: number;
  direction: Direction;
  animState: AnimationState;
  hp: number;
  maxHp: number;
  energy: number;
  maxEnergy: number;
  level: number;
  xp: number;
  isAlive: boolean;
  respawnTimer: number;
  moveSpeed: number;
  attackDamage: number;
  attackRange: number;
  cooldowns: Record<AbilityKey, number>;
  authMode: AuthMode;
  teamId: number;
}

// ---- Enemy State ----

export interface EnemyState {
  id: string;
  type: EnemyType;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  isAlive: boolean;
  respawnTimer: number;
  targetPlayerId: string | null;
  animState: AnimationState;
}

// ---- Sanctuary State ----

export interface SanctuaryData {
  id: string;
  x: number;
  y: number;
  radius: number;
  captureProgress: number;
  captureTeam: number;
  state: SanctuaryState;
  captureSpeed: number;
}

// ---- Room Metadata ----

export interface RoomMetadata {
  mode: GameMode;
  mapId: string;
  maxPlayers: number;
  currentPlayers: number;
  isPrivate: boolean;
  roomCode: string | null;
  hostAlias: string;
}

// ---- Player Input ----

export interface PlayerInputPayload {
  seq: number;
  dx: number;
  dy: number;
  abilityKey: AbilityKey | null;
  aimX: number;
  aimY: number;
  timestamp: number;
}

// ---- Match Result ----

export interface MatchResult {
  roomId: string;
  mode: GameMode;
  winnerUserId: string | null;
  winnerAlias: string | null;
  players: Array<{
    userId: string | null;
    alias: string;
    kills: number;
    deaths: number;
    xpGained: number;
  }>;
  durationMs: number;
}

// ---- Profile / Character (mirrors Supabase tables) ----

export interface Profile {
  id: string;
  username: string;
  displayName: string | null;
  avatarKey: string | null;
}

export interface Character {
  id: string;
  userId: string;
  name: string;
  classKey: PlayerClass;
  level: number;
  xp: number;
  gold: number;
}
