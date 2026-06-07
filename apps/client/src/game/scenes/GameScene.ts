import Phaser from 'phaser';
import { Room, getStateCallbacks } from '@colyseus/sdk';
import type { RealmRoomState } from '../../net/RoomStateTypes.js';
import { InputSystem } from '../systems/InputSystem.js';
import {
  generateClassTexture,
  generateEnemyTexture,
  generateSanctuaryTexture,
  generatePickupTexture,
} from '../entities/CharacterRenderer.js';
import { MSG } from '@fmr/shared';
import { CLASS_DEFINITIONS } from '@fmr/shared';
import { clamp } from '@fmr/shared';
import type { PlayerClass, AbilityKey } from '@fmr/shared';
import type { PlayerSession } from '../../auth/sessionStore.js';

interface PlayerSprite {
  body: Phaser.GameObjects.Image;
  nameTag: Phaser.GameObjects.Text;
  hpBar: Phaser.GameObjects.Graphics;
  shadow: Phaser.GameObjects.Ellipse;
  tweenAnim?: Phaser.Tweens.Tween;
}

interface EnemySprite {
  body: Phaser.GameObjects.Image;
  hpBar: Phaser.GameObjects.Graphics;
  shadow: Phaser.GameObjects.Ellipse;
}

interface SanctuarySprite {
  icon: Phaser.GameObjects.Image;
  captureBar: Phaser.GameObjects.Graphics;
  zone: Phaser.GameObjects.Ellipse;
  label: Phaser.GameObjects.Text;
}

export class GameScene extends Phaser.Scene {
  private room!: Room<RealmRoomState>;
  private session!: PlayerSession;
  private mode: 'realm' | 'duel' = 'realm';

  private playerSprites = new Map<string, PlayerSprite>();
  private enemySprites = new Map<string, EnemySprite>();
  private sanctuarySprites = new Map<string, SanctuarySprite>();

  private inputSystem!: InputSystem;
  private localPlayerId = '';
  private inputSendInterval = 0;
  private particles!: Phaser.GameObjects.Particles.ParticleEmitter;
  private effectsLayer!: Phaser.GameObjects.Container;

  // HUD references (HTML overlay)
  private hudEl: HTMLElement | null = null;

  // Chat
  private chatLog: string[] = [];
  private chatVisible = false;

  // For interpolation
  private serverPositions = new Map<string, { x: number; y: number }>();

  constructor() {
    super({ key: 'GameScene' });
  }

  init(data: { room: Room<RealmRoomState>; session: PlayerSession; mode?: 'realm' | 'duel' }) {
    this.room = data.room;
    this.session = data.session;
    this.mode = data.mode ?? 'realm';
  }

  preload() {
    const classes: PlayerClass[] = ['stag_druid', 'raven_witch', 'wolf_guardian', 'fox_trickster'];
    classes.forEach((c) => generateClassTexture(this, c, 48));
    ['wisp', 'bramble_beast', 'rune_imp'].forEach((e) => generateEnemyTexture(this, e, 36));
    generateSanctuaryTexture(this);
    generatePickupTexture(this, 'hp');
    generatePickupTexture(this, 'energy');
  }

  create() {
    this.effectsLayer = this.add.container(0, 0);
    this.buildMap();
    this.setupCamera();
    this.inputSystem = new InputSystem(this);
    this.setupRoomListeners();
    this.buildHUD();
    this.setupTouchControls();

    // Depth sort each frame
    this.events.on('postupdate', () => this.sortDepths());
  }

  private setupTouchControls() {
    // Auto-aim for touch abilities: nearest alive target (enemy or, in duels, foe).
    this.inputSystem.setAutoAimProvider(() => {
      const state = this.room.state as RealmRoomState;
      const me = state.players.get(this.localPlayerId);
      if (!me) return { x: 0, y: 0 };
      let bestX = 0;
      let bestY = 0;
      let bestD = Infinity;
      const consider = (x: number, y: number) => {
        const d = (x - me.x) ** 2 + (y - me.y) ** 2;
        if (d < bestD) { bestD = d; bestX = x; bestY = y; }
      };
      state.enemies?.forEach((en) => { if (en.isAlive) consider(en.x, en.y); });
      state.players?.forEach((p, id) => { if (id !== this.localPlayerId && p.isAlive) consider(p.x, p.y); });
      if (bestD < Infinity) return { x: bestX, y: bestY };
      // Fallback: aim a bit ahead in the facing direction
      const dirs: Record<string, [number, number]> = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
      const v = dirs[me.direction] ?? [1, 0];
      return { x: me.x + v[0] * 140, y: me.y + v[1] * 140 };
    });

    const isTouch =
      typeof window !== 'undefined' &&
      (window.matchMedia?.('(pointer: coarse)').matches ||
        navigator.maxTouchPoints > 0 ||
        'ontouchstart' in window);
    if (!isTouch) return;

    const overlay = document.getElementById('ui-overlay');
    if (!overlay) return;

    const wrap = document.createElement('div');
    wrap.id = 'touch-controls';
    wrap.innerHTML = `
      <style>
        /* On touch devices, lift the HP/EN panel to the top and hide the
           keyboard ability row (replaced by the big touch buttons). */
        #game-hud { top:10px; bottom:auto; left:10px; min-width:0; padding:8px 12px; }
        #game-hud .hud-abilities, #game-hud .hud-level { display:none; }
        #chat-container { bottom:auto !important; top:84px !important; }
        #touch-joystick {
          position:absolute; bottom:26px; left:26px;
          width:128px; height:128px; border-radius:50%;
          background:rgba(255,255,255,0.06); border:2px solid rgba(255,255,255,0.18);
          touch-action:none; pointer-events:auto;
        }
        #touch-thumb {
          position:absolute; left:39px; top:39px; width:50px; height:50px;
          border-radius:50%; background:rgba(255,255,255,0.28);
          border:1px solid rgba(255,255,255,0.45); will-change:transform;
        }
        #touch-abilities {
          position:absolute; bottom:26px; right:22px;
          display:flex; align-items:flex-end; gap:14px; pointer-events:none;
        }
        .touch-ab {
          pointer-events:auto; width:60px; height:60px; border-radius:50%;
          border:2px solid rgba(255,255,255,0.35); background:rgba(0,0,0,0.45);
          color:#fff; font-size:19px; font-weight:bold; touch-action:none;
          transition:transform 0.08s; -webkit-tap-highlight-color:transparent;
          display:flex; align-items:center; justify-content:center;
        }
        .touch-ab-basic { width:74px; height:74px; background:rgba(170,40,40,0.55); font-size:26px; }
        .touch-ab:active { transform:scale(0.9); }
      </style>
      <div id="touch-joystick"><div id="touch-thumb"></div></div>
      <div id="touch-abilities">
        <button class="touch-ab" data-ab="q">Q</button>
        <button class="touch-ab" data-ab="e">E</button>
        <button class="touch-ab" data-ab="r">R</button>
        <button class="touch-ab touch-ab-basic" data-ab="basic">⚔</button>
      </div>
    `;
    overlay.appendChild(wrap);

    // Joystick (pointer events handle both touch and mouse)
    const base = document.getElementById('touch-joystick')!;
    const thumb = document.getElementById('touch-thumb')!;
    let activeId: number | null = null;
    const setThumb = (nx: number, ny: number) => {
      thumb.style.transform = `translate(${nx * 38}px, ${ny * 38}px)`;
    };
    const handleMove = (e: PointerEvent) => {
      const rect = base.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let dx = (e.clientX - cx) / (rect.width / 2);
      let dy = (e.clientY - cy) / (rect.height / 2);
      const len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; }
      this.inputSystem.setTouchMove(dx, dy);
      setThumb(dx, dy);
    };
    const endMove = (e: PointerEvent) => {
      if (e.pointerId !== activeId) return;
      activeId = null;
      this.inputSystem.setTouchMove(0, 0);
      setThumb(0, 0);
    };
    base.addEventListener('pointerdown', (e) => {
      activeId = e.pointerId;
      try { base.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      handleMove(e);
      e.preventDefault();
    });
    base.addEventListener('pointermove', (e) => {
      if (e.pointerId === activeId) { handleMove(e); e.preventDefault(); }
    });
    base.addEventListener('pointerup', endMove);
    base.addEventListener('pointercancel', endMove);

    // Ability buttons
    wrap.querySelectorAll<HTMLElement>('.touch-ab').forEach((btn) => {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const ab = btn.dataset.ab as AbilityKey;
        this.inputSystem.queueAbility(ab);
      });
    });
  }

  private buildMap() {
    const W = 1600, H = 1200;

    // Background gradient
    const bg = this.add.graphics();
    bg.fillGradientStyle(0x1a3a2a, 0x1a3a2a, 0x0d2219, 0x0d2219, 1);
    bg.fillRect(0, 0, W, H);
    bg.setDepth(-10);

    // Biome zones
    const zones = [
      { x: 100, y: 100, w: 300, h: 250, color: 0x2d5a27, alpha: 0.5, label: 'Forest' },
      { x: 1200, y: 100, w: 300, h: 250, color: 0x2d5a27, alpha: 0.5, label: 'Forest' },
      { x: 550, y: 450, w: 500, h: 300, color: 0x3a2a1a, alpha: 0.4, label: 'Ruins' },
      { x: 100, y: 850, w: 350, h: 250, color: 0x1a3a4a, alpha: 0.4, label: 'Swamp' },
      { x: 1150, y: 850, w: 350, h: 250, color: 0x1a3a4a, alpha: 0.4, label: 'Swamp' },
    ];

    zones.forEach((z) => {
      const g = this.add.graphics();
      g.fillStyle(z.color, z.alpha);
      g.fillRoundedRect(z.x, z.y, z.w, z.h, 20);
      g.setDepth(-9);
    });

    // Obstacles (collidable visuals — collision enforced server-side)
    const obstacles = [
      { x: 200, y: 300, r: 35 },
      { x: 1400, y: 300, r: 35 },
      { x: 200, y: 900, r: 30 },
      { x: 1400, y: 900, r: 30 },
      { x: 700, y: 500, r: 25 },
      { x: 900, y: 500, r: 25 },
      { x: 800, y: 700, r: 40 },
    ];

    obstacles.forEach((o) => {
      const g = this.add.graphics();
      g.fillStyle(0x3e2723, 0.9);
      g.fillCircle(o.x, o.y, o.r);
      g.lineStyle(2, 0x6d4c41, 0.8);
      g.strokeCircle(o.x, o.y, o.r);

      // Detail marks
      g.lineStyle(1, 0x8d6e63, 0.5);
      g.strokeCircle(o.x, o.y, o.r * 0.6);
      g.setDepth(-5);
    });

    // Rune marks on ground
    this.drawRuneMarks();

    // Spawner zone markers
    this.drawSpawnerZones();

    // Border
    const border = this.add.graphics();
    border.lineStyle(6, 0x00ff88, 0.3);
    border.strokeRect(3, 3, W - 6, H - 6);
    border.setDepth(-8);

    // Grid overlay (subtle)
    const grid = this.add.graphics();
    grid.lineStyle(1, 0x00ff88, 0.04);
    for (let x = 0; x < W; x += 80) grid.lineBetween(x, 0, x, H);
    for (let y = 0; y < H; y += 80) grid.lineBetween(0, y, W, y);
    grid.setDepth(-8);
  }

  private drawRuneMarks() {
    const positions = [
      { x: 800, y: 600 },
      { x: 300, y: 600 },
      { x: 1300, y: 600 },
    ];
    positions.forEach((pos) => {
      const g = this.add.graphics();
      g.lineStyle(2, 0xffd700, 0.2);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        g.lineBetween(pos.x, pos.y, pos.x + Math.cos(a) * 60, pos.y + Math.sin(a) * 60);
      }
      g.strokeCircle(pos.x, pos.y, 60);
      g.setDepth(-7);
    });
  }

  private drawSpawnerZones() {
    const spawners = [
      { x: 200, y: 200 }, { x: 1400, y: 200 },
      { x: 200, y: 1000 }, { x: 1400, y: 1000 },
    ];
    spawners.forEach((sp) => {
      const g = this.add.graphics();
      g.lineStyle(1, 0xff4444, 0.15);
      g.strokeCircle(sp.x, sp.y, 80);
      g.setDepth(-7);
    });
  }

  private setupCamera() {
    this.cameras.main.setBounds(0, 0, 1600, 1200);
    this.cameras.main.setZoom(1.1);
  }

  private setupRoomListeners() {
    // Colyseus 0.16+ moved collection callbacks (onAdd/onRemove/onChange) off the
    // schema instances into a callback proxy obtained via getStateCallbacks(room).
    const $ = getStateCallbacks(this.room);
    const state = this.room.state as RealmRoomState;

    // Players
    $(state).players.onAdd((player, sessionId) => {
      this.createPlayerSprite(sessionId, player.classKey as PlayerClass, player.alias, player.x, player.y);
      if (sessionId === this.room.sessionId) {
        this.localPlayerId = sessionId;
        this.cameras.main.startFollow(this.playerSprites.get(sessionId)!.body, true, 0.1, 0.1);
      }
    });

    $(state).players.onRemove((_player, sessionId) => {
      this.destroyPlayerSprite(sessionId);
    });

    // Enemies
    $(state).enemies.onAdd((enemy, id) => {
      this.createEnemySprite(id, enemy.type, enemy.x, enemy.y);
    });

    $(state).enemies.onRemove((_enemy, id) => {
      this.destroyEnemySprite(id);
    });

    // Sanctuaries
    $(state).sanctuaries.onAdd((sanctuary, idx) => {
      this.createSanctuarySprite(String(idx), sanctuary.x, sanctuary.y, sanctuary.radius);
    });

    // Room messages
    this.room.onMessage(MSG.DAMAGE_EVENT, (data: { targetId: string; amount: number; isPlayer: boolean }) => {
      this.showDamageNumber(data.targetId, data.amount, data.isPlayer);
      this.flashHit(data.targetId, data.isPlayer);
    });

    this.room.onMessage(MSG.ABILITY_USED, (data: { playerId: string; abilityKey: string; x: number; y: number }) => {
      this.showAbilityEffect(data.playerId, data.abilityKey, data.x, data.y);
    });

    this.room.onMessage(MSG.XP_GAINED, (data: { playerId: string; amount: number }) => {
      if (data.playerId === this.localPlayerId) {
        this.showFloatingText(data.amount > 0 ? `+${data.amount} XP` : '', 0xffd700);
      }
    });

    this.room.onMessage(MSG.PLAYER_RESPAWNED, (data: { playerId: string }) => {
      const sprite = this.playerSprites.get(data.playerId);
      if (sprite) {
        sprite.body.setAlpha(1);
        sprite.body.setScale(1);
      }
    });

    this.room.onMessage(MSG.CHAT_MESSAGE, (data: { alias: string; text: string }) => {
      this.addChatMessage(`${data.alias}: ${data.text}`);
    });

    this.room.onMessage(MSG.MATCH_END, (data) => {
      this.scene.start('ResultsScene', { result: data, session: this.session });
    });

    this.room.onLeave(() => {
      this.scene.start('LobbyScene', { session: this.session });
    });
  }

  private createPlayerSprite(id: string, classKey: PlayerClass, alias: string, x: number, y: number) {
    const texKey = generateClassTexture(this, classKey, 48);

    const shadow = this.add.ellipse(x, y + 20, 36, 14, 0x000000, 0.3);
    shadow.setDepth(0);

    const body = this.add.image(x, y, texKey);
    body.setDepth(1);

    const isLocal = id === this.room.sessionId;
    const nameColor = isLocal ? '#ffffaa' : '#ffffff';
    const nameTag = this.add.text(x, y - 36, alias, {
      fontSize: '11px',
      color: nameColor,
      stroke: '#000000',
      strokeThickness: 3,
      align: 'center',
    }).setOrigin(0.5, 1).setDepth(5);

    const hpBar = this.add.graphics();
    hpBar.setDepth(4);

    this.playerSprites.set(id, { body, nameTag, hpBar, shadow });
  }

  private destroyPlayerSprite(id: string) {
    const sprite = this.playerSprites.get(id);
    if (!sprite) return;
    sprite.body.destroy();
    sprite.nameTag.destroy();
    sprite.hpBar.destroy();
    sprite.shadow.destroy();
    this.playerSprites.delete(id);
  }

  private createEnemySprite(id: string, type: string, x: number, y: number) {
    const texKey = generateEnemyTexture(this, type, 36);

    const shadow = this.add.ellipse(x, y + 16, 28, 10, 0x000000, 0.25);
    shadow.setDepth(0);

    const body = this.add.image(x, y, texKey);
    body.setDepth(1);

    const hpBar = this.add.graphics();
    hpBar.setDepth(4);

    this.enemySprites.set(id, { body, hpBar, shadow });
  }

  private destroyEnemySprite(id: string) {
    const sprite = this.enemySprites.get(id);
    if (!sprite) return;
    sprite.body.destroy();
    sprite.hpBar.destroy();
    sprite.shadow.destroy();
    this.enemySprites.delete(id);
  }

  private createSanctuarySprite(id: string, x: number, y: number, radius: number) {
    const zone = this.add.ellipse(x, y, radius * 2, radius * 1.3, 0xffd700, 0.1);
    zone.setDepth(-2);

    const icon = this.add.image(x, y, generateSanctuaryTexture(this));
    icon.setDepth(2);
    icon.setScale(0.9);

    // Pulsing animation
    this.tweens.add({
      targets: icon,
      scaleX: 1.1, scaleY: 1.1,
      duration: 1200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    const label = this.add.text(x, y + 44, '', {
      fontSize: '10px',
      color: '#ffd700',
      stroke: '#000000',
      strokeThickness: 2,
      align: 'center',
    }).setOrigin(0.5, 0).setDepth(5);

    const captureBar = this.add.graphics();
    captureBar.setDepth(3);

    this.sanctuarySprites.set(id, { icon, captureBar, zone, label });
  }

  update(_time: number, _delta: number) {
    const state = this.room.state as RealmRoomState;

    // Sync player positions with interpolation
    state.players.forEach((player, id) => {
      const sprite = this.playerSprites.get(id);
      if (!sprite) return;

      // Smooth lerp toward server position
      const lerpFactor = id === this.localPlayerId ? 0.5 : 0.2;
      sprite.body.x = Phaser.Math.Linear(sprite.body.x, player.x, lerpFactor);
      sprite.body.y = Phaser.Math.Linear(sprite.body.y, player.y, lerpFactor);
      sprite.shadow.x = sprite.body.x;
      sprite.shadow.y = sprite.body.y + 20;
      sprite.nameTag.x = sprite.body.x;
      sprite.nameTag.y = sprite.body.y - 26;

      // HP bar
      sprite.hpBar.clear();
      const barW = 40;
      const barH = 5;
      const bx = sprite.body.x - barW / 2;
      const by = sprite.body.y - 32;
      const ratio = clamp(player.hp / player.maxHp, 0, 1);

      sprite.hpBar.fillStyle(0x000000, 0.5);
      sprite.hpBar.fillRect(bx, by, barW, barH);
      const hpColor = ratio > 0.5 ? 0x44ff44 : ratio > 0.25 ? 0xffaa00 : 0xff4444;
      sprite.hpBar.fillStyle(hpColor, 1);
      sprite.hpBar.fillRect(bx, by, barW * ratio, barH);

      // Death state
      if (!player.isAlive) {
        sprite.body.setAlpha(0.3);
      } else {
        sprite.body.setAlpha(1);
      }

      // Walk bob animation (local client)
      if (id === this.localPlayerId && player.animState === 'walk') {
        sprite.body.setScale(1 + Math.sin(Date.now() * 0.015) * 0.04);
      } else {
        sprite.body.setScale(1);
      }
    });

    // Sync enemy positions
    state.enemies.forEach((enemy, id) => {
      const sprite = this.enemySprites.get(id);
      if (!sprite) return;

      sprite.body.x = Phaser.Math.Linear(sprite.body.x, enemy.x, 0.25);
      sprite.body.y = Phaser.Math.Linear(sprite.body.y, enemy.y, 0.25);
      sprite.shadow.x = sprite.body.x;
      sprite.shadow.y = sprite.body.y + 16;

      sprite.hpBar.clear();
      if (enemy.isAlive) {
        const barW = 32;
        const barH = 4;
        const bx = sprite.body.x - barW / 2;
        const by = sprite.body.y - 24;
        const ratio = clamp(enemy.hp / enemy.maxHp, 0, 1);
        sprite.hpBar.fillStyle(0x000000, 0.5);
        sprite.hpBar.fillRect(bx, by, barW, barH);
        sprite.hpBar.fillStyle(0xff4444, 1);
        sprite.hpBar.fillRect(bx, by, barW * ratio, barH);
        sprite.body.setAlpha(1);
      } else {
        sprite.body.setAlpha(0.2);
      }
    });

    // Sync sanctuary states
    state.sanctuaries.forEach((sanctuary, idx) => {
      const sprite = this.sanctuarySprites.get(String(idx));
      if (!sprite) return;

      sprite.captureBar.clear();
      const barW = 60;
      const barH = 6;
      const bx = sanctuary.x - barW / 2;
      const by = sanctuary.y - 48;
      const ratio = clamp(sanctuary.captureProgress / 100, 0, 1);

      if (ratio > 0) {
        sprite.captureBar.fillStyle(0x000000, 0.5);
        sprite.captureBar.fillRect(bx, by, barW, barH);
        const capColor = sanctuary.captureTeam === 0 ? 0x4488ff : 0xff4444;
        sprite.captureBar.fillStyle(capColor, 1);
        sprite.captureBar.fillRect(bx, by, barW * ratio, barH);
      }

      const stateLabel = sanctuary.state === 'neutral' ? '' :
        sanctuary.state === 'capturing' ? '⚡' :
        sanctuary.captureTeam === 0 ? '🔵' : '🔴';
      sprite.label.setText(stateLabel);

      // Color zone tint
      const zoneColor = sanctuary.state === 'neutral' ? 0xffd700 :
        sanctuary.captureTeam === 0 ? 0x4488ff : 0xff4444;
      sprite.zone.setFillStyle(zoneColor, 0.1);
    });

    // Send input to server
    this.inputSendInterval += _delta;
    if (this.inputSendInterval >= 50) { // 20hz input
      this.inputSendInterval = 0;
      const input = this.inputSystem.collect();
      if (input) {
        this.room.send(MSG.PLAYER_INPUT, input);
      }
    }

    // Chat toggle
    if (this.inputSystem.isChatKeyPressed()) {
      this.toggleChat();
    }

    // Update HUD
    this.updateHUD();
  }

  private sortDepths() {
    // Sort sprites by Y for pseudo-isometric depth
    this.playerSprites.forEach((sprite) => {
      sprite.body.setDepth(1 + sprite.body.y * 0.001);
    });
    this.enemySprites.forEach((sprite) => {
      sprite.body.setDepth(1 + sprite.body.y * 0.001);
    });
  }

  private showDamageNumber(targetId: string, amount: number, isPlayer: boolean) {
    const sprite = isPlayer
      ? this.playerSprites.get(targetId)?.body
      : this.enemySprites.get(targetId)?.body;
    if (!sprite) return;

    const x = sprite.x + Phaser.Math.Between(-20, 20);
    const y = sprite.y - 20;
    const color = isPlayer ? '#ff6666' : '#ffdd44';

    const text = this.add.text(x, y, `-${amount}`, {
      fontSize: '14px',
      color,
      stroke: '#000000',
      strokeThickness: 3,
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(20);

    this.tweens.add({
      targets: text,
      y: y - 40,
      alpha: 0,
      duration: 900,
      ease: 'Sine.easeOut',
      onComplete: () => text.destroy(),
    });
  }

  private flashHit(targetId: string, isPlayer: boolean) {
    const body = isPlayer
      ? this.playerSprites.get(targetId)?.body
      : this.enemySprites.get(targetId)?.body;
    if (!body) return;

    this.tweens.add({
      targets: body,
      tint: 0xff8888,
      duration: 80,
      yoyo: true,
      onStart: () => body.setTint(0xff4444),
      onComplete: () => body.clearTint(),
    });
  }

  private showAbilityEffect(playerId: string, abilityKey: string, x: number, y: number) {
    const colors: Record<string, number> = {
      q: 0x44ff88,
      e: 0x8844ff,
      r: 0xffdd00,
    };
    const color = colors[abilityKey] ?? 0xffffff;

    const circle = this.add.graphics();
    circle.fillStyle(color, 0.6);
    circle.fillCircle(x, y, 20);
    circle.setDepth(10);

    this.tweens.add({
      targets: circle,
      scaleX: 3, scaleY: 3,
      alpha: 0,
      duration: 400,
      ease: 'Quad.easeOut',
      onComplete: () => circle.destroy(),
    });

    // Player sprite flash
    const sprite = this.playerSprites.get(playerId);
    if (sprite) {
      sprite.body.setTint(color);
      this.time.delayedCall(150, () => sprite.body.clearTint());
    }
  }

  private showFloatingText(text: string, color: number) {
    const localSprite = this.playerSprites.get(this.localPlayerId);
    if (!localSprite || !text) return;
    const colorStr = `#${color.toString(16).padStart(6, '0')}`;
    const t = this.add.text(localSprite.body.x, localSprite.body.y - 50, text, {
      fontSize: '16px',
      color: colorStr,
      stroke: '#000000',
      strokeThickness: 3,
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(20);

    this.tweens.add({
      targets: t,
      y: t.y - 50,
      alpha: 0,
      duration: 1200,
      ease: 'Sine.easeOut',
      onComplete: () => t.destroy(),
    });
  }

  private buildHUD() {
    const overlay = document.getElementById('ui-overlay');
    if (!overlay) return;

    // Clear any DOM left by the previous scene (e.g. the lobby). Phaser does not
    // auto-invoke a scene's shutdown() method, so the prior overlay can linger.
    overlay.innerHTML = '';

    this.hudEl = document.createElement('div');
    this.hudEl.id = 'game-hud';
    this.hudEl.innerHTML = this.getHUDHTML();
    overlay.appendChild(this.hudEl);

    // Chat box
    const chatContainer = document.createElement('div');
    chatContainer.id = 'chat-container';
    chatContainer.style.cssText = `
      position:absolute; bottom:80px; left:12px;
      width:260px; max-height:120px;
      pointer-events:none;
    `;
    overlay.appendChild(chatContainer);

    // Back to lobby button
    const backBtn = document.createElement('button');
    backBtn.textContent = '← Lobby';
    backBtn.style.cssText = `
      position:absolute; top:12px; right:12px;
      background:rgba(0,0,0,0.6); color:#fff;
      border:1px solid rgba(255,255,255,0.3); border-radius:6px;
      padding:6px 12px; font-size:12px; cursor:pointer;
    `;
    backBtn.onclick = () => {
      this.room.leave();
    };
    overlay.appendChild(backBtn);
  }

  private getHUDHTML(): string {
    return `
      <style>
        #game-hud {
          position:absolute;
          bottom:12px; left:12px;
          background:rgba(0,0,0,0.65);
          border:1px solid rgba(255,255,255,0.15);
          border-radius:10px;
          padding:10px 14px;
          color:#fff;
          font-size:12px;
          min-width:220px;
          backdrop-filter:blur(4px);
        }
        .hud-bars { margin-bottom:8px; }
        .hud-bar-row { display:flex; align-items:center; gap:6px; margin-bottom:4px; }
        .hud-bar-label { width:40px; font-size:11px; opacity:0.8; }
        .hud-bar-bg { flex:1; height:8px; background:rgba(255,255,255,0.1); border-radius:4px; overflow:hidden; }
        .hud-bar-fill { height:100%; border-radius:4px; transition:width 0.15s; }
        .hud-bar-hp { background: linear-gradient(90deg,#44cc44,#88ff44); }
        .hud-bar-energy { background: linear-gradient(90deg,#4488ff,#44ccff); }
        .hud-abilities { display:flex; gap:6px; margin-top:8px; }
        .hud-ability {
          width:40px; height:40px;
          background:rgba(255,255,255,0.1);
          border:1px solid rgba(255,255,255,0.3);
          border-radius:6px;
          display:flex; flex-direction:column;
          align-items:center; justify-content:center;
          font-size:10px; position:relative; overflow:hidden;
        }
        .hud-ability-key { font-size:14px; font-weight:bold; }
        .hud-ability-cd {
          position:absolute; bottom:0; left:0; right:0;
          background:rgba(0,0,0,0.7);
          text-align:center; font-size:9px; padding:1px;
        }
        .hud-level { font-size:11px; opacity:0.7; margin-top:6px; }
        #respawn-overlay {
          position:absolute; top:50%; left:50%;
          transform:translate(-50%,-50%);
          background:rgba(0,0,0,0.8);
          color:#ff6666; font-size:22px; font-weight:bold;
          padding:20px 40px; border-radius:12px;
          border:2px solid #ff4444;
          display:none;
          text-align:center;
        }
        #duel-timer {
          position:absolute; top:12px; left:50%;
          transform:translateX(-50%);
          background:rgba(0,0,0,0.7);
          color:#fff; font-size:20px; font-weight:bold;
          padding:6px 20px; border-radius:8px;
          border:1px solid rgba(255,255,255,0.2);
          display:none;
        }
      </style>
      <div class="hud-bars">
        <div class="hud-bar-row">
          <span class="hud-bar-label">HP</span>
          <div class="hud-bar-bg"><div class="hud-bar-fill hud-bar-hp" id="hud-hp-fill" style="width:100%"></div></div>
          <span id="hud-hp-text" style="font-size:10px;min-width:42px;text-align:right">100/100</span>
        </div>
        <div class="hud-bar-row">
          <span class="hud-bar-label">EN</span>
          <div class="hud-bar-bg"><div class="hud-bar-fill hud-bar-energy" id="hud-en-fill" style="width:100%"></div></div>
          <span id="hud-en-text" style="font-size:10px;min-width:42px;text-align:right">100/100</span>
        </div>
      </div>
      <div class="hud-abilities">
        <div class="hud-ability"><span class="hud-ability-key">J</span><span style="font-size:9px">Ataque</span></div>
        <div class="hud-ability" id="hud-q"><span class="hud-ability-key">Q</span><div class="hud-ability-cd" id="hud-q-cd" style="display:none"></div></div>
        <div class="hud-ability" id="hud-e"><span class="hud-ability-key">E</span><div class="hud-ability-cd" id="hud-e-cd" style="display:none"></div></div>
        <div class="hud-ability" id="hud-r"><span class="hud-ability-key">R</span><div class="hud-ability-cd" id="hud-r-cd" style="display:none"></div></div>
      </div>
      <div class="hud-level" id="hud-level">Nv. 1 | 0 XP</div>
    `;
  }

  private updateHUD() {
    if (!this.hudEl) return;
    const state = this.room.state as RealmRoomState;
    const player = state.players.get(this.localPlayerId);
    if (!player) return;

    const hpRatio = clamp(player.hp / player.maxHp, 0, 1);
    const enRatio = clamp(player.energy / player.maxEnergy, 0, 1);

    const hpFill = document.getElementById('hud-hp-fill');
    const enFill = document.getElementById('hud-en-fill');
    const hpText = document.getElementById('hud-hp-text');
    const enText = document.getElementById('hud-en-text');
    const levelEl = document.getElementById('hud-level');

    if (hpFill) hpFill.style.width = `${hpRatio * 100}%`;
    if (enFill) enFill.style.width = `${enRatio * 100}%`;
    if (hpText) hpText.textContent = `${Math.ceil(player.hp)}/${player.maxHp}`;
    if (enText) enText.textContent = `${Math.ceil(player.energy)}/${player.maxEnergy}`;
    if (levelEl) levelEl.textContent = `Nv. ${player.level} | ${player.xp} XP`;

    // Cooldown display
    const now = Date.now();
    const classDef = CLASS_DEFINITIONS[player.classKey as PlayerClass];
    if (classDef) {
      (['q', 'e', 'r'] as const).forEach((key) => {
        const cd = classDef.abilities[key];
        const lastUsed = (player.cooldowns as unknown as Record<string, number>)[key] ?? 0;
        const remaining = Math.max(0, cd.cooldownMs - (now - lastUsed));
        const cdEl = document.getElementById(`hud-${key}-cd`);
        const abilityEl = document.getElementById(`hud-${key}`);
        if (cdEl && abilityEl) {
          if (remaining > 0) {
            cdEl.style.display = 'block';
            cdEl.textContent = `${(remaining / 1000).toFixed(1)}s`;
            abilityEl.style.opacity = '0.5';
          } else {
            cdEl.style.display = 'none';
            abilityEl.style.opacity = '1';
          }
        }
      });
    }

    // Respawn overlay
    let respawnEl = document.getElementById('respawn-overlay');
    if (!respawnEl) {
      respawnEl = document.createElement('div');
      respawnEl.id = 'respawn-overlay';
      document.getElementById('ui-overlay')?.appendChild(respawnEl);
    }
    if (!player.isAlive) {
      respawnEl.style.display = 'block';
      respawnEl.textContent = `Caído en batalla\nReapareciendo en ${Math.ceil(player.respawnTimer / 1000)}s`;
    } else {
      respawnEl.style.display = 'none';
    }
  }

  private addChatMessage(msg: string) {
    this.chatLog.push(msg);
    if (this.chatLog.length > 6) this.chatLog.shift();

    const container = document.getElementById('chat-container');
    if (!container) return;
    container.innerHTML = this.chatLog.map((m) =>
      `<div style="background:rgba(0,0,0,0.5);color:#fff;font-size:11px;padding:2px 6px;border-radius:3px;margin-bottom:2px;word-break:break-word;">${m}</div>`
    ).join('');
  }

  private toggleChat() {
    this.chatVisible = !this.chatVisible;
    const overlay = document.getElementById('ui-overlay');
    if (!overlay) return;

    let chatInput = document.getElementById('chat-input') as HTMLInputElement | null;
    if (this.chatVisible) {
      if (!chatInput) {
        chatInput = document.createElement('input');
        chatInput.id = 'chat-input';
        chatInput.type = 'text';
        chatInput.maxLength = 120;
        chatInput.placeholder = 'Escribe y pulsa Enter...';
        chatInput.style.cssText = `
          position:absolute; bottom:12px; left:12px;
          width:260px; padding:6px 10px;
          background:rgba(0,0,0,0.7); color:#fff;
          border:1px solid rgba(255,255,255,0.4); border-radius:6px;
          font-size:12px; outline:none;
        `;
        chatInput.onkeydown = (e) => {
          if (e.key === 'Enter') {
            const text = chatInput!.value.trim();
            if (text) this.room.send(MSG.CHAT, { text });
            chatInput!.value = '';
            this.toggleChat();
            e.stopPropagation();
          }
          if (e.key === 'Escape') this.toggleChat();
          e.stopPropagation();
        };
        overlay.appendChild(chatInput);
      }
      chatInput.style.display = 'block';
      chatInput.focus();
      this.inputSystem.setEnabled(false);
    } else {
      if (chatInput) chatInput.style.display = 'none';
      this.inputSystem.setEnabled(true);
    }
  }

  shutdown() {
    // Clean up HTML elements
    document.getElementById('game-hud')?.remove();
    document.getElementById('chat-container')?.remove();
    document.getElementById('chat-input')?.remove();
    document.getElementById('respawn-overlay')?.remove();
    document.getElementById('duel-timer')?.remove();
    document.querySelectorAll('#ui-overlay > *').forEach((el) => {
      if (!el.id || el.id === 'ui-overlay') return;
      // Keep overlay itself
    });
    const overlay = document.getElementById('ui-overlay');
    if (overlay) overlay.innerHTML = '';
  }
}
