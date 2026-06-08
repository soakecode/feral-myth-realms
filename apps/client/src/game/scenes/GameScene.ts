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
    try {
      this.game3d = new Game3D(this.room, this.session, this.mode, () => {
        this.game.canvas.style.display = '';
        this.scene.start('LobbyScene', { session: this.session });
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al iniciar la escena 3D';
      this.room.leave().catch(() => undefined);
      this.game.canvas.style.display = '';
      this.showFatal(message);
    }
  }

  private showFatal(message: string) {
    const overlay = document.getElementById('ui-overlay');
    if (!overlay) return;
    overlay.innerHTML = `
      <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#080b10;color:#f4ead2;font-family:Segoe UI,system-ui,sans-serif;padding:18px">
        <div style="width:min(420px,100%);background:rgba(20,24,30,.96);border:1px solid rgba(255,120,120,.35);border-radius:10px;padding:18px;box-shadow:0 18px 60px rgba(0,0,0,.45)">
          <h2 style="margin:0 0 8px;color:#ffb4b4;font-size:18px">No se pudo abrir la partida</h2>
          <p style="margin:0 0 14px;color:#d9cfc0;font-size:13px;line-height:1.4">${escapeHtml(message)}</p>
          <button id="game-fatal-back" style="width:100%;padding:11px;border-radius:8px;border:1px solid rgba(255,255,255,.18);background:#203044;color:#fff">Volver al lobby</button>
        </div>
      </div>
    `;
    document.getElementById('game-fatal-back')?.addEventListener('click', () => {
      this.scene.start('LobbyScene', { session: this.session });
    });
  }

  shutdown() {
    this.game3d?.dispose();
    this.game3d = undefined;
    this.game.canvas.style.display = '';
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
