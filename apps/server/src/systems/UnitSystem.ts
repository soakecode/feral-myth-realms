import { MapSchema } from '@colyseus/schema';
import { UnitSchema } from '../schema/UnitSchema.js';
import { EnemySchema } from '../schema/EnemySchema.js';
import { StructureSchema } from '../schema/StructureSchema.js';
import { distance, normalize, clamp, WORLD } from '@fmr/shared';
import type { StructureType } from '@fmr/shared';

export interface UnitDamageEvent {
  ownerId: string;
  enemyId: string;
  amount: number;
  killed: boolean;
  enemyType: string;
}

/**
 * Friendly soldiers trained at barracks. They patrol near their building and
 * engage nearby corrupted creatures — the kingdom's standing defence.
 */
export class UnitSystem {
  private seq = 0;
  private spawnAt = new Map<string, number>(); // barracksId -> next spawn time
  private attackAt = new Map<string, number>(); // unitId -> next attack time

  private readonly perBarracks = 2;
  private readonly engageRange = 470;
  private readonly attackRange = 56;
  private readonly speed = 125;
  private readonly damage = 9;
  private readonly attackCdMs = 850;
  private readonly enemyRespawnMs = 9000;

  tick(
    units: MapSchema<UnitSchema>,
    structures: MapSchema<StructureSchema>,
    enemies: MapSchema<EnemySchema>,
    deltaMs: number,
    now: number
  ): UnitDamageEvent[] {
    const events: UnitDamageEvent[] = [];

    // Collect barracks
    const barracks: StructureSchema[] = [];
    structures.forEach((s) => {
      if ((s.type as StructureType) === 'barracks') barracks.push(s);
    });

    // Despawn units whose home barracks is gone
    units.forEach((u, id) => {
      if (!barracks.some((b) => b.id === u.homeId)) units.delete(id);
    });

    // Maintain garrison per barracks (staggered spawns)
    for (const b of barracks) {
      let count = 0;
      units.forEach((u) => { if (u.homeId === b.id) count += 1; });
      if (count < this.perBarracks) {
        const next = this.spawnAt.get(b.id) ?? 0;
        if (now >= next) {
          this.spawnAt.set(b.id, now + 6000);
          const u = new UnitSchema();
          u.id = `unit_${this.seq++}`;
          u.kind = 'soldier';
          u.ownerId = b.ownerId;
          u.homeId = b.id;
          u.x = b.x + (Math.random() - 0.5) * 44;
          u.y = b.y + (Math.random() - 0.5) * 44;
          u.hp = 60; u.maxHp = 60; u.isAlive = true; u.animState = 'idle';
          units.set(u.id, u);
        }
      }
    }

    // Unit AI
    const dt = deltaMs / 1000;
    units.forEach((u, id) => {
      if (!u.isAlive) return;
      const home = structures.get(u.homeId);

      let target: EnemySchema | null = null;
      let bestD = this.engageRange;
      enemies.forEach((e) => {
        if (!e.isAlive) return;
        const d = distance(u.x, u.y, e.x, e.y);
        if (d < bestD) { bestD = d; target = e; }
      });

      if (target) {
        const foe = target as EnemySchema;
        if (bestD > this.attackRange) {
          const n = normalize(foe.x - u.x, foe.y - u.y);
          u.x = clamp(u.x + n.x * this.speed * dt, 30, WORLD.width - 30);
          u.y = clamp(u.y + n.y * this.speed * dt, 30, WORLD.height - 30);
          u.animState = 'walk';
        } else {
          u.animState = 'attack';
          const next = this.attackAt.get(id) ?? 0;
          if (now >= next) {
            this.attackAt.set(id, now + this.attackCdMs);
            foe.hp -= this.damage;
            let killed = false;
            if (foe.hp <= 0) {
              foe.hp = 0;
              foe.isAlive = false;
              foe.respawnTimer = this.enemyRespawnMs;
              foe.targetPlayerId = '';
              killed = true;
            }
            events.push({ ownerId: u.ownerId, enemyId: foe.id, amount: this.damage, killed, enemyType: foe.type });
          }
        }
      } else if (home) {
        const d = distance(u.x, u.y, home.x, home.y);
        if (d > 72) {
          const n = normalize(home.x - u.x, home.y - u.y);
          u.x = clamp(u.x + n.x * this.speed * dt, 30, WORLD.width - 30);
          u.y = clamp(u.y + n.y * this.speed * dt, 30, WORLD.height - 30);
          u.animState = 'walk';
        } else {
          u.animState = 'idle';
        }
      }
    });

    return events;
  }
}
