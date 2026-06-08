import Phaser from 'phaser';
import { t } from '../../i18n/index.js';
import {
  createRealmRoom,
  joinOrCreateRealm,
  joinOrCreateDuel,
  joinByCode,
  getAvailableRooms,
  checkGameServerHealth,
  getGameServerEndpoint,
} from '../../net/ColyseusClient.js';
import { ENV } from '../../config/env.js';
import type { PlayerSession } from '../../auth/sessionStore.js';
import { assetManifest } from '../../assets/assetManifest.js';

const CLASS_ART_POSITIONS: Record<string, string> = {
  stag_druid: '0% 0%',
  raven_witch: '33.3% 0%',
  wolf_guardian: '66.6% 0%',
  fox_trickster: '100% 0%',
};

const JOIN_TIMEOUT_MS = 12000;

async function withTimeout<T>(label: string, promise: Promise<T>, timeoutMs = JOIN_TIMEOUT_MS): Promise<T> {
  let timer = 0;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(`${label} no respondio tras ${Math.round(timeoutMs / 1000)}s`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    window.clearTimeout(timer);
  }
}

export class LobbyScene extends Phaser.Scene {
  private session!: PlayerSession;
  private pingInterval?: number;
  private onPopState = () => this.scene.start('MainMenuScene');

  constructor() {
    super({ key: 'LobbyScene' });
  }

  init(data: { session: PlayerSession }) {
    this.session = data.session;
  }

  async create() {
    const overlay = document.getElementById('ui-overlay')!;
    overlay.innerHTML = '';
    this.pushNavigationState();

    const rooms = await getAvailableRooms().catch(() => []);
    this.render(overlay, rooms);
  }

  private pushNavigationState() {
    try {
      window.history.pushState({ fmrScene: 'lobby' }, '', window.location.href);
    } catch {
      // Embedded browsers can block history updates.
    }
    window.addEventListener('popstate', this.onPopState);
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
    const deployWarning = this.getDeployWarning();
    const serverEndpoint = getGameServerEndpoint();

    overlay.innerHTML = `
      <style>
        #lobby-scene {
          position:absolute; top:0; left:0; width:100%; height:100%;
          display:flex; align-items:center; justify-content:center;
          background:
            radial-gradient(ellipse at center,rgba(25,34,42,.22) 0%,rgba(8,10,14,.94) 72%),
            url('${assetManifest.concept.realmsBiomes}') center/cover no-repeat;
          font-family:'Segoe UI',system-ui,sans-serif; color:#fff;
          padding:14px; box-sizing:border-box;
        }
        .lobby-card {
          background:linear-gradient(180deg,rgba(16,20,24,.94),rgba(7,9,13,.96));
          border:1px solid rgba(220,174,87,0.36); border-radius:8px;
          padding:28px clamp(18px,5vw,36px); width:min(420px, 92vw); max-height:90vh; overflow-y:auto;
          box-shadow:0 22px 70px rgba(0,0,0,0.58), inset 0 0 0 1px rgba(255,255,255,.04);
        }
        .lobby-card h2 { font-family:Georgia,serif; color:#f0d48a; font-size:22px; margin-bottom:10px; letter-spacing:.5px; }
        .player-badge {
          background:rgba(255,255,255,0.05); border-radius:8px;
          border:1px solid rgba(255,255,255,.09);
          padding:8px 12px; margin-bottom:20px; font-size:12px; color:#c9d4d9;
          display:flex; align-items:center; gap:8px;
        }
        .player-portrait {
          width:42px; height:42px; flex:0 0 42px; border-radius:50%;
          background-image:url('${assetManifest.concept.charactersClasses}');
          background-size:400% auto;
          background-position:${CLASS_ART_POSITIONS[this.session.classKey] ?? '0% 0%'};
          border:1px solid ${this.getClassColor(this.session.classKey)};
          box-shadow:0 0 18px ${this.getClassColor(this.session.classKey)}55;
        }
        .player-class-dot {
          width:12px; height:12px; border-radius:50%;
          display:inline-block;
        }
        .section-title { font-size:11px; color:#a4936d; text-transform:uppercase;
          letter-spacing:1px; margin:16px 0 8px; }
        .lobby-btn {
          width:100%; padding:12px; margin-bottom:8px;
          border:1px solid rgba(255,255,255,.12); border-radius:6px; font-size:14px;
          font-weight:600; cursor:pointer; display:flex;
          align-items:center; gap:10px; justify-content:center;
        }
        .btn-coop { background:linear-gradient(135deg,#1e5a2e,#2a7a3e); color:#88ffaa; border:1px solid #2a7a3e; }
        .btn-duel { background:linear-gradient(135deg,#5a1e1e,#7a2a2a); color:#ffaaaa; border:1px solid #7a2a2a; }
        .btn-private { background:rgba(255,255,255,0.05); color:#d2c4a0; border:1px solid rgba(255,255,255,0.15); }
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
        .deploy-warning {
          background:rgba(255,170,0,0.13);
          border:1px solid rgba(255,190,80,0.32);
          border-radius:8px;
          padding:9px 11px;
          margin:10px 0 12px;
          color:#ffd58a;
          font-size:12px;
          line-height:1.35;
        }
        .server-target {
          margin-top:8px;
          color:#75848d;
          font-size:10px;
          overflow-wrap:anywhere;
          text-align:center;
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
            <span class="player-portrait"></span>
            <span class="player-class-dot" style="background:${this.getClassColor(this.session.classKey)}"></span>
            <span><strong>${this.session.alias}</strong></span>
            <span style="margin-left:auto;font-size:10px;color:#556">${this.session.mode === 'registered' ? '✓ Registrado' : '👤 Invitado'}</span>
          </div>

          ${deployWarning ? `<div class="deploy-warning">${deployWarning}</div>` : ''}
          <div class="server-target">Servidor: ${serverEndpoint}</div>

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

  private getDeployWarning(): string {
    const host = window.location.hostname;
    const isLocalPage = host === 'localhost' || host === '127.0.0.1' || host === '';
    const pointsToLocalServer = ENV.GAME_SERVER_URL.includes('localhost') || ENV.GAME_SERVER_URL.includes('127.0.0.1');
    if (!isLocalPage && pointsToLocalServer) {
      return 'Esta pagina esta desplegada, pero el cliente apunta a ws://localhost:2567. En produccion debes configurar VITE_GAME_SERVER_URL con el servidor Colyseus publico; si no, no llegaran jugadores, criaturas ni recursos.';
    }
    return '';
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
      statusEl.textContent = `${msg} · Servidor: ${ENV.GAME_SERVER_URL}`;
      statusEl.style.display = 'block';
      statusEl.textContent = `${msg} · Servidor: ${getGameServerEndpoint()}`;
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
      const health = await checkGameServerHealth();
      if (!health.ok) throw new Error(health.message);
      let room;
      const opts = this.getJoinOptions();

      if (action === 'create-realm') {
        room = await withTimeout('Crear sala', createRealmRoom({ ...opts, isPrivate: false }));
      } else if (action === 'join-realm') {
        room = await withTimeout('Entrar a sala', joinOrCreateRealm({ ...opts, isPrivate: false }));
      } else if (action === 'duel') {
        room = await withTimeout('Buscar duelo', joinOrCreateDuel(opts));
        this.scene.start('GameScene', { room, session: this.session, mode: 'duel' });
        return;
      } else if (action === 'private') {
        room = await withTimeout('Crear sala privada', createRealmRoom({ ...opts, isPrivate: true }));
      } else if (action === 'code') {
        const code = (document.getElementById('input-code') as HTMLInputElement)?.value.trim().toUpperCase();
        if (!code || code.length < 4) { this.setError('Introduce un código válido'); return; }
        room = await withTimeout('Entrar por codigo', joinByCode(code, opts));
      } else {
        return;
      }

      this.scene.start('GameScene', { room, session: this.session, mode: 'realm' });
    } catch (err: unknown) {
      const base = err instanceof Error ? err.message : t('err_unknown');
      const msg = this.getDeployWarning() || base;
      this.setError(msg);
    } finally {
      this.setLoading(false);
    }
  }

  private async joinGameById(roomId: string) {
    this.setLoading(true);
    try {
      const health = await checkGameServerHealth();
      if (!health.ok) throw new Error(health.message);
      const { joinRealmRoom } = await import('../../net/ColyseusClient.js');
      const room = await withTimeout('Entrar a sala', joinRealmRoom(roomId, this.getJoinOptions()));
      this.scene.start('GameScene', { room, session: this.session, mode: 'realm' });
    } catch (err: unknown) {
      const base = err instanceof Error ? err.message : t('err_unknown');
      const msg = this.getDeployWarning() || base;
      this.setError(msg);
    } finally {
      this.setLoading(false);
    }
  }

  shutdown() {
    window.removeEventListener('popstate', this.onPopState);
    if (this.pingInterval) clearInterval(this.pingInterval);
    document.getElementById('ui-overlay')!.innerHTML = '';
  }
}
