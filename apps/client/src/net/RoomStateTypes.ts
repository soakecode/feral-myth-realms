// Type stubs that mirror Colyseus schema shapes for client-side typing.
// The actual schema is hydrated by @colyseus/sdk at runtime.

export interface CooldownsState {
  basic: number;
  q: number;
  e: number;
  r: number;
  space: number;
}

export interface PlayerState {
  id: string;
  userId: string;
  guestId: string;
  alias: string;
  classKey: string;
  x: number;
  y: number;
  direction: string;
  animState: string;
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
  authMode: string;
  teamId: number;
  essence: number;
  wood: number;
  stone: number;
  runeShard: number;
  cooldowns: CooldownsState;
}

export interface ResourceNodeState {
  id: string;
  type: string;
  x: number;
  y: number;
  amount: number;
  available: boolean;
  respawnTimer: number;
}

export interface StructureState {
  id: string;
  type: string;
  x: number;
  y: number;
  ownerId: string;
  ownerAlias: string;
  teamId: number;
  createdAt: number;
}

export interface EnemyState {
  id: string;
  type: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  isAlive: boolean;
  respawnTimer: number;
  targetPlayerId: string;
  animState: string;
}

export interface SanctuaryState {
  id: string;
  x: number;
  y: number;
  radius: number;
  captureProgress: number;
  captureTeam: number;
  state: string;
}

export interface RealmRoomState {
  players: Map<string, PlayerState> & {
    onAdd: (cb: (player: PlayerState, key: string) => void) => void;
    onRemove: (cb: (player: PlayerState, key: string) => void) => void;
    get: (key: string) => PlayerState | undefined;
    forEach: (cb: (player: PlayerState, key: string) => void) => void;
  };
  enemies: Map<string, EnemyState> & {
    onAdd: (cb: (enemy: EnemyState, key: string) => void) => void;
    onRemove: (cb: (enemy: EnemyState, key: string) => void) => void;
    get: (key: string) => EnemyState | undefined;
    forEach: (cb: (enemy: EnemyState, key: string) => void) => void;
  };
  sanctuaries: Array<SanctuaryState> & {
    onAdd: (cb: (sanctuary: SanctuaryState, idx: number) => void) => void;
    get: (idx: number) => SanctuaryState | undefined;
    forEach: (cb: (sanctuary: SanctuaryState, idx: number) => void) => void;
  };
  resources: Map<string, ResourceNodeState> & {
    onAdd: (cb: (node: ResourceNodeState, key: string) => void) => void;
    onRemove: (cb: (node: ResourceNodeState, key: string) => void) => void;
    get: (key: string) => ResourceNodeState | undefined;
    forEach: (cb: (node: ResourceNodeState, key: string) => void) => void;
  };
  structures: Map<string, StructureState> & {
    onAdd: (cb: (s: StructureState, key: string) => void) => void;
    onRemove: (cb: (s: StructureState, key: string) => void) => void;
    get: (key: string) => StructureState | undefined;
    forEach: (cb: (s: StructureState, key: string) => void) => void;
  };
  elapsedMs: number;
  matchActive: boolean;
}

export interface DuelRoomState {
  players: RealmRoomState['players'];
  elapsedMs: number;
  remainingMs: number;
  matchActive: boolean;
  matchEnded: boolean;
  winnerPlayerId: string;
  winnerAlias: string;
}
