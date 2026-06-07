import { Schema, type, MapSchema } from '@colyseus/schema';
import { PlayerSchema } from './PlayerSchema.js';

export class DuelRoomState extends Schema {
  @type({ map: PlayerSchema }) players = new MapSchema<PlayerSchema>();
  @type('number') elapsedMs: number = 0;
  @type('number') remainingMs: number = 3 * 60 * 1000;
  @type('boolean') matchActive: boolean = false;
  @type('boolean') matchEnded: boolean = false;
  @type('string') winnerPlayerId: string = '';
  @type('string') winnerAlias: string = '';
}
