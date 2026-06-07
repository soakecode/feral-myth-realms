import { Schema, type } from '@colyseus/schema';

export class CooldownsSchema extends Schema {
  @type('number') basic: number = 0;
  @type('number') q: number = 0;
  @type('number') e: number = 0;
  @type('number') r: number = 0;
  @type('number') space: number = 0;
}

export class PlayerSchema extends Schema {
  @type('string') id: string = '';
  @type('string') userId: string = '';
  @type('string') guestId: string = '';
  @type('string') alias: string = 'Player';
  @type('string') classKey: string = 'stag_druid';
  @type('number') x: number = 400;
  @type('number') y: number = 300;
  @type('string') direction: string = 'down';
  @type('string') animState: string = 'idle';
  @type('number') hp: number = 100;
  @type('number') maxHp: number = 100;
  @type('number') energy: number = 100;
  @type('number') maxEnergy: number = 100;
  @type('number') level: number = 1;
  @type('number') xp: number = 0;
  @type('boolean') isAlive: boolean = true;
  @type('number') respawnTimer: number = 0;
  @type('number') moveSpeed: number = 160;
  @type('number') attackDamage: number = 15;
  @type('number') attackRange: number = 200;
  @type('string') authMode: string = 'guest';
  @type('number') teamId: number = 0;
  @type(CooldownsSchema) cooldowns: CooldownsSchema = new CooldownsSchema();
}
