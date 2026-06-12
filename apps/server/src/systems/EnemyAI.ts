import { MapSchema } from '@colyseus/schema';
import { PlayerSchema } from '../schema/PlayerSchema.js';
import { EnemySchema } from '../schema/EnemySchema.js';
import { StructureSchema } from '../schema/StructureSchema.js';
import { ENEMY_DEFINITIONS, ENEMY_SPAWNS, STRUCTURE_DEFS } from '@fmr/shared';
import { distance, clamp, normalize, WORLD } from '@fmr/shared';
import type { EnemyType, StructureType } from '@fmr/shared';
import { CombatSystem } from './CombatSystem.js';
import { blockedByStructure } from './WorldSystem.js';

const MAP_W = WORLD.width;
const MAP_H = WORLD.height;

export class EnemyAI {
  private lastAttackTime: Map<string, number> = new Map();
  private combat = new CombatSystem();
  /** Threat multiplier ("la máquina"): scales respawned enemy hp + damage. */
  private threat = 1;

  setThreat(mult: number) {
    this.threat = Math.max(1, mult);
  }

  initEnemies(enemies: MapSchema<EnemySchema>) {
    ENEMY_SPAWNS.forEach((sp) => {
      const def = ENEMY_DEFINITIONS[sp.type];
      const enemy = new EnemySchema();
      enemy.id = sp.id;
      enemy.type = sp.type;
      enemy.x = sp.x + (Math.random() - 0.5) * 40;
      enemy.y = sp.y + (Math.random() - 0.5) * 40;
      enemy.hp = def.maxHp;
      enemy.maxHp = def.maxHp;
      enemy.isAlive = true;
      enemy.animState = 'idle';
      enemies.set(enemy.id, enemy);
    });
  }

  tick(
    enemies: MapSchema<EnemySchema>,
    players: MapSchema<PlayerSchema>,
    deltaMs: number,
    now: number,
    structures?: MapSchema<StructureSchema>
  ): Array<{ sourceId: string; targetId: string; amount: number }> {
    const damageEvents: Array<{ sourceId: string; targetId: string; amount: number }> = [];

    enemies.forEach((enemy, eid) => {
      if (!enemy.isAlive) {
        enemy.respawnTimer -= deltaMs;
        if (enemy.respawnTimer <= 0) {
          this.respawnEnemy(enemy, eid);
        }
        return;
      }

      const def = ENEMY_DEFINITIONS[enemy.type as EnemyType];
      if (!def) return;

      // Find closest alive player
      let closest: { player: PlayerSchema; dist: number; id: string } | null = null;
      players.forEach((p: PlayerSchema, pid: string) => {
        if (!p.isAlive) return;
        const d = distance(enemy.x, enemy.y, p.x, p.y);
        if (!closest || d < closest.dist) {
          closest = { player: p, dist: d, id: pid };
        }
      });

      if (!closest) {
        if (eid.startsWith('wave_')) this.marchOnSanctum(enemy, eid, def, deltaMs, now, structures);
        else { enemy.animState = 'idle'; enemy.targetPlayerId = ''; }
        return;
      }

      const closestData = closest as { player: PlayerSchema; dist: number; id: string };
      const player = closestData.player;
      const dist = closestData.dist;
      const targetId = closestData.id;

      if (dist > def.aggroRange) {
        if (eid.startsWith('wave_')) this.marchOnSanctum(enemy, eid, def, deltaMs, now, structures);
        else { enemy.animState = 'idle'; enemy.targetPlayerId = ''; }
        return;
      }

      enemy.targetPlayerId = targetId;

      // Move toward player if not in attack range
      if (dist > def.attackRange) {
        const norm = normalize(player.x - enemy.x, player.y - enemy.y);
        const dt = deltaMs / 1000;
        const nx = clamp(enemy.x + norm.x * def.moveSpeed * dt, 50, MAP_W - 50);
        const ny = clamp(enemy.y + norm.y * def.moveSpeed * dt, 50, MAP_H - 50);
        // Walls block creatures (axis-separated so they slide along the wall).
        if (!structures || !blockedByStructure(nx, enemy.y, 18, structures)) enemy.x = nx;
        if (!structures || !blockedByStructure(enemy.x, ny, 18, structures)) enemy.y = ny;
        enemy.animState = 'walk';

        // Rune imp erratic movement
        if (enemy.type === 'rune_imp') {
          enemy.x = clamp(enemy.x + (Math.random() - 0.5) * 20, 50, MAP_W - 50);
          enemy.y = clamp(enemy.y + (Math.random() - 0.5) * 20, 50, MAP_H - 50);
        }
      } else {
        // Attack
        const lastAttack = this.lastAttackTime.get(eid) ?? 0;
        if (now - lastAttack >= def.attackCooldownMs) {
          this.lastAttackTime.set(eid, now);
          enemy.animState = 'attack';
          const dmg = Math.round(def.attackDamage * this.threat);
          this.combat.damagePlayer(player, dmg, now);
          damageEvents.push({ sourceId: eid, targetId, amount: dmg });
        } else {
          enemy.animState = 'idle';
        }
      }
    });

    return damageEvents;
  }

  /**
   * Siege behaviour: wave enemies push toward the sanctum until they find
   * prey — and when a wall blocks the way, they bash it down.
   */
  private marchOnSanctum(
    enemy: EnemySchema,
    eid: string,
    def: { moveSpeed: number; attackDamage: number; attackCooldownMs: number },
    deltaMs: number,
    now: number,
    structures?: MapSchema<StructureSchema>
  ) {
    const d = distance(enemy.x, enemy.y, WORLD.sanctum.x, WORLD.sanctum.y);
    if (d < WORLD.sanctum.r * 0.7) { enemy.animState = 'idle'; return; }
    const n = normalize(WORLD.sanctum.x - enemy.x, WORLD.sanctum.y - enemy.y);
    const dt = deltaMs / 1000;
    const nx = clamp(enemy.x + n.x * def.moveSpeed * dt, 50, MAP_W - 50);
    const ny = clamp(enemy.y + n.y * def.moveSpeed * dt, 50, MAP_H - 50);
    let moved = false;
    if (!structures || !blockedByStructure(nx, enemy.y, 18, structures)) { enemy.x = nx; moved = true; }
    if (!structures || !blockedByStructure(enemy.x, ny, 18, structures)) { enemy.y = ny; moved = true; }
    if (!moved && structures) {
      // fully blocked: bash the nearest blocking structure
      let target: StructureSchema | null = null;
      let bestD = 90;
      structures.forEach((s) => {
        if (!STRUCTURE_DEFS[s.type as StructureType]?.blocks) return;
        const sd = distance(enemy.x, enemy.y, s.x, s.y);
        if (sd < bestD) { bestD = sd; target = s; }
      });
      if (target) {
        const wall = target as StructureSchema;
        enemy.animState = 'attack';
        const last = this.lastAttackTime.get(eid) ?? 0;
        if (now - last >= def.attackCooldownMs) {
          this.lastAttackTime.set(eid, now);
          wall.hp = Math.max(0, wall.hp - Math.round(def.attackDamage * this.threat));
        }
        return;
      }
    }
    enemy.animState = 'walk';
  }

  private respawnEnemy(enemy: EnemySchema, id: string) {
    const sp = ENEMY_SPAWNS.find((s) => s.id === id);
    if (!sp) return;
    const def = ENEMY_DEFINITIONS[sp.type];
    enemy.x = sp.x + (Math.random() - 0.5) * 40;
    enemy.y = sp.y + (Math.random() - 0.5) * 40;
    enemy.maxHp = Math.round(def.maxHp * this.threat);
    enemy.hp = enemy.maxHp;
    enemy.isAlive = true;
    enemy.animState = 'idle';
    enemy.respawnTimer = 0;
    enemy.targetPlayerId = '';
  }
}
