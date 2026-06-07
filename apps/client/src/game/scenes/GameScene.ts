import Phaser from 'phaser';
import type { Room } from '@colyseus/sdk';
import { Game3D } from '../../game3d/Game3D.js';
import type { PlayerSession } from '../../auth/sessionStore.js';

/**
 * Thin Phaser scene that hands the in-game rendering over to the Three.js
 * view (Game3D). The Phaser canvas is hidden while playing and restored on exit.
 * All gameplay state still comes from the authoritative Colyseus room.
 */
export class GameScene extends Phaser.Scene {
  private room!: Room;
  private session!: PlayerSession;
  private mode: 'realm' | 'duel' = 'realm';
  private game3d?: Game3D;

  constructor() {
    super({ key: 'GameScene' });
  }

  init(data: { room: Room; session: PlayerSession; mode?: 'realm' | 'duel' }) {
    this.room = data.room;
    this.session = data.session;
    this.mode = data.mode ?? 'realm';
  }

  create() {
    this.game.canvas.style.display = 'none';
    this.game3d = new Game3D(this.room, this.session, this.mode, () => {
      this.game.canvas.style.display = '';
      this.scene.start('LobbyScene', { session: this.session });
    });
  }

  shutdown() {
    this.game3d?.dispose();
    this.game3d = undefined;
    this.game.canvas.style.display = '';
  }
}
