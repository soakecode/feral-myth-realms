import * as THREE from 'three';
import { getStateCallbacks } from '@colyseus/sdk';
import type { Room } from '@colyseus/sdk';
import { MSG, CLASS_DEFINITIONS, clamp } from '@fmr/shared';
import type { PlayerClass, AbilityKey, PlayerInputPayload } from '@fmr/shared';
import type { RealmRoomState } from '../net/RoomStateTypes.js';
import type { PlayerSession } from '../auth/sessionStore.js';

const MAP_W = 1600;
const MAP_H = 1200;

const CLASS_COLORS: Record<string, number> = {
  stag_druid: 0x4caf50,
  raven_witch: 0x7c4dff,
  wolf_guardian: 0x90a4ae,
  fox_trickster: 0xff7043,
};

const ENEMY_COLORS: Record<string, number> = {
  wisp: 0x4dd0e1,
  bramble_beast: 0x6d4c41,
  rune_imp: 0xba68c8,
};

interface Entity {
  group: THREE.Group;
  target: THREE.Vector3;
  faceTarget: number; // desired Y rotation
  bob?: number;
}

/**
 * Standalone Three.js renderer for the in-game view. Reuses the authoritative
 * Colyseus room for all state; this class only renders + collects input.
 */
export class Game3D {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();

  private players = new Map<string, Entity>();
  private enemies = new Map<string, Entity>();
  private sanctuaries = new Map<string, { group: THREE.Group; pillar: THREE.Mesh }>();

  private localId = '';
  private camTarget = new THREE.Vector3(MAP_W / 2, 0, MAP_H / 2);

  // input
  private keys: Record<string, boolean> = {};
  private joyDx = 0;
  private joyDy = 0;
  private queuedAbility: AbilityKey | null = null;
  private aim = new THREE.Vector3(MAP_W / 2, 0, MAP_H / 2);
  private pointerAttack = false;
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private seq = 0;
  private inputAccum = 0;

  private rafId = 0;
  private hudEl: HTMLElement | null = null;
  private touchEl: HTMLElement | null = null;
  private disposed = false;
  private onResize = () => this.handleResize();
  private onKeyDown = (e: KeyboardEvent) => { this.keys[e.code] = true; };
  private onKeyUp = (e: KeyboardEvent) => { this.keys[e.code] = false; };

  constructor(
    private room: Room,
    private session: PlayerSession,
    private mode: 'realm' | 'duel',
    private onExit: () => void
  ) {
    this.localId = room.sessionId;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true, // allows screenshots / robust compositing
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    const canvas = this.renderer.domElement;
    canvas.id = 'game3d-canvas';
    canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:1;touch-action:none;';
    document.getElementById('game-container')!.appendChild(canvas);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x141d2b);
    this.scene.fog = new THREE.Fog(0x141d2b, 900, 2200);

    this.camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 1, 6000);

    this.buildWorld();
    this.setupRoomListeners();
    this.buildHUD();
    this.setupInput();

    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);

    this.loop();
  }

  // ---- world ----------------------------------------------------------------

  private buildWorld() {
    // Lights
    const hemi = new THREE.HemisphereLight(0xbcd6ff, 0x33402f, 0.75);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff1d0, 1.5);
    sun.position.set(MAP_W * 0.35, 1400, MAP_H * 0.15);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 100;
    sun.shadow.camera.far = 3500;
    const s = 1100;
    const cam = sun.shadow.camera as THREE.OrthographicCamera;
    cam.left = -s; cam.right = s; cam.top = s; cam.bottom = -s;
    cam.updateProjectionMatrix();
    sun.target.position.set(MAP_W / 2, 0, MAP_H / 2);
    this.scene.add(sun);
    this.scene.add(sun.target);

    // Ground
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x35562f, roughness: 1, metalness: 0 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(MAP_W, MAP_H), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(MAP_W / 2, 0, MAP_H / 2);
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Biome patches (subtle colored discs)
    const patches: Array<[number, number, number, number]> = [
      [250, 250, 200, 0x3f6b35], [1350, 250, 200, 0x3f6b35],
      [800, 600, 320, 0x4a3a26], [250, 950, 200, 0x294a4a], [1350, 950, 200, 0x294a4a],
    ];
    for (const [x, z, r, col] of patches) {
      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(r, 40),
        new THREE.MeshStandardMaterial({ color: col, roughness: 1 })
      );
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(x, 0.5, z);
      disc.receiveShadow = true;
      this.scene.add(disc);
    }

    // Border walls (low)
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x223043, roughness: 0.9 });
    const mkWall = (w: number, d: number, x: number, z: number) => {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 40, d), wallMat);
      wall.position.set(x, 20, z);
      wall.castShadow = true; wall.receiveShadow = true;
      this.scene.add(wall);
    };
    mkWall(MAP_W, 16, MAP_W / 2, 0);
    mkWall(MAP_W, 16, MAP_W / 2, MAP_H);
    mkWall(16, MAP_H, 0, MAP_H / 2);
    mkWall(16, MAP_H, MAP_W, MAP_H / 2);

    // Environment props: trees + rocks
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 1 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 1 });
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 1, flatShading: true });
    const rng = mulberry32(1337);
    for (let i = 0; i < 60; i++) {
      const x = 80 + rng() * (MAP_W - 160);
      const z = 80 + rng() * (MAP_H - 160);
      // keep center & lanes a bit clearer
      if (Math.abs(x - MAP_W / 2) < 120 && Math.abs(z - MAP_H / 2) < 120) continue;
      if (rng() > 0.45) {
        const tree = new THREE.Group();
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(4, 6, 30, 6), trunkMat);
        trunk.position.y = 15; trunk.castShadow = true;
        const leaves = new THREE.Mesh(new THREE.ConeGeometry(22, 46, 7), leafMat);
        leaves.position.y = 48; leaves.castShadow = true;
        tree.add(trunk, leaves);
        tree.position.set(x, 0, z);
        tree.scale.setScalar(0.8 + rng() * 0.6);
        this.scene.add(tree);
      } else {
        const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(8 + rng() * 10, 0), rockMat);
        rock.position.set(x, 6, z);
        rock.rotation.set(rng() * 3, rng() * 3, rng() * 3);
        rock.castShadow = true; rock.receiveShadow = true;
        this.scene.add(rock);
      }
    }
  }

  // ---- entities -------------------------------------------------------------

  private createPlayerMesh(classKey: string, isLocal: boolean): THREE.Group {
    const color = CLASS_COLORS[classKey] ?? 0xffffff;
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(11, 18, 4, 12), mat);
    body.position.y = 22; body.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(9, 16, 12), mat);
    head.position.y = 42; head.castShadow = true;
    // facing nose
    const nose = new THREE.Mesh(
      new THREE.ConeGeometry(4, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 })
    );
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 42, 9);
    g.add(body, head, nose);
    // ground ring (team / local indicator)
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(15, 19, 24),
      new THREE.MeshBasicMaterial({ color: isLocal ? 0xffe082 : color, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 1;
    g.add(ring);
    return g;
  }

  private createEnemyMesh(type: string): THREE.Group {
    const color = ENEMY_COLORS[type] ?? 0xff5252;
    const g = new THREE.Group();
    let mesh: THREE.Mesh;
    if (type === 'wisp') {
      mesh = new THREE.Mesh(
        new THREE.IcosahedronGeometry(12, 1),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6, roughness: 0.3 })
      );
      mesh.position.y = 34;
    } else if (type === 'bramble_beast') {
      mesh = new THREE.Mesh(
        new THREE.DodecahedronGeometry(18, 0),
        new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true })
      );
      mesh.position.y = 20;
    } else {
      mesh = new THREE.Mesh(
        new THREE.TetrahedronGeometry(15, 0),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4, roughness: 0.5, flatShading: true })
      );
      mesh.position.y = 18;
    }
    mesh.castShadow = true;
    g.add(mesh);
    return g;
  }

  private createSanctuaryMesh(): { group: THREE.Group; pillar: THREE.Mesh } {
    const g = new THREE.Group();
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(44, 48, 6, 32),
      new THREE.MeshStandardMaterial({ color: 0x3a3158, roughness: 0.8 })
    );
    base.position.y = 3; base.receiveShadow = true;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(40, 3, 12, 40),
      new THREE.MeshStandardMaterial({ color: 0xffd54f, emissive: 0xffb300, emissiveIntensity: 0.5 })
    );
    ring.rotation.x = -Math.PI / 2; ring.position.y = 7;
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(7, 7, 90, 16),
      new THREE.MeshStandardMaterial({ color: 0xffe082, emissive: 0xffc400, emissiveIntensity: 0.7, transparent: true, opacity: 0.55 })
    );
    pillar.position.y = 50;
    g.add(base, ring, pillar);
    return { group: g, pillar };
  }

  private setupRoomListeners() {
    const $ = getStateCallbacks(this.room);
    const state = this.room.state as RealmRoomState;

    $(state).players.onAdd((p, id) => {
      const isLocal = id === this.localId;
      const group = this.createPlayerMesh(p.classKey, isLocal);
      group.position.set(p.x, 0, p.y);
      this.scene.add(group);
      this.players.set(id, { group, target: new THREE.Vector3(p.x, 0, p.y), faceTarget: 0 });
      if (isLocal) { this.camTarget.set(p.x, 0, p.y); this.aim.set(p.x, 0, p.y); }
    });
    $(state).players.onRemove((_p, id) => {
      const e = this.players.get(id);
      if (e) { this.scene.remove(e.group); disposeGroup(e.group); this.players.delete(id); }
    });

    // Enemies / sanctuaries only exist in realm rooms (not duels).
    if ((state as { enemies?: unknown }).enemies) {
      $(state).enemies.onAdd((en, id) => {
        const group = this.createEnemyMesh(en.type);
        group.position.set(en.x, 0, en.y);
        group.visible = en.isAlive;
        this.scene.add(group);
        this.enemies.set(id, { group, target: new THREE.Vector3(en.x, 0, en.y), faceTarget: 0, bob: Math.random() * Math.PI * 2 });
      });
      $(state).enemies.onRemove((_en, id) => {
        const e = this.enemies.get(id);
        if (e) { this.scene.remove(e.group); disposeGroup(e.group); this.enemies.delete(id); }
      });
    }

    if ((state as { sanctuaries?: unknown }).sanctuaries) {
      $(state).sanctuaries.onAdd((s, idx) => {
        const sm = this.createSanctuaryMesh();
        sm.group.position.set(s.x, 0, s.y);
        this.scene.add(sm.group);
        this.sanctuaries.set(String(idx), sm);
      });
    }

    this.room.onMessage(MSG.MATCH_END, () => { /* handled via onLeave/exit for now */ });
    this.room.onLeave(() => this.exit());
  }

  // ---- input ----------------------------------------------------------------

  private setupInput() {
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointermove', (e) => this.updateAim(e));
    canvas.addEventListener('pointerdown', (e) => { this.updateAim(e); this.pointerAttack = true; });
    canvas.addEventListener('pointerup', () => { this.pointerAttack = false; });

    const isTouch = window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
    if (isTouch) this.buildTouchControls();
  }

  private updateAim(e: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.groundPlane, hit)) this.aim.copy(hit);
  }

  private autoAim(): THREE.Vector3 {
    const me = this.players.get(this.localId);
    if (!me) return this.aim;
    let best: THREE.Vector3 | null = null;
    let bestD = Infinity;
    const consider = (v: THREE.Vector3) => { const d = v.distanceToSquared(me.group.position); if (d < bestD) { bestD = d; best = v; } };
    this.enemies.forEach((e) => { if (e.group.visible) consider(e.group.position); });
    this.players.forEach((p, id) => { if (id !== this.localId) consider(p.group.position); });
    return best ?? this.aim;
  }

  private collectInput(): PlayerInputPayload | null {
    let dx = 0;
    let dy = 0;
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) dx -= 1;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) dx += 1;
    if (this.keys['KeyW'] || this.keys['ArrowUp']) dy -= 1;
    if (this.keys['KeyS'] || this.keys['ArrowDown']) dy += 1;
    dx += this.joyDx;
    dy += this.joyDy;

    let abilityKey: AbilityKey | null = null;
    let touchAbility = false;
    if (this.queuedAbility) { abilityKey = this.queuedAbility; this.queuedAbility = null; touchAbility = true; }
    else if (this.pointerAttack || this.keys['KeyJ']) abilityKey = 'basic';
    else if (this.keys['KeyQ']) abilityKey = 'q';
    else if (this.keys['KeyE']) abilityKey = 'e';
    else if (this.keys['KeyR']) abilityKey = 'r';

    if (dx === 0 && dy === 0 && abilityKey === null) return null;

    const aim = touchAbility ? this.autoAim() : this.aim;
    return { seq: this.seq++, dx, dy, abilityKey, aimX: aim.x, aimY: aim.z, timestamp: Date.now() };
  }

  // ---- loop -----------------------------------------------------------------

  private loop = () => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const state = this.room.state as RealmRoomState;

    // sync targets from server state
    state.players?.forEach((p, id) => {
      const e = this.players.get(id);
      if (!e) return;
      e.target.set(p.x, 0, p.y);
      e.group.visible = p.isAlive;
      if (p.direction === 'up') e.faceTarget = Math.PI;
      else if (p.direction === 'down') e.faceTarget = 0;
      else if (p.direction === 'left') e.faceTarget = -Math.PI / 2;
      else if (p.direction === 'right') e.faceTarget = Math.PI / 2;
    });
    state.enemies?.forEach((en, id) => {
      const e = this.enemies.get(id);
      if (!e) return;
      e.target.set(en.x, 0, en.y);
      e.group.visible = en.isAlive;
    });

    // interpolate players
    this.players.forEach((e) => {
      e.group.position.lerp(e.target, 1 - Math.pow(0.0001, dt));
      e.group.rotation.y = lerpAngle(e.group.rotation.y, e.faceTarget, 1 - Math.pow(0.001, dt));
    });
    this.enemies.forEach((e) => {
      e.group.position.lerp(e.target, 1 - Math.pow(0.0005, dt));
      if (e.bob !== undefined) { e.bob += dt * 3; e.group.position.y = Math.sin(e.bob) * 3; }
      e.group.rotation.y += dt * 0.6;
    });
    this.sanctuaries.forEach((s) => {
      s.pillar.rotation.y += dt;
      const k = 1 + Math.sin(this.clock.elapsedTime * 2) * 0.06;
      s.pillar.scale.set(k, 1, k);
    });

    // camera follow local player
    const me = this.players.get(this.localId);
    if (me) this.camTarget.lerp(me.group.position, 1 - Math.pow(0.002, dt));
    const desired = new THREE.Vector3(this.camTarget.x, 560, this.camTarget.z + 420);
    this.camera.position.lerp(desired, 1 - Math.pow(0.0008, dt));
    this.camera.lookAt(this.camTarget.x, 20, this.camTarget.z - 40);

    // send input at 20hz
    this.inputAccum += dt * 1000;
    if (this.inputAccum >= 50) {
      this.inputAccum = 0;
      const input = this.collectInput();
      if (input) this.room.send(MSG.PLAYER_INPUT, input);
    }

    this.updateHUD();
    this.renderer.render(this.scene, this.camera);
  };

  // ---- HUD ------------------------------------------------------------------

  private buildHUD() {
    const overlay = document.getElementById('ui-overlay');
    if (!overlay) return;
    overlay.innerHTML = '';
    const el = document.createElement('div');
    el.id = 'game-hud3d';
    el.innerHTML = `
      <style>
        #game-hud3d { position:absolute; inset:0; pointer-events:none; font-family:'Segoe UI',system-ui,sans-serif; color:#fff; }
        #game-hud3d .panel { position:absolute; top:10px; left:10px; background:rgba(0,0,0,0.5);
          border:1px solid rgba(255,255,255,0.15); border-radius:10px; padding:8px 12px; backdrop-filter:blur(4px); min-width:180px; }
        #game-hud3d .bar-row { display:flex; align-items:center; gap:6px; margin-bottom:4px; font-size:11px; }
        #game-hud3d .bar-row span:first-child { width:26px; opacity:0.85; }
        #game-hud3d .bar-bg { flex:1; height:8px; background:rgba(255,255,255,0.12); border-radius:4px; overflow:hidden; }
        #game-hud3d .fill { height:100%; transition:width 0.15s; }
        #game-hud3d .hp { background:linear-gradient(90deg,#36c750,#8aff5a); }
        #game-hud3d .en { background:linear-gradient(90deg,#3b82f6,#38d6ff); }
        #game-hud3d .val { font-size:10px; min-width:46px; text-align:right; }
        #game-hud3d #back3d { position:absolute; top:10px; right:10px; pointer-events:auto;
          background:rgba(0,0,0,0.55); color:#fff; border:1px solid rgba(255,255,255,0.3);
          border-radius:8px; padding:7px 13px; font-size:13px; cursor:pointer; }
        #game-hud3d #respawn3d { position:absolute; top:46%; left:50%; transform:translate(-50%,-50%);
          background:rgba(0,0,0,0.78); color:#ff6b6b; border:2px solid #ff5252; border-radius:12px;
          padding:16px 30px; font-weight:bold; text-align:center; display:none; }
      </style>
      <div class="panel">
        <div class="bar-row"><span>HP</span><div class="bar-bg"><div class="fill hp" id="hp3d" style="width:100%"></div></div><span class="val" id="hpv3d">100/100</span></div>
        <div class="bar-row"><span>EN</span><div class="bar-bg"><div class="fill en" id="en3d" style="width:100%"></div></div><span class="val" id="env3d">100/100</span></div>
        <div style="font-size:10px;opacity:0.7;margin-top:2px" id="lvl3d">Nv. 1</div>
      </div>
      <button id="back3d">← Salir</button>
      <div id="respawn3d">Caído<br><span style="font-size:13px;font-weight:normal">Reapareciendo…</span></div>
    `;
    overlay.appendChild(el);
    this.hudEl = el;
    document.getElementById('back3d')!.addEventListener('click', () => this.room.leave());
  }

  private updateHUD() {
    if (!this.hudEl) return;
    const me = (this.room.state as RealmRoomState).players?.get(this.localId);
    if (!me) return;
    const hp = document.getElementById('hp3d');
    const en = document.getElementById('en3d');
    const hpv = document.getElementById('hpv3d');
    const env = document.getElementById('env3d');
    const lvl = document.getElementById('lvl3d');
    const resp = document.getElementById('respawn3d');
    if (hp) hp.style.width = `${clamp(me.hp / me.maxHp, 0, 1) * 100}%`;
    if (en) en.style.width = `${clamp(me.energy / me.maxEnergy, 0, 1) * 100}%`;
    if (hpv) hpv.textContent = `${Math.ceil(me.hp)}/${me.maxHp}`;
    if (env) env.textContent = `${Math.ceil(me.energy)}/${me.maxEnergy}`;
    if (lvl) lvl.textContent = `Nv. ${me.level}`;
    if (resp) resp.style.display = me.isAlive ? 'none' : 'block';
  }

  private buildTouchControls() {
    const overlay = document.getElementById('ui-overlay');
    if (!overlay) return;
    const wrap = document.createElement('div');
    wrap.id = 'touch3d';
    wrap.innerHTML = `
      <style>
        #touch3d { position:absolute; inset:0; pointer-events:none; }
        #joy3d { position:absolute; bottom:28px; left:28px; width:128px; height:128px; border-radius:50%;
          background:rgba(255,255,255,0.07); border:2px solid rgba(255,255,255,0.2); touch-action:none; pointer-events:auto; }
        #joythumb3d { position:absolute; left:39px; top:39px; width:50px; height:50px; border-radius:50%;
          background:rgba(255,255,255,0.3); border:1px solid rgba(255,255,255,0.5); }
        #ab3d { position:absolute; bottom:28px; right:22px; display:flex; align-items:flex-end; gap:14px; pointer-events:none; }
        #ab3d button { pointer-events:auto; width:60px; height:60px; border-radius:50%; border:2px solid rgba(255,255,255,0.35);
          background:rgba(0,0,0,0.45); color:#fff; font-size:19px; font-weight:bold; touch-action:none; }
        #ab3d .basic { width:74px; height:74px; background:rgba(180,45,45,0.55); font-size:26px; }
        #ab3d button:active { transform:scale(0.9); }
      </style>
      <div id="joy3d"><div id="joythumb3d"></div></div>
      <div id="ab3d">
        <button data-ab="q">Q</button><button data-ab="e">E</button><button data-ab="r">R</button>
        <button class="basic" data-ab="basic">⚔</button>
      </div>
    `;
    overlay.appendChild(wrap);
    this.touchEl = wrap;

    const base = document.getElementById('joy3d')!;
    const thumb = document.getElementById('joythumb3d')!;
    let active: number | null = null;
    const move = (e: PointerEvent) => {
      const r = base.getBoundingClientRect();
      let dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      let dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      const len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; }
      this.joyDx = dx; this.joyDy = dy;
      thumb.style.transform = `translate(${dx * 38}px, ${dy * 38}px)`;
    };
    const end = (e: PointerEvent) => { if (e.pointerId !== active) return; active = null; this.joyDx = 0; this.joyDy = 0; thumb.style.transform = ''; };
    base.addEventListener('pointerdown', (e) => { active = e.pointerId; try { base.setPointerCapture(e.pointerId); } catch { /* */ } move(e); e.preventDefault(); });
    base.addEventListener('pointermove', (e) => { if (e.pointerId === active) { move(e); e.preventDefault(); } });
    base.addEventListener('pointerup', end);
    base.addEventListener('pointercancel', end);
    wrap.querySelectorAll<HTMLElement>('#ab3d button').forEach((btn) => {
      btn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.queuedAbility = btn.dataset.ab as AbilityKey; });
    });
  }

  // ---- lifecycle ------------------------------------------------------------

  private handleResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  private exit() {
    if (this.disposed) return;
    this.dispose();
    this.onExit();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.players.forEach((e) => disposeGroup(e.group));
    this.enemies.forEach((e) => disposeGroup(e.group));
    this.sanctuaries.forEach((s) => disposeGroup(s.group));
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.hudEl?.remove();
    this.touchEl?.remove();
  }
}

// Avoid unused-import lint while keeping class definitions handy for tuning.
void CLASS_DEFINITIONS;

function lerpAngle(a: number, b: number, t: number): number {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function disposeGroup(g: THREE.Object3D) {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    if (m.material) {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      mats.forEach((mat) => mat.dispose());
    }
  });
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
