import { MapSchema } from '@colyseus/schema';
import { PlayerSchema } from '../schema/PlayerSchema.js';
import { EnemySchema } from '../schema/EnemySchema.js';
import { CLASS_DEFINITIONS } from '@fmr/shared';
import { distance, clamp } from '@fmr/shared';
import type { AbilityKey, PlayerClass } from '@fmr/shared';

interface DamageResult {
  targetId: string;
  amount: number;
  isPlayer: boolean;
  killed: boolean;
}

export class CombatSystem {
  private lastAttackTime: Map<string, number> = new Map();

  applyPlayerAttack(
    attackerId: string,
    aimX: number,
    aimY: number,
    players: MapSchema<PlayerSchema>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    enemies: MapSchema<any>,
    now: number
  ): DamageResult[] {
    const attacker = players.get(attackerId);
    if (!attacker || !attacker.isAlive) return [];

    const classDef = CLASS_DEFINITIONS[attacker.classKey as PlayerClass];
    if (!classDef) return [];

    const cooldownMs = classDef.stats.attackCooldownMs;
    const last = this.lastAttackTime.get(attackerId) ?? 0;
    if (now - last < cooldownMs) return [];

    this.lastAttackTime.set(attackerId, now);
    attacker.cooldowns.basic = now;
    attacker.animState = 'attack';

    const results: DamageResult[] = [];
    const range = classDef.stats.attackRange;
    const dmg = classDef.stats.attackDamage;

    // Hit enemies in range toward aim direction
    enemies.forEach((enemy, eid) => {
      if (!enemy.isAlive) return;
      const dist = distance(attacker.x, attacker.y, enemy.x, enemy.y);
      if (dist <= range) {
        const result = this.damageEnemy(enemy, dmg, now);
        results.push({ targetId: eid, amount: dmg, isPlayer: false, killed: result.killed });
      }
    });

    // In duel: also hit players (PvP)
    players.forEach((target, tid) => {
      if (tid === attackerId || !target.isAlive) return;
      const dist = distance(attacker.x, attacker.y, target.x, target.y);
      if (dist <= range) {
        const result = this.damagePlayer(target, dmg, now);
        results.push({ targetId: tid, amount: dmg, isPlayer: true, killed: result.killed });
      }
    });

    return results;
  }

  applyAbility(
    playerId: string,
    abilityKey: AbilityKey,
    aimX: number,
    aimY: number,
    players: MapSchema<PlayerSchema>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    enemies: MapSchema<any>,
    now: number
  ): DamageResult[] {
    const player = players.get(playerId);
    if (!player || !player.isAlive) return [];

    const classDef = CLASS_DEFINITIONS[player.classKey as PlayerClass];
    if (!classDef || abilityKey === 'basic' || abilityKey === 'space') return [];

    const abilityDef = classDef.abilities[abilityKey as 'q' | 'e' | 'r'];
    if (!abilityDef) return [];

    // Check cooldown
    const lastUsed = (player.cooldowns as unknown as Record<string, number>)[abilityKey] ?? 0;
    if (now - lastUsed < abilityDef.cooldownMs) return [];

    // Check energy
    if (player.energy < abilityDef.energyCost) return [];

    // Consume energy and set cooldown
    player.energy = clamp(player.energy - abilityDef.energyCost, 0, player.maxEnergy);
    (player.cooldowns as unknown as Record<string, number>)[abilityKey] = now;
    player.animState = 'attack';

    const results: DamageResult[] = [];

    // Handle healing (stag_druid Q)
    if (abilityDef.damage === 0 && abilityDef.duration > 0 && player.classKey === 'stag_druid' && abilityKey === 'q') {
      // Heal nearby allies
      const healAmount = 20;
      players.forEach((target) => {
        if (!target.isAlive) return;
        const dist = distance(player.x, player.y, target.x, target.y);
        if (dist <= abilityDef.radius * 1.5) {
          target.hp = clamp(target.hp + healAmount, 0, target.maxHp);
        }
      });
      return results;
    }

    // Blink (raven_witch E)
    if (player.classKey === 'raven_witch' && abilityKey === 'e') {
      const dx = aimX - player.x;
      const dy = aimY - player.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const blinkDist = Math.min(dist, abilityDef.range);
      if (dist > 0) {
        player.x = clamp(player.x + (dx / dist) * blinkDist, 50, 1550);
        player.y = clamp(player.y + (dy / dist) * blinkDist, 50, 1150);
      }
      return results;
    }

    // Dash (fox_trickster E)
    if (player.classKey === 'fox_trickster' && abilityKey === 'e') {
      const dx = aimX - player.x;
      const dy = aimY - player.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 0) {
        player.x = clamp(player.x + (dx / dist) * abilityDef.range, 50, 1550);
        player.y = clamp(player.y + (dy / dist) * abilityDef.range, 50, 1150);
      }
      return results;
    }

    // Leap (wolf_guardian E)
    if (player.classKey === 'wolf_guardian' && abilityKey === 'e') {
      const dx = aimX - player.x;
      const dy = aimY - player.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const leapDist = Math.min(dist, abilityDef.range);
      if (dist > 0) {
        player.x = clamp(player.x + (dx / dist) * leapDist, 50, 1550);
        player.y = clamp(player.y + (dy / dist) * leapDist, 50, 1150);
      }
    }

    // Area damage abilities
    if (abilityDef.damage > 0 && abilityDef.radius > 0) {
      const centerX = abilityDef.range > 0 ? aimX : player.x;
      const centerY = abilityDef.range > 0 ? aimY : player.y;

      enemies.forEach((enemy, eid) => {
        if (!enemy.isAlive) return;
        const dist = distance(centerX, centerY, enemy.x, enemy.y);
        if (dist <= abilityDef.radius) {
          const res = this.damageEnemy(enemy, abilityDef.damage, now);
          results.push({ targetId: eid, amount: abilityDef.damage, isPlayer: false, killed: res.killed });
        }
      });

      // PvP damage in duel
      players.forEach((target, tid) => {
        if (tid === playerId || !target.isAlive) return;
        const dist = distance(centerX, centerY, target.x, target.y);
        if (dist <= abilityDef.radius) {
          const res = this.damagePlayer(target, abilityDef.damage, now);
          results.push({ targetId: tid, amount: abilityDef.damage, isPlayer: true, killed: res.killed });
        }
      });
    }

    // Projectile abilities (single target toward aim)
    if (abilityDef.damage > 0 && abilityDef.projectileSpeed > 0 && abilityDef.radius <= 20) {
      let closest: { id: string; dist: number } | null = null;
      enemies.forEach((enemy, eid) => {
        if (!enemy.isAlive) return;
        const dist = distance(player.x, player.y, enemy.x, enemy.y);
        if (dist <= abilityDef.range && (!closest || dist < closest.dist)) {
          closest = { id: eid, dist };
        }
      });
      if (closest) {
        const closestId = (closest as { id: string }).id;
        const enemy = enemies.get(closestId)!;
        const res = this.damageEnemy(enemy, abilityDef.damage, now);
        results.push({ targetId: closestId, amount: abilityDef.damage, isPlayer: false, killed: res.killed });
      }
    }

    return results;
  }

  damagePlayer(player: PlayerSchema, amount: number, _now: number): { killed: boolean } {
    if (!player.isAlive) return { killed: false };
    player.hp = clamp(player.hp - amount, 0, player.maxHp);
    player.animState = 'hit';
    if (player.hp === 0) {
      player.isAlive = false;
      player.animState = 'death';
      player.respawnTimer = 5000;
      return { killed: true };
    }
    return { killed: false };
  }

  damageEnemy(enemy: EnemySchema, amount: number, _now: number): { killed: boolean } {
    if (!enemy.isAlive) return { killed: false };
    enemy.hp = clamp(enemy.hp - amount, 0, enemy.maxHp);
    enemy.animState = 'hit';
    if (enemy.hp === 0) {
      enemy.isAlive = false;
      enemy.animState = 'death';
      enemy.respawnTimer = 15000;
      return { killed: true };
    }
    return { killed: false };
  }
}
