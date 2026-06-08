import { describe, expect, it } from 'vitest';
import { MapSchema } from '@colyseus/schema';
import { UnitSystem } from './UnitSystem.js';
import { UnitSchema } from '../schema/UnitSchema.js';
import { EnemySchema } from '../schema/EnemySchema.js';
import { StructureSchema } from '../schema/StructureSchema.js';

describe('UnitSystem', () => {
  it('spawns soldiers from barracks and lets them damage nearby enemies', () => {
    const units = new MapSchema<UnitSchema>();
    const enemies = new MapSchema<EnemySchema>();
    const structures = new MapSchema<StructureSchema>();
    const system = new UnitSystem();

    const barracks = new StructureSchema();
    barracks.id = 'barracks_1';
    barracks.type = 'barracks';
    barracks.ownerId = 'player_1';
    barracks.x = 1000;
    barracks.y = 1000;
    structures.set(barracks.id, barracks);

    const enemy = new EnemySchema();
    enemy.id = 'enemy_1';
    enemy.type = 'wisp';
    enemy.x = 1030;
    enemy.y = 1000;
    enemy.hp = 30;
    enemy.maxHp = 30;
    enemy.isAlive = true;
    enemies.set(enemy.id, enemy);

    system.tick(units, structures, enemies, 50, 1);
    expect(units.size).toBe(1);

    const events = system.tick(units, structures, enemies, 900, 1000);
    expect(events.length).toBeGreaterThan(0);
    expect(enemy.hp).toBeLessThan(30);
    expect(events[0].ownerId).toBe('player_1');
  });
});
