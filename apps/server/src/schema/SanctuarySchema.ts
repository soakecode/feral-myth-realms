import { Schema, type } from '@colyseus/schema';

export class SanctuarySchema extends Schema {
  @type('string') id: string = '';
  @type('number') x: number = 0;
  @type('number') y: number = 0;
  @type('number') radius: number = 80;
  @type('number') captureProgress: number = 0;
  @type('number') captureTeam: number = -1;
  @type('string') state: string = 'neutral';
}
