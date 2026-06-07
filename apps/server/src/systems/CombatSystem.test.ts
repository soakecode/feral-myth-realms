import { describe, expect, it } from 'vitest';
import { MapSchema } from '@colyseus/schema';
import { CombatSystem } from './CombatSystem.js';
import { PlayerSchema } from '../schema/PlayerSchema.js';
import { EnemySchema } from '../schema/EnemySchema.js';

function makePlayer() {
  const player = new PlayerSchema();
  player.id = 'p1';
  player.classKey = 'raven_witch';
  player.x = 100;
  player.y = 100;
  player.hp = 90;
  player.maxHp = 90;
  player.energy = 130;
  player.maxEnergy = 130;
  player.isAlive = true;
  return player;
}

function makeEnemy() {
  const enemy = new EnemySchema();
  enemy.id = 'e1';
  enemy.type = 'wisp';
  enemy.x = 180;
  enemy.y = 100;
  enemy.hp = 30;
  enemy.maxHp = 30;
  enemy.isAlive = true;
  return enemy;
}

describe('CombatSystem', () => {
  it('damages enemies in range with a basic attack', () => {
    const combat = new CombatSystem();
    const players = new MapSchema<PlayerSchema>();
    const enemies = new MapSchema<EnemySchema>();
    players.set('p1', makePlayer());
    enemies.set('e1', makeEnemy());

    const results = combat.applyPlayerAttack('p1', 180, 100, players, enemies, 1000);

    expect(results).toEqual([
      { targetId: 'e1', amount: 18, isPlayer: false, killed: false },
    ]);
    expect(enemies.get('e1')?.hp).toBe(12);
  });

  it('respects basic attack cooldown', () => {
    const combat = new CombatSystem();
    const players = new MapSchema<PlayerSchema>();
    const enemies = new MapSchema<EnemySchema>();
    players.set('p1', makePlayer());
    enemies.set('e1', makeEnemy());

    combat.applyPlayerAttack('p1', 180, 100, players, enemies, 1000);
    const secondAttack = combat.applyPlayerAttack('p1', 180, 100, players, enemies, 1100);

    expect(secondAttack).toEqual([]);
    expect(enemies.get('e1')?.hp).toBe(12);
  });
});
