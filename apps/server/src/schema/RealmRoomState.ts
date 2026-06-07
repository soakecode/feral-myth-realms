import { Schema, type, MapSchema, ArraySchema } from '@colyseus/schema';
import { PlayerSchema } from './PlayerSchema.js';
import { EnemySchema } from './EnemySchema.js';
import { SanctuarySchema } from './SanctuarySchema.js';

export class RealmRoomState extends Schema {
  @type({ map: PlayerSchema }) players = new MapSchema<PlayerSchema>();
  @type({ map: EnemySchema }) enemies = new MapSchema<EnemySchema>();
  @type([SanctuarySchema]) sanctuaries = new ArraySchema<SanctuarySchema>();
  @type('number') elapsedMs: number = 0;
  @type('boolean') matchActive: boolean = true;
}
