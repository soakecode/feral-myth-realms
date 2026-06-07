// ============================================================
// Message type constants for Colyseus room messaging
// ============================================================

export const MSG = {
  // Client → Server
  PLAYER_INPUT: 'player_input',
  CHAT: 'chat',
  EMOTE: 'emote',
  READY: 'ready',
  HARVEST: 'harvest',
  BUILD: 'build',

  // Server → Client
  PLAYER_JOINED: 'player_joined',
  PLAYER_LEFT: 'player_left',
  PLAYER_DIED: 'player_died',
  PLAYER_RESPAWNED: 'player_respawned',
  ABILITY_USED: 'ability_used',
  DAMAGE_EVENT: 'damage_event',
  ENEMY_DIED: 'enemy_died',
  SANCTUARY_UPDATE: 'sanctuary_update',
  XP_GAINED: 'xp_gained',
  LEVEL_UP: 'level_up',
  RESOURCE_GAINED: 'resource_gained',
  STRUCTURE_BUILT: 'structure_built',
  BUILD_DENIED: 'build_denied',
  ZONE_ENTERED: 'zone_entered',
  MATCH_END: 'match_end',
  CHAT_MESSAGE: 'chat_message',
  ERROR: 'error',
} as const;

export type MsgKey = (typeof MSG)[keyof typeof MSG];

// ---- Typed payloads for common messages ----

export interface ChatPayload {
  senderId: string;
  alias: string;
  text: string;
  timestamp: number;
}

export interface AbilityUsedPayload {
  playerId: string;
  abilityKey: string;
  x: number;
  y: number;
  aimX: number;
  aimY: number;
}

export interface DamageEventPayload {
  targetId: string;
  sourceId: string;
  amount: number;
  isPlayer: boolean;
}

export interface XpGainedPayload {
  playerId: string;
  amount: number;
  total: number;
}

export interface MatchEndPayload {
  mode: string;
  winnerUserId: string | null;
  winnerAlias: string | null;
  reason: 'time_out' | 'elimination' | 'disconnect';
  durationMs: number;
  stats: Array<{
    playerId: string;
    alias: string;
    hp: number;
    xpGained: number;
  }>;
}
