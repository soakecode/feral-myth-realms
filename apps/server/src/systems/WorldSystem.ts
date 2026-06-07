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

    // position must be near the player and on buildable ground
    if (distance(player.x, player.y, x, y) > BUILD_RANGE) return { error: 'Demasiado lejos' };
    if (isBlocked(x, y, 24)) return { error: 'No se puede construir aquí' };

    // not too close to an existing structure
    let tooClose = false;
    structures.forEach((s) => {
      if (distance(s.x, s.y, x, y) < 80) tooClose = true;
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
    structures.set(s.id, s);

    return { type: structureType, xp: def.xp };
  }

  /** Apply ongoing structure effects (campfire healing). */
  tickStructures(structures: MapSchema<StructureSchema>, players: MapSchema<PlayerSchema>) {
    structures.forEach((s) => {
      const def = STRUCTURE_DEFS[s.type as StructureType];
      if (!def?.healPerTick) return;
      players.forEach((p) => {
        if (!p.isAlive) return;
        if (distance(p.x, p.y, s.x, s.y) <= def.radius) {
          p.hp = clamp(p.hp + def.healPerTick!, 0, p.maxHp);
        }
      });
    });
  }
}
