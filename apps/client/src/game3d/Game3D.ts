import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { getStateCallbacks } from '@colyseus/sdk';
import type { Room } from '@colyseus/sdk';
import {
  MSG, CLASS_DEFINITIONS, clamp, WORLD, ZONES, OBSTACLES, zoneAt, isBlocked,
  RESOURCE_INFO, STRUCTURE_DEFS, HARVEST_RANGE, BUILD_RANGE, distance, threatTier,
  waveNumberAt, nextWaveAtMs, nightFactor, REPAIR_RANGE,
} from '@fmr/shared';
import { AudioSystem } from './AudioSystem.js';
import { buildHeroMesh, CLASS_COLORS } from './heroMesh.js';
import type { Rig } from './heroMesh.js';
import { HERO_MODELS, ENEMY_MODELS, ENEMY_MODEL_HEIGHTS, instantiateModel, preloadModel } from './models.js';
import type { RiggedActions } from './models.js';
import type {
  PlayerClass, AbilityKey, PlayerInputPayload, ResourceType, StructureType,
} from '@fmr/shared';
import type { RealmRoomState } from '../net/RoomStateTypes.js';
import type { PlayerSession } from '../auth/sessionStore.js';

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
  kind: 'player' | 'enemy' | 'unit';
  type?: string;
  name?: string;
  bob?: number;
  label?: Label;
  rig?: Rig;
  lastPos?: THREE.Vector3;
  // skeletal-animation state (GLB models)
  mixer?: THREE.AnimationMixer;
  actions?: RiggedActions;
  animName?: 'idle' | 'walk';
  serverAnim?: string;
  lastAttackPlay?: number;
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
  private composer: EffectComposer | null = null;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private quality: 'high' | 'low' = 'high';
  private fireflies: THREE.Points | null = null;
  private fireflyAnim: { base: Float32Array; phase: Float32Array } | null = null;
  private waterMeshes: THREE.Mesh[] = [];
  private foliage: { mesh: THREE.Object3D; sway: number; phase: number }[] = [];
  private braziers: { light: THREE.PointLight; flame: THREE.Mesh; base: number; phase: number }[] = [];
  // day/night cycle refs
  private sunLight: THREE.DirectionalLight | null = null;
  private hemiLight: THREE.HemisphereLight | null = null;
  private ambLight: THREE.AmbientLight | null = null;
  private rimLight: THREE.DirectionalLight | null = null;
  private skyMat: THREE.MeshBasicMaterial | null = null;
  private curNight = 0;
  private lastNightOn = false;
  // structure health tracking + particle bursts
  private structHp = new Map<string, number>();
  private bursts: Array<{ pts: THREE.Points; vel: Float32Array; age: number; ttl: number }> = [];
  private glowTex: THREE.Texture | null = null;
  private nearestRepairId: string | null = null;
  private nearestRepairLabel = '';

  private players = new Map<string, Entity>();
  private enemies = new Map<string, Entity>();
  private units = new Map<string, Entity>();
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
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private seq = 0;
  private inputAccum = 0;
  // click / tap-to-move
  private moveTarget: THREE.Vector3 | null = null;
  private moveMarker: THREE.Mesh | null = null;
  private cameraMode: 'iso' | 'third' | 'first' = 'iso';
  private wallDragStart: THREE.Vector3 | null = null;
  // first-person state
  private yaw = 0;
  private pitch = -0.1;
  private fpWeapon: THREE.Group | null = null;
  private fpRight: THREE.Group | null = null;
  private fpLeft: THREE.Group | null = null;
  private fpSwing = 0;
  private fpBob = 0;
  private lookId: number | null = null;
  private lookLast = { x: 0, y: 0 };
  private lookMoved = 0;
  private lookStart = 0;
  private onLockChange = () => this.handleLockChange();
  private onMouseLook = (e: MouseEvent) => {
    if (this.cameraMode !== 'first' || document.pointerLockElement !== this.renderer.domElement) return;
    this.yaw -= e.movementX * 0.0026;
    this.pitch = clamp(this.pitch - e.movementY * 0.0022, -1.15, 1.05);
  };
  /** Diablo-style command: walk to the clicked enemy/resource, then act. */
  private pendingAction: { kind: 'attack' | 'harvest'; id: string } | null = null;

  // world interaction
  private nearestNodeId: string | null = null;
  private nearestNodeType: ResourceType | null = null;
  private buildMode: StructureType | null = null;
  private buildGhost: THREE.Mesh | null = null;
  private currentZone = 'sanctum';
  private objectives: Objective[] = [];
  private objectiveTier = 0;
  private charOpen = false;
  private lastThreatTier = 0;
  private audio = new AudioSystem();
  private lastAbilitySfx = 0;
  /** Session chronicle shown in the hero panel. */
  private chron = { kills: 0, gathered: 0, built: 0, waves: 0 };
  private toast = '';
  private toastUntil = 0;

  private rafId = 0;
  private hudEl: HTMLElement | null = null;
  private touchEl: HTMLElement | null = null;
  private minimapCtx: CanvasRenderingContext2D | null = null;
  private roomCode = '';
  private connectionStatus = 'Conectado';
  private intentionalExit = false;
  private settingsOpen = false;
  private disposed = false;
  private onResize = () => this.handleResize();
  private onKeyDown = (e: KeyboardEvent) => this.handleKey(e.code, true);
  private onKeyUp = (e: KeyboardEvent) => this.handleKey(e.code, false);
  private onPopState = () => this.handleBrowserBack();

  constructor(
    private room: Room,
    private session: PlayerSession,
    private mode: 'realm' | 'duel',
    private onExit: () => void
  ) {
    this.localId = room.sessionId;

    // Adaptive quality: phones / coarse-pointer devices get a lighter pipeline
    // (no bloom composer, fewer particles, smaller shadow map) so they stay smooth.
    const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
    const lowMem = typeof navigator !== 'undefined' && typeof (navigator as { deviceMemory?: number }).deviceMemory === 'number' && (navigator as { deviceMemory?: number }).deviceMemory! <= 2;
    const smallScreen = Math.min(window.innerWidth, window.innerHeight) < 560;
    // Phones (coarse pointer) and very weak devices get the lighter pipeline.
    this.quality = coarse || lowMem || smallScreen ? 'low' : 'high';

    this.renderer = new THREE.WebGLRenderer({ antialias: this.quality === 'high', preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality === 'high' ? 2 : 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = this.quality === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = this.quality === 'high' ? 1.24 : 1.34;
    const canvas = this.renderer.domElement;
    canvas.id = 'game3d-canvas';
    canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:1;touch-action:none;';
    document.getElementById('game-container')!.appendChild(canvas);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x162338);
    this.scene.fog = new THREE.FogExp2(0x24364c, 0.00036);

    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 1, 9000);
    // The camera lives in the scene graph so the first-person weapon (a camera
    // child) gets rendered and lit.
    this.scene.add(this.camera);

    this.buildWorld();
    this.setupPostProcessing();
    this.initObjectives();
    this.setupRoomListeners();
    this.buildHUD();
    this.setupInput();
    this.setupNavigationGuards();

    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('pointerlockchange', this.onLockChange);
    document.addEventListener('mousemove', this.onMouseLook);

    // Warm the model cache: this hero's class plus the common foes.
    void preloadModel(HERO_MODELS[this.session.classKey] ?? HERO_MODELS.stag_druid);
    for (const url of Object.values(ENEMY_MODELS)) void preloadModel(url);

    this.loop();
  }

  // ---- world ----------------------------------------------------------------

  private buildWorld() {
    const hi = this.quality === 'high';

    // Gradient dusk sky dome
    this.scene.add(this.makeSky());

    // Dark fantasy mood, but kept readable on deployed/mobile screens.
    // Contrast comes from rim light and colored props instead of crushing blacks.
    this.hemiLight = new THREE.HemisphereLight(0x8fb5da, 0x2b2119, 0.7);
    this.scene.add(this.hemiLight);
    this.ambLight = new THREE.AmbientLight(0x2f4056, 0.36);
    this.scene.add(this.ambLight);
    const sun = new THREE.DirectionalLight(0xd8e7ff, 1.85);
    this.sunLight = sun;
    sun.position.set(WORLD.width * 0.34, 2500, WORLD.height * 0.04);
    sun.castShadow = true;
    sun.shadow.mapSize.set(hi ? 2048 : 1024, hi ? 2048 : 1024);
    sun.shadow.camera.near = 200;
    sun.shadow.camera.far = 5400;
    sun.shadow.bias = -0.0006;
    const scam = sun.shadow.camera as THREE.OrthographicCamera;
    const s = 1500; scam.left = -s; scam.right = s; scam.top = s; scam.bottom = -s; scam.updateProjectionMatrix();
    sun.target.position.set(WORLD.sanctum.x, 0, WORLD.sanctum.y);
    this.scene.add(sun, sun.target);
    const rim = new THREE.DirectionalLight(0x79a8ff, 0.78);
    rim.position.set(-WORLD.width * 0.2, 1500, WORLD.height * 1.15);
    this.scene.add(rim);
    this.rimLight = rim;

    // Biome ground: each realm gets its own procedural tile palette so the map
    // reads as terrain instead of a flat dark sheet.
    for (const z of ZONES) {
      const groundTex = this.makeGroundTexture(z.id);
      if (groundTex) { groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping; groundTex.repeat.set(z.w / 180, z.h / 180); }
      const geo = new THREE.PlaneGeometry(z.w, z.h, hi ? 40 : 12, hi ? 30 : 9);
      const pos = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i);
        pos.setZ(i, Math.sin(x * 0.0042 + 1.3) * Math.cos(y * 0.0051) * 7 + Math.sin((x + y) * 0.0026) * 5);
      }
      geo.computeVertexNormals();
      const col = new THREE.Color(z.color).offsetHSL(0, -0.03, 0.13);
      const g = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        color: col,
        roughness: 0.92,
        metalness: 0.02,
        map: groundTex ?? null,
        bumpMap: groundTex ?? null,
        bumpScale: 0.9,
        emissive: new THREE.Color(z.accent).multiplyScalar(0.08),
        emissiveIntensity: 0.08,
      }));
      g.rotation.x = -Math.PI / 2;
      g.position.set(z.x + z.w / 2, 0, z.y + z.h / 2);
      g.receiveShadow = true;
      this.scene.add(g);
    }

    // Central sanctum glade + carved stone ring
    const glade = new THREE.Mesh(
      new THREE.CircleGeometry(WORLD.sanctum.r, 56),
      new THREE.MeshStandardMaterial({ color: 0x6da86f, roughness: 0.9, emissive: 0x2a6a3a, emissiveIntensity: 0.32 })
    );
    glade.rotation.x = -Math.PI / 2; glade.position.set(WORLD.sanctum.x, 0.6, WORLD.sanctum.y);
    glade.receiveShadow = true; this.scene.add(glade);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(WORLD.sanctum.r - 8, 6, 8, 72),
      new THREE.MeshStandardMaterial({ color: 0xb8a46a, roughness: 0.62, metalness: 0.08, emissive: 0x4a3714, emissiveIntensity: 0.28 })
    );
    ring.rotation.x = -Math.PI / 2; ring.position.set(WORLD.sanctum.x, 2, WORLD.sanctum.y); this.scene.add(ring);

    // Border cliffs (dark, framing the playfield)
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x202a3a, roughness: 1, map: this.getStoneTexture() });
    const wall = (w: number, d: number, x: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 130, d), wallMat);
      m.position.set(x, 35, z); m.receiveShadow = true; this.scene.add(m);
    };
    wall(WORLD.width + 80, 70, WORLD.width / 2, -12);
    wall(WORLD.width + 80, 70, WORLD.width / 2, WORLD.height + 12);
    wall(70, WORLD.height + 80, -12, WORLD.height / 2);
    wall(70, WORLD.height + 80, WORLD.width + 12, WORLD.height / 2);

    // Data-driven obstacles (positions match server collision exactly)
    for (const o of OBSTACLES) {
      const zone = zoneAt(o.x, o.y);
      if (o.kind === 'tree') this.scene.add(this.makeTree(o.x, o.y, o.radius, zone.accent, hi));
      else if (o.kind === 'rock') this.scene.add(this.makeRock(o.x, o.y, o.radius, hi));
      else if (o.kind === 'ruin') this.scene.add(this.makeRuin(o.x, o.y, o.radius, hi));
      else this.scene.add(this.makeWater(o.x, o.y, o.radius));
    }

    // Purely cosmetic dressing: dense woodland, undergrowth, crystals
    this.scatterForest();
    this.scatterGrass();
    if (hi) this.scatterCrystals();
    this.addBraziers();
    this.buildAtmosphere();
  }

  /**
   * Dense visual-only woodland (no collision): one merged trunk + one merged
   * crown-card geometry drawn as two InstancedMeshes with per-instance biome
   * tinting — hundreds of extra trees for two draw calls. This is what turns
   * a scatter of props into a forest.
   */
  private scatterForest() {
    const R = 30;
    const trunkGeo = new THREE.CylinderGeometry(R * 0.15, R * 0.34, R * 2.6, 7);
    trunkGeo.translate(0, R * 1.3, 0);
    const cardGeos: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 6; i++) {
      const cg = new THREE.PlaneGeometry(R * 2.5, R * 2.0);
      cg.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(
        new THREE.Euler((Math.random() - 0.5) * 0.8, Math.random() * Math.PI, (Math.random() - 0.5) * 0.4)
      ));
      const a = (i / 6) * Math.PI * 2;
      cg.translate(Math.cos(a) * R * 0.35, R * (2.6 + (i % 3) * 0.5), Math.sin(a) * R * 0.35);
      cardGeos.push(cg);
    }
    const crownGeo = mergeGeometries(cardGeos);
    if (!crownGeo) return;
    const count = this.quality === 'high' ? 420 : 150;
    const trunkInst = new THREE.InstancedMesh(
      trunkGeo,
      new THREE.MeshStandardMaterial({ color: 0x5b4634, roughness: 1, map: this.getBarkTexture() }),
      count
    );
    const crownInst = new THREE.InstancedMesh(
      crownGeo,
      new THREE.MeshStandardMaterial({ map: this.getLeafTexture(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.95 }),
      count
    );
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    let placed = 0;
    for (let i = 0; i < count * 6 && placed < count; i++) {
      const x = Math.random() * WORLD.width;
      const z = Math.random() * WORLD.height;
      if (distance(x, z, WORLD.sanctum.x, WORLD.sanctum.y) < WORLD.sanctum.r + 150) continue;
      if (isBlocked(x, z, 42)) continue;
      const zone = zoneAt(x, z);
      // per-biome density: the grove is thick forest, the ruins stay open
      const keep = zone.id === 'emerald_grove' ? 1
        : zone.id === 'moonfen_marsh' ? 0.72
        : zone.id === 'sunken_hollow' ? 0.5 : 0.22;
      if (Math.random() > keep) continue;
      const s = 0.65 + Math.random() * 0.85;
      dummy.position.set(x, 0, z);
      dummy.rotation.y = Math.random() * Math.PI * 2;
      dummy.scale.set(s, s * (0.85 + Math.random() * 0.4), s);
      dummy.updateMatrix();
      trunkInst.setMatrixAt(placed, dummy.matrix);
      crownInst.setMatrixAt(placed, dummy.matrix);
      col.set(zone.accent).offsetHSL(0, -0.06, (Math.random() - 0.5) * 0.12);
      crownInst.setColorAt(placed, col);
      placed++;
    }
    trunkInst.count = placed;
    crownInst.count = placed;
    trunkInst.instanceMatrix.needsUpdate = true;
    crownInst.instanceMatrix.needsUpdate = true;
    if (crownInst.instanceColor) crownInst.instanceColor.needsUpdate = true;
    trunkInst.castShadow = this.quality === 'high';
    this.scene.add(trunkInst, crownInst);
  }

  private makeGroundTexture(zoneId: string): THREE.CanvasTexture | null {
    const palette = zoneId === 'emerald_grove'
      ? { base: '#536b34', mid: '#748f3f', hi: '#9fc86a', crack: '#263216', moss: '#30b978' }
      : zoneId === 'obsidian_ruins'
        ? { base: '#45445f', mid: '#5d617d', hi: '#8c82ba', crack: '#171527', moss: '#8b55ff' }
        : zoneId === 'moonfen_marsh'
          ? { base: '#34595c', mid: '#467479', hi: '#7ec8bd', crack: '#142a2c', moss: '#3ef0c0' }
          : { base: '#5c5240', mid: '#7a6a49', hi: '#c39d54', crack: '#2f2518', moss: '#d9af52' };

    const c = document.createElement('canvas'); c.width = c.height = 256;
    const ctx = c.getContext('2d'); if (!ctx) return null;
    const bg = ctx.createLinearGradient(0, 0, 256, 256);
    bg.addColorStop(0, palette.hi);
    bg.addColorStop(0.42, palette.base);
    bg.addColorStop(1, palette.mid);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, 256, 256);

    for (let i = 0; i < 3600; i++) {
      const hot = Math.random() > 0.72;
      const alpha = hot ? 0.16 : 0.1;
      ctx.fillStyle = hot ? `rgba(255,244,195,${alpha})` : `rgba(12,10,8,${alpha})`;
      const s = hot ? 1 + Math.random() * 2.2 : 1 + Math.random() * 4;
      ctx.fillRect(Math.random() * 256, Math.random() * 256, s, s);
    }

    if (zoneId === 'obsidian_ruins') {
      // only the ruins have worked stone underfoot
      const cell = 44;
      for (let gy = -cell; gy <= 256; gy += cell) {
        const off = ((gy / cell) % 2) ? cell / 2 : 0;
        for (let gx = -cell; gx <= 256; gx += cell) {
          const x = gx + off + Math.random() * 8;
          const y = gy + Math.random() * 8;
          const w = cell + (Math.random() - 0.5) * 12;
          const h = cell * (0.72 + Math.random() * 0.32);
          ctx.fillStyle = `rgba(255,235,180,${0.035 + Math.random() * 0.04})`;
          ctx.fillRect(x + 3, y + 3, w - 7, h - 7);
          ctx.strokeStyle = `rgba(12,9,8,${0.26 + Math.random() * 0.16})`;
          ctx.lineWidth = 1.3 + Math.random() * 1.2;
          ctx.strokeRect(x, y, w, h);
        }
      }
    } else {
      // organic forest floor: grass blades, leaf litter, bare-earth patches
      for (let i = 0; i < 420; i++) {
        const x = Math.random() * 256, y = Math.random() * 256;
        const len = 3 + Math.random() * 7;
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.1;
        ctx.strokeStyle = `${palette.moss}${Math.random() > 0.5 ? '55' : '33'}`;
        ctx.lineWidth = 0.8 + Math.random() * 0.8;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
        ctx.stroke();
      }
      for (let i = 0; i < 40; i++) { // leaf litter
        ctx.fillStyle = `rgba(120,90,40,${0.12 + Math.random() * 0.14})`;
        ctx.beginPath();
        ctx.ellipse(Math.random() * 256, Math.random() * 256, 1.6 + Math.random() * 2.6, 0.9 + Math.random() * 1.4, Math.random() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.strokeStyle = palette.crack; ctx.lineWidth = 1.15;
    for (let i = 0; i < 24; i++) {
      ctx.beginPath();
      let x = Math.random() * 256, y = Math.random() * 256; ctx.moveTo(x, y);
      for (let j = 0; j < 4; j++) { x += (Math.random() - 0.5) * 42; y += (Math.random() - 0.5) * 42; ctx.lineTo(x, y); }
      ctx.stroke();
    }

    ctx.fillStyle = `${palette.moss}66`;
    for (let i = 0; i < 34; i++) {
      ctx.beginPath();
      ctx.ellipse(Math.random() * 256, Math.random() * 256, 3 + Math.random() * 10, 1.5 + Math.random() * 5, Math.random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.quality === 'high' ? 8 : 2;
    return tex;
  }

  private addBraziers() {
    const place = (x: number, z: number, scale = 1) => {
      const g = new THREE.Group();
      const post = new THREE.Mesh(new THREE.CylinderGeometry(3 * scale, 5 * scale, 34 * scale, 6), new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 1 }));
      post.position.y = 17 * scale; post.castShadow = true; g.add(post);
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(9 * scale, 5 * scale, 8 * scale, 8), new THREE.MeshStandardMaterial({ color: 0x39322c, roughness: 1 }));
      bowl.position.y = 36 * scale; g.add(bowl);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(6 * scale, 18 * scale, 7), new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.95 }));
      flame.position.y = 47 * scale; g.add(flame);
      const light = new THREE.PointLight(0xff7e2c, 2.3, 380 * scale, 1.7); light.position.set(0, 48 * scale, 0); g.add(light);
      g.position.set(x, 0, z); this.scene.add(g);
      this.braziers.push({ light, flame, base: 2.3, phase: Math.random() * Math.PI * 2 });
    };
    const n = 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      place(WORLD.sanctum.x + Math.cos(a) * (WORLD.sanctum.r - 26), WORLD.sanctum.y + Math.sin(a) * (WORLD.sanctum.r - 26));
    }
    if (this.quality === 'high') {
      for (const o of OBSTACLES) {
        if (o.kind === 'ruin' && Math.random() > 0.72) place(o.x + 34, o.y + 30, 0.9);
      }
    }
  }

  private setupPostProcessing() {
    if (this.quality !== 'high') return;
    try {
      const composer = new EffectComposer(this.renderer);
      composer.addPass(new RenderPass(this.scene, this.camera));
      const bloom = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight), 0.46, 0.42, 0.72
      );
      composer.addPass(bloom);
      composer.addPass(new OutputPass());
      // Light vignette for focus without hiding edge UI or terrain on phones.
      composer.addPass(new ShaderPass({
        uniforms: { tDiffuse: { value: null }, strength: { value: 0.82 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
        fragmentShader: 'uniform sampler2D tDiffuse; uniform float strength; varying vec2 vUv; void main(){ vec4 c=texture2D(tDiffuse,vUv); vec2 d=vUv-0.5; float v=clamp(1.0-dot(d,d)*strength,0.0,1.0); v=pow(v,1.15); gl_FragColor=vec4(c.rgb*mix(0.74,1.0,v),c.a); }',
      }));
      composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      composer.setSize(window.innerWidth, window.innerHeight);
      this.composer = composer;
    } catch (err) {
      console.warn('[Game3D] post-processing unavailable, using direct render', err);
      this.composer = null;
    }
  }

  // ---- world helpers --------------------------------------------------------

  private makeSky(): THREE.Mesh {
    // Real night sky for first person: dusk gradient + starfield + glowing moon.
    const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
    const ctx = c.getContext('2d')!;
    const grad = ctx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0.0, '#132a4f');   // moonlit zenith
    grad.addColorStop(0.34, '#315070');
    grad.addColorStop(0.5, '#b39268');   // warm horizon haze
    grad.addColorStop(0.66, '#547080');
    grad.addColorStop(1.0, '#293747');   // nadir
    ctx.fillStyle = grad; ctx.fillRect(0, 0, 1024, 512);
    // stars on the upper hemisphere, denser near the zenith
    for (let i = 0; i < 420; i++) {
      const y = Math.pow(Math.random(), 1.7) * 230;
      const x = Math.random() * 1024;
      const r = Math.random() * 1.1 + 0.3;
      const a = 0.25 + Math.random() * 0.65;
      ctx.fillStyle = `rgba(${220 + Math.floor(Math.random() * 35)},${225 + Math.floor(Math.random() * 30)},255,${a})`;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    }
    // moon with halo and craters
    const mx = 700, my = 96;
    const halo = ctx.createRadialGradient(mx, my, 6, mx, my, 70);
    halo.addColorStop(0, 'rgba(220,228,255,0.55)');
    halo.addColorStop(0.35, 'rgba(190,205,245,0.16)');
    halo.addColorStop(1, 'rgba(180,200,240,0)');
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(mx, my, 70, 0, 7); ctx.fill();
    ctx.fillStyle = '#e8edfb'; ctx.beginPath(); ctx.arc(mx, my, 17, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(170,182,210,0.5)';
    for (const [ox, oy, r] of [[-5, -3, 4], [6, 4, 3], [2, -7, 2.4]]) {
      ctx.beginPath(); ctx.arc(mx + ox, my + oy, r, 0, 7); ctx.fill();
    }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false });
    this.skyMat = mat;
    const sky = new THREE.Mesh(new THREE.SphereGeometry(5200, 48, 28), mat);
    sky.position.set(WORLD.sanctum.x, 0, WORLD.sanctum.y);
    sky.renderOrder = -1;
    return sky;
  }

  // Neutral-luminance detail textures: the material's color supplies the hue.
  private texBark: THREE.CanvasTexture | null = null;
  private texStone: THREE.CanvasTexture | null = null;
  private texLeaf: THREE.CanvasTexture | null = null;
  private texGrass: THREE.CanvasTexture | null = null;

  private getBarkTexture(): THREE.CanvasTexture {
    if (this.texBark) return this.texBark;
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#b8b0a6'; ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 46; i++) {
      const x = Math.random() * 128;
      const w = 1 + Math.random() * 3;
      const v = 60 + Math.floor(Math.random() * 90);
      ctx.fillStyle = `rgba(${v},${v - 8},${v - 16},0.55)`;
      ctx.fillRect(x, 0, w, 128);
    }
    for (let i = 0; i < 9; i++) { // knots
      const x = Math.random() * 128, y = Math.random() * 128;
      ctx.strokeStyle = 'rgba(40,32,24,0.5)'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.ellipse(x, y, 3 + Math.random() * 4, 6 + Math.random() * 6, 0, 0, 7); ctx.stroke();
    }
    this.texBark = new THREE.CanvasTexture(c);
    this.texBark.colorSpace = THREE.SRGBColorSpace;
    this.texBark.wrapS = this.texBark.wrapT = THREE.RepeatWrapping;
    this.texBark.repeat.set(2, 2);
    return this.texBark;
  }

  private getStoneTexture(): THREE.CanvasTexture {
    if (this.texStone) return this.texStone;
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#b2b2b2'; ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 1500; i++) {
      const v = 110 + Math.floor(Math.random() * 110);
      ctx.fillStyle = `rgba(${v},${v},${v},0.4)`;
      ctx.fillRect(Math.random() * 128, Math.random() * 128, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
    ctx.strokeStyle = 'rgba(30,28,26,0.5)'; ctx.lineWidth = 1.1;
    for (let i = 0; i < 10; i++) {
      ctx.beginPath();
      let x = Math.random() * 128, y = Math.random() * 128;
      ctx.moveTo(x, y);
      for (let j = 0; j < 4; j++) { x += (Math.random() - 0.5) * 36; y += (Math.random() - 0.5) * 36; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    this.texStone = new THREE.CanvasTexture(c);
    this.texStone.colorSpace = THREE.SRGBColorSpace;
    this.texStone.wrapS = this.texStone.wrapT = THREE.RepeatWrapping;
    return this.texStone;
  }

  /**
   * Alpha-cutout foliage card: dense cloud of overlapping leaf shapes with
   * ragged edges. Near-neutral luminance so the material color supplies the
   * biome hue. This is how real-time games build convincing tree crowns.
   */
  private getLeafTexture(): THREE.CanvasTexture {
    if (this.texLeaf) return this.texLeaf;
    const S = 256;
    const c = document.createElement('canvas'); c.width = c.height = S;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, S, S);
    // leaf clusters, denser toward the center so card edges stay ragged
    for (let i = 0; i < 1500; i++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.pow(Math.random(), 0.62) * S * 0.46;
      const x = S / 2 + Math.cos(ang) * rad;
      const y = S / 2 + Math.sin(ang) * rad;
      const v = 120 + Math.floor(Math.random() * 120);
      ctx.fillStyle = `rgba(${Math.round(v * 0.72)},${v},${Math.round(v * 0.6)},${0.75 + Math.random() * 0.25})`;
      const w = 3 + Math.random() * 7;
      const h = w * (0.45 + Math.random() * 0.4);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.random() * Math.PI);
      ctx.beginPath(); ctx.ellipse(0, 0, w, h, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    this.texLeaf = new THREE.CanvasTexture(c);
    this.texLeaf.colorSpace = THREE.SRGBColorSpace;
    this.texLeaf.anisotropy = this.quality === 'high' ? 4 : 1;
    return this.texLeaf;
  }

  /** Alpha-cutout grass tuft card (several curved blades). */
  private getGrassTexture(): THREE.CanvasTexture {
    if (this.texGrass) return this.texGrass;
    const W = 128, H = 128;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, W, H);
    for (let i = 0; i < 26; i++) {
      const x0 = 14 + Math.random() * (W - 28);
      const lean = (Math.random() - 0.5) * 36;
      const v = 130 + Math.floor(Math.random() * 110);
      ctx.strokeStyle = `rgba(${Math.round(v * 0.66)},${v},${Math.round(v * 0.52)},${0.85 + Math.random() * 0.15})`;
      ctx.lineWidth = 2.4 + Math.random() * 2.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x0, H);
      ctx.quadraticCurveTo(x0 + lean * 0.3, H * 0.5, x0 + lean, H * (0.06 + Math.random() * 0.3));
      ctx.stroke();
    }
    this.texGrass = new THREE.CanvasTexture(c);
    this.texGrass.colorSpace = THREE.SRGBColorSpace;
    return this.texGrass;
  }

  private makeTree(x: number, y: number, radius: number, accent: number, hi: boolean): THREE.Group {
    // Human scale + organic silhouettes: bent smooth trunks with bark relief,
    // canopies built from noise-displaced ellipsoids (deciduous) or smooth
    // jittered cones (firs) — no faceted "block" trees.
    const g = new THREE.Group();
    const bark = this.getBarkTexture();
    const trunkGeo = jitterGeometry(new THREE.CylinderGeometry(radius * 0.15, radius * 0.34, radius * 2.6, 10, 4), radius * 0.04);
    const trunk = new THREE.Mesh(
      trunkGeo,
      new THREE.MeshStandardMaterial({ color: 0x5b4634, roughness: 1, map: bark, bumpMap: bark, bumpScale: 1.4 })
    );
    trunk.position.y = radius * 1.3;
    trunk.rotation.z = (Math.random() - 0.5) * 0.09;
    trunk.castShadow = hi; g.add(trunk);

    // Crown of alpha-cutout foliage cards: reads as a volumetric leafy canopy
    // from every angle (including first person), not as geometric solids.
    const canopy = new THREE.Group();
    const tint = new THREE.Color(accent).offsetHSL(0, -0.06, (Math.random() - 0.5) * 0.08);
    const leafMat = new THREE.MeshStandardMaterial({
      color: tint,
      map: this.getLeafTexture(),
      alphaTest: 0.45,
      side: THREE.DoubleSide,
      roughness: 0.95,
      emissive: new THREE.Color(accent).multiplyScalar(0.05),
      emissiveIntensity: 0.1,
    });
    const cardGeo = new THREE.PlaneGeometry(radius * 2.5, radius * 2.0);
    const cards = hi ? 9 : 6;
    for (let i = 0; i < cards; i++) {
      const card = new THREE.Mesh(cardGeo, leafMat);
      const a = (i / cards) * Math.PI * 2 + Math.random() * 0.8;
      card.position.set(
        Math.cos(a) * radius * (0.25 + Math.random() * 0.45),
        radius * (2.55 + Math.random() * 1.25),
        Math.sin(a) * radius * (0.25 + Math.random() * 0.45)
      );
      card.rotation.set((Math.random() - 0.5) * 0.9, Math.random() * Math.PI, (Math.random() - 0.5) * 0.5);
      // cards don't cast shadows (depth pass ignores alphaTest → ugly slabs)
      canopy.add(card);
    }
    g.add(canopy); g.position.set(x, 0, y);
    this.foliage.push({ mesh: canopy, sway: 0.04 + Math.random() * 0.03, phase: Math.random() * Math.PI * 2 });
    return g;
  }

  private makeRock(x: number, y: number, radius: number, hi: boolean): THREE.Group {
    // Natural boulders: subdivided icosahedra displaced by noise + stone relief.
    const g = new THREE.Group();
    const stone = this.getStoneTexture();
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x858b91, roughness: 0.94, map: stone, bumpMap: stone, bumpScale: 1.6 });
    const main = new THREE.Mesh(jitterGeometry(new THREE.IcosahedronGeometry(radius, 2), radius * 0.16), stoneMat);
    main.scale.set(1, 0.74 + Math.random() * 0.3, 1);
    main.position.y = radius * 0.45;
    main.rotation.set(Math.random(), Math.random() * 3, Math.random());
    main.castShadow = hi; main.receiveShadow = true; g.add(main);
    const cap = new THREE.Mesh(
      jitterGeometry(new THREE.IcosahedronGeometry(radius * 0.72, 1), radius * 0.08),
      new THREE.MeshStandardMaterial({ color: 0x6d854e, roughness: 0.96 })
    );
    cap.position.y = radius * 0.92; cap.scale.y = 0.38; g.add(cap);
    const n = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      const r2 = radius * (0.3 + Math.random() * 0.3);
      const a = Math.random() * Math.PI * 2, d = radius * (0.9 + Math.random() * 0.5);
      const sr = new THREE.Mesh(jitterGeometry(new THREE.IcosahedronGeometry(r2, 1), r2 * 0.18), stoneMat);
      sr.position.set(Math.cos(a) * d, r2 * 0.4, Math.sin(a) * d);
      sr.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      sr.castShadow = hi; g.add(sr);
    }
    g.position.set(x, 0, y);
    return g;
  }

  private makeRuin(x: number, y: number, radius: number, hi: boolean): THREE.Group {
    const g = new THREE.Group();
    const stoneTex = this.getStoneTexture();
    const stone = new THREE.MeshStandardMaterial({ color: 0x6b668a, emissive: 0x17122a, emissiveIntensity: 0.12, roughness: 0.88, map: stoneTex, bumpMap: stoneTex, bumpScale: 1.5 });
    const h = radius * 3.1 * (0.7 + Math.random() * 0.6);
    // Weathered fluted column: smooth, slightly eroded
    const col = new THREE.Mesh(jitterGeometry(new THREE.CylinderGeometry(radius * 0.5, radius * 0.64, h, 14, 5), radius * 0.05), stone);
    col.position.y = h / 2; col.rotation.z = (Math.random() - 0.5) * 0.05;
    col.castShadow = hi; col.receiveShadow = true; g.add(col);
    const base = new THREE.Mesh(jitterGeometry(new THREE.CylinderGeometry(radius * 0.95, radius * 1.1, radius * 0.42, 10), radius * 0.05), stone);
    base.position.y = radius * 0.2; base.castShadow = hi; g.add(base);
    if (Math.random() > 0.4) {
      const cap = new THREE.Mesh(jitterGeometry(new THREE.CylinderGeometry(radius * 0.85, radius * 0.7, radius * 0.5, 10), radius * 0.06), stone);
      cap.position.y = h + radius * 0.2; cap.rotation.y = Math.random(); cap.castShadow = hi; g.add(cap);
    }
    const runeMat = new THREE.MeshStandardMaterial({ color: 0x9b6bff, emissive: 0x9b6bff, emissiveIntensity: 1.7, roughness: 0.4 });
    for (let i = 0; i < 3; i++) {
      const rune = new THREE.Mesh(new THREE.BoxGeometry(2.6, 6, 0.7), runeMat);
      const a = (i / 3) * Math.PI * 2 + 0.4;
      rune.position.set(Math.cos(a) * radius * 0.52, h * (0.3 + i * 0.2), Math.sin(a) * radius * 0.52);
      rune.rotation.y = -a;
      g.add(rune);
    }
    g.position.set(x, 0, y);
    return g;
  }

  private makeWater(x: number, y: number, radius: number): THREE.Mesh {
    const m = new THREE.Mesh(
      new THREE.CircleGeometry(radius, 32),
      new THREE.MeshStandardMaterial({ color: 0x47a6b8, roughness: 0.12, metalness: 0.28, transparent: true, opacity: 0.88, emissive: 0x1b7080, emissiveIntensity: 0.38 })
    );
    m.rotation.x = -Math.PI / 2; m.position.set(x, 1.2, y); m.receiveShadow = true;
    this.waterMeshes.push(m);
    return m;
  }

  private scatterGrass() {
    // grass tuft cards (alpha cutout) instead of geometric spikes
    const blade = new THREE.PlaneGeometry(16, 15);
    blade.translate(0, 7.5, 0);
    const count = this.quality === 'high' ? 5200 : 1400;
    const inst = new THREE.InstancedMesh(blade, new THREE.MeshStandardMaterial({
      map: this.getGrassTexture(), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 1,
    }), count);
    const dummy = new THREE.Object3D(); const col = new THREE.Color();
    let placed = 0;
    for (let i = 0; i < count * 4 && placed < count; i++) {
      const x = Math.random() * WORLD.width, z = Math.random() * WORLD.height;
      if (isBlocked(x, z, 6)) continue;
      const zone = zoneAt(x, z);
      dummy.position.set(x, 0, z);
      dummy.rotation.y = Math.random() * Math.PI;
      const sc = 0.6 + Math.random() * 0.9;
      dummy.scale.set(sc, sc * (0.7 + Math.random() * 0.7), sc);
      dummy.updateMatrix();
      inst.setMatrixAt(placed, dummy.matrix);
      col.set(zone.accent).offsetHSL(0, -0.18, (Math.random() - 0.5) * 0.12);
      inst.setColorAt(placed, col);
      placed++;
    }
    inst.count = placed;
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    this.scene.add(inst);
  }

  private scatterCrystals() {
    for (let i = 0; i < 18; i++) {
      const x = Math.random() * WORLD.width, z = Math.random() * WORLD.height;
      if (isBlocked(x, z, 30)) continue;
      if (distance(x, z, WORLD.sanctum.x, WORLD.sanctum.y) < WORLD.sanctum.r + 120) continue;
      const zone = zoneAt(x, z);
      const hue = zone.id === 'obsidian_ruins' ? 0x9b6bff : zone.id === 'moonfen_marsh' ? 0x49d6c8 : 0x8ad6ff;
      const g = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: hue, emissive: hue, emissiveIntensity: 1.9, roughness: 0.3 });
      const n = 3 + Math.floor(Math.random() * 3);
      for (let j = 0; j < n; j++) {
        const cs = 8 + Math.random() * 12;
        const cryst = new THREE.Mesh(new THREE.OctahedronGeometry(cs, 0), mat);
        const a = Math.random() * Math.PI * 2, d = Math.random() * 22;
        cryst.position.set(Math.cos(a) * d, cs * 0.7, Math.sin(a) * d);
        cryst.rotation.set(Math.random(), Math.random(), Math.random());
        cryst.scale.y = 1.7;
        g.add(cryst);
      }
      const light = new THREE.PointLight(hue, 0.5, 220); light.position.y = 26; g.add(light);
      g.position.set(x, 0, z);
      this.scene.add(g);
    }
  }

  private buildAtmosphere() {
    const count = this.quality === 'high' ? 340 : 90;
    const base = new Float32Array(count * 3);
    const phase = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      base[i * 3] = Math.random() * WORLD.width;
      base[i * 3 + 1] = 18 + Math.random() * 260;
      base[i * 3 + 2] = Math.random() * WORLD.height;
      phase[i] = Math.random() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(base.slice(), 3));
    const mat = new THREE.PointsMaterial({
      size: 13, map: this.makeGlowTexture(), color: 0xffe6a0, transparent: true, opacity: 0.85,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    this.fireflies = pts;
    this.fireflyAnim = { base, phase };
    this.scene.add(pts);
  }

  private makeGlowTexture(): THREE.Texture {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,224,150,0.7)');
    g.addColorStop(1, 'rgba(255,200,90,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  // ---- meshes ---------------------------------------------------------------

  private createEnemyMesh(type: string): THREE.Group {
    const color = ENEMY_COLORS[type] ?? 0xff5252;
    const g = new THREE.Group();
    if (type === 'wisp') {
      const core = new THREE.Mesh(new THREE.IcosahedronGeometry(11, 1),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.9, roughness: 0.2 }));
      core.position.y = 36; core.castShadow = true;
      const flame = new THREE.Mesh(new THREE.ConeGeometry(9, 28, 7),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.52 }));
      flame.position.y = 50; flame.rotation.x = Math.PI;
      const halo = new THREE.Mesh(new THREE.TorusGeometry(18, 1.6, 8, 24),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5 }));
      halo.position.y = 36; halo.rotation.x = Math.PI / 2.4;
      for (let i = 0; i < 3; i++) {
        const mote = new THREE.Mesh(new THREE.SphereGeometry(2.2, 8, 6),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75 }));
        const a = (i / 3) * Math.PI * 2;
        mote.position.set(Math.cos(a) * 19, 35 + i * 4, Math.sin(a) * 19);
        g.add(mote);
      }
      g.add(core, flame, halo);
      const light = new THREE.PointLight(color, 0.9, 210); light.position.y = 36; g.add(light);
    } else if (type === 'bramble_beast') {
      const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).offsetHSL(0, 0.06, 0.12), emissive: 0x233915, emissiveIntensity: 0.16, roughness: 0.94 });
      const body = new THREE.Mesh(new THREE.DodecahedronGeometry(24, 0), bodyMat);
      body.scale.set(1.35, 0.9, 1.05);
      body.position.y = 23; body.castShadow = true; g.add(body);
      const head = new THREE.Mesh(new THREE.DodecahedronGeometry(14, 0), bodyMat);
      head.position.set(18, 28, 8); head.castShadow = true; g.add(head);
      const thornMat = new THREE.MeshStandardMaterial({ color: 0x6d8f2f, emissive: 0x263f12, emissiveIntensity: 0.18, roughness: 1 });
      for (let i = 0; i < 11; i++) {
        const th = new THREE.Mesh(new THREE.ConeGeometry(4, 20, 5), thornMat);
        const a = (i / 11) * Math.PI * 2;
        th.position.set(Math.cos(a) * 24, 25 + Math.sin(i) * 8, Math.sin(a) * 20);
        th.rotation.set(Math.PI / 2, 0, -a); th.castShadow = true; g.add(th);
      }
      for (const side of [-1, 1]) {
        const horn = new THREE.Mesh(new THREE.ConeGeometry(3.2, 18, 6), new THREE.MeshStandardMaterial({ color: 0xa48649, roughness: 1 }));
        horn.position.set(24, 39, side * 8); horn.rotation.set(0, 0, -0.9); g.add(horn);
      }
    } else {
      const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).offsetHSL(0, 0.04, 0.08), emissive: color, emissiveIntensity: 0.48, roughness: 0.46 });
      const body = new THREE.Mesh(new THREE.TetrahedronGeometry(15, 0), bodyMat);
      body.position.y = 18; body.castShadow = true;
      const eyes = new THREE.Mesh(new THREE.SphereGeometry(7, 12, 10), new THREE.MeshStandardMaterial({ color: 0xfff2a8, emissive: 0xffd24a, emissiveIntensity: 0.8 }));
      eyes.position.y = 30;
      for (const side of [-1, 1]) {
        const horn = new THREE.Mesh(new THREE.ConeGeometry(3.2, 15, 5), new THREE.MeshStandardMaterial({ color: 0x2c183a, roughness: 0.7 }));
        horn.position.set(side * 8, 39, 0);
        horn.rotation.z = side * -0.45;
        g.add(horn);
      }
      const staff = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 2, 38, 6), bodyMat);
      staff.position.set(-14, 26, 4); staff.rotation.z = -0.18;
      const rune = new THREE.Mesh(new THREE.TorusGeometry(10, 1.4, 6, 18), new THREE.MeshBasicMaterial({ color: 0xe6b3ff, transparent: true, opacity: 0.8 }));
      rune.position.y = 46; rune.rotation.x = Math.PI / 2;
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(5, 0), new THREE.MeshBasicMaterial({ color: 0xe6b3ff, transparent: true, opacity: 0.95 }));
      crystal.position.set(-14, 49, 4);
      g.add(body, eyes, staff, rune, crystal);
    }
    return g;
  }

  private createUnitMesh(ownerIsLocal: boolean): THREE.Group {
    const g = new THREE.Group();
    const clothColor = ownerIsLocal ? 0xf0c96f : 0x9fc5eb;
    const cloth = new THREE.MeshStandardMaterial({ color: clothColor, emissive: clothColor, emissiveIntensity: 0.12, roughness: 0.72 });
    const leather = new THREE.MeshStandardMaterial({ color: 0x5a3f26, roughness: 0.86 });
    const metal = new THREE.MeshStandardMaterial({ color: 0xd8d1b9, roughness: 0.38, metalness: 0.34 });

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(7, 16, 4, 10), cloth);
    body.position.y = 20; body.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(6, 12, 8), leather);
    head.position.y = 38; head.castShadow = true;
    const helm = new THREE.Mesh(new THREE.CylinderGeometry(6.6, 5.2, 5, 8), metal);
    helm.position.y = 43; helm.castShadow = true;
    const spear = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.6, 44, 6), metal);
    spear.position.set(10, 28, 4); spear.rotation.z = -0.28; spear.castShadow = true;
    const shield = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 6.5, 2.5, 6), metal);
    shield.position.set(-9, 25, 7); shield.rotation.x = Math.PI / 2; shield.castShadow = true;
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(10, 8), new THREE.MeshBasicMaterial({ color: clothColor, side: THREE.DoubleSide }));
    banner.position.set(12, 47, 1);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(11, 14, 20),
      new THREE.MeshBasicMaterial({ color: clothColor, transparent: true, opacity: 0.52, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 1;
    g.add(body, head, helm, spear, shield, banner, ring);
    return g;
  }

  private createResourceMesh(type: ResourceType): THREE.Group {
    const info = RESOURCE_INFO[type];
    const g = new THREE.Group();
    if (type === 'wood') {
      // small choppable tree (talar)
      const stump = new THREE.Mesh(new THREE.CylinderGeometry(9, 10, 6, 8), new THREE.MeshStandardMaterial({ color: 0x8a5a34, roughness: 1 }));
      stump.position.y = 3; g.add(stump);
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 7.5, 32, 7), new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 1 }));
      trunk.position.y = 20; trunk.castShadow = true; g.add(trunk);
      const leafMat = new THREE.MeshStandardMaterial({ color: 0x66bd5b, emissive: 0x1b4a24, emissiveIntensity: 0.12, roughness: 0.96 });
      for (let i = 0; i < 2; i++) {
        const leaf = new THREE.Mesh(new THREE.ConeGeometry(20 - i * 5, 30, 7), leafMat);
        leaf.position.y = 40 + i * 12; leaf.castShadow = true; g.add(leaf);
      }
    } else if (type === 'stone') {
      // ore boulder (minar)
      const rockMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(info.color).offsetHSL(0, -0.02, 0.1), roughness: 0.94 });
      const main = new THREE.Mesh(new THREE.DodecahedronGeometry(15, 0), rockMat);
      main.position.y = 12; main.scale.set(1.1, 0.9, 1); main.castShadow = true; g.add(main);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const r = new THREE.Mesh(new THREE.DodecahedronGeometry(6 - i, 0), rockMat);
        r.position.set(Math.cos(a) * 13, 5, Math.sin(a) * 13); r.castShadow = true; g.add(r);
      }
      const oreMat = new THREE.MeshStandardMaterial({ color: 0xcdd6e0, emissive: 0x7c8aa0, emissiveIntensity: 1.1, roughness: 0.5 });
      for (const p of [[4, 16, 7], [-6, 13, 4], [2, 10, -7]]) {
        const ore = new THREE.Mesh(new THREE.OctahedronGeometry(3, 0), oreMat);
        ore.position.set(p[0], p[1], p[2]); g.add(ore);
      }
    } else {
      // essence / rune_shard: glowing crystal cluster
      const cmat = new THREE.MeshStandardMaterial({ color: info.color, emissive: info.color, emissiveIntensity: 1.5, roughness: 0.2 });
      const c = new THREE.Mesh(new THREE.OctahedronGeometry(11, 0), cmat);
      c.position.y = 24; c.scale.y = 1.5; c.castShadow = true; g.add(c);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const shard = new THREE.Mesh(new THREE.OctahedronGeometry(5, 0), cmat);
        shard.position.set(Math.cos(a) * 10, 12, Math.sin(a) * 10); shard.scale.y = 1.6; g.add(shard);
      }
      const light = new THREE.PointLight(info.color, 0.6, 140); light.position.y = 24; g.add(light);
    }
    const marker = new THREE.Mesh(new THREE.ConeGeometry(5, 18, 5),
      new THREE.MeshBasicMaterial({ color: info.color, transparent: true, opacity: 0.85 }));
    marker.position.y = 46;
    marker.rotation.x = Math.PI;
    g.add(marker);
    const tag = this.makeResourceTag(type, info.color);
    tag.position.set(0, 65, 0);
    g.add(tag);
    // base glow ring
    const ring = new THREE.Mesh(new THREE.RingGeometry(16, 21, 28),
      new THREE.MeshBasicMaterial({ color: info.color, transparent: true, opacity: 0.62, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 1; g.add(ring);
    return g;
  }

  private makeResourceTag(type: ResourceType, color: number): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const label = type === 'rune_shard' ? 'RUNA' : type.toUpperCase();
    const c = `#${color.toString(16).padStart(6, '0')}`;
    ctx.fillStyle = 'rgba(4,8,12,0.76)';
    ctx.strokeStyle = c;
    ctx.lineWidth = 3;
    drawRoundedRect(ctx, 10, 12, 140, 36, 10);
    ctx.fill();
    ctx.stroke();
    ctx.font = 'bold 20px Segoe UI, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = c;
    ctx.fillText(label, 80, 36);
    const tex = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sprite.scale.set(72, 29, 1);
    return sprite;
  }

  private createStructureMesh(type: StructureType): THREE.Group {
    const def = STRUCTURE_DEFS[type];
    const g = new THREE.Group();
    if (type === 'campfire') {
      const stones = new THREE.Mesh(new THREE.TorusGeometry(16, 5, 6, 14), new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 1 }));
      stones.rotation.x = -Math.PI / 2; stones.position.y = 4;
      const fire = new THREE.Mesh(new THREE.ConeGeometry(11, 30, 8), new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.9 }));
      fire.position.y = 18; fire.name = 'fire';
      const light = new THREE.PointLight(def.color, 1.2, def.radius); light.position.y = 24; g.add(light);
      g.add(stones, fire);
      // soft heal-radius ring
      const aura = new THREE.Mesh(new THREE.RingGeometry(def.radius - 4, def.radius, 40), new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.12, side: THREE.DoubleSide }));
      aura.rotation.x = -Math.PI / 2; aura.position.y = 1; g.add(aura);
    } else if (type === 'wall') {
      const mat = new THREE.MeshStandardMaterial({ color: def.color, roughness: 1, map: this.getStoneTexture() });
      const body = new THREE.Mesh(new THREE.BoxGeometry(74, 46, 26), mat);
      body.position.y = 23; body.castShadow = true; body.receiveShadow = true; g.add(body);
      for (let i = -1; i <= 1; i++) {
        const cr = new THREE.Mesh(new THREE.BoxGeometry(16, 12, 26), mat);
        cr.position.set(i * 27, 52, 0); cr.castShadow = true; g.add(cr);
      }
      const seam = new THREE.Mesh(new THREE.BoxGeometry(75, 4, 27), new THREE.MeshStandardMaterial({ color: 0x6f6354, roughness: 1 }));
      seam.position.y = 30; g.add(seam);
    } else if (type === 'barracks') {
      const tent = new THREE.Mesh(new THREE.ConeGeometry(34, 46, 4), new THREE.MeshStandardMaterial({ color: def.color, roughness: 1 }));
      tent.rotation.y = Math.PI / 4; tent.position.y = 23; tent.castShadow = true; g.add(tent);
      const door = new THREE.Mesh(new THREE.BoxGeometry(12, 18, 2), new THREE.MeshStandardMaterial({ color: 0x3a2a18, roughness: 1 }));
      door.position.set(0, 9, 24); g.add(door);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 60, 6), new THREE.MeshStandardMaterial({ color: 0x5a4a32, roughness: 1 }));
      pole.position.set(28, 30, -10); pole.castShadow = true; g.add(pole);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(22, 13), new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 1, side: THREE.DoubleSide }));
      flag.position.set(39, 50, -10); g.add(flag);
      const aura = new THREE.Mesh(new THREE.RingGeometry(def.radius - 4, def.radius, 48), new THREE.MeshBasicMaterial({ color: 0xffcf6a, transparent: true, opacity: 0.07, side: THREE.DoubleSide }));
      aura.rotation.x = -Math.PI / 2; aura.position.y = 1; g.add(aura);
    } else if (type === 'shelter') {
      const base = new THREE.Mesh(new THREE.BoxGeometry(52, 34, 46), new THREE.MeshStandardMaterial({ color: 0xb9a07a, roughness: 1 }));
      base.position.y = 17; base.castShadow = true; base.receiveShadow = true; g.add(base);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(42, 28, 4), new THREE.MeshStandardMaterial({ color: def.color, roughness: 1 }));
      roof.rotation.y = Math.PI / 4; roof.position.y = 48; roof.castShadow = true; g.add(roof);
      const door = new THREE.Mesh(new THREE.BoxGeometry(14, 22, 2), new THREE.MeshStandardMaterial({ color: 0x4a3420, roughness: 1, emissive: 0xffcf6a, emissiveIntensity: 0.6 }));
      door.position.set(0, 11, 24); g.add(door);
      const beacon = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 90, 8), new THREE.MeshBasicMaterial({ color: 0x9fd6ff, transparent: true, opacity: 0.32 }));
      beacon.position.y = 78; g.add(beacon);
      const light = new THREE.PointLight(0xffe0a0, 0.9, 220); light.position.set(0, 26, 0); g.add(light);
      const aura = new THREE.Mesh(new THREE.RingGeometry(def.radius - 4, def.radius, 48), new THREE.MeshBasicMaterial({ color: 0x9fd6ff, transparent: true, opacity: 0.07, side: THREE.DoubleSide }));
      aura.rotation.x = -Math.PI / 2; aura.position.y = 1; g.add(aura);
    } else {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(7, 9, 70, 7), new THREE.MeshStandardMaterial({ color: 0x6b5a3a, roughness: 1 }));
      pole.position.y = 35; pole.castShadow = true;
      const top = new THREE.Mesh(new THREE.OctahedronGeometry(16, 0), new THREE.MeshStandardMaterial({ color: def.color, emissive: def.color, emissiveIntensity: 0.7 }));
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

    const addPlayer = (p: RealmRoomState['players'] extends Map<string, infer P> ? P : never, id: string) => {
      if (this.players.has(id)) return;
      const isLocal = id === this.localId;
      const color = CLASS_COLORS[p.classKey] ?? 0xffffff;
      const group = new THREE.Group();
      group.position.set(p.x, 0, p.y);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(15, 19, 24),
        new THREE.MeshBasicMaterial({ color: isLocal ? 0xffe082 : color, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
      );
      ring.rotation.x = -Math.PI / 2; ring.position.y = 1; group.add(ring);
      if (isLocal) {
        // Hero torch: a warm pool of light that travels with you (Diablo mood).
        const torch = new THREE.PointLight(0xffb46a, 1.9, 340, 1.6);
        torch.position.set(0, 62, 0);
        group.add(torch);
      }
      const label = this.makeLabel();
      label.sprite.position.set(0, 66, 0);
      group.add(label.sprite);
      this.scene.add(group);
      const entity: Entity = { group, target: new THREE.Vector3(p.x, 0, p.y), faceTarget: 0, kind: 'player', name: p.alias, label, lastPos: new THREE.Vector3(p.x, 0, p.y) };
      this.players.set(id, entity);
      // Professional rigged model (KayKit); procedural hero only as fallback.
      void instantiateModel(HERO_MODELS[p.classKey] ?? HERO_MODELS.stag_druid, 46).then((ri) => {
        if (this.disposed || this.players.get(id) !== entity) return;
        if (ri) {
          group.add(ri.group);
          entity.mixer = ri.mixer;
          entity.actions = ri.actions;
          if (isLocal && this.cameraMode === 'first') this.setLocalMeshHidden(true);
        } else {
          const body = buildHeroMesh(p.classKey, isLocal, false);
          entity.rig = body.userData.rig as Rig;
          group.add(body);
        }
      });
      if (isLocal) { this.camTarget.set(p.x, 0, p.y); this.aim.set(p.x, 0, p.y); }
    };
    const removePlayer = (_p: unknown, id: string) => {
      const e = this.players.get(id);
      if (e) { this.scene.remove(e.group); disposeGroup(e.group); this.players.delete(id); }
    };

    $(state).players.onAdd(addPlayer);
    $(state).players.onRemove(removePlayer);
    // onAdd already fires for pre-existing entries; the manual seed is a guarded
    // fallback in case the first state patch hasn't decoded the map yet.
    state.players?.forEach(addPlayer);

    // Realm-only collections. CRITICAL: register onAdd/onRemove unconditionally
    // for realm rooms — gating on `state.enemies` being truthy skipped the
    // registration whenever the first state patch hadn't decoded yet (Render
    // latency), so meshes were never created even though the entities existed in
    // state (you'd take damage / see "F" with nothing visible). onAdd fires for
    // both pre-existing and future entries; the `?.forEach` seed is just a guard.
    if (this.mode === 'realm') {
      const addEnemy = (en: RealmRoomState['enemies'] extends Map<string, infer E> ? E : never, id: string) => {
        if (this.enemies.has(id)) return;
        const group = new THREE.Group();
        group.position.set(en.x, 0, en.y);
        group.userData.pick = { kind: 'enemy', id };
        group.visible = en.isAlive;
        const label = this.makeLabel();
        label.sprite.position.set(0, 64, 0);
        group.add(label.sprite);
        this.scene.add(group);
        const entity: Entity = { group, target: new THREE.Vector3(en.x, 0, en.y), faceTarget: 0, kind: 'enemy', type: en.type, name: ENEMY_NAMES[en.type] ?? en.type, bob: Math.random() * 6, label, lastPos: new THREE.Vector3(en.x, 0, en.y) };
        this.enemies.set(id, entity);
        const modelUrl = ENEMY_MODELS[en.type];
        if (modelUrl) {
          void instantiateModel(modelUrl, ENEMY_MODEL_HEIGHTS[en.type] ?? 48).then((ri) => {
            if (this.disposed || this.enemies.get(id) !== entity) return;
            if (ri) {
              group.add(ri.group);
              entity.mixer = ri.mixer;
              entity.actions = ri.actions;
              entity.bob = undefined; // rigged models don't hover-bob or spin
            } else {
              group.add(this.createEnemyMesh(en.type));
            }
          });
        } else {
          // wisp: a glowing spirit — the procedural ethereal look fits it
          group.add(this.createEnemyMesh(en.type));
        }
      };
      const removeEnemy = (_en: unknown, id: string) => {
        const e = this.enemies.get(id);
        if (e) { this.scene.remove(e.group); disposeGroup(e.group); this.enemies.delete(id); }
      };
      $(state).enemies.onAdd(addEnemy);
      $(state).enemies.onRemove(removeEnemy);
      state.enemies?.forEach(addEnemy);

      const addSanctuary = (s: RealmRoomState['sanctuaries'][number], idx: number) => {
        if (this.sanctuaries.has(String(idx))) return;
        const sm = this.createSanctuaryMesh();
        sm.group.position.set(s.x, 0, s.y);
        this.scene.add(sm.group);
        this.sanctuaries.set(String(idx), sm);
      };
      $(state).sanctuaries.onAdd(addSanctuary);
      state.sanctuaries?.forEach(addSanctuary);

      const addResource = (n: RealmRoomState['resources'] extends Map<string, infer R> ? R : never, id: string) => {
        if (this.resourceMeshes.has(id)) return;
        const g = this.createResourceMesh(n.type as ResourceType);
        g.position.set(n.x, 0, n.y);
        g.userData.pick = { kind: 'resource', id };
        g.visible = n.available;
        this.scene.add(g);
        this.resourceMeshes.set(id, g);
      };
      const removeResource = (_n: unknown, id: string) => {
        const g = this.resourceMeshes.get(id);
        if (g) { this.scene.remove(g); disposeGroup(g); this.resourceMeshes.delete(id); }
      };
      $(state).resources.onAdd(addResource);
      $(state).resources.onRemove(removeResource);
      state.resources?.forEach(addResource);

      const addStructure = (s: RealmRoomState['structures'] extends Map<string, infer S> ? S : never, id: string) => {
        if (this.structureMeshes.has(id)) return;
        const g = this.createStructureMesh(s.type as StructureType);
        g.position.set(s.x, 0, s.y);
        this.scene.add(g);
        this.structureMeshes.set(id, g);
      };
      const removeStructure = (_s: unknown, id: string) => {
        const g = this.structureMeshes.get(id);
        if (g) { this.scene.remove(g); disposeGroup(g); this.structureMeshes.delete(id); }
      };
      $(state).structures.onAdd(addStructure);
      $(state).structures.onRemove(removeStructure);
      state.structures?.forEach(addStructure);

      const addUnit = (u: RealmRoomState['units'] extends Map<string, infer U> ? U : never, id: string) => {
        if (this.units.has(id)) return;
        const group = this.createUnitMesh(u.ownerId === this.localId);
        group.position.set(u.x, 0, u.y);
        group.visible = u.isAlive;
        const label = this.makeLabel();
        label.sprite.position.set(0, 54, 0);
        group.add(label.sprite);
        this.scene.add(group);
        this.units.set(id, {
          group,
          target: new THREE.Vector3(u.x, 0, u.y),
          faceTarget: 0,
          kind: 'unit',
          name: 'Guardia',
          label,
          lastPos: new THREE.Vector3(u.x, 0, u.y),
        });
      };
      const removeUnit = (_u: unknown, id: string) => {
        const unit = this.units.get(id);
        if (unit) { this.scene.remove(unit.group); disposeGroup(unit.group); this.units.delete(id); }
      };
      if (state.units) {
        $(state).units.onAdd(addUnit);
        $(state).units.onRemove(removeUnit);
        state.units.forEach(addUnit);
      }
    }

    this.room.onMessage(MSG.PLAYER_JOINED, (d: { playerId: string; roomCode?: string }) => {
      if (d.playerId === this.localId && d.roomCode) this.roomCode = d.roomCode;
    });
    this.room.onMessage(MSG.DAMAGE_EVENT, (d: { targetId: string; amount: number; isPlayer: boolean }) => {
      this.showDamageFeedback(d.targetId, d.amount, d.isPlayer);
      const target = d.isPlayer ? this.players.get(d.targetId) : this.enemies.get(d.targetId);
      if (target) {
        const p = target.group.position;
        this.spawnBurst(p.x, 42, p.z, d.isPlayer ? 0xff5a4a : 0xffd24a, 10, 95, 5, 0.55);
      }
      if (d.isPlayer && d.targetId === this.localId) this.audio.sfx('hurt');
      else if (!d.isPlayer) this.audio.sfx('hit');
    });
    this.room.onMessage(MSG.ENEMY_DIED, (d: { killerId: string; enemyType?: string }) => {
      this.audio.sfx('die');
      if (d.killerId === this.localId) { this.progressObjective('kill'); this.chron.kills += 1; }
    });
    this.room.onMessage(MSG.RESOURCE_GAINED, (d: { type: ResourceType; loot?: boolean }) => {
      if (!d.loot) { this.progressObjective('gather'); this.audio.sfx('harvest'); }
      this.chron.gathered += 1;
      const info = RESOURCE_INFO[d.type];
      const meEnt = this.players.get(this.localId);
      if (meEnt) this.spawnBurst(meEnt.group.position.x, 34, meEnt.group.position.z, info.color, 9, 75, 4.5, 0.55);
      this.showToast(`+1 ${info.icon} ${info.name}${d.loot ? ' (botín)' : ''}`);
    });
    this.room.onMessage(MSG.STRUCTURE_BUILT, (d: { type: StructureType; ownerId: string }) => {
      if (d.ownerId === this.localId) {
        this.progressObjective('build');
        this.chron.built += 1;
        this.audio.sfx('build');
        // walls fire many builds at once — don't spam a toast per segment
        if (d.type !== 'wall') this.showToast(`${STRUCTURE_DEFS[d.type].icon} ${STRUCTURE_DEFS[d.type].name} construido`);
      }
    });
    this.room.onMessage(MSG.BUILD_DENIED, (d: { reason: string }) => this.showToast(`✗ ${d.reason}`));
    this.room.onMessage(MSG.STRUCTURE_DESTROYED, (d: { type: StructureType; x: number; y: number }) => {
      const def = STRUCTURE_DEFS[d.type];
      this.audio.sfx('crumble');
      this.spawnBurst(d.x, 26, d.y, 0x9a8b73, 26, 130, 6, 0.9);
      this.showToast(`💥 ¡${def?.name ?? 'Construcción'} derribada por el asedio!`);
    });
    this.room.onMessage(MSG.LEVEL_UP, (d: { level: number }) => {
      this.showToast(`⭐ ¡Nivel ${d.level}! +1 punto de mejora — pulsa C`);
      this.audio.sfx('level');
      this.setObjective('level', d.level);
      if (this.charOpen) this.renderCharPanel();
    });
    this.room.onMessage(MSG.WAVE_STARTED, (d: { wave: number }) => {
      this.audio.sfx('horn');
      this.chron.waves += 1;
      this.progressObjective('wave');
      this.showZoneBanner(`☠️ ¡ASEDIO! Oleada ${d.wave}`, '#ff7a5a');
      this.showToast('La horda marcha hacia el santuario — ¡a las murallas!');
    });
    this.room.onMessage(MSG.MATCH_END, () => { /* realm: no end */ });
    this.room.onLeave(() => {
      this.connectionStatus = this.intentionalExit ? 'Saliendo' : 'Desconectado';
      window.setTimeout(() => this.exit(), this.intentionalExit ? 0 : 1200);
    });
  }

  // ---- objectives -----------------------------------------------------------

  private initObjectives() {
    this.objectiveTier = 0;
    this.objectives = this.objectivesForTier(0);
  }

  private objectivesForTier(tier: number): Objective[] {
    if (tier === 0) {
      return [
        { id: 'explore', label: 'Sal del santuario y explora un bioma', goal: 1, progress: 0, done: false },
        { id: 'gather', label: 'Recolecta 5 recursos', goal: 5, progress: 0, done: false },
        { id: 'kill', label: 'Derrota 3 criaturas corruptas', goal: 3, progress: 0, done: false },
        { id: 'build', label: 'Construye tu primera estructura', goal: 1, progress: 0, done: false },
        { id: 'wave', label: 'Resiste tu primer asedio', goal: 1, progress: 0, done: false },
        { id: 'sanctuary', label: 'Captura un santuario', goal: 1, progress: 0, done: false },
      ];
    }
    // Escalating campaign: goals grow each tier.
    const g = (n: number) => Math.round(n * (1 + (tier - 1) * 0.8));
    return [
      { id: 'gather', label: `Reúne ${g(15)} recursos para el reino`, goal: g(15), progress: 0, done: false },
      { id: 'kill', label: `Derrota ${g(10)} criaturas corruptas`, goal: g(10), progress: 0, done: false },
      { id: 'build', label: `Levanta ${g(3)} construcciones del reino`, goal: g(3), progress: 0, done: false },
      { id: 'wave', label: `Resiste ${g(2)} asedios`, goal: g(2), progress: 0, done: false },
      { id: 'level', label: `Alcanza el nivel ${2 + tier}`, goal: 2 + tier, progress: 0, done: false },
    ];
  }

  private maybeEscalateObjectives() {
    if (this.objectives.length > 0 && this.objectives.every((o) => o.done)) {
      this.objectiveTier += 1;
      this.objectives = this.objectivesForTier(this.objectiveTier);
      this.renderObjectives();
      this.showToast('⚔️ ¡Reino afianzado! Nuevos objetivos, más ambiciosos');
    }
  }

  private progressObjective(id: string, amount = 1) {
    const o = this.objectives.find((x) => x.id === id);
    if (!o || o.done) return;
    o.progress = Math.min(o.goal, o.progress + amount);
    if (o.progress >= o.goal) { o.done = true; this.showToast('✓ Objetivo completado'); }
    this.renderObjectives();
    this.maybeEscalateObjectives();
  }

  private setObjective(id: string, value: number) {
    const o = this.objectives.find((x) => x.id === id);
    if (!o || o.done) return;
    o.progress = Math.min(o.goal, value);
    if (o.progress >= o.goal) { o.done = true; this.showToast('✓ Objetivo completado'); }
    this.renderObjectives();
    this.maybeEscalateObjectives();
  }

  // ---- input ----------------------------------------------------------------

  private setupInput() {
    const canvas = this.renderer.domElement;
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointermove', (e) => {
      if (this.cameraMode === 'first') {
        // Drag-look (touch, or mouse when pointer lock is unavailable);
        // locked-mouse look arrives via the document mousemove handler.
        if (this.lookId === e.pointerId && document.pointerLockElement !== canvas) {
          const ldx = e.clientX - this.lookLast.x;
          const ldy = e.clientY - this.lookLast.y;
          this.lookLast = { x: e.clientX, y: e.clientY };
          this.lookMoved += Math.abs(ldx) + Math.abs(ldy);
          this.yaw -= ldx * 0.0062;
          this.pitch = clamp(this.pitch - ldy * 0.005, -1.15, 1.05);
          e.preventDefault();
        }
        return;
      }
      this.updateAim(e);
    });
    canvas.addEventListener('pointerdown', (e) => {
      this.audio.ensure();
      this.updateAim(e);
      if (this.buildMode) {
        if (e.button === 2) { this.cancelBuild(); return; }
        if (this.buildMode === 'wall') { this.wallDragStart = this.groundPoint(e); return; }
        this.confirmBuild();
        return;
      }
      if (this.cameraMode === 'first') {
        const locked = document.pointerLockElement === canvas;
        const coarse = window.matchMedia?.('(pointer: coarse)').matches || e.pointerType === 'touch';
        if (locked) { this.queueBasicAttack(); e.preventDefault(); return; }
        // Not locked: try to capture the mouse (desktop) and start drag-look as
        // a universal fallback; a quick tap/click attacks (resolved on pointerup).
        if (!coarse) this.tryPointerLock();
        this.lookId = e.pointerId;
        this.lookLast = { x: e.clientX, y: e.clientY };
        this.lookMoved = 0;
        this.lookStart = performance.now();
        try { canvas.setPointerCapture(e.pointerId); } catch { /* */ }
        e.preventDefault();
        return;
      }
      // Left/primary click (or tap): clicking an enemy attacks it, a resource
      // harvests it (walking into range first); empty ground just moves.
      // Right-click is a direct attack.
      if (e.button === 2) { this.queueBasicAttack(); return; }
      const picked = this.pickAt(e);
      if (picked?.kind === 'enemy') {
        this.pendingAction = { kind: 'attack', id: picked.id };
        const en = (this.room.state as RealmRoomState).enemies?.get(picked.id);
        if (en) this.spawnMoveMarker(new THREE.Vector3(en.x, 0, en.y), 0xff6a5a);
      } else if (picked?.kind === 'resource') {
        this.pendingAction = { kind: 'harvest', id: picked.id };
        const n = (this.room.state as RealmRoomState).resources?.get(picked.id);
        if (n) this.spawnMoveMarker(new THREE.Vector3(n.x, 0, n.y), 0x7fe3a0);
      } else {
        this.pendingAction = null;
        this.setMoveTargetFromPointer(e);
      }
    });
    canvas.addEventListener('pointerup', (e) => {
      if (this.cameraMode === 'first' && this.lookId === e.pointerId) {
        // quick tap/click = attack — unless this click just captured the mouse
        if (document.pointerLockElement !== canvas && this.lookMoved < 12 && performance.now() - this.lookStart < 320) {
          this.queueBasicAttack();
        }
        this.lookId = null;
        return;
      }
      if (this.buildMode === 'wall' && this.wallDragStart) {
        this.placeWallLine(this.wallDragStart, this.groundPoint(e) ?? this.wallDragStart);
        this.wallDragStart = null;
      }
    });
    const isTouch = window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
    if (isTouch) this.buildTouchControls();
  }

  private queueBasicAttack() { this.queuedAbility = 'basic'; }

  private toggleCamera() {
    const order: Array<'iso' | 'third' | 'first'> = ['iso', 'third', 'first'];
    const prev = this.cameraMode;
    this.cameraMode = order[(order.indexOf(this.cameraMode) + 1) % order.length];
    const labels = { iso: '🎥 Aérea', third: '🎥 3ª pers.', first: '🎥 1ª pers.' } as const;
    const names = { iso: 'Vista aérea', third: 'Vista en tercera persona', first: 'Primera persona — mira con el ratón, clic para atacar' } as const;
    const btn = document.getElementById('cambtn3d');
    if (btn) btn.textContent = labels[this.cameraMode];
    this.showToast(names[this.cameraMode]);
    if (this.cameraMode === 'first') this.enterFirstPerson();
    else if (prev === 'first') this.exitFirstPerson();
  }

  private enterFirstPerson() {
    // Align the look direction with where the hero is facing.
    const me = this.players.get(this.localId);
    if (me) this.yaw = me.group.rotation.y;
    this.pitch = -0.08;
    this.pendingAction = null;
    this.clearMoveTarget();
    this.cancelBuild();
    this.buildFpWeapon();
    if (this.fpWeapon) this.fpWeapon.visible = true;
    this.setLocalMeshHidden(true);
    const cross = document.getElementById('cross3d');
    if (cross) cross.style.display = 'block';
    const coarse = window.matchMedia?.('(pointer: coarse)').matches;
    if (!coarse) {
      // Browsers may deny pointer lock from a keypress — the first click will
      // capture it; until then drag-look works as a fallback.
      this.tryPointerLock();
      this.showToast('1ª persona: clic para capturar el ratón · WASD moverte · V cambia vista');
    }
  }

  private tryPointerLock() {
    try {
      const p = this.renderer.domElement.requestPointerLock?.() as unknown as Promise<void> | undefined;
      p?.catch?.(() => undefined);
    } catch { /* denied — drag-look fallback still works */ }
  }

  private exitFirstPerson() {
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock?.();
    if (this.fpWeapon) this.fpWeapon.visible = false;
    this.setLocalMeshHidden(false);
    const cross = document.getElementById('cross3d');
    if (cross) cross.style.display = 'none';
    this.lookId = null;
  }

  /** Hide the hero's body in first person but keep its lights (torch) alive. */
  private setLocalMeshHidden(hidden: boolean) {
    const me = this.players.get(this.localId);
    if (!me) return;
    me.group.userData.fpHidden = hidden;
    me.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh || (o as THREE.Sprite).isSprite) o.visible = !hidden;
    });
  }

  /** First-person rig: right arm wields the class weapon, left holds a torch. */
  private buildFpWeapon() {
    if (this.fpWeapon) return;
    const key = this.session.classKey;
    const color = CLASS_COLORS[key] ?? 0xffffff;
    const container = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({ color: 0xd8b890, roughness: 0.85 });
    const sleeve = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.42), roughness: 0.92 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x6a4a2c, roughness: 0.9 });
    const metal = new THREE.MeshStandardMaterial({ color: 0xc8d4de, roughness: 0.35, metalness: 0.5 });
    const glow = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.6, roughness: 0.3 });

    const mkArm = (side: 1 | -1): THREE.Group => {
      const arm = new THREE.Group();
      const fore = new THREE.Mesh(new THREE.CapsuleGeometry(1.5, 7.5, 4, 12), sleeve);
      fore.rotation.x = -1.05;
      fore.rotation.z = side * 0.18;
      fore.position.set(side * 0.4, -2.2, 2.6);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(1.8, 14, 10), skin);
      hand.position.set(0, 1.4, -1.4);
      arm.add(fore, hand);
      arm.position.set(side * 8, -8.2, -16);
      container.add(arm);
      return arm;
    };
    this.fpRight = mkArm(1);
    this.fpLeft = mkArm(-1);

    // class weapon in the right hand
    const weapon = new THREE.Group();
    if (key === 'wolf_guardian') {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(1.2, 13, 1.8), metal);
      blade.position.y = 9.5;
      const guard = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.9, 2.2), metal);
      guard.position.y = 3.2;
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 4, 8), wood);
      grip.position.y = 1;
      weapon.add(blade, guard, grip);
    } else if (key === 'fox_trickster') {
      const blade = new THREE.Mesh(new THREE.ConeGeometry(1.1, 9, 8), metal);
      blade.position.y = 7.5;
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 3.6, 8), wood);
      grip.position.y = 1.4;
      weapon.add(blade, grip);
    } else {
      const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.75, 16, 9), wood);
      staff.position.y = 5;
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(1.7, 1), glow);
      gem.position.y = 13.6;
      const gemLight = new THREE.PointLight(color, 0.5, 60);
      gemLight.position.y = 13.6;
      weapon.add(staff, gem, gemLight);
    }
    weapon.position.set(0, 1.6, -1.4);
    weapon.rotation.set(0.3, 0, -0.08);
    this.fpRight.add(weapon);

    // torch in the left hand — your travelling pool of light made visible
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 8, 8), wood);
    stick.position.set(0, 4.4, -1.4);
    stick.rotation.z = 0.1;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.75, 1.6, 8), new THREE.MeshStandardMaterial({ color: 0x3a322a, roughness: 1 }));
    cap.position.set(0, 8.2, -1.4);
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(1.3, 4.2, 8),
      new THREE.MeshBasicMaterial({ color: 0xff9a3a, transparent: true, opacity: 0.95 })
    );
    flame.name = 'fpflame';
    flame.position.set(0, 10.4, -1.4);
    const torchLight = new THREE.PointLight(0xffb46a, 0.85, 90, 1.4);
    torchLight.name = 'fptorchlight';
    torchLight.position.set(0, 10.4, -1.4);
    this.fpLeft.add(stick, cap, flame, torchLight);

    container.visible = false;
    this.fpWeapon = container;
    this.camera.add(container);
  }

  private handleLockChange() {
    // Browser kicked us out of pointer lock (Esc); stay in FP — a click re-locks.
    if (this.cameraMode === 'first' && document.pointerLockElement !== this.renderer.domElement) {
      this.showToast('Clic en el mundo para volver a capturar el ratón');
    }
  }

  private groundPoint(e: PointerEvent): THREE.Vector3 | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, hit)) return null;
    hit.x = clamp(hit.x, 30, WORLD.width - 30);
    hit.z = clamp(hit.z, 30, WORLD.height - 30);
    return hit;
  }

  private setMoveTargetFromPointer(e: PointerEvent) {
    const hit = this.groundPoint(e);
    if (!hit) return;
    this.moveTarget = hit;
    this.spawnMoveMarker(hit, 0xffe082);
  }

  /** Raycast enemies + resource nodes under the pointer. */
  private pickAt(e: PointerEvent): { kind: 'enemy' | 'resource'; id: string } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const targets: THREE.Object3D[] = [];
    this.enemies.forEach((en) => { if (en.group.visible) targets.push(en.group); });
    this.resourceMeshes.forEach((g) => { if (g.visible) targets.push(g); });
    const hits = this.raycaster.intersectObjects(targets, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o) {
        const pick = o.userData?.pick as { kind: 'enemy' | 'resource'; id: string } | undefined;
        if (pick) return pick;
        o = o.parent;
      }
    }
    return null;
  }

  /** Linear wall: lay segments from start→end, capped by the player's stone. */
  private placeWallLine(start: THREE.Vector3, end: THREE.Vector3) {
    const state = this.room.state as RealmRoomState;
    const mine = state.players?.get(this.localId);
    const stone = mine ? (mine.stone ?? 0) : 0;
    const cost = STRUCTURE_DEFS.wall.cost.stone ?? 1;
    const affordable = Math.floor(stone / cost);
    if (affordable < 1) { this.showToast('✗ Sin piedra para el muro'); this.cancelBuild(); return; }
    const dx = end.x - start.x, dz = end.z - start.z;
    const len = Math.hypot(dx, dz);
    const spacing = 52;
    let count = Math.max(1, Math.round(len / spacing) + 1);
    count = Math.min(count, affordable, 16);
    const ux = len > 0 ? dx / len : 0, uz = len > 0 ? dz / len : 0;
    for (let i = 0; i < count; i++) {
      this.room.send(MSG.BUILD, { structureType: 'wall', x: start.x + ux * spacing * i, y: start.z + uz * spacing * i });
    }
    this.showToast(`🧱 Alzando muralla (${count} tramos)`);
    this.cancelBuild();
    const menu = document.getElementById('build3d'); if (menu) menu.style.display = 'none';
  }

  private spawnMoveMarker(p: THREE.Vector3, color = 0xffe082) {
    if (!this.moveMarker) {
      this.moveMarker = new THREE.Mesh(
        new THREE.RingGeometry(10, 16, 28),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
      );
      this.moveMarker.rotation.x = -Math.PI / 2;
      this.scene.add(this.moveMarker);
    }
    (this.moveMarker.material as THREE.MeshBasicMaterial).color.setHex(color);
    this.moveMarker.position.set(p.x, 2, p.z);
    this.moveMarker.visible = true;
    this.moveMarker.scale.setScalar(1);
  }

  private setupNavigationGuards() {
    try {
      window.history.pushState({ fmrGame: true }, '', window.location.href);
    } catch {
      // Some embedded browsers disallow history mutation; the game still works.
    }
    window.addEventListener('popstate', this.onPopState);
  }

  private handleBrowserBack() {
    if (this.disposed) return;
    try {
      window.history.pushState({ fmrGame: true }, '', window.location.href);
    } catch {
      // Ignore; opening settings is still useful when the event reaches us.
    }
    this.openSettings('La navegación del sistema no sale directamente de una partida online.');
  }

  private handleKey(code: string, down: boolean) {
    this.keys[code] = down;
    if (!down) return;
    this.audio.ensure();
    if (code === 'KeyM') { const m = this.audio.toggleMute(); this.showToast(m ? '🔇 Sonido silenciado (M)' : '🔊 Sonido activado'); return; }
    if (code === 'Escape' && this.settingsOpen) this.closeSettings();
    else if (code === 'Escape' && this.charOpen) this.toggleCharPanel();
    else if (code === 'KeyC') this.toggleCharPanel();
    else if (code === 'KeyF') this.tryHarvest();
    else if (code === 'KeyB') this.toggleBuildMenu();
    else if (code === 'KeyV') this.toggleCamera();
    else if (code === 'Digit1') this.selectBuild('campfire');
    else if (code === 'Digit2') this.selectBuild('totem');
    else if (code === 'Digit3') this.selectBuild('wall');
    else if (code === 'Digit4') this.selectBuild('barracks');
    else if (code === 'Digit5') this.selectBuild('shelter');
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
    if (this.cameraMode === 'first') {
      // FP: W follows the look direction; A/D strafe.
      let fwd = 0, strafe = 0;
      if (this.keys['KeyW'] || this.keys['ArrowUp']) fwd += 1;
      if (this.keys['KeyS'] || this.keys['ArrowDown']) fwd -= 1;
      if (this.keys['KeyD'] || this.keys['ArrowRight']) strafe += 1;
      if (this.keys['KeyA'] || this.keys['ArrowLeft']) strafe -= 1;
      fwd += -this.joyDy; strafe += this.joyDx;
      // right = forward × up = (-cos(yaw), sin(yaw)) on the ground plane
      const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
      dx = sy * fwd - cy * strafe;
      dy = cy * fwd + sy * strafe;
    } else {
      if (this.keys['KeyA'] || this.keys['ArrowLeft']) dx -= 1;
      if (this.keys['KeyD'] || this.keys['ArrowRight']) dx += 1;
      if (this.keys['KeyW'] || this.keys['ArrowUp']) dy -= 1;
      if (this.keys['KeyS'] || this.keys['ArrowDown']) dy += 1;
      dx += this.joyDx; dy += this.joyDy;
    }

    // Manual input (keys/joystick) cancels click commands; otherwise resolve the
    // pending Diablo-style action (chase enemy / walk to resource) into steering.
    let forcedAttack = false;
    if (dx !== 0 || dy !== 0) {
      this.pendingAction = null;
      this.clearMoveTarget();
    } else if (this.pendingAction) {
      const state = this.room.state as RealmRoomState;
      const meEnt = this.players.get(this.localId);
      const pa = this.pendingAction;
      if (meEnt && pa.kind === 'attack') {
        const en = state.enemies?.get(pa.id);
        if (!en || !en.isAlive) { this.pendingAction = null; this.clearMoveTarget(); }
        else {
          const range = (state.players?.get(this.localId)?.attackRange ?? 90) * 0.95;
          const d = Math.hypot(en.x - meEnt.group.position.x, en.y - meEnt.group.position.z);
          if (d > range) {
            this.moveTarget = new THREE.Vector3(en.x, 0, en.y);
            if (this.moveMarker?.visible) this.moveMarker.position.set(en.x, 2, en.y);
          } else { this.clearMoveTarget(); forcedAttack = true; }
        }
      } else if (meEnt && pa.kind === 'harvest') {
        const n = state.resources?.get(pa.id);
        if (!n || !n.available) { this.pendingAction = null; this.clearMoveTarget(); }
        else {
          const d = Math.hypot(n.x - meEnt.group.position.x, n.y - meEnt.group.position.z);
          if (d > HARVEST_RANGE * 0.9) this.moveTarget = new THREE.Vector3(n.x, 0, n.y);
          else { this.clearMoveTarget(); this.tryHarvest(); }
        }
      }
    }
    if (this.moveTarget) {
      const me = this.players.get(this.localId);
      if (me) {
        const tx = this.moveTarget.x - me.group.position.x;
        const tz = this.moveTarget.z - me.group.position.z;
        const d = Math.hypot(tx, tz);
        if (d < 26) this.clearMoveTarget();
        else { dx = tx / d; dy = tz / d; }
      }
    }

    let abilityKey: AbilityKey | null = null;
    if (this.queuedAbility) { abilityKey = this.queuedAbility; this.queuedAbility = null; }
    else if (this.keys['KeyJ'] || this.keys['Space'] || forcedAttack) abilityKey = 'basic';
    else if (this.keys['KeyQ']) abilityKey = 'q';
    else if (this.keys['KeyE']) abilityKey = 'e';
    else if (this.keys['KeyR']) abilityKey = 'r';

    if (dx === 0 && dy === 0 && abilityKey === null) return null;
    if (abilityKey) {
      const me = this.players.get(this.localId);
      if (me?.rig) me.rig.attack = 1;
      if (this.cameraMode === 'first') this.fpSwing = 1;
      const nowMs = performance.now();
      if (nowMs - this.lastAbilitySfx > 380) {
        this.lastAbilitySfx = nowMs;
        this.audio.sfx(abilityKey === 'basic' ? 'attack' : 'ability');
      }
    }
    // FP aims everything at the crosshair; otherwise damage abilities auto-aim
    // the nearest foe and movement abilities (E) head to the cursor / last tap.
    const aim = this.cameraMode === 'first' ? this.aim
      : abilityKey === 'e' ? this.aim
      : abilityKey ? this.autoAim() : this.aim;
    return { seq: this.seq++, dx, dy, abilityKey, aimX: aim.x, aimY: aim.z, timestamp: Date.now() };
  }

  private clearMoveTarget() {
    this.moveTarget = null;
    if (this.moveMarker) this.moveMarker.visible = false;
  }

  // ---- harvest + build ------------------------------------------------------

  private tryHarvest() {
    if (this.nearestNodeId) {
      this.room.send(MSG.HARVEST, { nodeId: this.nearestNodeId });
    } else if (this.nearestRepairId) {
      this.room.send(MSG.REPAIR, { structureId: this.nearestRepairId });
      this.audio.sfx('build');
    }
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
    this.showToast(type === 'wall'
      ? '🧱 Arrastra sobre el suelo para alzar la muralla (según tu piedra)'
      : `Coloca: ${def.icon} ${def.name} (clic para confirmar, clic der./Esc cancela)`);
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

  /** Crossfade idle/walk + one-shot attacks on a GLB skeletal model. */
  private driveMixer(e: Entity, moving: boolean, speed: number, dt: number) {
    if (!e.mixer || !e.actions) return;
    const desired: 'idle' | 'walk' = moving ? 'walk' : 'idle';
    if (e.animName !== desired) {
      const next = e.actions[desired] ?? e.actions.idle;
      const prev = e.animName ? e.actions[e.animName] : undefined;
      if (next && next !== prev) {
        next.reset().fadeIn(0.16).play();
        prev?.fadeOut(0.16);
      }
      e.animName = desired;
    }
    if (e.actions.walk && moving) e.actions.walk.timeScale = clamp(speed / 150, 0.7, 1.8);
    if (e.serverAnim === 'attack' && e.actions.attack) {
      const nowMs = performance.now();
      if (nowMs - (e.lastAttackPlay ?? 0) > 650) {
        e.lastAttackPlay = nowMs;
        e.actions.attack.reset().fadeIn(0.06).play();
      }
    }
    e.mixer.update(dt);
  }

  private animateRig(e: Entity, dt: number, time: number) {
    const cur = e.group.position;
    if (!e.lastPos) e.lastPos = cur.clone();
    const pdx = cur.x - e.lastPos.x, pdz = cur.z - e.lastPos.z;
    const pSpeed = Math.hypot(pdx, pdz) / Math.max(dt, 0.001);
    if (e.mixer) {
      e.lastPos.set(cur.x, cur.y, cur.z);
      cur.y = 0;
      this.driveMixer(e, pSpeed > 8, pSpeed, dt);
      return;
    }
    const rig = e.rig; if (!rig) return;
    const speed = pSpeed;
    e.lastPos.set(cur.x, cur.y, cur.z);
    const moving = speed > 8;
    const amt = Math.min(speed / 170, 1);
    rig.stride += dt * (moving ? 9 + amt * 4 : 0);
    const swing = moving ? Math.sin(rig.stride) * (0.45 + amt * 0.5) : 0;
    if (rig.legL) rig.legL.rotation.x = swing;
    if (rig.legR) rig.legR.rotation.x = -swing;
    if (rig.armL) rig.armL.rotation.x = -swing * 0.7;
    if (rig.torso) rig.torso.rotation.x = Math.sin(time * 1.6 + rig.phase) * 0.05;
    cur.y = moving ? Math.abs(Math.sin(rig.stride)) * 3 : Math.sin(time * 1.6 + rig.phase) * 1.2;
    if (rig.attack > 0) {
      rig.attack = Math.max(0, rig.attack - dt * 3.4);
      const a = Math.sin((1 - rig.attack) * Math.PI);
      if (rig.armR) rig.armR.rotation.x = -a * 2.1;
    } else if (rig.armR) {
      rig.armR.rotation.x = swing * 0.7;
    }
  }

  /** Short-lived gravity particle burst (impacts, harvests, rubble). */
  private spawnBurst(x: number, y: number, z: number, color: number, count = 12, speed = 90, size = 5, ttl = 0.65) {
    if (!this.glowTex) this.glowTex = this.makeGlowTexture();
    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.4 + Math.random() * 0.8);
      vel[i * 3] = Math.cos(a) * sp;
      vel[i * 3 + 1] = (0.45 + Math.random() * 0.9) * sp;
      vel[i * 3 + 2] = Math.sin(a) * sp;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color, size, map: this.glowTex, transparent: true, opacity: 0.95,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    this.scene.add(pts);
    this.bursts.push({ pts, vel, age: 0, ttl });
  }

  private updateBursts(dt: number) {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.age += dt;
      const attr = b.pts.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let j = 0; j < attr.count; j++) {
        b.vel[j * 3 + 1] -= 260 * dt;
        attr.setXYZ(j,
          attr.getX(j) + b.vel[j * 3] * dt,
          Math.max(2, attr.getY(j) + b.vel[j * 3 + 1] * dt),
          attr.getZ(j) + b.vel[j * 3 + 2] * dt);
      }
      attr.needsUpdate = true;
      (b.pts.material as THREE.PointsMaterial).opacity = Math.max(0, 0.95 * (1 - b.age / b.ttl));
      if (b.age >= b.ttl) {
        this.scene.remove(b.pts);
        b.pts.geometry.dispose();
        (b.pts.material as THREE.PointsMaterial).dispose();
        this.bursts.splice(i, 1);
      }
    }
  }

  /** Day/night: lights, fog and sky follow the shared cycle (night = siege). */
  private applyDayNight(nf: number, time: number) {
    this.curNight = nf;
    if (this.sunLight) this.sunLight.intensity = 1.85 - nf * 1.45;
    if (this.hemiLight) this.hemiLight.intensity = 0.7 - nf * 0.46;
    if (this.ambLight) this.ambLight.intensity = 0.36 - nf * 0.2;
    if (this.rimLight) this.rimLight.intensity = 0.78 - nf * 0.4;
    const fog = this.scene.fog as THREE.FogExp2 | null;
    if (fog && 'density' in fog) fog.density = 0.00082 + nf * 0.0005;
    if (this.skyMat) this.skyMat.color.setScalar(1 - nf * 0.52);
    void time;
    const nightOn = nf > 0.55;
    if (nightOn !== this.lastNightOn) {
      this.lastNightOn = nightOn;
      this.showZoneBanner(nightOn ? '🌙 Cae la noche…' : '🌅 Amanece sobre el reino', nightOn ? '#9fb8ff' : '#ffd98a');
    }
  }

  private animateAmbient(time: number) {
    for (const f of this.foliage) {
      f.mesh.rotation.z = Math.sin(time * 0.8 + f.phase) * f.sway;
      f.mesh.rotation.x = Math.cos(time * 0.6 + f.phase) * f.sway * 0.6;
    }
    for (const w of this.waterMeshes) {
      w.position.y = 1.2 + Math.sin(time * 1.4 + w.position.x * 0.01) * 1.1;
      (w.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.4 + Math.sin(time * 2 + w.position.z * 0.01) * 0.2;
    }
    if (this.fireflies && this.fireflyAnim) {
      const attr = this.fireflies.geometry.getAttribute('position') as THREE.BufferAttribute;
      const { base, phase } = this.fireflyAnim;
      for (let i = 0; i < phase.length; i++) {
        attr.setXYZ(i,
          base[i * 3] + Math.cos(time * 0.4 + phase[i]) * 10,
          base[i * 3 + 1] + Math.sin(time * 0.7 + phase[i]) * 14,
          base[i * 3 + 2] + Math.sin(time * 0.3 + phase[i]) * 10);
      }
      attr.needsUpdate = true;
      // fireflies come alive at night
      (this.fireflies.material as THREE.PointsMaterial).opacity = (0.7 + Math.sin(time * 2) * 0.15) * (0.45 + 0.55 * this.curNight);
    }
    for (const b of this.braziers) {
      const f = 0.78 + Math.sin(time * 11 + b.phase) * 0.13 + Math.sin(time * 23 + b.phase) * 0.06;
      // braziers burn brighter under night skies
      b.light.intensity = b.base * f * (1 + 0.5 * this.curNight);
      const sc = 0.85 + f * 0.3;
      b.flame.scale.set(sc, 1 + (f - 0.8) * 1.7, sc);
    }
    if (this.moveMarker && this.moveMarker.visible) {
      const k = 1 + Math.sin(time * 6) * 0.18;
      this.moveMarker.scale.set(k, k, k);
      this.moveMarker.rotation.z += 0.04;
      (this.moveMarker.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(time * 6) * 0.3;
    }
  }

  private loop = () => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const time = this.clock.elapsedTime;
    const state = this.room.state as RealmRoomState;

    state.players?.forEach((p, id) => {
      const e = this.players.get(id);
      if (!e) return;
      e.target.set(p.x, 0, p.y);
      e.group.visible = p.isAlive;
      e.serverAnim = p.animState;
      e.faceTarget = p.direction === 'up' ? Math.PI : p.direction === 'left' ? -Math.PI / 2 : p.direction === 'right' ? Math.PI / 2 : 0;
      if (e.label) this.drawLabel(e.label, p.alias, clamp(p.hp / p.maxHp, 0, 1), id === this.localId ? '#ffe082' : '#cfe8ff');
    });
    state.enemies?.forEach((en, id) => {
      const e = this.enemies.get(id);
      if (!e) return;
      e.target.set(en.x, 0, en.y);
      e.group.visible = en.isAlive;
      e.serverAnim = en.animState;
      if (e.label) {
        e.label.sprite.visible = en.isAlive;
        this.drawLabel(e.label, e.name ?? 'Enemy', clamp(en.hp / en.maxHp, 0, 1), '#ffd2d2');
      }
    });
    state.units?.forEach((u, id) => {
      const e = this.units.get(id);
      if (!e) return;
      e.target.set(u.x, 0, u.y);
      e.group.visible = u.isAlive;
      if (e.label) {
        e.label.sprite.visible = u.isAlive;
        this.drawLabel(e.label, e.name ?? 'Guardia', clamp(u.hp / u.maxHp, 0, 1), u.ownerId === this.localId ? '#ffe6a8' : '#b8d7ff');
      }
    });

    this.players.forEach((e) => {
      e.group.position.lerp(e.target, 1 - Math.pow(0.0001, dt));
      e.group.rotation.y = lerpAngle(e.group.rotation.y, e.faceTarget, 1 - Math.pow(0.001, dt));
      this.animateRig(e, dt, time);
    });
    this.enemies.forEach((e) => {
      const oldX = e.group.position.x;
      const oldZ = e.group.position.z;
      e.group.position.lerp(e.target, 1 - Math.pow(0.0006, dt));
      const dx = e.group.position.x - oldX;
      const dz = e.group.position.z - oldZ;
      if (Math.hypot(dx, dz) > 0.03) e.faceTarget = Math.atan2(dx, dz);
      if (e.mixer) {
        // rigged skeleton: walk/idle/attack clips, face the way it moves
        e.group.rotation.y = lerpAngle(e.group.rotation.y, e.faceTarget, 1 - Math.pow(0.0012, dt));
        const sp = Math.hypot(dx, dz) / Math.max(dt, 0.001);
        this.driveMixer(e, sp > 6, sp, dt);
        return;
      }
      if (e.bob !== undefined) { e.bob += dt * 3; e.group.position.y = e.type === 'wisp' ? Math.sin(e.bob) * 6 + 4 : Math.sin(e.bob) * 2; }
      const pulse = 1 + Math.sin(time * (e.type === 'bramble_beast' ? 3.2 : 5.2) + e.group.position.x * 0.02) * 0.035;
      e.group.scale.set(pulse, pulse, pulse);
      if (e.type === 'rune_imp') {
        e.group.rotation.y += dt * 1.15;
      } else {
        e.group.rotation.y = lerpAngle(e.group.rotation.y, e.faceTarget, 1 - Math.pow(0.0012, dt));
      }
    });
    this.units.forEach((e) => {
      const old = e.group.position.clone();
      e.group.position.lerp(e.target, 1 - Math.pow(0.0008, dt));
      const dx = e.group.position.x - old.x;
      const dz = e.group.position.z - old.z;
      if (Math.hypot(dx, dz) > 0.02) e.faceTarget = Math.atan2(dx, dz);
      e.group.rotation.y = lerpAngle(e.group.rotation.y, e.faceTarget, 1 - Math.pow(0.001, dt));
      e.group.position.y = Math.sin(time * 7 + e.group.position.x * 0.02) * 1.2;
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
    if (this.cameraMode === 'first' && me) {
      if (!me.group.userData.fpHidden) this.setLocalMeshHidden(true);
      const stride = me.rig?.stride ?? 0;
      const eye = 50 + Math.sin(stride) * 1.3;
      this.camera.position.set(me.group.position.x, me.group.position.y + eye, me.group.position.z);
      const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
      const dir = new THREE.Vector3(Math.sin(this.yaw) * cp, sp, Math.cos(this.yaw) * cp);
      this.camera.lookAt(
        this.camera.position.x + dir.x,
        this.camera.position.y + dir.y,
        this.camera.position.z + dir.z
      );
      this.camTarget.copy(me.group.position);
      // crosshair aim: project the look ray onto the ground
      this.raycaster.set(this.camera.position, dir);
      const hit = new THREE.Vector3();
      if (this.raycaster.ray.intersectPlane(this.groundPlane, hit)) this.aim.copy(hit);
      else this.aim.set(me.group.position.x + dir.x * 400, 0, me.group.position.z + dir.z * 400);
      // viewmodel: arm sway + walk bob, right-arm attack swing, torch flicker
      if (this.fpWeapon) {
        this.fpWeapon.position.set(
          Math.sin(stride) * 0.4,
          Math.abs(Math.cos(stride)) * 0.5 + Math.sin(time * 1.7) * 0.15,
          0
        );
        if (this.fpRight) {
          if (this.fpSwing > 0) {
            this.fpSwing = Math.max(0, this.fpSwing - dt * 4.2);
            const a = Math.sin((1 - this.fpSwing) * Math.PI);
            this.fpRight.rotation.set(-a * 1.35, a * 0.35, 0);
            this.fpRight.position.z = -16 + a * 3.5;
          } else {
            this.fpRight.rotation.set(Math.sin(stride) * 0.05, 0, 0);
            this.fpRight.position.z = -16;
          }
        }
        if (this.fpLeft) this.fpLeft.rotation.x = Math.sin(stride + Math.PI) * 0.05;
        const fl = this.fpWeapon.getObjectByName('fpflame');
        if (fl) {
          const k = 0.85 + Math.sin(time * 12.7) * 0.18 + Math.sin(time * 23) * 0.08;
          fl.scale.set(k, 1 + (k - 0.85) * 1.5, k);
        }
        const tl = this.fpWeapon.getObjectByName('fptorchlight') as THREE.PointLight | null;
        if (tl) tl.intensity = (0.7 + 0.45 * this.curNight) * (0.85 + 0.25 * Math.sin(time * 11.3));
      }
    } else if (this.cameraMode === 'third' && me) {
      const ang = me.group.rotation.y;
      const fx = Math.sin(ang), fz = Math.cos(ang);
      const desired = new THREE.Vector3(this.camTarget.x - fx * 250, 178, this.camTarget.z - fz * 250);
      this.camera.position.lerp(desired, 1 - Math.pow(0.0022, dt));
      this.camera.lookAt(this.camTarget.x + fx * 130, 48, this.camTarget.z + fz * 130);
    } else {
      const desired = new THREE.Vector3(this.camTarget.x, 620, this.camTarget.z + 470);
      this.camera.position.lerp(desired, 1 - Math.pow(0.0009, dt));
      this.camera.lookAt(this.camTarget.x, 20, this.camTarget.z - 40);
    }

    // nearest harvestable + build ghost + zone
    this.updateInteraction(me);

    // send input
    this.inputAccum += dt * 1000;
    if (this.inputAccum >= 50) {
      this.inputAccum = 0;
      const input = this.collectInput();
      if (input) this.room.send(MSG.PLAYER_INPUT, input);
    }

    // Day/night cycle (night falls with each siege wave)
    this.applyDayNight(nightFactor(state.elapsedMs ?? 0), time);

    // Structure damage feedback: rubble sparks when sieges chip at walls
    state.structures?.forEach((s, id) => {
      const prev = this.structHp.get(id);
      if (prev !== undefined && s.hp < prev) {
        this.spawnBurst(s.x, 30, s.y, 0xb0a48c, 8, 80, 4.5, 0.5);
      }
      this.structHp.set(id, s.hp);
    });

    this.updateBursts(dt);
    this.animateAmbient(time);
    this.updateHUD();
    if (this.composer) this.composer.render(); else this.renderer.render(this.scene, this.camera);
  };

  private updateInteraction(me: Entity | undefined) {
    const state = this.room.state as RealmRoomState;
    if (!me) return;
    const mx = me.group.position.x, mz = me.group.position.z;

    // nearest available resource node
    this.nearestNodeId = null;
    this.nearestNodeType = null;
    let bestD = HARVEST_RANGE;
    state.resources?.forEach((n, id) => {
      if (!n.available) return;
      const d = distance(mx, mz, n.x, n.y);
      if (d < bestD) { bestD = d; this.nearestNodeId = id; this.nearestNodeType = n.type as ResourceType; }
    });

    // nearest damaged structure (repairable with stone)
    this.nearestRepairId = null;
    let bestR = REPAIR_RANGE * 0.9;
    state.structures?.forEach((s, id) => {
      if (s.hp >= s.maxHp) return;
      const d = distance(mx, mz, s.x, s.y);
      if (d < bestR) {
        bestR = d;
        this.nearestRepairId = id;
        const def = STRUCTURE_DEFS[s.type as StructureType];
        this.nearestRepairLabel = `${def?.name ?? s.type} ${Math.round((s.hp / s.maxHp) * 100)}%`;
      }
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
        #game-hud3d .panel { position:absolute; top:10px; left:10px; background:rgba(14,11,8,0.62);
          border:1px solid rgba(255,216,138,0.26); border-radius:10px; padding:8px 12px; backdrop-filter:blur(5px); min-width:236px; }
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
        #game-hud3d #obj3d{position:absolute;top:10px;right:10px;background:rgba(14,11,8,.62);border:1px solid rgba(255,216,138,.26);
          border-radius:10px;padding:9px 12px;backdrop-filter:blur(5px);min-width:210px;max-width:250px}
        #game-hud3d #obj3d h4{font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#ffd76a;margin-bottom:5px}
        #game-hud3d #obj3d ul{list-style:none;font-size:12px;line-height:1.45}
        #game-hud3d #obj3d li.done{color:#7ee787;text-decoration:line-through;opacity:.7}
        #game-hud3d #zone3d{position:absolute;top:64px;left:50%;transform:translateX(-50%);font-size:22px;font-weight:800;
          text-shadow:0 2px 14px rgba(0,0,0,.8);opacity:0;transition:opacity .5s;letter-spacing:1px}
        #game-hud3d #toast3d{position:absolute;bottom:150px;left:50%;transform:translateX(-50%);background:rgba(10,16,26,.8);
          border:1px solid rgba(255,255,255,.2);border-radius:8px;padding:7px 16px;font-size:14px;opacity:0;transition:opacity .25s}
        #game-hud3d #mini3d{position:absolute;bottom:12px;right:12px;border:1px solid rgba(255,216,138,.3);border-radius:6px;background:rgba(0,0,0,.45);pointer-events:auto;cursor:crosshair}
        #game-hud3d #hint3d{position:absolute;bottom:130px;left:50%;transform:translateX(-50%);font-size:13px;background:rgba(0,0,0,.5);
          border:1px solid rgba(255,255,255,.2);border-radius:8px;padding:5px 12px;display:none}
        #game-hud3d #back3d{position:absolute;top:10px;left:50%;transform:translateX(-50%);pointer-events:auto;background:rgba(10,16,26,.6);
          color:#fff;border:1px solid rgba(255,255,255,.3);border-radius:8px;padding:6px 14px;font-size:13px;cursor:pointer}
        #game-hud3d #settingsbtn3d{position:absolute;top:10px;right:12px;pointer-events:auto;background:rgba(10,16,26,.6);
          color:#fff;border:1px solid rgba(255,255,255,.3);border-radius:8px;padding:6px 14px;font-size:13px;cursor:pointer}
        #game-hud3d #cambtn3d{position:absolute;bottom:52px;left:12px;pointer-events:auto;background:rgba(10,16,26,.6);
          color:#fff;border:1px solid rgba(255,255,255,.3);border-radius:8px;padding:6px 14px;font-size:13px;cursor:pointer}
        #game-hud3d #respawn3d{position:absolute;top:44%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,.78);
          color:#ff6b6b;border:2px solid #ff5252;border-radius:12px;padding:16px 30px;font-weight:bold;text-align:center;display:none}
        #game-hud3d #build3d{position:absolute;bottom:86px;left:50%;transform:translateX(-50%);display:none;flex-wrap:wrap;justify-content:center;gap:8px;max-width:min(620px,96vw);pointer-events:auto}
        #game-hud3d #build3d button{background:rgba(10,16,26,.85);color:#fff;border:1px solid rgba(255,255,255,.3);border-radius:8px;
          padding:8px 12px;font-size:12px;cursor:pointer;text-align:center;min-width:120px}
        #game-hud3d #buildbtn3d{display:none;position:absolute;bottom:14px;left:12px;pointer-events:auto;background:rgba(10,16,26,.7);color:#fff;
          border:1px solid rgba(255,255,255,.3);border-radius:8px;padding:8px 12px;font-size:13px;cursor:pointer}
        #game-hud3d #charbtn3d{position:absolute;bottom:90px;left:12px;pointer-events:auto;background:rgba(10,16,26,.7);color:#ffd98a;
          border:1px solid rgba(255,216,138,.4);border-radius:8px;padding:8px 12px;font-size:13px;cursor:pointer}
        #game-hud3d #charbtn3d.pts{animation:perkPulse 1.4s ease-in-out infinite}
        @keyframes perkPulse{0%,100%{box-shadow:0 0 0 0 rgba(255,216,138,0)}50%{box-shadow:0 0 16px 2px rgba(255,216,138,.55)}}
        #game-hud3d #dock3d{position:absolute;bottom:12px;left:50%;transform:translateX(-50%);display:flex;align-items:stretch;gap:10px;
          pointer-events:auto;background:linear-gradient(180deg,rgba(20,16,11,.8),rgba(9,8,6,.88));border:1px solid rgba(255,216,138,.3);
          border-radius:14px;padding:8px 10px;backdrop-filter:blur(6px);box-shadow:0 14px 44px rgba(0,0,0,.55)}
        #game-hud3d .dock-sep{width:1px;background:linear-gradient(180deg,transparent,rgba(255,216,138,.35),transparent)}
        #game-hud3d #abar3d{display:flex;gap:7px}
        #game-hud3d #bpal3d{display:flex;gap:6px}
        #game-hud3d #bpal3d .bslot{position:relative;width:58px;height:62px;border-radius:9px;cursor:pointer;
          border:1px solid rgba(255,216,138,.28);background:rgba(255,255,255,.03);color:#e8dcc0;
          display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:'Cinzel',Georgia,serif}
        #game-hud3d #bpal3d .bslot:hover{border-color:#ffd98a;background:rgba(255,216,138,.08)}
        #game-hud3d #bpal3d .bslot .ic{font-size:17px;line-height:1}
        #game-hud3d #bpal3d .bslot .nm{font-size:7.5px;margin-top:2px;text-align:center;opacity:.85;padding:0 2px}
        #game-hud3d #bpal3d .bslot .cst{font-size:8px;margin-top:1px;color:#9fd0a8;letter-spacing:.4px}
        #game-hud3d #bpal3d .bslot .hk{position:absolute;top:2px;left:5px;font-size:8.5px;color:#ffd98a;font-weight:700}
        #game-hud3d #bpal3d .bslot.poor{filter:saturate(.25) brightness(.6)}
        #game-hud3d #bpal3d .bslot.poor .cst{color:#e08a7a}
        #game-hud3d #dinfo3d{display:flex;flex-direction:column;justify-content:center;gap:4px;min-width:92px;padding:0 4px}
        #game-hud3d #dinfo3d .drow{font-size:10px;color:#cdbfa0;display:flex;gap:6px;align-items:center;font-family:'Cinzel',Georgia,serif;letter-spacing:.5px}
        #game-hud3d #dinfo3d .drow b{color:#ffd98a;letter-spacing:2px}
        #game-hud3d #codechipw{cursor:pointer;border:1px solid rgba(255,216,138,.3);border-radius:7px;padding:4px 8px;background:rgba(255,216,138,.07)}
        #game-hud3d #codechipw:hover{border-color:#ffd98a}
        #game-hud3d #mcode3d{display:none;position:absolute;top:calc(env(safe-area-inset-top,0px) + 8px);left:50%;transform:translateX(-50%);
          pointer-events:auto;font-family:'Cinzel',Georgia,serif;font-size:11px;color:#ffd98a;background:rgba(10,8,6,.74);
          border:1px solid rgba(255,216,138,.35);border-radius:7px;padding:5px 10px;letter-spacing:2px}
        #game-hud3d #cross3d{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);display:none;
          width:7px;height:7px;border:2px solid rgba(255,230,170,.95);border-radius:50%;pointer-events:none;z-index:3;
          box-shadow:0 0 6px rgba(0,0,0,.9),inset 0 0 3px rgba(0,0,0,.6)}
        #game-hud3d #starthint3d{position:absolute;top:36%;left:50%;transform:translate(-50%,-50%);z-index:4;
          background:rgba(10,8,6,.84);border:1px solid rgba(255,216,138,.4);border-radius:12px;padding:13px 22px;
          font-family:'Cinzel',Georgia,serif;color:#f0e6cf;font-size:13px;text-align:center;letter-spacing:.4px;line-height:1.8;
          box-shadow:0 18px 60px rgba(0,0,0,.6);transition:opacity .8s;pointer-events:none;max-width:min(480px,90vw)}
        #game-hud3d #abar3d .slot{position:relative;width:62px;height:62px;border-radius:10px;cursor:pointer;overflow:hidden;
          border:1px solid rgba(255,216,138,.35);background:linear-gradient(180deg,rgba(24,20,14,.9),rgba(12,10,8,.94));
          color:#f0e6cf;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:'Cinzel',Georgia,serif}
        #game-hud3d #abar3d .slot:hover{border-color:rgba(255,216,138,.85)}
        #game-hud3d #abar3d .slot .ic{font-size:19px;line-height:1}
        #game-hud3d #abar3d .slot .nm{font-size:7.5px;letter-spacing:.3px;opacity:.85;margin-top:3px;text-align:center;padding:0 2px}
        #game-hud3d #abar3d .slot .key{position:absolute;top:2px;left:5px;font-size:9px;color:#ffd98a;font-weight:700}
        #game-hud3d #abar3d .slot .cost{position:absolute;top:2px;right:5px;font-size:9px;color:#7fd4ff}
        #game-hud3d #abar3d .slot .cd{position:absolute;left:0;bottom:0;width:100%;height:0%;background:rgba(5,7,12,.82);pointer-events:none}
        #game-hud3d #abar3d .slot .cdt{position:absolute;inset:0;display:none;align-items:center;justify-content:center;
          font-size:15px;font-weight:800;color:#ffd98a;text-shadow:0 1px 4px #000;pointer-events:none}
        #game-hud3d #abar3d .slot.noen{filter:saturate(.25) brightness(.65)}
        #charpanel3d{position:absolute;inset:0;display:none;align-items:center;justify-content:center;
          background:rgba(3,6,10,.62);backdrop-filter:blur(5px);pointer-events:auto;z-index:6}
        #charpanel3d .card{width:min(540px,calc(100vw - 24px));max-height:86vh;overflow-y:auto;
          background:linear-gradient(165deg,rgba(22,18,12,.97),rgba(10,9,8,.97));border:1px solid rgba(255,216,138,.4);
          border-radius:14px;padding:18px 20px;font-family:'Cinzel',Georgia,serif;color:#efe4cb;box-shadow:0 24px 80px rgba(0,0,0,.7)}
        #charpanel3d h3{color:#ffd98a;font-family:'Cinzel Decorative','Cinzel',serif;font-size:20px;margin-bottom:2px}
        #charpanel3d .sub{font-size:11px;letter-spacing:2px;color:#b9a777;text-transform:uppercase;margin-bottom:12px}
        #charpanel3d .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:6px}
        #charpanel3d .stat{background:rgba(255,216,138,.06);border:1px solid rgba(255,216,138,.18);border-radius:8px;padding:7px 6px;text-align:center}
        #charpanel3d .stat b{display:block;font-size:15px;color:#ffe6ad}
        #charpanel3d .stat span{font-size:9px;letter-spacing:1px;text-transform:uppercase;color:#9c8e6e}
        #charpanel3d .sect{font-size:11px;letter-spacing:2px;color:#ffd98a;text-transform:uppercase;margin:13px 0 7px;
          border-bottom:1px solid rgba(255,216,138,.2);padding-bottom:3px}
        #charpanel3d .perks{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}
        #charpanel3d .perk{background:rgba(255,255,255,.04);border:1px solid rgba(255,216,138,.25);border-radius:9px;
          padding:9px;cursor:pointer;color:#efe4cb;text-align:left;font-family:inherit}
        #charpanel3d .perk:hover:not([disabled]){border-color:#ffd98a;background:rgba(255,216,138,.1)}
        #charpanel3d .perk b{display:block;font-size:13px;color:#ffe6ad}
        #charpanel3d .perk span{font-size:10px;color:#a99a78}
        #charpanel3d .perk[disabled]{opacity:.4;cursor:default}
        #charpanel3d .ab{display:flex;gap:10px;align-items:center;background:rgba(255,255,255,.03);
          border:1px solid rgba(255,255,255,.08);border-radius:9px;padding:7px 10px;margin-bottom:6px}
        #charpanel3d .ab .k{width:26px;height:26px;border-radius:6px;background:rgba(255,216,138,.14);
          border:1px solid rgba(255,216,138,.4);display:flex;align-items:center;justify-content:center;
          color:#ffd98a;font-weight:700;font-size:12px;flex:none}
        #charpanel3d .ab .inf{flex:1}
        #charpanel3d .ab .inf b{font-size:13px;color:#f5ead0}
        #charpanel3d .ab .inf span{display:block;font-size:10px;color:#9c8e6e}
        #charpanel3d .close{width:100%;margin-top:12px;padding:10px;border-radius:9px;border:1px solid rgba(255,216,138,.4);
          background:rgba(255,216,138,.12);color:#ffd98a;font-family:inherit;font-size:13px;cursor:pointer;letter-spacing:1px}
        #game-hud3d .controls{position:absolute;bottom:130px;left:12px;font-size:10px;color:rgba(255,255,255,.55)}
        #settingsmenu3d{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(3,7,12,.58);backdrop-filter:blur(6px);pointer-events:auto}
        #settingsmenu3d .settings-card{width:min(360px,calc(100vw - 28px));background:rgba(10,16,26,.94);border:1px solid rgba(255,255,255,.18);border-radius:12px;padding:16px;box-shadow:0 20px 60px rgba(0,0,0,.5)}
        #settingsmenu3d h3{font-size:17px;margin-bottom:4px;color:#ffe08a}
        #settingsmenu3d p{font-size:12px;line-height:1.4;color:rgba(255,255,255,.7);margin-bottom:12px}
        #settingsmenu3d button{width:100%;margin-top:8px;background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.18);border-radius:9px;padding:11px 12px;font-size:14px;text-align:left;cursor:pointer}
        #settingsmenu3d button.primary{background:rgba(255,215,106,.16);border-color:rgba(255,215,106,.35);color:#ffe08a}
        #settingsmenu3d button.danger{background:rgba(255,82,82,.12);border-color:rgba(255,82,82,.28);color:#ffb4b4}
        @media (max-width: 760px), (pointer: coarse) {
          #game-hud3d .panel{top:calc(env(safe-area-inset-top,0px) + 8px);left:8px;right:auto;width:auto;min-width:0;max-width:58vw;padding:6px 9px;background:rgba(10,16,26,.46)}
          #game-hud3d .meta{display:none}
          #game-hud3d .bar-row{font-size:10px;margin-bottom:3px}
          #game-hud3d .bar-row span:first-child{width:20px}
          #game-hud3d .res{font-size:12px;gap:9px;margin-top:5px}
          #game-hud3d #obj3d{display:none}
          #game-hud3d #back3d{display:none}
          #game-hud3d #settingsbtn3d{top:calc(env(safe-area-inset-top,0px) + 8px);right:8px;padding:7px 10px;font-size:12px;background:rgba(10,16,26,.74)}
          #game-hud3d #cambtn3d{top:calc(env(safe-area-inset-top,0px) + 50px);right:8px;left:auto;bottom:auto;padding:7px 10px;font-size:12px;background:rgba(10,16,26,.74)}
          #game-hud3d #buildbtn3d{top:calc(env(safe-area-inset-top,0px) + 92px);right:8px;left:auto;bottom:auto;padding:7px 10px;font-size:12px;background:rgba(10,16,26,.74)}
          #game-hud3d #charbtn3d{top:calc(env(safe-area-inset-top,0px) + 134px);right:8px;left:auto;bottom:auto;padding:7px 10px;font-size:12px;background:rgba(10,16,26,.74)}
          #game-hud3d #dock3d{display:none}
          #game-hud3d #mcode3d{display:block}
          #game-hud3d #buildbtn3d{display:block}
          #game-hud3d #mini3d{top:calc(env(safe-area-inset-top,0px) + 92px);left:8px;right:auto;bottom:auto;width:104px;height:80px;opacity:.8}
          #game-hud3d #build3d{bottom:calc(env(safe-area-inset-bottom,0px) + 128px);left:50%;right:auto;transform:translateX(-50%);max-width:calc(100vw - 18px)}
          #game-hud3d #build3d button{min-width:108px;padding:9px 10px}
          #game-hud3d #hint3d{bottom:calc(env(safe-area-inset-bottom,0px) + 130px);font-size:12px;background:rgba(10,16,26,.76)}
          #game-hud3d #toast3d{bottom:calc(env(safe-area-inset-bottom,0px) + 186px);max-width:calc(100vw - 28px);text-align:center}
          #game-hud3d .controls{display:none}
          #game-hud3d #zone3d{top:calc(env(safe-area-inset-top,0px) + 184px);font-size:18px}
        }
      </style>
      <div class="panel">
        <div class="meta">
          <span>Alias</span><span id="alias3d"></span>
          <span>Clase</span><span id="class3d"></span>
          <span>Jugadores</span><span id="players3d">1</span>
          <span>Zona</span><span id="zonelbl3d">Santuario</span>
          <span>Estado</span><span id="conn3d">Conectado</span>
          <span>Amenaza</span><span id="threat3d" style="color:#ff9a6a">I</span>
        </div>
        <div class="bar-row"><span>HP</span><div class="bar-bg"><div class="fill hp" id="hp3d" style="width:100%"></div></div><span class="val" id="hpv3d">100/100</span></div>
        <div class="bar-row"><span>EN</span><div class="bar-bg"><div class="fill en" id="en3d" style="width:100%"></div></div><span class="val" id="env3d">100/100</span></div>
        <div class="bar-row"><span id="lvl3d">N1</span><div class="bar-bg"><div class="fill xp" id="xp3d" style="width:0%"></div></div><span class="val" id="xpv3d">0</span></div>
        <div class="res">
          <span>✦ <b id="r-essence">0</b></span><span>🪵 <b id="r-wood">0</b></span>
          <span>🪨 <b id="r-stone">0</b></span><span>◈ <b id="r-rune">0</b></span>
        </div>
      </div>
      <div id="obj3d"><h4 id="objhdr3d">Objetivos</h4><ul id="objlist3d"></ul></div>
      <div id="zone3d"></div>
      <div id="toast3d"></div>
      <div id="hint3d"></div>
      <canvas id="mini3d" width="170" height="128"></canvas>
      <div class="controls">Clic: mover · Clic der./J: atacar · Q/E/R: habilidades · F: recolectar · 1-5: construir · V: vista (aérea/3ª/1ª persona) · C: héroe · M: sonido</div>
      <button id="back3d">← Volver al campamento</button>
      <button id="settingsbtn3d">Ajustes</button>
      <button id="cambtn3d">🎥 Vista</button>
      <button id="charbtn3d">👤 Héroe (C)</button>
      <div id="dock3d">
        <div id="abar3d"></div>
        <div class="dock-sep"></div>
        <div id="bpal3d"></div>
        <div class="dock-sep"></div>
        <div id="dinfo3d">
          <div class="drow" id="codechipw" title="Copiar código de sala">⚑ <b id="dcode3d">——</b></div>
          <div class="drow">👥 <span id="dplayers3d">1</span> héroes</div>
          <div class="drow">🏰 <span id="dstructs3d">0</span> · 🛡 <span id="dunits3d">0</span></div>
          <div class="drow" title="Tiempo hasta el próximo asedio" style="color:#ff9a7a">☠️ <span id="dwave3d">—</span></div>
        </div>
      </div>
      <div id="mcode3d">⚑ ——</div>
      <div id="cross3d"></div>
      <div id="starthint3d"></div>
      <div id="charpanel3d"><div class="card" id="charcard3d"></div></div>
      <button id="buildbtn3d">🔨 Construir (B)</button>
      <div id="build3d">
        <button data-build="campfire">🔥 Hoguera<br><small>3🪵 2✦</small></button>
        <button data-build="totem">🗿 Tótem<br><small>3🪨 2✦</small></button>
        <button data-build="wall">🧱 Muro<br><small>3🪨</small></button>
        <button data-build="barracks">🏕️ Entrenamiento<br><small>4🪵 2🪨</small></button>
        <button data-build="shelter">🏠 Refugio<br><small>4🪵 2✦</small></button>
      </div>
      <div id="respawn3d">Caído en batalla<br><span style="font-size:13px;font-weight:normal">Reapareciendo en el santuario…</span></div>
      <div id="settingsmenu3d" role="dialog" aria-modal="true" aria-label="Ajustes">
        <div class="settings-card">
          <h3>Ajustes</h3>
          <p id="settingsmsg3d">La partida online sigue activa mientras este menu esta abierto.</p>
          <button class="primary" id="installpwa3d">Instalar como app</button>
          <button id="soundbtn3d">🔊 Sonido (M)</button>
          <button id="fullscreen3d">Pantalla completa</button>
          <button id="closeSettings3d">Volver al juego</button>
          <button class="danger" id="leaveGame3d">Salir al lobby</button>
        </div>
      </div>
    `;
    overlay.appendChild(el);
    this.hudEl = el;
    this.minimapCtx = (document.getElementById('mini3d') as HTMLCanvasElement).getContext('2d');
    const backButton = document.getElementById('back3d') as HTMLButtonElement | null;
    if (backButton) backButton.textContent = 'Campamento';
    this.renderObjectives();

    backButton?.addEventListener('click', () => this.leaveToLobby());
    document.getElementById('settingsbtn3d')?.addEventListener('click', () => this.openSettings());
    document.getElementById('cambtn3d')?.addEventListener('click', () => this.toggleCamera());
    document.getElementById('charbtn3d')?.addEventListener('click', () => this.toggleCharPanel());
    document.getElementById('charpanel3d')?.addEventListener('click', (e) => {
      if (e.target === document.getElementById('charpanel3d')) this.toggleCharPanel();
    });
    this.buildActionBar();
    this.buildBuildPalette();
    const copyCode = () => {
      if (!this.roomCode) return;
      void navigator.clipboard?.writeText(this.roomCode).then(() => this.showToast('⚑ Código copiado — compártelo con tus aliados'));
    };
    document.getElementById('codechipw')?.addEventListener('click', copyCode);
    document.getElementById('mcode3d')?.addEventListener('click', copyCode);
    // Minimap acts as a command map: click/tap to send the hero there.
    const mini = document.getElementById('mini3d') as HTMLCanvasElement | null;
    mini?.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const r = mini.getBoundingClientRect();
      const wx = clamp(((e.clientX - r.left) / r.width) * WORLD.width, 30, WORLD.width - 30);
      const wz = clamp(((e.clientY - r.top) / r.height) * WORLD.height, 30, WORLD.height - 30);
      this.pendingAction = null;
      this.moveTarget = new THREE.Vector3(wx, 0, wz);
      this.spawnMoveMarker(this.moveTarget, 0xffe082);
      this.audio.sfx('click');
    });
    const hintEl = document.getElementById('starthint3d');
    if (hintEl) {
      const isTouch = window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
      hintEl.innerHTML = isTouch
        ? '👆 <b>Toca el suelo</b> para moverte<br>Toca un <b>enemigo</b> para atacarlo · un <b>recurso</b> para recolectarlo'
        : '🖱️ <b>Clic</b>: moverte · clic en <b>enemigo</b>: atacar · clic en <b>recurso</b>: recolectar<br>⌨️ C héroe · 1-5 construir · V vista · Q/E/R habilidades';
      window.setTimeout(() => {
        hintEl.style.opacity = '0';
        window.setTimeout(() => hintEl.remove(), 900);
      }, 9000);
    }
    document.getElementById('buildbtn3d')!.addEventListener('click', () => this.toggleBuildMenu());
    document.getElementById('closeSettings3d')!.addEventListener('click', () => this.closeSettings());
    document.getElementById('leaveGame3d')!.addEventListener('click', () => this.leaveToLobby());
    document.getElementById('installpwa3d')!.addEventListener('click', () => void this.installPWA());
    document.getElementById('soundbtn3d')?.addEventListener('click', () => {
      this.audio.ensure();
      const m = this.audio.toggleMute();
      const b = document.getElementById('soundbtn3d');
      if (b) b.textContent = m ? '🔇 Sonido silenciado (M)' : '🔊 Sonido (M)';
    });
    document.getElementById('fullscreen3d')!.addEventListener('click', () => void this.enterFullscreen());
    el.querySelectorAll<HTMLElement>('#build3d button').forEach((b) => {
      b.addEventListener('click', () => this.selectBuild(b.dataset.build as StructureType));
    });
  }

  // ---- action bar + hero panel ----------------------------------------------

  private buildActionBar() {
    const bar = document.getElementById('abar3d');
    if (!bar) return;
    const def = CLASS_DEFINITIONS[this.session.classKey as PlayerClass];
    if (!def) return;
    const slots: Array<{ k: 'basic' | 'q' | 'e' | 'r'; ic: string; nm: string; key: string; cost: number }> = [
      { k: 'basic', ic: '⚔️', nm: 'Ataque', key: 'J', cost: 0 },
      { k: 'q', ic: '✦', nm: def.abilities.q.nameEs, key: 'Q', cost: def.abilities.q.energyCost },
      { k: 'e', ic: '◆', nm: def.abilities.e.nameEs, key: 'E', cost: def.abilities.e.energyCost },
      { k: 'r', ic: '✸', nm: def.abilities.r.nameEs, key: 'R', cost: def.abilities.r.energyCost },
    ];
    bar.innerHTML = slots.map((s) => `
      <div class="slot" data-slot="${s.k}">
        <span class="key">${s.key}</span>${s.cost ? `<span class="cost">${s.cost}</span>` : ''}
        <span class="ic">${s.ic}</span><span class="nm">${s.nm}</span>
        <div class="cd" data-cd="${s.k}"></div><div class="cdt" data-cdt="${s.k}"></div>
      </div>`).join('');
    bar.querySelectorAll<HTMLElement>('.slot').forEach((el) => {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const k = el.dataset.slot as AbilityKey;
        if (k === 'basic') this.queueBasicAttack(); else this.queuedAbility = k;
      });
    });
  }

  private buildBuildPalette() {
    const pal = document.getElementById('bpal3d');
    if (!pal) return;
    const order: StructureType[] = ['campfire', 'totem', 'wall', 'barracks', 'shelter'];
    pal.innerHTML = order.map((tp, i) => {
      const d = STRUCTURE_DEFS[tp];
      const cost = Object.entries(d.cost)
        .map(([r, a]) => `${a}${RESOURCE_INFO[r as ResourceType].icon}`)
        .join(' ');
      return `<div class="bslot" data-build="${tp}" title="${d.name} — ${d.desc}">
        <span class="hk">${i + 1}</span><span class="ic">${d.icon}</span>
        <span class="nm">${d.name.split(' ')[0]}</span><span class="cst">${cost}</span>
      </div>`;
    }).join('');
    pal.querySelectorAll<HTMLElement>('.bslot').forEach((b) => {
      b.addEventListener('click', () => this.selectBuild(b.dataset.build as StructureType));
    });
  }

  private abilityCooldownMs(k: 'basic' | 'q' | 'e' | 'r', classKey: string): number {
    const def = CLASS_DEFINITIONS[classKey as PlayerClass];
    if (!def) return 0;
    return k === 'basic' ? def.stats.attackCooldownMs : def.abilities[k].cooldownMs;
  }

  private updateActionBar(me: { classKey: string; energy: number; cooldowns?: Record<string, number> } | undefined) {
    const bar = document.getElementById('abar3d');
    if (!bar || !me) return;
    const def = CLASS_DEFINITIONS[me.classKey as PlayerClass];
    if (!def) return;
    const now = Date.now();
    (['basic', 'q', 'e', 'r'] as const).forEach((k) => {
      const cdEl = bar.querySelector<HTMLElement>(`[data-cd="${k}"]`);
      const cdt = bar.querySelector<HTMLElement>(`[data-cdt="${k}"]`);
      const slot = bar.querySelector<HTMLElement>(`[data-slot="${k}"]`);
      if (!cdEl || !cdt || !slot) return;
      const total = this.abilityCooldownMs(k, me.classKey);
      const since = now - ((me.cooldowns?.[k] as number) ?? 0);
      const remain = Math.max(0, total - since);
      if (remain > 250 && since >= 0 && since < 86400000) {
        cdEl.style.height = `${(remain / total) * 100}%`;
        cdt.style.display = 'flex';
        cdt.textContent = remain > 950 ? String(Math.ceil(remain / 1000)) : '';
      } else {
        cdEl.style.height = '0%';
        cdt.style.display = 'none';
      }
      const cost = k === 'basic' ? 0 : def.abilities[k].energyCost;
      slot.classList.toggle('noen', me.energy < cost);
    });
  }

  private toggleCharPanel() {
    this.charOpen = !this.charOpen;
    const panel = document.getElementById('charpanel3d');
    if (!panel) return;
    panel.style.display = this.charOpen ? 'flex' : 'none';
    if (this.charOpen) this.renderCharPanel();
  }

  private renderCharPanel() {
    const card = document.getElementById('charcard3d');
    if (!card) return;
    const state = this.room.state as RealmRoomState;
    const me = state.players?.get(this.localId);
    if (!me) return;
    const def = CLASS_DEFINITIONS[me.classKey as PlayerClass];
    const pts = me.perkPoints ?? 0;
    const perks = [
      { id: 'vigor', icon: '❤️', name: 'Vigor', desc: '+25 vida máxima' },
      { id: 'furia', icon: '🗡️', name: 'Furia', desc: '+4 daño de ataque' },
      { id: 'celeridad', icon: '🌀', name: 'Celeridad', desc: '+8% velocidad de movimiento' },
      { id: 'foco', icon: '🔮', name: 'Foco', desc: '+20 energía máxima' },
    ];
    const abilities = def ? ([['J', { nameEs: 'Ataque básico', energyCost: 0, cooldownMs: def.stats.attackCooldownMs, damage: def.stats.attackDamage }] as const,
      ['Q', def.abilities.q] as const, ['E', def.abilities.e] as const, ['R', def.abilities.r] as const]) : [];
    card.innerHTML = `
      <h3>${me.alias}</h3>
      <div class="sub">${def?.nameEs ?? me.classKey} · Nivel ${me.level} · ${me.xp} XP</div>
      <div class="grid">
        <div class="stat"><b>${Math.ceil(me.hp)}/${me.maxHp}</b><span>Vida</span></div>
        <div class="stat"><b>${Math.ceil(me.energy)}/${me.maxEnergy}</b><span>Energía</span></div>
        <div class="stat"><b>${me.attackDamage}</b><span>Daño</span></div>
        <div class="stat"><b>${me.moveSpeed}</b><span>Velocidad</span></div>
      </div>
      <div class="sect">Mejoras ${pts > 0 ? `— <span style="color:#ffe6ad">${pts} punto${pts > 1 ? 's' : ''} disponible${pts > 1 ? 's' : ''}</span>` : '— sube de nivel para ganar puntos'}</div>
      <div class="perks">
        ${perks.map((p) => `<button class="perk" data-perk="${p.id}" ${pts <= 0 ? 'disabled' : ''}><b>${p.icon} ${p.name}</b><span>${p.desc}</span></button>`).join('')}
      </div>
      <div class="sect">Habilidades</div>
      ${abilities.map(([key, a]) => `
        <div class="ab"><div class="k">${key}</div><div class="inf"><b>${(a as { nameEs: string }).nameEs}</b>
          <span>${(a as { damage: number }).damage ? `Daño ${(a as { damage: number }).damage} · ` : ''}${(a as { energyCost: number }).energyCost ? `Coste ${(a as { energyCost: number }).energyCost} EN · ` : ''}Recarga ${(((a as { cooldownMs: number }).cooldownMs) / 1000).toFixed(1)}s</span>
        </div></div>`).join('')}
      <div class="sect">Reino</div>
      <div style="font-size:11px;color:#a99a78;line-height:1.6">
        Era ${romanNumeral(this.objectiveTier + 1)} · Amenaza ${romanNumeral(threatTier(state.elapsedMs ?? 0) + 1)} ·
        Construcciones: <b style="color:#ffe6ad">${countMap(state.structures)}</b> ·
        Soldados: <b style="color:#ffe6ad">${countMap(state.units)}</b>
      </div>
      <div class="sect">Crónica de la partida</div>
      <div class="grid">
        <div class="stat"><b>${this.chron.kills}</b><span>Bajas</span></div>
        <div class="stat"><b>${this.chron.gathered}</b><span>Recursos</span></div>
        <div class="stat"><b>${this.chron.built}</b><span>Obras</span></div>
        <div class="stat"><b>${this.chron.waves}</b><span>Asedios</span></div>
      </div>
      <button class="close" id="charclose3d">Volver al combate (C)</button>
    `;
    card.querySelectorAll<HTMLElement>('.perk').forEach((b) => {
      b.addEventListener('click', () => {
        const perk = b.dataset.perk!;
        this.room.send(MSG.PERK_CHOICE, { perk });
        this.audio.sfx('perk');
        window.setTimeout(() => { if (this.charOpen) this.renderCharPanel(); }, 150);
      });
    });
    document.getElementById('charclose3d')?.addEventListener('click', () => this.toggleCharPanel());
  }

  private openSettings(message?: string) {
    this.settingsOpen = true;
    const menu = document.getElementById('settingsmenu3d');
    const msg = document.getElementById('settingsmsg3d');
    const install = document.getElementById('installpwa3d') as HTMLButtonElement | null;
    if (msg) msg.textContent = message ?? 'La partida online sigue activa mientras este menu esta abierto.';
    if (install) {
      const canInstall = window.fmrCanInstallPWA?.() ?? false;
      install.disabled = !canInstall;
      install.textContent = canInstall ? 'Instalar como app' : 'Instalacion no disponible en este navegador';
      install.style.opacity = canInstall ? '1' : '.55';
    }
    if (menu) menu.style.display = 'flex';
  }

  private closeSettings() {
    this.settingsOpen = false;
    const menu = document.getElementById('settingsmenu3d');
    if (menu) menu.style.display = 'none';
  }

  private leaveToLobby() {
    if (this.intentionalExit || this.disposed) return;
    this.intentionalExit = true;
    this.connectionStatus = 'Saliendo';
    this.closeSettings();
    this.room.leave().catch(() => this.exit());
    window.setTimeout(() => {
      if (!this.disposed) this.exit();
    }, 900);
  }

  private async installPWA() {
    const installed = await window.fmrInstallPWA?.();
    this.showToast(installed ? 'App instalada' : 'Instalacion no disponible');
    this.closeSettings();
  }

  private async enterFullscreen() {
    const root = document.documentElement;
    if (!document.fullscreenElement && root.requestFullscreen) {
      await root.requestFullscreen().catch(() => undefined);
    }
    this.closeSettings();
  }

  private renderObjectives() {
    const hdr = document.getElementById('objhdr3d');
    if (hdr) {
      const eraNames = ['El Despertar', 'La Corrupción', 'El Asedio', 'La Reconquista', 'El Dominio'];
      const name = eraNames[Math.min(this.objectiveTier, eraNames.length - 1)];
      hdr.textContent = `Era ${romanNumeral(this.objectiveTier + 1)} · ${name}`;
    }
    const ul = document.getElementById('objlist3d');
    if (!ul) return;
    ul.innerHTML = this.objectives.map((o) => {
      const txt = o.goal > 1 ? `${o.label} (${o.progress}/${o.goal})` : o.label;
      return `<li class="${o.done ? 'done' : ''}">${o.done ? '✓' : '○'} ${txt}</li>`;
    }).join('');
  }

  private showZoneBanner(name: string, color = '#ffffff') {
    const z = document.getElementById('zone3d');
    const lbl = document.getElementById('zonelbl3d');
    if (lbl && color === '#ffffff') lbl.textContent = name;
    if (!z) return;
    z.textContent = name; z.style.color = color; z.style.opacity = '1';
    window.setTimeout(() => { if (z) z.style.opacity = '0'; }, 2600);
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

    // Threat ("la máquina") — derived from elapsedMs on both sides.
    const tTier = threatTier(state.elapsedMs ?? 0);
    set('threat3d', romanNumeral(tTier + 1) + (this.curNight > 0.5 ? ' 🌙' : ''));
    if (tTier > this.lastThreatTier) {
      this.lastThreatTier = tTier;
      this.showToast(`☠️ La corrupción se intensifica — Amenaza ${romanNumeral(tTier + 1)}`);
    }

    // Dock: room code, siege countdown, realm counters, build affordability
    set('dcode3d', this.roomCode || '——');
    const elapsed = state.elapsedMs ?? 0;
    const remainMs = Math.max(0, nextWaveAtMs(elapsed) - elapsed);
    const mm = Math.floor(remainMs / 60000);
    const ss = Math.floor((remainMs % 60000) / 1000);
    const countdown = `${mm}:${String(ss).padStart(2, '0')}`;
    set('dwave3d', `Oleada ${waveNumberAt(elapsed) + 1} en ${countdown}`);
    const mcodeEl = document.getElementById('mcode3d');
    if (mcodeEl) mcodeEl.textContent = `⚑ ${this.roomCode || '——'} · ☠️ ${countdown}`;
    set('dplayers3d', String(countPlayers(state)));
    set('dstructs3d', String(countMap(state.structures)));
    set('dunits3d', String(countMap(state.units)));
    document.querySelectorAll<HTMLElement>('#bpal3d .bslot').forEach((b) => {
      const d = STRUCTURE_DEFS[b.dataset.build as StructureType];
      if (!d) return;
      let ok = true;
      for (const [r, a] of Object.entries(d.cost)) {
        const key = r === 'rune_shard' ? 'runeShard' : r;
        if (((me as unknown as Record<string, number>)[key] ?? 0) < (a as number)) ok = false;
      }
      b.classList.toggle('poor', !ok);
    });

    // Action bar cooldowns + perk badge
    this.updateActionBar(me as unknown as { classKey: string; energy: number; cooldowns?: Record<string, number> });
    const cb = document.getElementById('charbtn3d');
    if (cb) {
      const pts = me.perkPoints ?? 0;
      cb.classList.toggle('pts', pts > 0);
      cb.textContent = pts > 0 ? `👤 Héroe (C) · ${pts}⬆` : '👤 Héroe (C)';
    }

    // interaction hint
    const hint = document.getElementById('hint3d');
    if (hint) {
      if (this.buildMode) { hint.style.display = 'block'; hint.textContent = 'Clic para construir · clic der./Esc cancela'; }
      else if (this.nearestNodeId) {
        const verb = this.nearestNodeType === 'wood' ? '🪓 Talar madera'
          : this.nearestNodeType === 'stone' ? '⛏️ Minar piedra'
          : this.nearestNodeType === 'rune_shard' ? '◈ Extraer runa'
          : '✦ Recoger esencia';
        hint.style.display = 'block'; hint.textContent = `F · ${verb}`;
      }
      else if (this.nearestRepairId) {
        hint.style.display = 'block'; hint.textContent = `F · 🔧 Reparar ${this.nearestRepairLabel} (1🪨)`;
      }
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
    state.units?.forEach((u) => { if (u.isAlive) dot(u.x, u.y, u.ownerId === this.localId ? '#ffd76a' : '#9fc4ff', 1.8); });
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
        #joy3d{position:absolute;bottom:calc(env(safe-area-inset-bottom,0px) + 18px);left:18px;width:118px;height:118px;border-radius:50%;background:rgba(6,12,20,.58);border:2px solid rgba(255,255,255,.22);touch-action:none;pointer-events:auto;backdrop-filter:blur(3px)}
        #joythumb3d{position:absolute;left:37px;top:37px;width:50px;height:50px;border-radius:50%;background:rgba(255,255,255,.3);border:1px solid rgba(255,255,255,.5)}
        #ab3d{position:absolute;bottom:calc(env(safe-area-inset-bottom,0px) + 14px);right:12px;display:grid;grid-template-columns:repeat(2,82px);gap:8px;pointer-events:none}
        #ab3d button{pointer-events:auto;width:82px;height:50px;border-radius:12px;border:1px solid rgba(255,255,255,.32);background:rgba(6,12,20,.68);color:#fff;font-size:12px;font-weight:800;touch-action:none;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1.05;backdrop-filter:blur(3px)}
        #ab3d button small{font-size:9px;font-weight:600;opacity:.78;margin-top:2px}
        #ab3d .basic{background:rgba(190,45,45,.7)} #ab3d .harv{background:rgba(36,150,108,.7)}
        #ab3d button[data-ab="q"]{background:rgba(58,92,200,.66)} #ab3d button[data-ab="r"]{background:rgba(200,150,40,.66)}
        #ab3d button{font-size:0}
        #ab3d button::before{font-size:21px;line-height:1}
        #ab3d button::after{font-size:9px;font-weight:700;opacity:.88;margin-top:2px;letter-spacing:.3px}
        #ab3d button[data-ab="q"]::before{content:"✦"} #ab3d button[data-ab="q"]::after{content:"Habilidad"}
        #ab3d button[data-ab="e"]{background:rgba(64,150,190,.62)}
        #ab3d button[data-ab="e"]::before{content:"◆"} #ab3d button[data-ab="e"]::after{content:"Destreza"}
        #ab3d button[data-ab="r"]::before{content:"✸"} #ab3d button[data-ab="r"]::after{content:"Especial"}
        #ab3d button[data-ab="basic"]::before{content:"⚔️"} #ab3d button[data-ab="basic"]::after{content:"Atacar"}
        #ab3d button[data-act="harvest"]::before{content:"✋"} #ab3d button[data-act="harvest"]::after{content:"Coger"}
        #ab3d button:active{transform:scale(.9)}
      </style>
      <div id="joy3d"><div id="joythumb3d"></div></div>
      <div id="ab3d">
        <button data-ab="q">Q</button><button class="basic" data-ab="basic">⚔</button>
        <button data-ab="e">E</button><button data-ab="r">R</button>
        <button class="harv" data-act="harvest">✋</button>
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
    this.composer?.setSize(window.innerWidth, window.innerHeight);
  }

  private exit() { if (this.disposed) return; this.dispose(); this.onExit(); }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('popstate', this.onPopState);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    document.removeEventListener('mousemove', this.onMouseLook);
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock?.();
    this.players.forEach((e) => disposeGroup(e.group));
    this.enemies.forEach((e) => disposeGroup(e.group));
    this.units.forEach((e) => disposeGroup(e.group));
    this.sanctuaries.forEach((s) => disposeGroup(s.group));
    this.resourceMeshes.forEach((g) => disposeGroup(g));
    this.structureMeshes.forEach((g) => disposeGroup(g));
    if (this.buildGhost) disposeSingleMesh(this.buildGhost);
    if (this.moveMarker) disposeSingleMesh(this.moveMarker);
    if (this.fpWeapon) disposeGroup(this.fpWeapon);
    for (const b of this.bursts) {
      this.scene.remove(b.pts);
      b.pts.geometry.dispose();
      (b.pts.material as THREE.PointsMaterial).dispose();
    }
    this.bursts.length = 0;
    this.glowTex?.dispose();
    this.texBark?.dispose();
    this.texStone?.dispose();
    if (this.fireflies) disposeGroup(this.fireflies);
    this.audio.dispose();
    this.composer?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.hudEl?.remove();
    this.touchEl?.remove();
  }
}

/**
 * Organic-noise displacement: pushes every vertex along its position direction
 * by a random amount, then rebuilds normals. Turns platonic solids (icosa,
 * cones, cylinders) into natural, irregular shapes — the antidote to the
 * "blocky" look.
 */
function jitterGeometry<T extends THREE.BufferGeometry>(geo: T, amp: number): T {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const seen = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    // shared offset per unique vertex position so faces stay welded
    const key = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
    let off = seen.get(key);
    if (off === undefined) { off = (Math.random() - 0.5) * 2 * amp; seen.set(key, off); }
    const len = Math.hypot(x, y, z) || 1;
    pos.setXYZ(i, x + (x / len) * off, y + (y / len) * off, z + (z / len) * off);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
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
function countMap(m: { forEach: (cb: (v: unknown, k: string) => void) => void } | undefined): number {
  let count = 0; m?.forEach(() => { count += 1; }); return count;
}
function romanNumeral(n: number): string {
  const table: Array<[number, string]> = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = ''; let v = Math.max(1, Math.floor(n));
  for (const [num, sym] of table) { while (v >= num) { out += sym; v -= num; } }
  return out;
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

function drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}
