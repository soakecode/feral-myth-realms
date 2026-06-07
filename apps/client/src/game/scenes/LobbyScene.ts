import Phaser from 'phaser';
import { t } from '../../i18n/index.js';
import {
  createRealmRoom,
  joinOrCreateRealm,
  joinOrCreateDuel,
  joinByCode,
  getAvailableRooms,
} from '../../net/ColyseusClient.js';
import type { PlayerSession } from '../../auth/sessionStore.js';

export class LobbyScene extends Phaser.Scene {
  private session!: PlayerSession;
  private pingInterval?: number;

  constructor() {
    super({ key: 'LobbyScene' });
  }

  init(data: { session: PlayerSession }) {
    this.session = data.session;
  }

  async create() {
    const overlay = document.getElementById('ui-overlay')!;
    overlay.innerHTML = '';

    const rooms = await getAvailableRooms().catch(() => []);
    this.render(overlay, rooms);
  }

  private render(overlay: HTMLElement, rooms: Array<{ roomId: string; metadata?: { roomCode?: string; hostAlias?: string }; clients: number; maxClients: number }>) {
    const roomsHtml = rooms.length > 0
      ? rooms.map((r) => `
          <div class="room-item" data-roomid="${r.roomId}">
            <span>🌍 Sala ${r.metadata?.roomCode ?? r.roomId.slice(0, 6)}</span>
            <span>${r.clients}/${r.maxClients} jugadores</span>
            <button class="room-join-btn" data-roomid="${r.roomId}">Unirse</button>
          </div>
        `).join('')
      : `<div style="color:#667;font-size:12px;text-align:center;padding:12px">${t('lobby_no_rooms')}</div>`;

    overlay.innerHTML = `
      <style>
        #lobby-scene {
          position:absolute; top:0; left:0; width:100%; height:100%;
          display:flex; align-items:center; justify-content:center;
          background:radial-gradient(ellipse at center,#1a2a3a 0%,#0d1a2e 60%,#080d1a 100%);
          font-family:'Segoe UI',system-ui,sans-serif; color:#fff;
        }
        .lobby-card {
          background:linear-gradient(145deg,#1a1a3e,#0d0d2e);
          border:1px solid rgba(255,215,0,0.2); border-radius:14px;
          padding:32px 36px; width:420px; max-height:90vh; overflow-y:auto;
          box-shadow:0 8px 40px rgba(0,0,0,0.5);
        }
        .lobby-card h2 { color:#ffd700; font-size:20px; margin-bottom:4px; }
        .player-badge {
          background:rgba(255,255,255,0.05); border-radius:8px;
          padding:8px 12px; margin-bottom:20px; font-size:12px; color:#aabbcc;
          display:flex; align-items:center; gap:8px;
        }
        .player-class-dot {
          width:12px; height:12px; border-radius:50%;
          display:inline-block;
        }
        .section-title { font-size:11px; color:#667; text-transform:uppercase;
          letter-spacing:1px; margin:16px 0 8px; }
        .lobby-btn {
          width:100%; padding:12px; margin-bottom:8px;
          border:none; border-radius:8px; font-size:14px;
          font-weight:600; cursor:pointer; display:flex;
          align-items:center; gap:10px; justify-content:center;
        }
        .btn-coop { background:linear-gradient(135deg,#1e5a2e,#2a7a3e); color:#88ffaa; border:1px solid #2a7a3e; }
        .btn-duel { background:linear-gradient(135deg,#5a1e1e,#7a2a2a); color:#ffaaaa; border:1px solid #7a2a2a; }
        .btn-private { background:rgba(255,255,255,0.05); color:#aabbcc; border:1px solid rgba(255,255,255,0.15); }
        .lobby-btn:hover { filter:brightness(1.2); transform:translateY(-1px); }
        .code-row { display:flex; gap:8px; margin-bottom:8px; }
        .code-input {
          flex:1; padding:10px 12px; background:rgba(255,255,255,0.05);
          border:1px solid rgba(255,255,255,0.15); border-radius:6px;
          color:#fff; font-size:14px; outline:none; text-transform:uppercase;
          letter-spacing:2px;
        }
        .code-input::placeholder { letter-spacing:0; text-transform:none; }
        .code-input:focus { border-color:#ffd700; }
        .code-join-btn {
          padding:10px 16px; background:linear-gradient(135deg,#ffd700,#ffaa00);
          color:#1a1a2e; border:none; border-radius:6px;
          font-weight:700; cursor:pointer; white-space:nowrap;
        }
        .rooms-list { max-height:120px; overflow-y:auto; }
        .room-item {
          display:flex; align-items:center; justify-content:space-between;
          padding:6px 8px; border-radius:6px; font-size:12px;
          background:rgba(255,255,255,0.04); margin-bottom:4px;
        }
        .room-join-btn {
          padding:3px 10px; background:rgba(255,215,0,0.2);
          color:#ffd700; border:1px solid rgba(255,215,0,0.3);
          border-radius:4px; cursor:pointer; font-size:11px;
        }
        #lobby-status {
          background:rgba(255,60,60,0.15); border:1px solid rgba(255,60,60,0.3);
          border-radius:6px; padding:8px 12px; font-size:12px; color:#ff8888;
          margin-top:10px; display:none;
        }
        #lobby-loading {
          text-align:center; padding:20px; color:#667; display:none;
        }
        .back-btn {
          padding:8px 16px; background:transparent; color:#667;
          border:1px solid rgba(255,255,255,0.1); border-radius:6px;
          cursor:pointer; font-size:12px; margin-top:8px; width:100%;
        }
        .class-colors { stag_druid:'#4caf50',raven_witch:'#7c4dff',wolf_guardian:'#607d8b',fox_trickster:'#ff6f00' }
      </style>
      <div id="lobby-scene">
        <div class="lobby-card">
          <h2>🏰 ${t('lobby_title')}</h2>

          <div class="player-badge">
            <span class="player-class-dot" style="background:${this.getClassColor(this.session.classKey)}"></span>
            <span><strong>${this.session.alias}</strong></span>
            <span style="margin-left:auto;font-size:10px;color:#556">${this.session.mode === 'registered' ? '✓ Registrado' : '👤 Invitado'}</span>
          </div>

          <div class="section-title">Jugar</div>
          <button class="lobby-btn btn-coop" id="btn-create-realm">🌍 ${t('btn_create_realm')}</button>
          <button class="lobby-btn btn-coop" id="btn-join-realm">🔗 ${t('btn_join_realm')}</button>
          <button class="lobby-btn btn-duel" id="btn-duel">⚔️ ${t('btn_find_duel')}</button>

          <div class="section-title">${t('btn_join_code')}</div>
          <div class="code-row">
            <input type="text" class="code-input" id="input-code" placeholder="XXXXXX" maxlength="6" />
            <button class="code-join-btn" id="btn-join-code">${t('lobby_join')}</button>
          </div>

          <button class="lobby-btn btn-private" id="btn-create-private">🔒 ${t('btn_create_private')}</button>

          <div class="section-title">${t('lobby_available_rooms')}</div>
          <div class="rooms-list">${roomsHtml}</div>

          <div id="lobby-status"></div>
          <div id="lobby-loading">Conectando...</div>

          <button class="back-btn" id="btn-back">← Volver al menú</button>
        </div>
      </div>
    `;

    document.getElementById('btn-create-realm')?.addEventListener('click', () => void this.joinGame('create-realm'));
    document.getElementById('btn-join-realm')?.addEventListener('click', () => void this.joinGame('join-realm'));
    document.getElementById('btn-duel')?.addEventListener('click', () => void this.joinGame('duel'));
    document.getElementById('btn-create-private')?.addEventListener('click', () => void this.joinGame('private'));
    document.getElementById('btn-join-code')?.addEventListener('click', () => void this.joinGame('code'));
    document.getElementById('input-code')?.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') void this.joinGame('code');
    });
    document.getElementById('btn-back')?.addEventListener('click', () => {
      this.scene.start('MainMenuScene');
    });

    // Room list join buttons
    overlay.querySelectorAll('.room-join-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const roomId = btn.getAttribute('data-roomid')!;
        void this.joinGameById(roomId);
      });
    });
  }

  private getClassColor(classKey: string): string {
    const colors: Record<string, string> = {
      stag_druid: '#4caf50',
      raven_witch: '#7c4dff',
      wolf_guardian: '#607d8b',
      fox_trickster: '#ff6f00',
    };
    return colors[classKey] ?? '#ffffff';
  }

  private setLoading(loading: boolean) {
    const loadEl = document.getElementById('lobby-loading');
    const statusEl = document.getElementById('lobby-status');
    if (loadEl) loadEl.style.display = loading ? 'block' : 'none';
    if (statusEl) statusEl.style.display = 'none';
  }

  private setError(msg: string) {
    const statusEl = document.getElementById('lobby-status');
    if (statusEl) {
      statusEl.textContent = msg;
      statusEl.style.display = 'block';
    }
  }

  private getJoinOptions() {
    return {
      alias: this.session.alias,
      classKey: this.session.classKey,
      authToken: this.session.authToken ?? undefined,
      guestId: this.session.guestId ?? undefined,
    };
  }

  private async joinGame(action: string) {
    this.setLoading(true);
    try {
      let room;
      const opts = this.getJoinOptions();

      if (action === 'create-realm') {
        room = await createRealmRoom({ ...opts, isPrivate: false });
      } else if (action === 'join-realm') {
        room = await joinOrCreateRealm({ ...opts, isPrivate: false });
      } else if (action === 'duel') {
        room = await joinOrCreateDuel(opts);
        this.scene.start('GameScene', { room, session: this.session, mode: 'duel' });
        return;
      } else if (action === 'private') {
        room = await createRealmRoom({ ...opts, isPrivate: true });
      } else if (action === 'code') {
        const code = (document.getElementById('input-code') as HTMLInputElement)?.value.trim().toUpperCase();
        if (!code || code.length < 4) { this.setError('Introduce un código válido'); return; }
        room = await joinByCode(code, opts);
      } else {
        return;
      }

      this.scene.start('GameScene', { room, session: this.session, mode: 'realm' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('err_unknown');
      this.setError(msg);
    } finally {
      this.setLoading(false);
    }
  }

  private async joinGameById(roomId: string) {
    this.setLoading(true);
    try {
      const { joinRealmRoom } = await import('../../net/ColyseusClient.js');
      const room = await joinRealmRoom(roomId, this.getJoinOptions());
      this.scene.start('GameScene', { room, session: this.session, mode: 'realm' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('err_unknown');
      this.setError(msg);
    } finally {
      this.setLoading(false);
    }
  }

  shutdown() {
    if (this.pingInterval) clearInterval(this.pingInterval);
    document.getElementById('ui-overlay')!.innerHTML = '';
  }
}
