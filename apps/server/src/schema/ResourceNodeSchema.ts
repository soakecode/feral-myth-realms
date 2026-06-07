import { Schema, type } from '@colyseus/schema';

export class ResourceNodeSchema extends Schema {
  @type('string') id = '';
  @type('string') type = 'essence';
  @type('number') x = 0;
  @type('number') y = 0;
  @type('number') amount = 3;
  @type('boolean') available = true;
  @type('number') respawnTimer = 0;
}
