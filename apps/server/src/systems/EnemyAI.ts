import { MapSchema } from '@colyseus/schema';
import { PlayerSchema } from '../schema/PlayerSchema.js';
import { EnemySchema } from '../schema/EnemySchema.js';
import { ENEMY_DEFINITIONS, ENEMY_SPAWNS } from '@fmr/shared';
import { distance, clamp, normalize, WORLD } from '@fmr/shared';
import type { EnemyType } from '@fmr/shared';
import { CombatSystem } from './CombatSystem.js';

const MAP_W = WORLD.width;
const MAP_H = WORLD.height;

export class EnemyAI {
  private lastAttackTime: Map<string, number> = new Map();
  private combat = new CombatSystem();

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
    now: number
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
        enemy.animState = 'idle';
        enemy.targetPlayerId = '';
        return;
      }

      const closestData = closest as { player: PlayerSchema; dist: number; id: string };
      const player = closestData.player;
      const dist = closestData.dist;
      const targetId = closestData.id;

      if (dist > def.aggroRange) {
        enemy.animState = 'idle';
        enemy.targetPlayerId = '';
        return;
      }

      enemy.targetPlayerId = targetId;

      // Move toward player if not in attack range
      if (dist > def.attackRange) {
        const norm = normalize(player.x - enemy.x, player.y - enemy.y);
        enemy.x = clamp(enemy.x + norm.x * def.moveSpeed * (deltaMs / 1000), 50, MAP_W - 50);
        enemy.y = clamp(enemy.y + norm.y * def.moveSpeed * (deltaMs / 1000), 50, MAP_H - 50);
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
          this.combat.damagePlayer(player, def.attackDamage, now);
          damageEvents.push({ sourceId: eid, targetId, amount: def.attackDamage });
        } else {
          enemy.animState = 'idle';
        }
      }
    });

    return damageEvents;
  }

  private respawnEnemy(enemy: EnemySchema, id: string) {
    const sp = ENEMY_SPAWNS.find((s) => s.id === id);
    if (!sp) return;
    const def = ENEMY_DEFINITIONS[sp.type];
    enemy.x = sp.x + (Math.random() - 0.5) * 40;
    enemy.y = sp.y + (Math.random() - 0.5) * 40;
    enemy.hp = def.maxHp;
    enemy.isAlive = true;
    enemy.animState = 'idle';
    enemy.respawnTimer = 0;
    enemy.targetPlayerId = '';
  }
}
