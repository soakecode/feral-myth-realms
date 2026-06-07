import * as THREE from 'three';
import { getStateCallbacks } from '@colyseus/sdk';
import type { Room } from '@colyseus/sdk';
import {
  MSG, CLASS_DEFINITIONS, clamp, WORLD, ZONES, OBSTACLES, zoneAt,
  RESOURCE_INFO, STRUCTURE_DEFS, HARVEST_RANGE, BUILD_RANGE, distance,
} from '@fmr/shared';
import type {
  PlayerClass, AbilityKey, PlayerInputPayload, ResourceType, StructureType,
} from '@fmr/shared';
import type { RealmRoomState } from '../net/RoomStateTypes.js';
import type { PlayerSession } from '../auth/sessionStore.js';

const CLASS_COLORS: Record<string, number> = {
  stag_druid: 0x4caf50, raven_witch: 0x7c4dff, wolf_guardian: 0x90a4ae, fox_trickster: 0xff7043,
};
const ENEMY_COLORS: Record<string, number> = {
  wisp: 0x4dd0e1, bramble_beast: 0x6d8f3a, rune_imp: 0xba68c8,
};
const ENEMY_NAMES: Record<string, string> = {
  wisp: 'Wisp', bramble_beast: 'Bramble Beast', rune_imp: 'Rune Imp',
};

interface Label {
  sprite: THREE.Sprite;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
  last: string;
}

interface Entity {
  group: THREE.Group;
  target: THREE.Vector3;
  faceTarget: number;
  kind: 'player' | 'enemy';
  type?: string;
  name?: string;
  bob?: number;
  label?: Label;
}

interface Objective {
  id: string;
  label: string;
  goal: number;
  progress: number;
  done: boolean;
}

export class Game3D {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();

  private players = new Map<string, Entity>();
  private enemies = new Map<string, Entity>();
  private sanctuaries = new Map<string, { group: THREE.Group; pillar: THREE.Mesh }>();
  private resourceMeshes = new Map<string, THREE.Group>();
  private structureMeshes = new Map<string, THREE.Group>();

  private localId = '';
  private camTarget = new THREE.Vector3(WORLD.sanctum.x, 0, WORLD.sanctum.y);

  // input
  private keys: Record<string, boolean> = {};
  private joyDx = 0;
  private joyDy = 0;
  private queuedAbility: AbilityKey | null = null;
  private aim = new THREE.Vector3(WORLD.sanctum.x, 0, WORLD.sanctum.y);
  private pointerAttack = false;
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private seq = 0;
  private inputAccum = 0;

  // world interaction
  private nearestNodeId: string | null = null;
  private buildMode: StructureType | null = null;
  private buildGhost: THREE.Mesh | null = null;
  private currentZone = 'sanctum';
  private objectives: Objective[] = [];
  private toast = '';
  private toastUntil = 0;

  private rafId = 0;
  private hudEl: HTMLElement | null = null;
  private touchEl: HTMLElement | null = null;
  private minimapCtx: CanvasRenderingContext2D | null = null;
  private roomCode = '';
  private connectionStatus = 'Conectado';
  private intentionalExit = false;
  private disposed = false;
  private onResize = () => this.handleResize();
  private onKeyDown = (e: KeyboardEvent) => this.handleKey(e.code, true);
  private onKeyUp = (e: KeyboardEvent) => this.handleKey(e.code, false);

  constructor(
    private room: Room,
    private session: PlayerSession,
    private mode: 'realm' | 'duel',
    private onExit: () => void
  ) {
    this.localId = room.sessionId;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
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
    this.scene.background = new THREE.Color(0x0e1622);
    this.scene.fog = new THREE.Fog(0x0e1622, 1100, 2600);

    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 1, 8000);

    this.buildWorld();
    this.initObjectives();
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
    const hemi = new THREE.HemisphereLight(0xc4d8ff, 0x2a3326, 0.8);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff1d0, 1.45);
    sun.position.set(WORLD.width * 0.3, 2200, WORLD.height * 0.1);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 200;
    sun.shadow.camera.far = 5000;
    const cam = sun.shadow.camera as THREE.OrthographicCamera;
    const s = 1400;
    cam.left = -s; cam.right = s; cam.top = s; cam.bottom = -s;
    cam.updateProjectionMatrix();
    sun.target.position.set(WORLD.sanctum.x, 0, WORLD.sanctum.y);
    this.scene.add(sun, sun.target);

    // Biome ground (one tinted plane per zone quadrant)
    for (const z of ZONES) {
      const g = new THREE.Mesh(
        new THREE.PlaneGeometry(z.w, z.h),
        new THREE.MeshStandardMaterial({ color: z.color, roughness: 1 })
      );
      g.rotation.x = -Math.PI / 2;
      g.position.set(z.x + z.w / 2, 0, z.y + z.h / 2);
      g.receiveShadow = true;
      this.scene.add(g);
    }
    // Central sanctum glade
    const glade = new THREE.Mesh(
      new THREE.CircleGeometry(WORLD.sanctum.r, 48),
      new THREE.MeshStandardMaterial({ color: 0x4a6b58, roughness: 1, emissive: 0x16241c, emissiveIntensity: 0.4 })
    );
    glade.rotation.x = -Math.PI / 2;
    glade.position.set(WORLD.sanctum.x, 0.4, WORLD.sanctum.y);
    glade.receiveShadow = true;
    this.scene.add(glade);

    // Border walls
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x1b2536, roughness: 0.9 });
    const wall = (w: number, d: number, x: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 60, d), wallMat);
      m.position.set(x, 30, z); m.castShadow = true; m.receiveShadow = true; this.scene.add(m);
    };
    wall(WORLD.width, 20, WORLD.width / 2, 0);
    wall(WORLD.width, 20, WORLD.width / 2, WORLD.height);
    wall(20, WORLD.height, 0, WORLD.height / 2);
    wall(20, WORLD.height, WORLD.width, WORLD.height / 2);

    // Data-driven obstacles (positions match server collision exactly)
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 1 });
    for (const o of OBSTACLES) {
      const zone = zoneAt(o.x, o.y);
      if (o.kind === 'tree') {
        const t = new THREE.Group();
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(o.radius * 0.18, o.radius * 0.26, o.radius * 1.4, 6), trunkMat);
        trunk.position.y = o.radius * 0.7; trunk.castShadow = true;
        const leaves = new THREE.Mesh(
          new THREE.ConeGeometry(o.radius, o.radius * 2.2, 7),
          new THREE.MeshStandardMaterial({ color: zone.accent, roughness: 1, flatShading: true })
        );
        leaves.position.y = o.radius * 2; leaves.castShadow = true;
        t.add(trunk, leaves); t.position.set(o.x, 0, o.y); this.scene.add(t);
      } else if (o.kind === 'rock') {
        const m = new THREE.Mesh(
          new THREE.IcosahedronGeometry(o.radius, 0),
          new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 1, flatShading: true })
        );
        m.position.set(o.x, o.radius * 0.5, o.y);
        m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
        m.castShadow = true; m.receiveShadow = true; this.scene.add(m);
      } else if (o.kind === 'ruin') {
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(o.radius * 1.3, o.radius * 1.8, o.radius * 1.3),
          new THREE.MeshStandardMaterial({ color: 0x4a4566, roughness: 0.9, flatShading: true })
        );
        m.position.set(o.x, o.radius * 0.9, o.y);
        m.rotation.y = Math.random() * 0.6 - 0.3;
        m.castShadow = true; m.receiveShadow = true; this.scene.add(m);
      } else {
        // water (slows, walkable)
        const m = new THREE.Mesh(
          new THREE.CircleGeometry(o.radius, 28),
          new THREE.MeshStandardMaterial({ color: 0x2a6f7a, roughness: 0.3, metalness: 0.2, transparent: true, opacity: 0.82 })
        );
        m.rotation.x = -Math.PI / 2; m.position.set(o.x, 0.8, o.y); this.scene.add(m);
      }
    }
  }

  // ---- meshes ---------------------------------------------------------------

  private createPlayerMesh(classKey: string, isLocal: boolean): THREE.Group {
    const color = CLASS_COLORS[classKey] ?? 0xffffff;
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(11, 18, 4, 12), mat);
    body.position.y = 22; body.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(9, 16, 12), mat);
    head.position.y = 42; head.castShadow = true;
    const nose = new THREE.Mesh(new THREE.ConeGeometry(4, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffffff }));
    nose.rotation.x = Math.PI / 2; nose.position.set(0, 42, 9);
    g.add(body, head, nose);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(15, 19, 24),
      new THREE.MeshBasicMaterial({ color: isLocal ? 0xffe082 : color, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2; ring.position.y = 1; g.add(ring);
    return g;
  }

  private createEnemyMesh(type: string): THREE.Group {
    const color = ENEMY_COLORS[type] ?? 0xff5252;
    const g = new THREE.Group();
    if (type === 'wisp') {
      const core = new THREE.Mesh(new THREE.IcosahedronGeometry(11, 1),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.9, roughness: 0.2 }));
      core.position.y = 36; core.castShadow = true;
      const halo = new THREE.Mesh(new THREE.TorusGeometry(18, 1.6, 8, 24),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5 }));
      halo.position.y = 36; halo.rotation.x = Math.PI / 2.4;
      g.add(core, halo);
      const light = new THREE.PointLight(color, 0.6, 160); light.position.y = 36; g.add(light);
    } else if (type === 'bramble_beast') {
      const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true });
      const body = new THREE.Mesh(new THREE.DodecahedronGeometry(20, 0), bodyMat);
      body.position.y = 22; body.castShadow = true; g.add(body);
      const thornMat = new THREE.MeshStandardMaterial({ color: 0x3e5a23, roughness: 1, flatShading: true });
      for (let i = 0; i < 7; i++) {
        const th = new THREE.Mesh(new THREE.ConeGeometry(4, 16, 5), thornMat);
        const a = (i / 7) * Math.PI * 2;
        th.position.set(Math.cos(a) * 18, 22 + Math.sin(i) * 6, Math.sin(a) * 18);
        th.rotation.set(Math.PI / 2, 0, -a); th.castShadow = true; g.add(th);
      }
    } else {
      const bodyMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.3, roughness: 0.5, flatShading: true });
      const body = new THREE.Mesh(new THREE.TetrahedronGeometry(15, 0), bodyMat);
      body.position.y = 18; body.castShadow = true;
      const eyes = new THREE.Mesh(new THREE.SphereGeometry(7, 12, 10), new THREE.MeshStandardMaterial({ color: 0xfff2a8, emissive: 0xffd24a, emissiveIntensity: 0.8 }));
      eyes.position.y = 30;
      const rune = new THREE.Mesh(new THREE.TorusGeometry(10, 1.4, 6, 18), new THREE.MeshBasicMaterial({ color: 0xe6b3ff, transparent: true, opacity: 0.8 }));
      rune.position.y = 46; rune.rotation.x = Math.PI / 2;
      g.add(body, eyes, rune);
    }
    return g;
  }

  private createResourceMesh(type: ResourceType): THREE.Group {
    const info = RESOURCE_INFO[type];
    const g = new THREE.Group();
    if (type === 'wood') {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(7, 8, 30, 7), new THREE.MeshStandardMaterial({ color: info.color, roughness: 1, flatShading: true }));
      log.rotation.z = Math.PI / 2; log.position.y = 8; log.castShadow = true; g.add(log);
    } else if (type === 'stone') {
      for (let i = 0; i < 3; i++) {
        const r = new THREE.Mesh(new THREE.DodecahedronGeometry(9 - i * 2, 0), new THREE.MeshStandardMaterial({ color: info.color, roughness: 1, flatShading: true }));
        r.position.set((i - 1) * 9, 6 + i * 2, (i % 2) * 6); r.castShadow = true; g.add(r);
      }
    } else {
      // essence / rune_shard: floating crystal
      const c = new THREE.Mesh(new THREE.OctahedronGeometry(11, 0),
        new THREE.MeshStandardMaterial({ color: info.color, emissive: info.color, emissiveIntensity: 0.7, roughness: 0.2, flatShading: true }));
      c.position.y = 24; c.castShadow = true; g.add(c);
      const light = new THREE.PointLight(info.color, 0.5, 120); light.position.y = 24; g.add(light);
    }
    // base glow ring
    const ring = new THREE.Mesh(new THREE.RingGeometry(14, 17, 20),
      new THREE.MeshBasicMaterial({ color: info.color, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 1; g.add(ring);
    return g;
  }

  private createStructureMesh(type: StructureType): THREE.Group {
    const def = STRUCTURE_DEFS[type];
    const g = new THREE.Group();
    if (type === 'campfire') {
      const stones = new THREE.Mesh(new THREE.TorusGeometry(16, 5, 6, 14), new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 1, flatShading: true }));
      stones.rotation.x = -Math.PI / 2; stones.position.y = 4;
      const fire = new THREE.Mesh(new THREE.ConeGeometry(11, 30, 8), new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.9 }));
      fire.position.y = 18; fire.name = 'fire';
      const light = new THREE.PointLight(def.color, 1.2, def.radius); light.position.y = 24; g.add(light);
      g.add(stones, fire);
      // soft heal-radius ring
      const aura = new THREE.Mesh(new THREE.RingGeometry(def.radius - 4, def.radius, 40), new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.12, side: THREE.DoubleSide }));
      aura.rotation.x = -Math.PI / 2; aura.position.y = 1; g.add(aura);
    } else {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(7, 9, 70, 7), new THREE.MeshStandardMaterial({ color: 0x6b5a3a, roughness: 1, flatShading: true }));
      pole.position.y = 35; pole.castShadow = true;
      const top = new THREE.Mesh(new THREE.OctahedronGeometry(16, 0), new THREE.MeshStandardMaterial({ color: def.color, emissive: def.color, emissiveIntensity: 0.7, flatShading: true }));
      top.position.y = 78;
      const light = new THREE.PointLight(def.color, 1, 240); light.position.y = 78; g.add(light);
      g.add(pole, top);
    }
    return g;
  }

  private createSanctuaryMesh(): { group: THREE.Group; pillar: THREE.Mesh } {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(54, 60, 8, 32), new THREE.MeshStandardMaterial({ color: 0x3a3158, roughness: 0.8 }));
    base.position.y = 4; base.receiveShadow = true;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(50, 4, 12, 40), new THREE.MeshStandardMaterial({ color: 0xffd54f, emissive: 0xffb300, emissiveIntensity: 0.5 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 9;
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 120, 16), new THREE.MeshStandardMaterial({ color: 0xffe082, emissive: 0xffc400, emissiveIntensity: 0.7, transparent: true, opacity: 0.5 }));
    pillar.position.y = 64;
    const light = new THREE.PointLight(0xffd76a, 1, 360); light.position.y = 60; g.add(light);
    g.add(base, ring, pillar);
    return { group: g, pillar };
  }

  // ---- labels (canvas sprites for name + HP) --------------------------------

  private makeLabel(): Label {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const tex = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sprite.scale.set(120, 30, 1);
    return { sprite, canvas, ctx, tex, last: '' };
  }

  private drawLabel(L: Label, name: string, hpRatio: number | null, color: string) {
    const key = `${name}|${hpRatio === null ? 'x' : Math.round(hpRatio * 20)}|${color}`;
    if (L.last === key) return;
    L.last = key;
    const ctx = L.ctx;
    ctx.clearRect(0, 0, 256, 64);
    ctx.font = 'bold 22px Segoe UI, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillText(name, 129, 25);
    ctx.fillStyle = color; ctx.fillText(name, 128, 24);
    if (hpRatio !== null) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(48, 38, 160, 14);
      ctx.fillStyle = hpRatio > 0.5 ? '#5dd95d' : hpRatio > 0.25 ? '#e0c040' : '#e05555';
      ctx.fillRect(50, 40, 156 * Math.max(0, Math.min(1, hpRatio)), 10);
    }
    L.tex.needsUpdate = true;
  }

  // ---- room listeners -------------------------------------------------------

  private setupRoomListeners() {
    const $ = getStateCallbacks(this.room);
    const state = this.room.state as RealmRoomState;

    $(state).players.onAdd((p, id) => {
      const isLocal = id === this.localId;
      const group = this.createPlayerMesh(p.classKey, isLocal);
      group.position.set(p.x, 0, p.y);
      const label = this.makeLabel();
      label.sprite.position.set(0, 66, 0);
      group.add(label.sprite);
      this.scene.add(group);
      this.players.set(id, { group, target: new THREE.Vector3(p.x, 0, p.y), faceTarget: 0, kind: 'player', name: p.alias, label });
      if (isLocal) { this.camTarget.set(p.x, 0, p.y); this.aim.set(p.x, 0, p.y); }
    });
    $(state).players.onRemove((_p, id) => {
      const e = this.players.get(id);
      if (e) { this.scene.remove(e.group); disposeGroup(e.group); this.players.delete(id); }
    });

    if ((state as { enemies?: unknown }).enemies) {
      $(state).enemies.onAdd((en, id) => {
        const group = this.createEnemyMesh(en.type);
        group.position.set(en.x, 0, en.y);
        group.visible = en.isAlive;
        const label = this.makeLabel();
        label.sprite.position.set(0, 64, 0);
        group.add(label.sprite);
        this.scene.add(group);
        this.enemies.set(id, { group, target: new THREE.Vector3(en.x, 0, en.y), faceTarget: 0, kind: 'enemy', type: en.type, name: ENEMY_NAMES[en.type] ?? en.type, bob: Math.random() * 6, label });
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

    if ((state as { resources?: unknown }).resources) {
      $(state).resources.onAdd((n, id) => {
        const g = this.createResourceMesh(n.type as ResourceType);
        g.position.set(n.x, 0, n.y);
        g.visible = n.available;
        this.scene.add(g);
        this.resourceMeshes.set(id, g);
      });
      $(state).resources.onRemove((_n, id) => {
        const g = this.resourceMeshes.get(id);
        if (g) { this.scene.remove(g); disposeGroup(g); this.resourceMeshes.delete(id); }
      });
    }

    if ((state as { structures?: unknown }).structures) {
      $(state).structures.onAdd((s, id) => {
        const g = this.createStructureMesh(s.type as StructureType);
        g.position.set(s.x, 0, s.y);
        this.scene.add(g);
        this.structureMeshes.set(id, g);
      });
      $(state).structures.onRemove((_s, id) => {
        const g = this.structureMeshes.get(id);
        if (g) { this.scene.remove(g); disposeGroup(g); this.structureMeshes.delete(id); }
      });
    }

    this.room.onMessage(MSG.PLAYER_JOINED, (d: { playerId: string; roomCode?: string }) => {
      if (d.playerId === this.localId && d.roomCode) this.roomCode = d.roomCode;
    });
    this.room.onMessage(MSG.DAMAGE_EVENT, (d: { targetId: string; amount: number; isPlayer: boolean }) => {
      this.showDamageFeedback(d.targetId, d.amount, d.isPlayer);
    });
    this.room.onMessage(MSG.ENEMY_DIED, (d: { killerId: string; enemyType?: string }) => {
      if (d.killerId === this.localId) this.progressObjective('kill');
    });
    this.room.onMessage(MSG.RESOURCE_GAINED, (d: { type: ResourceType }) => {
      this.progressObjective('gather');
      const info = RESOURCE_INFO[d.type];
      this.showToast(`+1 ${info.icon} ${info.name}`);
    });
    this.room.onMessage(MSG.STRUCTURE_BUILT, (d: { type: StructureType; ownerId: string }) => {
      if (d.ownerId === this.localId) {
        if (d.type === 'campfire') this.progressObjective('build');
        this.showToast(`${STRUCTURE_DEFS[d.type].icon} ${STRUCTURE_DEFS[d.type].name} construido`);
      }
    });
    this.room.onMessage(MSG.BUILD_DENIED, (d: { reason: string }) => this.showToast(`✗ ${d.reason}`));
    this.room.onMessage(MSG.LEVEL_UP, (d: { level: number }) => this.showToast(`⭐ ¡Nivel ${d.level}!`));
    this.room.onMessage(MSG.MATCH_END, () => { /* realm: no end */ });
    this.room.onLeave(() => {
      this.connectionStatus = this.intentionalExit ? 'Saliendo' : 'Desconectado';
      window.setTimeout(() => this.exit(), this.intentionalExit ? 0 : 1200);
    });
  }

  // ---- objectives -----------------------------------------------------------

  private initObjectives() {
    this.objectives = [
      { id: 'explore', label: 'Sal del santuario y explora un bioma', goal: 1, progress: 0, done: false },
      { id: 'gather', label: 'Recolecta 5 recursos', goal: 5, progress: 0, done: false },
      { id: 'kill', label: 'Derrota 3 criaturas corruptas', goal: 3, progress: 0, done: false },
      { id: 'build', label: 'Construye una Hoguera 🔥', goal: 1, progress: 0, done: false },
      { id: 'sanctuary', label: 'Captura un santuario', goal: 1, progress: 0, done: false },
    ];
  }

  private progressObjective(id: string, amount = 1) {
    const o = this.objectives.find((x) => x.id === id);
    if (!o || o.done) return;
    o.progress = Math.min(o.goal, o.progress + amount);
    if (o.progress >= o.goal) { o.done = true; this.showToast('✓ Objetivo completado'); }
    this.renderObjectives();
  }

  // ---- input ----------------------------------------------------------------

  private setupInput() {
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointermove', (e) => this.updateAim(e));
    canvas.addEventListener('pointerdown', (e) => {
      this.updateAim(e);
      if (this.buildMode) { this.confirmBuild(); return; }
      this.pointerAttack = true;
    });
    canvas.addEventListener('pointerup', () => { this.pointerAttack = false; });
    const isTouch = window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
    if (isTouch) this.buildTouchControls();
  }

  private handleKey(code: string, down: boolean) {
    this.keys[code] = down;
    if (!down) return;
    if (code === 'KeyF') this.tryHarvest();
    else if (code === 'KeyB') this.toggleBuildMenu();
    else if (code === 'Digit1') this.selectBuild('campfire');
    else if (code === 'Digit2') this.selectBuild('totem');
    else if (code === 'Escape') this.cancelBuild();
  }

  private updateAim(e: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.groundPlane, hit)) this.aim.copy(hit);
  }

  private autoAim(): THREE.Vector3 {
    const me = this.players.get(this.localId);
    if (!me) return this.aim;
    let best: THREE.Vector3 | null = null; let bestD = Infinity;
    const consider = (v: THREE.Vector3) => { const d = v.distanceToSquared(me.group.position); if (d < bestD) { bestD = d; best = v; } };
    this.enemies.forEach((e) => { if (e.group.visible) consider(e.group.position); });
    this.players.forEach((p, id) => { if (id !== this.localId) consider(p.group.position); });
    return best ?? this.aim;
  }

  private collectInput(): PlayerInputPayload | null {
    let dx = 0, dy = 0;
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) dx -= 1;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) dx += 1;
    if (this.keys['KeyW'] || this.keys['ArrowUp']) dy -= 1;
    if (this.keys['KeyS'] || this.keys['ArrowDown']) dy += 1;
    dx += this.joyDx; dy += this.joyDy;

    let abilityKey: AbilityKey | null = null;
    let touchAbility = false;
    if (this.queuedAbility) { abilityKey = this.queuedAbility; this.queuedAbility = null; touchAbility = true; }
    else if (this.pointerAttack || this.keys['KeyJ']) abilityKey = 'basic';
    else if (this.keys['KeyQ']) abilityKey = 'q';
    else if (this.keys['KeyR']) abilityKey = 'r';
    // note: KeyE reserved for nothing here (E ability via touch only) to avoid clashing build/harvest keys

    if (dx === 0 && dy === 0 && abilityKey === null) return null;
    const aim = touchAbility ? this.autoAim() : this.aim;
    return { seq: this.seq++, dx, dy, abilityKey, aimX: aim.x, aimY: aim.z, timestamp: Date.now() };
  }

  // ---- harvest + build ------------------------------------------------------

  private tryHarvest() {
    if (this.nearestNodeId) this.room.send(MSG.HARVEST, { nodeId: this.nearestNodeId });
  }

  private toggleBuildMenu() {
    const menu = document.getElementById('build3d');
    if (!menu) return;
    const open = menu.style.display !== 'flex';
    menu.style.display = open ? 'flex' : 'none';
    if (!open) this.cancelBuild();
  }

  private selectBuild(type: StructureType) {
    this.buildMode = type;
    if (this.buildGhost) { this.scene.remove(this.buildGhost); disposeSingleMesh(this.buildGhost); }
    const def = STRUCTURE_DEFS[type];
    this.buildGhost = new THREE.Mesh(
      new THREE.CylinderGeometry(18, 18, 6, 18),
      new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.5 })
    );
    this.scene.add(this.buildGhost);
    this.showToast(`Coloca: ${def.icon} ${def.name} (click para confirmar, Esc cancela)`);
  }

  private cancelBuild() {
    this.buildMode = null;
    if (this.buildGhost) { this.scene.remove(this.buildGhost); disposeSingleMesh(this.buildGhost); this.buildGhost = null; }
  }

  private confirmBuild() {
    if (!this.buildMode) return;
    const me = this.players.get(this.localId);
    if (!me) return;
    const pos = this.clampedBuildPos();
    this.room.send(MSG.BUILD, { structureType: this.buildMode, x: pos.x, y: pos.z });
    this.cancelBuild();
    const menu = document.getElementById('build3d'); if (menu) menu.style.display = 'none';
  }

  private clampedBuildPos(): THREE.Vector3 {
    const me = this.players.get(this.localId);
    if (!me) return this.aim.clone();
    const dir = this.aim.clone().sub(me.group.position);
    const d = dir.length();
    if (d > BUILD_RANGE) dir.multiplyScalar(BUILD_RANGE / d);
    return me.group.position.clone().add(dir);
  }

  private showDamageFeedback(targetId: string, amount: number, isPlayer: boolean) {
    const target = isPlayer ? this.players.get(targetId) : this.enemies.get(targetId);
    if (!target) return;
    const color = isPlayer ? 0xff5252 : 0xffd54f;
    const pulse = new THREE.Mesh(new THREE.SphereGeometry(7 + Math.min(amount, 40) * 0.12, 12, 8), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 }));
    pulse.position.copy(target.group.position); pulse.position.y += 56;
    this.scene.add(pulse);
    const started = performance.now();
    const animate = () => {
      if (this.disposed) { disposeSingleMesh(pulse); return; }
      const t = Math.min((performance.now() - started) / 450, 1);
      pulse.position.y += 0.8; pulse.scale.setScalar(1 + t * 1.6);
      (pulse.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - t);
      if (t < 1) requestAnimationFrame(animate);
      else { this.scene.remove(pulse); disposeSingleMesh(pulse); }
    };
    animate();
  }

  // ---- loop -----------------------------------------------------------------

  private loop = () => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const state = this.room.state as RealmRoomState;

    state.players?.forEach((p, id) => {
      const e = this.players.get(id);
      if (!e) return;
      e.target.set(p.x, 0, p.y);
      e.group.visible = p.isAlive;
      e.faceTarget = p.direction === 'up' ? Math.PI : p.direction === 'left' ? -Math.PI / 2 : p.direction === 'right' ? Math.PI / 2 : 0;
      if (e.label) this.drawLabel(e.label, p.alias, clamp(p.hp / p.maxHp, 0, 1), id === this.localId ? '#ffe082' : '#cfe8ff');
    });
    state.enemies?.forEach((en, id) => {
      const e = this.enemies.get(id);
      if (!e) return;
      e.target.set(en.x, 0, en.y);
      e.group.visible = en.isAlive;
      if (e.label) {
        e.label.sprite.visible = en.isAlive;
        this.drawLabel(e.label, e.name ?? 'Enemy', clamp(en.hp / en.maxHp, 0, 1), '#ffd2d2');
      }
    });

    this.players.forEach((e) => {
      e.group.position.lerp(e.target, 1 - Math.pow(0.0001, dt));
      e.group.rotation.y = lerpAngle(e.group.rotation.y, e.faceTarget, 1 - Math.pow(0.001, dt));
    });
    this.enemies.forEach((e) => {
      e.group.position.lerp(e.target, 1 - Math.pow(0.0006, dt));
      if (e.bob !== undefined) { e.bob += dt * 3; e.group.position.y = e.type === 'wisp' ? Math.sin(e.bob) * 6 + 4 : Math.sin(e.bob) * 2; }
      e.group.rotation.y += dt * (e.type === 'rune_imp' ? 1.4 : 0.5);
    });
    this.sanctuaries.forEach((s) => { s.pillar.rotation.y += dt; const k = 1 + Math.sin(this.clock.elapsedTime * 2) * 0.06; s.pillar.scale.set(k, 1, k); });
    this.resourceMeshes.forEach((g) => { g.rotation.y += dt * 0.8; });
    state.resources?.forEach((n, id) => { const g = this.resourceMeshes.get(id); if (g) g.visible = n.available; });
    this.structureMeshes.forEach((g) => {
      const fire = g.getObjectByName('fire');
      if (fire) { const k = 1 + Math.sin(this.clock.elapsedTime * 9 + g.position.x) * 0.12; fire.scale.set(k, 1 + (k - 1) * 1.5, k); }
    });

    // camera follow
    const me = this.players.get(this.localId);
    if (me) this.camTarget.lerp(me.group.position, 1 - Math.pow(0.002, dt));
    const desired = new THREE.Vector3(this.camTarget.x, 620, this.camTarget.z + 470);
    this.camera.position.lerp(desired, 1 - Math.pow(0.0009, dt));
    this.camera.lookAt(this.camTarget.x, 20, this.camTarget.z - 40);

    // nearest harvestable + build ghost + zone
    this.updateInteraction(me);

    // send input
    this.inputAccum += dt * 1000;
    if (this.inputAccum >= 50) {
      this.inputAccum = 0;
      const input = this.collectInput();
      if (input) this.room.send(MSG.PLAYER_INPUT, input);
    }

    this.updateHUD();
    this.renderer.render(this.scene, this.camera);
  };

  private updateInteraction(me: Entity | undefined) {
    const state = this.room.state as RealmRoomState;
    if (!me) return;
    const mx = me.group.position.x, mz = me.group.position.z;

    // nearest available resource node
    this.nearestNodeId = null;
    let bestD = HARVEST_RANGE;
    state.resources?.forEach((n, id) => {
      if (!n.available) return;
      const d = distance(mx, mz, n.x, n.y);
      if (d < bestD) { bestD = d; this.nearestNodeId = id; }
    });

    // build ghost follows clamped aim, tinted by validity (range only client-side)
    if (this.buildMode && this.buildGhost) {
      const pos = this.clampedBuildPos();
      this.buildGhost.position.set(pos.x, 4, pos.z);
    }

    // zone tracking → banner + explore objective + sanctuary capture objective
    const z = zoneAt(mx, mz);
    if (z.id !== this.currentZone) {
      this.currentZone = z.id;
      this.showZoneBanner(z.name);
      if (z.id !== 'sanctum') this.progressObjective('explore');
    }
    let captured = false;
    state.sanctuaries?.forEach((s) => { if (String(s.state || '').startsWith('captured')) captured = true; });
    if (captured) this.progressObjective('sanctuary');
  }

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
        #game-hud3d .panel { position:absolute; top:10px; left:10px; background:rgba(10,16,26,0.55);
          border:1px solid rgba(255,255,255,0.14); border-radius:10px; padding:8px 12px; backdrop-filter:blur(5px); min-width:236px; }
        #game-hud3d .meta { display:grid; grid-template-columns:auto auto; gap:1px 10px; margin-bottom:7px; font-size:11px; }
        #game-hud3d .meta span:nth-child(odd){opacity:.6} #game-hud3d .meta span:nth-child(even){text-align:right}
        #game-hud3d .bar-row{display:flex;align-items:center;gap:6px;margin-bottom:4px;font-size:11px}
        #game-hud3d .bar-row span:first-child{width:24px;opacity:.85}
        #game-hud3d .bar-bg{flex:1;height:8px;background:rgba(255,255,255,.12);border-radius:4px;overflow:hidden}
        #game-hud3d .fill{height:100%;transition:width .15s}
        #game-hud3d .hp{background:linear-gradient(90deg,#36c750,#8aff5a)} #game-hud3d .en{background:linear-gradient(90deg,#3b82f6,#38d6ff)} #game-hud3d .xp{background:linear-gradient(90deg,#c79bff,#7c4dff)}
        #game-hud3d .val{font-size:10px;min-width:46px;text-align:right}
        #game-hud3d .res{display:flex;gap:10px;margin-top:7px;font-size:13px}
        #game-hud3d .res b{font-weight:700}
        #game-hud3d #obj3d{position:absolute;top:10px;right:10px;background:rgba(10,16,26,.55);border:1px solid rgba(255,255,255,.14);
          border-radius:10px;padding:9px 12px;backdrop-filter:blur(5px);min-width:210px;max-width:250px}
        #game-hud3d #obj3d h4{font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#ffd76a;margin-bottom:5px}
        #game-hud3d #obj3d ul{list-style:none;font-size:12px;line-height:1.45}
        #game-hud3d #obj3d li.done{color:#7ee787;text-decoration:line-through;opacity:.7}
        #game-hud3d #zone3d{position:absolute;top:64px;left:50%;transform:translateX(-50%);font-size:22px;font-weight:800;
          text-shadow:0 2px 14px rgba(0,0,0,.8);opacity:0;transition:opacity .5s;letter-spacing:1px}
        #game-hud3d #toast3d{position:absolute;bottom:150px;left:50%;transform:translateX(-50%);background:rgba(10,16,26,.8);
          border:1px solid rgba(255,255,255,.2);border-radius:8px;padding:7px 16px;font-size:14px;opacity:0;transition:opacity .25s}
        #game-hud3d #mini3d{position:absolute;bottom:12px;right:12px;border:1px solid rgba(255,255,255,.22);border-radius:6px;background:rgba(0,0,0,.45)}
        #game-hud3d #hint3d{position:absolute;bottom:130px;left:50%;transform:translateX(-50%);font-size:13px;background:rgba(0,0,0,.5);
          border:1px solid rgba(255,255,255,.2);border-radius:8px;padding:5px 12px;display:none}
        #game-hud3d #back3d{position:absolute;top:10px;left:50%;transform:translateX(-50%);pointer-events:auto;background:rgba(10,16,26,.6);
          color:#fff;border:1px solid rgba(255,255,255,.3);border-radius:8px;padding:6px 14px;font-size:13px;cursor:pointer}
        #game-hud3d #respawn3d{position:absolute;top:44%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,.78);
          color:#ff6b6b;border:2px solid #ff5252;border-radius:12px;padding:16px 30px;font-weight:bold;text-align:center;display:none}
        #game-hud3d #build3d{position:absolute;bottom:14px;left:50%;transform:translateX(-50%);display:none;gap:10px;pointer-events:auto}
        #game-hud3d #build3d button{background:rgba(10,16,26,.85);color:#fff;border:1px solid rgba(255,255,255,.3);border-radius:8px;
          padding:8px 12px;font-size:12px;cursor:pointer;text-align:center;min-width:120px}
        #game-hud3d #buildbtn3d{position:absolute;bottom:14px;left:12px;pointer-events:auto;background:rgba(10,16,26,.7);color:#fff;
          border:1px solid rgba(255,255,255,.3);border-radius:8px;padding:8px 12px;font-size:13px;cursor:pointer}
        #game-hud3d .controls{position:absolute;bottom:90px;left:12px;font-size:10px;color:rgba(255,255,255,.55)}
      </style>
      <div class="panel">
        <div class="meta">
          <span>Alias</span><span id="alias3d"></span>
          <span>Clase</span><span id="class3d"></span>
          <span>Jugadores</span><span id="players3d">1</span>
          <span>Zona</span><span id="zonelbl3d">Santuario</span>
          <span>Estado</span><span id="conn3d">Conectado</span>
        </div>
        <div class="bar-row"><span>HP</span><div class="bar-bg"><div class="fill hp" id="hp3d" style="width:100%"></div></div><span class="val" id="hpv3d">100/100</span></div>
        <div class="bar-row"><span>EN</span><div class="bar-bg"><div class="fill en" id="en3d" style="width:100%"></div></div><span class="val" id="env3d">100/100</span></div>
        <div class="bar-row"><span id="lvl3d">N1</span><div class="bar-bg"><div class="fill xp" id="xp3d" style="width:0%"></div></div><span class="val" id="xpv3d">0</span></div>
        <div class="res">
          <span>✦ <b id="r-essence">0</b></span><span>🪵 <b id="r-wood">0</b></span>
          <span>🪨 <b id="r-stone">0</b></span><span>◈ <b id="r-rune">0</b></span>
        </div>
      </div>
      <div id="obj3d"><h4>Objetivos</h4><ul id="objlist3d"></ul></div>
      <div id="zone3d"></div>
      <div id="toast3d"></div>
      <div id="hint3d"></div>
      <canvas id="mini3d" width="170" height="128"></canvas>
      <div class="controls">WASD mover · J/click atacar · F recolectar · B construir</div>
      <button id="back3d">← Volver al campamento</button>
      <button id="buildbtn3d">🔨 Construir (B)</button>
      <div id="build3d">
        <button data-build="campfire">🔥 Hoguera<br><small>3🪵 2✦</small></button>
        <button data-build="totem">🗿 Tótem<br><small>3🪨 2✦</small></button>
      </div>
      <div id="respawn3d">Caído en batalla<br><span style="font-size:13px;font-weight:normal">Reapareciendo en el santuario…</span></div>
    `;
    overlay.appendChild(el);
    this.hudEl = el;
    this.minimapCtx = (document.getElementById('mini3d') as HTMLCanvasElement).getContext('2d');
    this.renderObjectives();

    document.getElementById('back3d')!.addEventListener('click', () => { this.intentionalExit = true; this.room.leave(); });
    document.getElementById('buildbtn3d')!.addEventListener('click', () => this.toggleBuildMenu());
    el.querySelectorAll<HTMLElement>('#build3d button').forEach((b) => {
      b.addEventListener('click', () => this.selectBuild(b.dataset.build as StructureType));
    });
  }

  private renderObjectives() {
    const ul = document.getElementById('objlist3d');
    if (!ul) return;
    ul.innerHTML = this.objectives.map((o) => {
      const txt = o.goal > 1 ? `${o.label} (${o.progress}/${o.goal})` : o.label;
      return `<li class="${o.done ? 'done' : ''}">${o.done ? '✓' : '○'} ${txt}</li>`;
    }).join('');
  }

  private showZoneBanner(name: string) {
    const z = document.getElementById('zone3d');
    const lbl = document.getElementById('zonelbl3d');
    if (lbl) lbl.textContent = name;
    if (!z) return;
    z.textContent = name; z.style.opacity = '1';
    window.setTimeout(() => { if (z) z.style.opacity = '0'; }, 2200);
  }

  private showToast(msg: string) { this.toast = msg; this.toastUntil = performance.now() + 1800; }

  private updateHUD() {
    if (!this.hudEl) return;
    const state = this.room.state as RealmRoomState;
    const me = state.players?.get(this.localId);
    if (!me) return;
    const set = (id: string, v: string) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    const w = (id: string, v: number) => { const e = document.getElementById(id); if (e) e.style.width = `${clamp(v, 0, 1) * 100}%`; };
    w('hp3d', me.hp / me.maxHp); w('en3d', me.energy / me.maxEnergy);
    const xpInLevel = me.xp % 100;
    w('xp3d', xpInLevel / 100);
    set('hpv3d', `${Math.ceil(me.hp)}/${me.maxHp}`); set('env3d', `${Math.ceil(me.energy)}/${me.maxEnergy}`);
    set('lvl3d', `N${me.level}`); set('xpv3d', String(me.xp));
    set('alias3d', me.alias || this.session.alias); set('class3d', className(me.classKey));
    set('players3d', String(countPlayers(state))); set('conn3d', this.connectionStatus);
    set('r-essence', String(me.essence ?? 0)); set('r-wood', String(me.wood ?? 0));
    set('r-stone', String(me.stone ?? 0)); set('r-rune', String(me.runeShard ?? 0));
    const resp = document.getElementById('respawn3d'); if (resp) resp.style.display = me.isAlive ? 'none' : 'block';

    // interaction hint
    const hint = document.getElementById('hint3d');
    if (hint) {
      if (this.buildMode) { hint.style.display = 'block'; hint.textContent = 'Click para construir · Esc cancela'; }
      else if (this.nearestNodeId) { hint.style.display = 'block'; hint.textContent = 'F · Recolectar'; }
      else hint.style.display = 'none';
    }
    // toast
    const toastEl = document.getElementById('toast3d');
    if (toastEl) {
      const on = performance.now() < this.toastUntil;
      toastEl.style.opacity = on ? '1' : '0';
      if (on) toastEl.textContent = this.toast;
    }
    this.drawMinimap();
  }

  private drawMinimap() {
    const ctx = this.minimapCtx;
    if (!ctx) return;
    const W = 170, H = 128;
    const sx = W / WORLD.width, sy = H / WORLD.height;
    ctx.clearRect(0, 0, W, H);
    for (const z of ZONES) {
      ctx.fillStyle = `#${z.color.toString(16).padStart(6, '0')}`;
      ctx.globalAlpha = 0.9; ctx.fillRect(z.x * sx, z.y * sy, z.w * sx, z.h * sy);
    }
    ctx.globalAlpha = 1;
    const dot = (x: number, y: number, c: string, r: number) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x * sx, y * sy, r, 0, 7); ctx.fill(); };
    const state = this.room.state as RealmRoomState;
    state.sanctuaries?.forEach((s) => dot(s.x, s.y, '#ffd76a', 2.5));
    state.resources?.forEach((n) => { if (n.available) dot(n.x, n.y, '#7fe3c0', 1.3); });
    state.structures?.forEach((s) => dot(s.x, s.y, '#ff9a3c', 2));
    state.enemies?.forEach((e) => { if (e.isAlive) dot(e.x, e.y, '#ff5a5a', 1.5); });
    state.players?.forEach((p, id) => dot(p.x, p.y, id === this.localId ? '#ffffff' : '#7fb0ff', id === this.localId ? 3 : 2));
  }

  private buildTouchControls() {
    const overlay = document.getElementById('ui-overlay');
    if (!overlay) return;
    const wrap = document.createElement('div');
    wrap.id = 'touch3d';
    wrap.innerHTML = `
      <style>
        #touch3d{position:absolute;inset:0;pointer-events:none}
        #joy3d{position:absolute;bottom:26px;left:26px;width:124px;height:124px;border-radius:50%;background:rgba(255,255,255,.07);border:2px solid rgba(255,255,255,.2);touch-action:none;pointer-events:auto}
        #joythumb3d{position:absolute;left:37px;top:37px;width:50px;height:50px;border-radius:50%;background:rgba(255,255,255,.3);border:1px solid rgba(255,255,255,.5)}
        #ab3d{position:absolute;bottom:26px;right:20px;display:grid;grid-template-columns:repeat(2,1fr);gap:10px;pointer-events:none}
        #ab3d button{pointer-events:auto;width:56px;height:56px;border-radius:50%;border:2px solid rgba(255,255,255,.35);background:rgba(0,0,0,.45);color:#fff;font-size:16px;font-weight:bold;touch-action:none}
        #ab3d .basic{background:rgba(180,45,45,.55)} #ab3d .harv{background:rgba(40,150,110,.55)}
        #ab3d button:active{transform:scale(.9)}
      </style>
      <div id="joy3d"><div id="joythumb3d"></div></div>
      <div id="ab3d">
        <button data-ab="q">Q</button><button class="basic" data-ab="basic">⚔</button>
        <button data-ab="r">R</button><button class="harv" data-act="harvest">✋</button>
      </div>`;
    overlay.appendChild(wrap);
    this.touchEl = wrap;
    const base = document.getElementById('joy3d')!;
    const thumb = document.getElementById('joythumb3d')!;
    let active: number | null = null;
    const move = (e: PointerEvent) => {
      const r = base.getBoundingClientRect();
      let dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      let dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      const len = Math.hypot(dx, dy); if (len > 1) { dx /= len; dy /= len; }
      this.joyDx = dx; this.joyDy = dy; thumb.style.transform = `translate(${dx * 36}px,${dy * 36}px)`;
    };
    const end = (e: PointerEvent) => { if (e.pointerId !== active) return; active = null; this.joyDx = 0; this.joyDy = 0; thumb.style.transform = ''; };
    base.addEventListener('pointerdown', (e) => { active = e.pointerId; try { base.setPointerCapture(e.pointerId); } catch { /* */ } move(e); e.preventDefault(); });
    base.addEventListener('pointermove', (e) => { if (e.pointerId === active) { move(e); e.preventDefault(); } });
    base.addEventListener('pointerup', end); base.addEventListener('pointercancel', end);
    wrap.querySelectorAll<HTMLElement>('#ab3d button').forEach((btn) => {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (btn.dataset.act === 'harvest') this.tryHarvest();
        else this.queuedAbility = btn.dataset.ab as AbilityKey;
      });
    });
  }

  // ---- lifecycle ------------------------------------------------------------

  private handleResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  private exit() { if (this.disposed) return; this.dispose(); this.onExit(); }

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
    this.resourceMeshes.forEach((g) => disposeGroup(g));
    this.structureMeshes.forEach((g) => disposeGroup(g));
    if (this.buildGhost) disposeSingleMesh(this.buildGhost);
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.hudEl?.remove();
    this.touchEl?.remove();
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
function className(classKey: string): string {
  const def = CLASS_DEFINITIONS[classKey as PlayerClass];
  return def?.nameEs ?? classKey;
}
function countPlayers(state: RealmRoomState): number {
  let count = 0; state.players?.forEach(() => { count += 1; }); return count;
}
function disposeSingleMesh(mesh: THREE.Mesh) {
  mesh.geometry.dispose();
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  mats.forEach((m) => m.dispose());
}
function disposeGroup(g: THREE.Object3D) {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    if (m.material) { const mats = Array.isArray(m.material) ? m.material : [m.material]; mats.forEach((mt) => mt.dispose()); }
  });
}
