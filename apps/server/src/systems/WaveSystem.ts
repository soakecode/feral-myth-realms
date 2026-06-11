import { MapSchema } from '@colyseus/schema';
import { EnemySchema } from '../schema/EnemySchema.js';
import { ENEMY_DEFINITIONS, WORLD, waveNumberAt } from '@fmr/shared';
import type { EnemyKind } from '@fmr/shared';

/**
 * Siege waves: periodic hordes spawn at the map edges and march on the
 * sanctum (EnemyAI gives `wave_*` enemies that march behaviour). Wave enemies
 * never respawn — once dead they are removed from state shortly after.
 */
export class WaveSystem {
  private lastWave = 0;

  /** Spawn the next wave if its time has come. Returns the wave number (0 = none). */
  maybeSpawn(elapsedMs: number, enemies: MapSchema<EnemySchema>, threat: number): number {
    const w = waveNumberAt(elapsedMs);
    if (w <= this.lastWave) return 0;
    this.lastWave = w;

    const count = Math.min(4 + w * 2, 14);
    const types: EnemyKind[] = ['wisp', 'bramble_beast', 'rune_imp'];
    for (let i = 0; i < count; i++) {
      const e = new EnemySchema();
      e.id = `wave_${w}_${i}`;
      e.type = types[(w + i) % types.length];
      const edge = Math.floor(Math.random() * 4);
      if (edge === 0) { e.x = 80; e.y = Math.random() * WORLD.height; }
      else if (edge === 1) { e.x = WORLD.width - 80; e.y = Math.random() * WORLD.height; }
      else if (edge === 2) { e.x = Math.random() * WORLD.width; e.y = 80; }
      else { e.x = Math.random() * WORLD.width; e.y = WORLD.height - 80; }
      const def = ENEMY_DEFINITIONS[e.type as EnemyKind];
      e.maxHp = Math.round(def.maxHp * threat);
      e.hp = e.maxHp;
      e.isAlive = true;
      e.animState = 'walk';
      enemies.set(e.id, e);
    }
    return w;
  }

  /** Drop dead wave enemies from state (they sit at negative respawnTimer). */
  cleanup(enemies: MapSchema<EnemySchema>) {
    const gone: string[] = [];
    enemies.forEach((e, id) => {
      if (id.startsWith('wave_') && !e.isAlive && e.respawnTimer < -2500) gone.push(id);
    });
    for (const id of gone) enemies.delete(id);
  }
}
