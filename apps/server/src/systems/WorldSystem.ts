import { MapSchema } from '@colyseus/schema';
import { ResourceNodeSchema } from '../schema/ResourceNodeSchema.js';
import { StructureSchema } from '../schema/StructureSchema.js';
import { PlayerSchema } from '../schema/PlayerSchema.js';
import {
  RESOURCE_SPAWNS,
  RESOURCE_INFO,
  STRUCTURE_DEFS,
  HARVEST_RANGE,
  BUILD_RANGE,
  REPAIR_RANGE,
  REPAIR_HP,
  REPAIR_COST_STONE,
  isBlocked,
  distance,
  clamp,
} from '@fmr/shared';
import type { ResourceType, StructureType } from '@fmr/shared';

type InvKey = 'essence' | 'wood' | 'stone' | 'runeShard';
function invKey(t: ResourceType): InvKey {
  return t === 'rune_shard' ? 'runeShard' : (t as InvKey);
}

export interface HarvestResult {
  type: ResourceType;
  amount: number;
  xp: number;
}

export interface BuildResult {
  type: StructureType;
  xp: number;
}

export class WorldSystem {
  private structSeq = 0;

  initResources(resources: MapSchema<ResourceNodeSchema>) {
    for (const spawn of RESOURCE_SPAWNS) {
      const node = new ResourceNodeSchema();
      node.id = spawn.id;
      node.type = spawn.type;
      node.x = spawn.x;
      node.y = spawn.y;
      node.amount = 3;
      node.available = true;
      node.respawnTimer = 0;
      resources.set(node.id, node);
    }
  }

  tickResources(resources: MapSchema<ResourceNodeSchema>, deltaMs: number) {
    resources.forEach((node) => {
      if (node.available) return;
      node.respawnTimer -= deltaMs;
      if (node.respawnTimer <= 0) {
        node.available = true;
        node.amount = 3;
        node.respawnTimer = 0;
      }
    });
  }

  /** Attempt to harvest a node. Returns the gained resource or null. */
  harvest(player: PlayerSchema, nodeId: string, resources: MapSchema<ResourceNodeSchema>): HarvestResult | null {
    const node = resources.get(nodeId);
    if (!node || !node.available || node.amount <= 0) return null;
    if (distance(player.x, player.y, node.x, node.y) > HARVEST_RANGE) return null;

    const type = node.type as ResourceType;
    const info = RESOURCE_INFO[type];
    const gained = info.perHarvest;
    node.amount -= 1;
    player[invKey(type)] = (player[invKey(type)] as number) + gained;

    if (node.amount <= 0) {
      node.available = false;
      node.respawnTimer = info.respawnMs;
    }
    return { type, amount: gained, xp: info.xp };
  }

  /** Validate + place a structure. Returns the result or a reason string. */
  build(
    player: PlayerSchema,
    structureType: StructureType,
    x: number,
    y: number,
    structures: MapSchema<StructureSchema>
  ): BuildResult | { error: string } {
    const def = STRUCTURE_DEFS[structureType];
    if (!def) return { error: 'Construcción desconocida' };

    // position must be near the player and on buildable ground (walls reach
    // farther so you can lay a defensive line in one drag).
    const range = structureType === 'wall' ? 760 : BUILD_RANGE;
    if (distance(player.x, player.y, x, y) > range) return { error: 'Demasiado lejos' };
    if (isBlocked(x, y, 24)) return { error: 'No se puede construir aquí' };

    // not too close to an existing structure (walls may sit closer to form lines)
    let tooClose = false;
    structures.forEach((s) => {
      const minGap = structureType === 'wall' && s.type === 'wall' ? 50 : 80;
      if (distance(s.x, s.y, x, y) < minGap) tooClose = true;
    });
    if (tooClose) return { error: 'Hay otra construcción cerca' };

    // cost check
    for (const [res, amount] of Object.entries(def.cost)) {
      const key = invKey(res as ResourceType);
      if ((player[key] as number) < (amount as number)) {
        return { error: `Faltan recursos: ${res}` };
      }
    }
    // deduct
    for (const [res, amount] of Object.entries(def.cost)) {
      const key = invKey(res as ResourceType);
      player[key] = (player[key] as number) - (amount as number);
    }

    const s = new StructureSchema();
    s.id = `struct_${this.structSeq++}`;
    s.type = structureType;
    s.x = x;
    s.y = y;
    s.ownerId = player.id;
    s.ownerAlias = player.alias;
    s.teamId = player.teamId;
    s.createdAt = Date.now();
    s.maxHp = def.maxHp;
    s.hp = def.maxHp;
    structures.set(s.id, s);

    return { type: structureType, xp: def.xp };
  }

  /** Repair a damaged structure with stone. */
  repair(
    player: PlayerSchema,
    structureId: string,
    structures: MapSchema<StructureSchema>
  ): { repaired: true } | { error: string } {
    const s = structures.get(structureId);
    if (!s) return { error: 'No existe esa construcción' };
    if (s.hp >= s.maxHp) return { error: 'Está intacta' };
    if (distance(player.x, player.y, s.x, s.y) > REPAIR_RANGE) return { error: 'Demasiado lejos' };
    if (player.stone < REPAIR_COST_STONE) return { error: 'Falta piedra para reparar' };
    player.stone -= REPAIR_COST_STONE;
    s.hp = Math.min(s.maxHp, s.hp + REPAIR_HP);
    return { repaired: true };
  }

  /** Apply ongoing structure effects (campfire/shelter heal, barracks energy). */
  tickStructures(structures: MapSchema<StructureSchema>, players: MapSchema<PlayerSchema>) {
    structures.forEach((s) => {
      const def = STRUCTURE_DEFS[s.type as StructureType];
      if (!def || (!def.healPerTick && !def.energyPerTick)) return;
      players.forEach((p) => {
        if (!p.isAlive) return;
        if (distance(p.x, p.y, s.x, s.y) <= def.radius) {
          if (def.healPerTick) p.hp = clamp(p.hp + def.healPerTick, 0, p.maxHp);
          if (def.energyPerTick) p.energy = clamp(p.energy + def.energyPerTick, 0, p.maxEnergy);
        }
      });
    });
  }
}

/** True if a circle at (x,y) collides with a blocking structure (walls). */
export function blockedByStructure(
  x: number,
  y: number,
  radius: number,
  structures: MapSchema<StructureSchema>
): boolean {
  let blocked = false;
  structures.forEach((s) => {
    if (blocked) return;
    const def = STRUCTURE_DEFS[s.type as StructureType];
    if (!def?.blocks) return;
    const rr = def.radius + radius;
    const dx = x - s.x;
    const dy = y - s.y;
    if (dx * dx + dy * dy < rr * rr) blocked = true;
  });
  return blocked;
}
