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
import { gothicScreen } from '../../ui/theme.js';

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
            <span class="room-code-tag">${r.metadata?.roomCode ?? r.roomId.slice(0, 6)}</span>
            <span class="room-meta">${r.clients}/${r.maxClients} héroes</span>
            <button class="room-join-btn" data-roomid="${r.roomId}">Unirse</button>
          </div>
        `).join('')
      : `<div class="gnote" style="text-align:center;padding:10px">${t('lobby_no_rooms')}</div>`;
    const deployWarning = this.getDeployWarning();
    const serverEndpoint = getGameServerEndpoint();
    const classColor = this.getClassColor(this.session.classKey);

    const inner = `
      <style>
        #lobby-scene .player-badge{display:flex;align-items:center;gap:10px;padding:8px 12px;margin-bottom:6px;
          background:rgba(255,216,138,.06);border:1px solid rgba(255,216,138,.22);border-radius:10px;font-size:13px}
        #lobby-scene .player-portrait{width:44px;height:44px;flex:0 0 44px;border-radius:50%;
          background-image:url('${assetManifest.concept.charactersClasses}');background-size:400% auto;
          background-position:${CLASS_ART_POSITIONS[this.session.classKey] ?? '0% 0%'};
          border:1px solid ${classColor};box-shadow:0 0 18px ${classColor}55}
        #lobby-scene .badge-mode{margin-left:auto;font-size:10px;letter-spacing:1px;color:#a99a78;text-transform:uppercase}
        #lobby-scene .deploy-warning{background:rgba(255,170,0,.1);border:1px solid rgba(255,190,80,.3);border-radius:8px;
          padding:9px 11px;margin:8px 0 4px;color:#ffd58a;font-size:11.5px;line-height:1.4;font-family:'Segoe UI',sans-serif}
        #lobby-scene .server-target{margin:2px 0 4px;color:#7d7259;font-size:10px;overflow-wrap:anywhere;text-align:center;font-family:'Segoe UI',sans-serif}
        #lobby-scene .gbtn.coop{color:#bdf0c8;background:linear-gradient(135deg,rgba(30,84,44,.85),rgba(20,52,30,.92));border:1px solid rgba(120,220,150,.4)}
        #lobby-scene .gbtn.coop:hover{box-shadow:0 0 22px rgba(110,220,140,.2)}
        #lobby-scene .gbtn.duel{color:#ffc4b8;background:linear-gradient(135deg,rgba(96,30,30,.85),rgba(58,18,18,.92));border:1px solid rgba(255,130,110,.38)}
        #lobby-scene .gbtn.duel:hover{box-shadow:0 0 22px rgba(255,110,90,.2)}
        #lobby-scene .gbtn{margin-top:0;margin-bottom:8px}
        #lobby-scene .code-row{display:flex;gap:8px}
        #lobby-scene .code-row .ginput{text-transform:uppercase;letter-spacing:5px;text-align:center;font-weight:700;margin-bottom:0}
        #lobby-scene .code-row .gbtn{width:auto;padding:11px 20px;margin:0;flex:none}
        #lobby-scene .rooms-list{max-height:150px;overflow-y:auto;margin-bottom:2px}
        #lobby-scene .room-item{display:flex;align-items:center;gap:10px;padding:7px 9px;border-radius:8px;
          background:rgba(255,255,255,.035);border:1px solid rgba(255,216,138,.12);margin-bottom:5px;font-size:12px}
        #lobby-scene .room-code-tag{font-weight:700;letter-spacing:2.5px;color:#ffd98a}
        #lobby-scene .room-meta{margin-left:auto;color:#a99a78;font-size:11px}
        #lobby-scene .room-join-btn{padding:5px 13px;background:rgba(255,216,138,.14);color:#ffd98a;
          border:1px solid rgba(255,216,138,.4);border-radius:6px;cursor:pointer;font-family:'Cinzel',serif;
          font-size:11px;letter-spacing:1px;font-weight:700}
        #lobby-scene .room-join-btn:hover{background:rgba(255,216,138,.26)}
        #lobby-scene #lobby-loading{text-align:center;padding:14px;color:#b9a777;display:none;letter-spacing:2px;font-size:12px}
      </style>
      <div class="gcard" style="width:min(440px,94vw)">
        <h2 class="gtitle">${t('lobby_title')}</h2>
        <p class="gsub">Reúne a tu hueste o adéntrate en solitario</p>

        <div class="player-badge">
          <span class="player-portrait"></span>
          <strong>${this.session.alias}</strong>
          <span class="badge-mode">${this.session.mode === 'registered' ? '✓ Registrado' : 'Invitado'}</span>
        </div>

        ${deployWarning ? `<div class="deploy-warning">${deployWarning}</div>` : ''}
        <div class="server-target">Servidor: ${serverEndpoint}</div>

        <div class="gsect">Expedición</div>
        <button class="gbtn coop" id="btn-create-realm">🌍 ${t('btn_create_realm')}</button>
        <button class="gbtn coop" id="btn-join-realm">🔗 ${t('btn_join_realm')}</button>
        <button class="gbtn duel" id="btn-duel">⚔️ ${t('btn_find_duel')}</button>

        <div class="gsect">${t('btn_join_code')}</div>
        <div class="code-row">
          <input type="text" class="ginput" id="input-code" placeholder="••••••" maxlength="6" />
          <button class="gbtn gold" id="btn-join-code">${t('lobby_join')}</button>
        </div>
        <div class="gnote" style="margin-top:7px">Cada sala nace con un <b style="color:#ffd98a">código de 6 letras</b>: dentro de la partida lo verás arriba (junto al estandarte ⚑) y podrás copiarlo para invitar a tus aliados. A una sala privada solo se entra con su código.</div>

        <button class="gbtn ghost" id="btn-create-private" style="margin-top:10px">🔒 ${t('btn_create_private')}</button>

        <div class="gsect">${t('lobby_available_rooms')}</div>
        <div class="rooms-list">${roomsHtml}</div>

        <div class="gerr" id="lobby-status"></div>
        <div id="lobby-loading">⟡ Conectando…</div>

        <button class="gbtn dim" id="btn-back">← Volver al menú</button>
      </div>
    `;
    overlay.innerHTML = gothicScreen('lobby-scene', inner, { wide: true });

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
