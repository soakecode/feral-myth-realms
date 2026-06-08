import { Schema, type, MapSchema, ArraySchema } from '@colyseus/schema';
import { PlayerSchema } from './PlayerSchema.js';
import { EnemySchema } from './EnemySchema.js';
import { SanctuarySchema } from './SanctuarySchema.js';
import { ResourceNodeSchema } from './ResourceNodeSchema.js';
import { StructureSchema } from './StructureSchema.js';
import { UnitSchema } from './UnitSchema.js';

export class RealmRoomState extends Schema {
  @type({ map: PlayerSchema }) players = new MapSchema<PlayerSchema>();
  @type({ map: EnemySchema }) enemies = new MapSchema<EnemySchema>();
  @type([SanctuarySchema]) sanctuaries = new ArraySchema<SanctuarySchema>();
  @type({ map: ResourceNodeSchema }) resources = new MapSchema<ResourceNodeSchema>();
  @type({ map: StructureSchema }) structures = new MapSchema<StructureSchema>();
  @type({ map: UnitSchema }) units = new MapSchema<UnitSchema>();
  @type('number') elapsedMs: number = 0;
  @type('boolean') matchActive: boolean = true;
}
