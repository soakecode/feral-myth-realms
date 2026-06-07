import { Schema, type } from '@colyseus/schema';

export class EnemySchema extends Schema {
  @type('string') id: string = '';
  @type('string') type: string = 'wisp';
  @type('number') x: number = 0;
  @type('number') y: number = 0;
  @type('number') hp: number = 30;
  @type('number') maxHp: number = 30;
  @type('boolean') isAlive: boolean = true;
  @type('number') respawnTimer: number = 0;
  @type('string') targetPlayerId: string = '';
  @type('string') animState: string = 'idle';
}
