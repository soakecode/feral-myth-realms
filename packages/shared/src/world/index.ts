// ============================================================
// World definition — shared by client (render) and server (collision,
// spawns). Generated deterministically so both sides agree without syncing
// the static world. Dynamic things (resource amounts, structures) ARE synced.
// ============================================================

export const WORLD = {
  width: 4000,
  height: 3000,
  // central safe glade where players spawn; no enemies here
  sanctum: { x: 2000, y: 1500, r: 380 },
};

export type BiomeId =
  | 'sanctum'
  | 'emerald_grove'
  | 'obsidian_ruins'
  | 'moonfen_marsh'
  | 'sunken_hollow';

export interface Zone {
  id: BiomeId;
  name: string;
  color: number; // ground tint
  accent: number; // props / fog accent (from concept art palettes)
  x: number;
  y: number;
  w: number;
  h: number;
}

// Four quadrants around the central Sanctum (see realms-biomes concept art).
export const ZONES: Zone[] = [
  { id: 'emerald_grove', name: 'Bosque Esmeralda', color: 0x35562f, accent: 0x6fe08a, x: 0, y: 0, w: 2000, h: 1500 },
  { id: 'obsidian_ruins', name: 'Ruinas Obsidiana', color: 0x2a2440, accent: 0x9a6cff, x: 2000, y: 0, w: 2000, h: 1500 },
  { id: 'moonfen_marsh', name: 'Marismas Lunaresa', color: 0x1f3a3f, accent: 0x4fd6c6, x: 0, y: 1500, w: 2000, h: 1500 },
  { id: 'sunken_hollow', name: 'Hondonada Sumida', color: 0x33302a, accent: 0xc7a14a, x: 2000, y: 1500, w: 2000, h: 1500 },
];

const SANCTUM_ZONE: Zone = {
  id: 'sanctum', name: 'Santuario del Despertar', color: 0x3a4a55, accent: 0xffe08a,
  x: WORLD.sanctum.x - WORLD.sanctum.r, y: WORLD.sanctum.y - WORLD.sanctum.r,
  w: WORLD.sanctum.r * 2, h: WORLD.sanctum.r * 2,
};

export function zoneAt(x: number, y: number): Zone {
  const dx = x - WORLD.sanctum.x;
  const dy = y - WORLD.sanctum.y;
  if (dx * dx + dy * dy <= WORLD.sanctum.r * WORLD.sanctum.r) return SANCTUM_ZONE;
  for (const z of ZONES) {
    if (x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h) return z;
  }
  return ZONES[0];
}

function inSanctum(x: number, y: number, pad = 0): boolean {
  const dx = x - WORLD.sanctum.x;
  const dy = y - WORLD.sanctum.y;
  const r = WORLD.sanctum.r + pad;
  return dx * dx + dy * dy <= r * r;
}

// Deterministic RNG (mulberry32) so client + server generate identical worlds.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- Obstacles (static, used for collision + render) ----------------------

export type ObstacleKind = 'tree' | 'rock' | 'ruin' | 'water';

export interface WorldObstacle {
  id: string;
  kind: ObstacleKind;
  x: number;
  y: number;
  radius: number;
  blocks: boolean; // hard block
  slows: boolean; // walkable but slow (water)
  biome: BiomeId;
}

function buildObstacles(): WorldObstacle[] {
  const out: WorldObstacle[] = [];
  const rng = mulberry32(91237);
  let i = 0;
  for (const z of ZONES) {
    const kinds: ObstacleKind[] =
      z.id === 'emerald_grove' ? ['tree', 'tree', 'tree', 'rock']
      : z.id === 'obsidian_ruins' ? ['ruin', 'ruin', 'rock', 'tree']
      : z.id === 'moonfen_marsh' ? ['water', 'water', 'tree', 'rock']
      : ['rock', 'ruin', 'tree', 'water'];
    const count = 34;
    for (let k = 0; k < count; k++) {
      const x = z.x + 90 + rng() * (z.w - 180);
      const y = z.y + 90 + rng() * (z.h - 180);
      if (inSanctum(x, y, 120)) continue; // keep the start glade clear
      const kind = kinds[Math.floor(rng() * kinds.length)];
      const radius =
        kind === 'water' ? 70 + rng() * 70
        : kind === 'ruin' ? 34 + rng() * 22
        : kind === 'rock' ? 24 + rng() * 16
        : 26 + rng() * 14;
      out.push({
        id: `obs_${i++}`,
        kind,
        x, y, radius,
        blocks: kind !== 'water',
        slows: kind === 'water',
        biome: z.id,
      });
    }
  }
  return out;
}

export const OBSTACLES: WorldObstacle[] = buildObstacles();

/** True if a circle at (x,y) with given radius hits a hard obstacle. */
export function isBlocked(x: number, y: number, radius = 14): boolean {
  if (x < radius || y < radius || x > WORLD.width - radius || y > WORLD.height - radius) return true;
  for (const o of OBSTACLES) {
    if (!o.blocks) continue;
    const dx = x - o.x;
    const dy = y - o.y;
    const rr = o.radius + radius;
    if (dx * dx + dy * dy < rr * rr) return true;
  }
  return false;
}

/** Movement multiplier (1 = normal, lower = slowed by water). */
export function slowFactorAt(x: number, y: number): number {
  for (const o of OBSTACLES) {
    if (!o.slows) continue;
    const dx = x - o.x;
    const dy = y - o.y;
    if (dx * dx + dy * dy < o.radius * o.radius) return 0.45;
  }
  return 1;
}

// ---- Resources ------------------------------------------------------------

export type ResourceType = 'essence' | 'wood' | 'stone' | 'rune_shard';

export interface ResourceInfo {
  name: string;
  color: number;
  icon: string;
  xp: number;
  respawnMs: number;
  perHarvest: number;
}

export const RESOURCE_INFO: Record<ResourceType, ResourceInfo> = {
  essence: { name: 'Esencia', color: 0x6fe0c0, icon: '✦', xp: 4, respawnMs: 20000, perHarvest: 1 },
  wood: { name: 'Madera ancestral', color: 0x9a6a3a, icon: '🪵', xp: 3, respawnMs: 18000, perHarvest: 1 },
  stone: { name: 'Piedra rúnica', color: 0x8d93a6, icon: '🪨', xp: 3, respawnMs: 22000, perHarvest: 1 },
  rune_shard: { name: 'Fragmento rúnico', color: 0xc77dff, icon: '◈', xp: 8, respawnMs: 35000, perHarvest: 1 },
};

export interface ResourceSpawn {
  id: string;
  type: ResourceType;
  x: number;
  y: number;
}

function buildResourceSpawns(): ResourceSpawn[] {
  const out: ResourceSpawn[] = [];
  const rng = mulberry32(551);
  let i = 0;
  const perZone: Record<BiomeId, ResourceType[]> = {
    sanctum: [],
    emerald_grove: ['wood', 'wood', 'essence'],
    obsidian_ruins: ['stone', 'stone', 'rune_shard'],
    moonfen_marsh: ['essence', 'essence', 'rune_shard'],
    sunken_hollow: ['stone', 'wood', 'essence'],
  };
  for (const z of ZONES) {
    const pool = perZone[z.id];
    for (let k = 0; k < 11; k++) {
      const x = z.x + 120 + rng() * (z.w - 240);
      const y = z.y + 120 + rng() * (z.h - 240);
      if (inSanctum(x, y, 140)) continue;
      out.push({ id: `res_${i++}`, type: pool[Math.floor(rng() * pool.length)], x, y });
    }
  }
  return out;
}

export const RESOURCE_SPAWNS: ResourceSpawn[] = buildResourceSpawns();

// ---- Enemy spawns ---------------------------------------------------------

export type EnemyKind = 'wisp' | 'bramble_beast' | 'rune_imp';

export interface EnemySpawnPoint {
  id: string;
  type: EnemyKind;
  x: number;
  y: number;
}

function buildEnemySpawns(): EnemySpawnPoint[] {
  const out: EnemySpawnPoint[] = [];
  const rng = mulberry32(7720);
  let i = 0;
  const perZone: Partial<Record<BiomeId, EnemyKind[]>> = {
    emerald_grove: ['wisp', 'bramble_beast', 'wisp'],
    obsidian_ruins: ['rune_imp', 'bramble_beast', 'rune_imp'],
    moonfen_marsh: ['wisp', 'rune_imp', 'wisp'],
    sunken_hollow: ['bramble_beast', 'rune_imp', 'wisp'],
  };
  for (const z of ZONES) {
    const pool = perZone[z.id];
    if (!pool) continue;
    for (let k = 0; k < 5; k++) {
      const x = z.x + 200 + rng() * (z.w - 400);
      const y = z.y + 200 + rng() * (z.h - 400);
      if (inSanctum(x, y, 260)) continue;
      out.push({ id: `enemy_${i++}`, type: pool[Math.floor(rng() * pool.length)], x, y });
    }
  }
  return out;
}

export const ENEMY_SPAWNS: EnemySpawnPoint[] = buildEnemySpawns();

// ---- Structures (buildable) ----------------------------------------------

export type StructureType =
  | 'campfire'
  | 'totem'
  | 'ward'
  | 'bridge'
  | 'wall'
  | 'barracks'
  | 'shelter';

export interface StructureDef {
  type: StructureType;
  name: string;
  desc: string;
  icon: string;
  color: number;
  cost: Partial<Record<ResourceType, number>>;
  radius: number; // footprint / effect radius
  healPerTick?: number; // campfire / shelter
  energyPerTick?: number; // barracks (training stamina)
  revealRadius?: number; // totem
  blocks?: boolean; // wall — stops enemies
  respawn?: boolean; // shelter — forward respawn point
  xp: number;
}

export const STRUCTURE_DEFS: Record<StructureType, StructureDef> = {
  campfire: {
    type: 'campfire', name: 'Hoguera', desc: 'Cura a los aliados cercanos.', icon: '🔥', color: 0xff7a30,
    cost: { wood: 3, essence: 2 }, radius: 200, healPerTick: 0.8, xp: 15,
  },
  totem: {
    type: 'totem', name: 'Tótem rúnico', desc: 'Marca la zona y revela el área.', icon: '🗿', color: 0x9a6cff,
    cost: { stone: 3, essence: 2 }, radius: 60, revealRadius: 520, xp: 15,
  },
  ward: {
    type: 'ward', name: 'Guarda espiritual', desc: 'Zona protegida (próxima fase).', icon: '🛡️', color: 0x4fd6c6,
    cost: { stone: 2, rune_shard: 1 }, radius: 90, xp: 20,
  },
  bridge: {
    type: 'bridge', name: 'Puente', desc: 'Cruza el agua (próxima fase).', icon: '🌉', color: 0x9a6a3a,
    cost: { wood: 2, stone: 2 }, radius: 80, xp: 10,
  },
  wall: {
    type: 'wall', name: 'Muro', desc: 'Barrera defensiva: arrastra para alzar una muralla mientras tengas piedra.', icon: '🧱', color: 0x9a8b73,
    cost: { stone: 1 }, radius: 46, blocks: true, xp: 4,
  },
  barracks: {
    type: 'barracks', name: 'Campamento de entrenamiento', desc: 'Restaura energía a los aliados cercanos.', icon: '🏕️', color: 0xc06a2a,
    cost: { wood: 4, stone: 2 }, radius: 220, energyPerTick: 0.7, xp: 20,
  },
  shelter: {
    type: 'shelter', name: 'Refugio', desc: 'Cura y reaparición avanzada para el reino.', icon: '🏠', color: 0x6fa8dc,
    cost: { wood: 4, essence: 2 }, radius: 240, healPerTick: 0.5, respawn: true, xp: 25,
  },
};

export const HARVEST_RANGE = 90;
export const HARVEST_COOLDOWN_MS = 600;
export const BUILD_RANGE = 160;
