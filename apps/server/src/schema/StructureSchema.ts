import { Schema, type } from '@colyseus/schema';

export class StructureSchema extends Schema {
  @type('string') id = '';
  @type('string') type = 'campfire';
  @type('number') x = 0;
  @type('number') y = 0;
  @type('string') ownerId = '';
  @type('string') ownerAlias = '';
  @type('number') teamId = 0;
  @type('number') createdAt = 0;
}
