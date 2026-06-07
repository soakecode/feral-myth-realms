import type { EnemyType } from '../types/index.js';

export interface EnemyDef {
  type: EnemyType;
  maxHp: number;
  moveSpeed: number;
  attackDamage: number;
  attackRange: number;
  attackCooldownMs: number;
  aggroRange: number;
  color: number;
  xpReward: number;
}

export const ENEMY_DEFINITIONS: Record<EnemyType, EnemyDef> = {
  wisp: {
    type: 'wisp',
    maxHp: 30,
    moveSpeed: 90,
    attackDamage: 5,
    attackRange: 50,
    attackCooldownMs: 1500,
    aggroRange: 200,
    color: 0x80deea,
    xpReward: 10,
  },
  bramble_beast: {
    type: 'bramble_beast',
    maxHp: 80,
    moveSpeed: 60,
    attackDamage: 14,
    attackRange: 55,
    attackCooldownMs: 1800,
    aggroRange: 160,
    color: 0x6d4c41,
    xpReward: 25,
  },
  rune_imp: {
    type: 'rune_imp',
    maxHp: 45,
    moveSpeed: 110,
    attackDamage: 8,
    attackRange: 160,
    attackCooldownMs: 2000,
    aggroRange: 240,
    color: 0xce93d8,
    xpReward: 15,
  },
};
