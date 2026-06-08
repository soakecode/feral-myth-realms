import { Schema, type } from '@colyseus/schema';

/** Friendly unit (e.g. a soldier trained at a barracks) that defends the realm. */
export class UnitSchema extends Schema {
  @type('string') id: string = '';
  @type('string') kind: string = 'soldier';
  @type('string') ownerId: string = '';
  @type('string') homeId: string = ''; // barracks structure id
  @type('number') x: number = 0;
  @type('number') y: number = 0;
  @type('number') hp: number = 60;
  @type('number') maxHp: number = 60;
  @type('boolean') isAlive: boolean = true;
  @type('string') animState: string = 'idle';
}
