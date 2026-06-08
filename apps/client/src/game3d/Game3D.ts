import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { getStateCallbacks } from '@colyseus/sdk';
import type { Room } from '@colyseus/sdk';
import {
  MSG, CLASS_DEFINITIONS, clamp, WORLD, ZONES, OBSTACLES, zoneAt, isBlocked,
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

interface Rig {
  armL?: THREE.Object3D;
  armR?: THREE.Object3D;
  legL?: THREE.Object3D;
  legR?: THREE.Object3D;
  torso?: THREE.Object3D;
  accent?: THREE.Object3D;
  phase: number;
  stride: number;
  attack: number;
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
  rig?: Rig;
  lastPos?: THREE.Vector3;
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
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private seq = 0;
  private inputAccum = 0;
  // click / tap-to-move
  private moveTarget: THREE.Vector3 | null = null;
  private moveMarker: THREE.Mesh | null = null;
  private cameraMode: 'iso' | 'third' = 'iso';

  // world interaction
  private nearestNodeId: string | null = null;
  private nearestNodeType: ResourceType | null = null;
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
    this.renderer.toneMappingExposure = 1.18;
    const canvas = this.renderer.domElement;
    canvas.id = 'game3d-canvas';
    canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:1;touch-action:none;';
    document.getElementById('game-container')!.appendChild(canvas);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x141d2b);
    this.scene.fog = new THREE.FogExp2(0x16212e, 0.00046);

    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 1, 9000);

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

    this.loop();
  }

  // ---- world ----------------------------------------------------------------

  private buildWorld() {
    const hi = this.quality === 'high';

    // Gradient dusk sky dome
    this.scene.add(this.makeSky());

    // Lighting: cool sky fill + warm key sun (shadows) + cold rim for separation
    this.scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x4a4231, 0.7));
    this.scene.add(new THREE.AmbientLight(0x35506a, 0.36));
    const sun = new THREE.DirectionalLight(0xffe4b2, 2.55);
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
    const rim = new THREE.DirectionalLight(0x6f8cff, 0.7);
    rim.position.set(-WORLD.width * 0.2, 1500, WORLD.height * 1.15);
    this.scene.add(rim);

    // Biome ground — gently undulating terrain per quadrant
    for (const z of ZONES) {
      const geo = new THREE.PlaneGeometry(z.w, z.h, hi ? 40 : 12, hi ? 30 : 9);
      const pos = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i);
        pos.setZ(i, Math.sin(x * 0.0042 + 1.3) * Math.cos(y * 0.0051) * 7 + Math.sin((x + y) * 0.0026) * 5);
      }
      geo.computeVertexNormals();
      const g = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: z.color, roughness: 0.98 }));
      g.rotation.x = -Math.PI / 2;
      g.position.set(z.x + z.w / 2, 0, z.y + z.h / 2);
      g.receiveShadow = true;
      this.scene.add(g);
    }

    // Central sanctum glade + carved stone ring
    const glade = new THREE.Mesh(
      new THREE.CircleGeometry(WORLD.sanctum.r, 56),
      new THREE.MeshStandardMaterial({ color: 0x53785f, roughness: 0.95, emissive: 0x163020, emissiveIntensity: 0.5 })
    );
    glade.rotation.x = -Math.PI / 2; glade.position.set(WORLD.sanctum.x, 0.6, WORLD.sanctum.y);
    glade.receiveShadow = true; this.scene.add(glade);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(WORLD.sanctum.r - 8, 6, 8, 72),
      new THREE.MeshStandardMaterial({ color: 0x8a7d52, roughness: 0.7, emissive: 0x2a2410, emissiveIntensity: 0.5 })
    );
    ring.rotation.x = -Math.PI / 2; ring.position.set(WORLD.sanctum.x, 2, WORLD.sanctum.y); this.scene.add(ring);

    // Border cliffs (dark, framing the playfield)
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x202a3a, roughness: 1, flatShading: true });
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

    // Purely cosmetic dressing
    if (hi) { this.scatterGrass(); this.scatterCrystals(); }
    this.buildAtmosphere();
  }

  private setupPostProcessing() {
    if (this.quality !== 'high') return;
    try {
      const composer = new EffectComposer(this.renderer);
      composer.addPass(new RenderPass(this.scene, this.camera));
      const bloom = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight), 0.8, 0.6, 0.6
      );
      composer.addPass(bloom);
      composer.addPass(new OutputPass());
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
    const c = document.createElement('canvas'); c.width = 16; c.height = 256;
    const ctx = c.getContext('2d')!;
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0.0, '#0a1530');   // zenith — deep dusk
    grad.addColorStop(0.36, '#22344f');
    grad.addColorStop(0.5, '#8a755c');   // warm horizon haze
    grad.addColorStop(0.62, '#46505d');
    grad.addColorStop(1.0, '#1d232e');   // nadir
    ctx.fillStyle = grad; ctx.fillRect(0, 0, 16, 256);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(5200, 32, 20), mat);
    sky.position.set(WORLD.sanctum.x, 0, WORLD.sanctum.y);
    sky.renderOrder = -1;
    return sky;
  }

  private makeTree(x: number, y: number, radius: number, accent: number, hi: boolean): THREE.Group {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.16, radius * 0.3, radius * 1.5, 6),
      new THREE.MeshStandardMaterial({ color: 0x5b4634, roughness: 1, flatShading: true })
    );
    trunk.position.y = radius * 0.75; trunk.castShadow = hi; g.add(trunk);
    const canopy = new THREE.Group();
    const tint = new THREE.Color(accent).offsetHSL(0, -0.12, (Math.random() - 0.5) * 0.1);
    const leafMat = new THREE.MeshStandardMaterial({ color: tint, roughness: 1, flatShading: true });
    for (let i = 0; i < 3; i++) {
      const f = 1 - i / 3;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(radius * (0.7 + f * 0.55), radius * 1.25, 7), leafMat);
      cone.position.y = radius * (1.4 + i * 0.7);
      cone.rotation.y = Math.random() * Math.PI;
      cone.castShadow = hi;
      canopy.add(cone);
    }
    g.add(canopy); g.position.set(x, 0, y);
    this.foliage.push({ mesh: canopy, sway: 0.04 + Math.random() * 0.03, phase: Math.random() * Math.PI * 2 });
    return g;
  }

  private makeRock(x: number, y: number, radius: number, hi: boolean): THREE.Group {
    const g = new THREE.Group();
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x6a7077, roughness: 1, flatShading: true });
    const main = new THREE.Mesh(new THREE.IcosahedronGeometry(radius, 0), stoneMat);
    main.scale.set(1, 0.78 + Math.random() * 0.3, 1);
    main.position.y = radius * 0.45;
    main.rotation.set(Math.random(), Math.random() * 3, Math.random());
    main.castShadow = hi; main.receiveShadow = true; g.add(main);
    const cap = new THREE.Mesh(
      new THREE.IcosahedronGeometry(radius * 0.7, 0),
      new THREE.MeshStandardMaterial({ color: 0x4a5d3a, roughness: 1, flatShading: true })
    );
    cap.position.y = radius * 0.92; cap.scale.y = 0.4; g.add(cap);
    const n = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      const r2 = radius * (0.3 + Math.random() * 0.3);
      const a = Math.random() * Math.PI * 2, d = radius * (0.9 + Math.random() * 0.5);
      const sr = new THREE.Mesh(new THREE.IcosahedronGeometry(r2, 0), stoneMat);
      sr.position.set(Math.cos(a) * d, r2 * 0.4, Math.sin(a) * d);
      sr.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      sr.castShadow = hi; g.add(sr);
    }
    g.position.set(x, 0, y);
    return g;
  }

  private makeRuin(x: number, y: number, radius: number, hi: boolean): THREE.Group {
    const g = new THREE.Group();
    const stone = new THREE.MeshStandardMaterial({ color: 0x4b4668, roughness: 0.92, flatShading: true });
    const h = radius * 2.2 * (0.7 + Math.random() * 0.6);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.5, radius * 0.62, h, 8), stone);
    col.position.y = h / 2; col.castShadow = hi; col.receiveShadow = true; g.add(col);
    const base = new THREE.Mesh(new THREE.BoxGeometry(radius * 1.5, radius * 0.4, radius * 1.5), stone);
    base.position.y = radius * 0.2; base.castShadow = hi; g.add(base);
    if (Math.random() > 0.4) {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(radius * 1.35, radius * 0.5, radius * 1.35), stone);
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
      new THREE.MeshStandardMaterial({ color: 0x2f6f86, roughness: 0.14, metalness: 0.35, transparent: true, opacity: 0.85, emissive: 0x10333f, emissiveIntensity: 0.5 })
    );
    m.rotation.x = -Math.PI / 2; m.position.set(x, 1.2, y); m.receiveShadow = true;
    this.waterMeshes.push(m);
    return m;
  }

  private scatterGrass() {
    const blade = new THREE.ConeGeometry(3.4, 16, 4); blade.translate(0, 8, 0);
    const count = 2400;
    const inst = new THREE.InstancedMesh(blade, new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), count);
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
      const mat = new THREE.MeshStandardMaterial({ color: hue, emissive: hue, emissiveIntensity: 1.9, roughness: 0.3, flatShading: true });
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

  private createPlayerMesh(classKey: string, isLocal: boolean): THREE.Group {
    const color = CLASS_COLORS[classKey] ?? 0xffffff;
    const g = new THREE.Group();
    const main = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.05, flatShading: true });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1c150e, roughness: 0.86, flatShading: true });
    const bone = new THREE.MeshStandardMaterial({ color: 0xd8c28a, roughness: 0.72, flatShading: true });
    const metal = new THREE.MeshStandardMaterial({ color: 0xc2d2dd, roughness: 0.4, metalness: 0.5, flatShading: true });
    const accent = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.1, roughness: 0.35, flatShading: true });

    const rig: Rig = { phase: Math.random() * Math.PI * 2, stride: 0, attack: 0 };

    // Legs — hip pivot groups so they swing while walking
    const mkLeg = (sx: number) => {
      const hip = new THREE.Group(); hip.position.set(sx, 20, 0);
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(4.6, 14, 3, 6), dark);
      leg.position.y = -9; leg.castShadow = true;
      const foot = new THREE.Mesh(new THREE.BoxGeometry(7, 4, 12), dark);
      foot.position.set(0, -18, 3);
      hip.add(leg, foot); g.add(hip); return hip;
    };
    rig.legL = mkLeg(-6); rig.legR = mkLeg(6);

    // Torso
    const torso = new THREE.Group(); torso.position.y = 20;
    const belly = new THREE.Mesh(new THREE.CapsuleGeometry(10, 16, 4, 10), main);
    belly.position.y = 11; belly.castShadow = true;
    const chest = new THREE.Mesh(new THREE.BoxGeometry(21, 16, 13), dark);
    chest.position.y = 16; chest.castShadow = true;
    torso.add(belly, chest); g.add(torso); rig.torso = torso;

    // Head (animal-like, with snout)
    const head = new THREE.Group(); head.position.set(0, 46, 0);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(8.5, 16, 12), main); skull.castShadow = true;
    const muzzle = new THREE.Mesh(new THREE.ConeGeometry(4.2, 10, 8), bone);
    muzzle.rotation.x = Math.PI / 2; muzzle.position.set(0, -3, 9);
    const eyeL = new THREE.Mesh(new THREE.SphereGeometry(1.7, 8, 6), accent);
    const eyeR = eyeL.clone();
    eyeL.position.set(-3.2, 1.5, 7.2); eyeR.position.set(3.2, 1.5, 7.2);
    head.add(skull, muzzle, eyeL, eyeR); g.add(head);

    // Arms — shoulder pivot groups (right arm wields / attacks)
    const mkArm = (sx: number) => {
      const sh = new THREE.Group(); sh.position.set(sx, 36, 0);
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(3.7, 13, 3, 6), main);
      arm.position.y = -8; arm.castShadow = true;
      sh.add(arm); g.add(sh); return sh;
    };
    const armL = mkArm(-12), armR = mkArm(12);
    rig.armL = armL; rig.armR = armR;

    if (classKey === 'stag_druid') {
      for (const side of [-1, 1]) {
        const antler = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.5, 22, 6), bone);
        antler.position.set(side * 6, 12, -1); antler.rotation.z = side * -0.45;
        const tine = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.1, 13, 5), bone);
        tine.position.set(side * 10, 19, -1); tine.rotation.z = side * -0.9;
        head.add(antler, tine);
      }
      const staff = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.4, 58, 7), bone);
      staff.position.set(2, 6, 4); staff.castShadow = true;
      const gem = new THREE.Mesh(new THREE.IcosahedronGeometry(5.5, 0), accent);
      gem.position.set(2, 34, 4);
      armR.add(staff, gem);
    } else if (classKey === 'raven_witch') {
      const beak = new THREE.Mesh(new THREE.ConeGeometry(4.5, 14, 4), new THREE.MeshStandardMaterial({ color: 0x141017, roughness: 0.7, flatShading: true }));
      beak.rotation.x = Math.PI / 2; beak.position.set(0, -2, 12); head.add(beak);
      for (const side of [-1, 1]) {
        const wing = new THREE.Mesh(new THREE.ConeGeometry(7, 34, 3), dark);
        wing.position.set(side * 15, 10, -4); wing.rotation.set(0.65, 0.2 * side, side * 0.8);
        wing.castShadow = true; torso.add(wing);
      }
      const orb = new THREE.Mesh(new THREE.SphereGeometry(5, 14, 10), accent);
      orb.position.set(0, -12, 9);
      const light = new THREE.PointLight(color, 0.6, 130); light.position.copy(orb.position);
      armL.add(orb, light);
    } else if (classKey === 'wolf_guardian') {
      for (const side of [-1, 1]) {
        const ear = new THREE.Mesh(new THREE.ConeGeometry(4, 13, 4), main);
        ear.position.set(side * 6.5, 8, 0); ear.rotation.z = side * -0.35; head.add(ear);
      }
      const shield = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 3, 6), metal);
      shield.position.set(0, -8, 9); shield.rotation.set(Math.PI / 2, 0, 0.12);
      const crest = new THREE.Mesh(new THREE.OctahedronGeometry(4, 0), accent);
      crest.position.set(0, -8, 11);
      armL.add(shield, crest);
      const sword = new THREE.Mesh(new THREE.BoxGeometry(3, 38, 4), metal);
      sword.position.set(0, -6, 7); sword.castShadow = true; armR.add(sword);
    } else if (classKey === 'fox_trickster') {
      for (const side of [-1, 1]) {
        const ear = new THREE.Mesh(new THREE.ConeGeometry(4.8, 15, 4), main);
        ear.position.set(side * 6.7, 9, 0); ear.rotation.z = side * -0.45; head.add(ear);
      }
      const daggerL = new THREE.Mesh(new THREE.ConeGeometry(2.5, 21, 4), metal);
      daggerL.position.set(0, -12, 8); daggerL.rotation.x = Math.PI / 2; armL.add(daggerL);
      const daggerR = daggerL.clone(); armR.add(daggerR);
      const tail = new THREE.Mesh(new THREE.CapsuleGeometry(5.5, 30, 4, 10), main);
      tail.position.set(0, 4, -15); tail.rotation.x = -0.8; tail.castShadow = true;
      const tip = new THREE.Mesh(new THREE.SphereGeometry(5.2, 10, 8), bone);
      tip.position.set(0, -10, -27);
      torso.add(tail, tip);
    }

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(15, 19, 24),
      new THREE.MeshBasicMaterial({ color: isLocal ? 0xffe082 : color, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2; ring.position.y = 1; g.add(ring);

    g.userData.rig = rig;
    return g;
  }

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
      const light = new THREE.PointLight(color, 0.6, 160); light.position.y = 36; g.add(light);
    } else if (type === 'bramble_beast') {
      const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true });
      const body = new THREE.Mesh(new THREE.DodecahedronGeometry(24, 0), bodyMat);
      body.scale.set(1.35, 0.9, 1.05);
      body.position.y = 23; body.castShadow = true; g.add(body);
      const head = new THREE.Mesh(new THREE.DodecahedronGeometry(14, 0), bodyMat);
      head.position.set(18, 28, 8); head.castShadow = true; g.add(head);
      const thornMat = new THREE.MeshStandardMaterial({ color: 0x3e5a23, roughness: 1, flatShading: true });
      for (let i = 0; i < 11; i++) {
        const th = new THREE.Mesh(new THREE.ConeGeometry(4, 20, 5), thornMat);
        const a = (i / 11) * Math.PI * 2;
        th.position.set(Math.cos(a) * 24, 25 + Math.sin(i) * 8, Math.sin(a) * 20);
        th.rotation.set(Math.PI / 2, 0, -a); th.castShadow = true; g.add(th);
      }
      for (const side of [-1, 1]) {
        const horn = new THREE.Mesh(new THREE.ConeGeometry(3.2, 18, 6), new THREE.MeshStandardMaterial({ color: 0xa48649, roughness: 1, flatShading: true }));
        horn.position.set(24, 39, side * 8); horn.rotation.set(0, 0, -0.9); g.add(horn);
      }
    } else {
      const bodyMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.3, roughness: 0.5, flatShading: true });
      const body = new THREE.Mesh(new THREE.TetrahedronGeometry(15, 0), bodyMat);
      body.position.y = 18; body.castShadow = true;
      const eyes = new THREE.Mesh(new THREE.SphereGeometry(7, 12, 10), new THREE.MeshStandardMaterial({ color: 0xfff2a8, emissive: 0xffd24a, emissiveIntensity: 0.8 }));
      eyes.position.y = 30;
      for (const side of [-1, 1]) {
        const horn = new THREE.Mesh(new THREE.ConeGeometry(3.2, 15, 5), new THREE.MeshStandardMaterial({ color: 0x2c183a, roughness: 0.7, flatShading: true }));
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

  private createResourceMesh(type: ResourceType): THREE.Group {
    const info = RESOURCE_INFO[type];
    const g = new THREE.Group();
    if (type === 'wood') {
      // small choppable tree (talar)
      const stump = new THREE.Mesh(new THREE.CylinderGeometry(9, 10, 6, 8), new THREE.MeshStandardMaterial({ color: 0x8a5a34, roughness: 1, flatShading: true }));
      stump.position.y = 3; g.add(stump);
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 7.5, 32, 7), new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 1, flatShading: true }));
      trunk.position.y = 20; trunk.castShadow = true; g.add(trunk);
      const leafMat = new THREE.MeshStandardMaterial({ color: 0x4f9e57, roughness: 1, flatShading: true });
      for (let i = 0; i < 2; i++) {
        const leaf = new THREE.Mesh(new THREE.ConeGeometry(20 - i * 5, 30, 7), leafMat);
        leaf.position.y = 40 + i * 12; leaf.castShadow = true; g.add(leaf);
      }
    } else if (type === 'stone') {
      // ore boulder (minar)
      const rockMat = new THREE.MeshStandardMaterial({ color: info.color, roughness: 1, flatShading: true });
      const main = new THREE.Mesh(new THREE.DodecahedronGeometry(15, 0), rockMat);
      main.position.y = 12; main.scale.set(1.1, 0.9, 1); main.castShadow = true; g.add(main);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const r = new THREE.Mesh(new THREE.DodecahedronGeometry(6 - i, 0), rockMat);
        r.position.set(Math.cos(a) * 13, 5, Math.sin(a) * 13); r.castShadow = true; g.add(r);
      }
      const oreMat = new THREE.MeshStandardMaterial({ color: 0xcdd6e0, emissive: 0x7c8aa0, emissiveIntensity: 1.1, roughness: 0.5, flatShading: true });
      for (const p of [[4, 16, 7], [-6, 13, 4], [2, 10, -7]]) {
        const ore = new THREE.Mesh(new THREE.OctahedronGeometry(3, 0), oreMat);
        ore.position.set(p[0], p[1], p[2]); g.add(ore);
      }
    } else {
      // essence / rune_shard: glowing crystal cluster
      const cmat = new THREE.MeshStandardMaterial({ color: info.color, emissive: info.color, emissiveIntensity: 1.5, roughness: 0.2, flatShading: true });
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
      const stones = new THREE.Mesh(new THREE.TorusGeometry(16, 5, 6, 14), new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 1, flatShading: true }));
      stones.rotation.x = -Math.PI / 2; stones.position.y = 4;
      const fire = new THREE.Mesh(new THREE.ConeGeometry(11, 30, 8), new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.9 }));
      fire.position.y = 18; fire.name = 'fire';
      const light = new THREE.PointLight(def.color, 1.2, def.radius); light.position.y = 24; g.add(light);
      g.add(stones, fire);
      // soft heal-radius ring
      const aura = new THREE.Mesh(new THREE.RingGeometry(def.radius - 4, def.radius, 40), new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.12, side: THREE.DoubleSide }));
      aura.rotation.x = -Math.PI / 2; aura.position.y = 1; g.add(aura);
    } else if (type === 'wall') {
      const mat = new THREE.MeshStandardMaterial({ color: def.color, roughness: 1, flatShading: true });
      const body = new THREE.Mesh(new THREE.BoxGeometry(74, 46, 26), mat);
      body.position.y = 23; body.castShadow = true; body.receiveShadow = true; g.add(body);
      for (let i = -1; i <= 1; i++) {
        const cr = new THREE.Mesh(new THREE.BoxGeometry(16, 12, 26), mat);
        cr.position.set(i * 27, 52, 0); cr.castShadow = true; g.add(cr);
      }
      const seam = new THREE.Mesh(new THREE.BoxGeometry(75, 4, 27), new THREE.MeshStandardMaterial({ color: 0x6f6354, roughness: 1, flatShading: true }));
      seam.position.y = 30; g.add(seam);
    } else if (type === 'barracks') {
      const tent = new THREE.Mesh(new THREE.ConeGeometry(34, 46, 4), new THREE.MeshStandardMaterial({ color: def.color, roughness: 1, flatShading: true }));
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
      const base = new THREE.Mesh(new THREE.BoxGeometry(52, 34, 46), new THREE.MeshStandardMaterial({ color: 0xb9a07a, roughness: 1, flatShading: true }));
      base.position.y = 17; base.castShadow = true; base.receiveShadow = true; g.add(base);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(42, 28, 4), new THREE.MeshStandardMaterial({ color: def.color, roughness: 1, flatShading: true }));
      roof.rotation.y = Math.PI / 4; roof.position.y = 48; roof.castShadow = true; g.add(roof);
      const door = new THREE.Mesh(new THREE.BoxGeometry(14, 22, 2), new THREE.MeshStandardMaterial({ color: 0x4a3420, roughness: 1, emissive: 0xffcf6a, emissiveIntensity: 0.6 }));
      door.position.set(0, 11, 24); g.add(door);
      const beacon = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 90, 8), new THREE.MeshBasicMaterial({ color: 0x9fd6ff, transparent: true, opacity: 0.32 }));
      beacon.position.y = 78; g.add(beacon);
      const light = new THREE.PointLight(0xffe0a0, 0.9, 220); light.position.set(0, 26, 0); g.add(light);
      const aura = new THREE.Mesh(new THREE.RingGeometry(def.radius - 4, def.radius, 48), new THREE.MeshBasicMaterial({ color: 0x9fd6ff, transparent: true, opacity: 0.07, side: THREE.DoubleSide }));
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

    const addPlayer = (p: RealmRoomState['players'] extends Map<string, infer P> ? P : never, id: string) => {
      if (this.players.has(id)) return;
      const isLocal = id === this.localId;
      const group = this.createPlayerMesh(p.classKey, isLocal);
      group.position.set(p.x, 0, p.y);
      const rig = group.userData.rig as Rig | undefined;
      const label = this.makeLabel();
      label.sprite.position.set(0, 66, 0);
      group.add(label.sprite);
      this.scene.add(group);
      this.players.set(id, { group, target: new THREE.Vector3(p.x, 0, p.y), faceTarget: 0, kind: 'player', name: p.alias, label, rig, lastPos: new THREE.Vector3(p.x, 0, p.y) });
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
        const group = this.createEnemyMesh(en.type);
        group.position.set(en.x, 0, en.y);
        group.visible = en.isAlive;
        const label = this.makeLabel();
        label.sprite.position.set(0, 64, 0);
        group.add(label.sprite);
        this.scene.add(group);
        this.enemies.set(id, { group, target: new THREE.Vector3(en.x, 0, en.y), faceTarget: 0, kind: 'enemy', type: en.type, name: ENEMY_NAMES[en.type] ?? en.type, bob: Math.random() * 6, label });
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
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointermove', (e) => this.updateAim(e));
    canvas.addEventListener('pointerdown', (e) => {
      this.updateAim(e);
      if (this.buildMode) { if (e.button === 2) this.cancelBuild(); else this.confirmBuild(); return; }
      // Left/primary click (or tap) sets a move destination; right-click attacks.
      if (e.button === 2) this.queueBasicAttack();
      else this.setMoveTargetFromPointer(e);
    });
    const isTouch = window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
    if (isTouch) this.buildTouchControls();
  }

  private queueBasicAttack() { this.queuedAbility = 'basic'; }

  private toggleCamera() {
    this.cameraMode = this.cameraMode === 'iso' ? 'third' : 'iso';
    const btn = document.getElementById('cambtn3d');
    if (btn) btn.textContent = this.cameraMode === 'iso' ? '🎥 Vista' : '🎥 3ª pers.';
    this.showToast(this.cameraMode === 'iso' ? 'Vista aérea' : 'Vista en tercera persona');
  }

  private setMoveTargetFromPointer(e: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, hit)) return;
    hit.x = clamp(hit.x, 30, WORLD.width - 30);
    hit.z = clamp(hit.z, 30, WORLD.height - 30);
    this.moveTarget = hit;
    this.spawnMoveMarker(hit);
  }

  private spawnMoveMarker(p: THREE.Vector3) {
    if (!this.moveMarker) {
      this.moveMarker = new THREE.Mesh(
        new THREE.RingGeometry(10, 16, 28),
        new THREE.MeshBasicMaterial({ color: 0xffe082, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
      );
      this.moveMarker.rotation.x = -Math.PI / 2;
      this.scene.add(this.moveMarker);
    }
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
    if (code === 'Escape' && this.settingsOpen) this.closeSettings();
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
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) dx -= 1;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) dx += 1;
    if (this.keys['KeyW'] || this.keys['ArrowUp']) dy -= 1;
    if (this.keys['KeyS'] || this.keys['ArrowDown']) dy += 1;
    dx += this.joyDx; dy += this.joyDy;

    // Manual input (keys/joystick) cancels click-to-move; otherwise steer to target.
    if (dx !== 0 || dy !== 0) {
      this.clearMoveTarget();
    } else if (this.moveTarget) {
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
    else if (this.keys['KeyJ'] || this.keys['Space']) abilityKey = 'basic';
    else if (this.keys['KeyQ']) abilityKey = 'q';
    else if (this.keys['KeyR']) abilityKey = 'r';

    if (dx === 0 && dy === 0 && abilityKey === null) return null;
    if (abilityKey) { const me = this.players.get(this.localId); if (me?.rig) me.rig.attack = 1; }
    // Abilities auto-aim the nearest foe (no cursor aiming in click-to-move mode).
    const aim = abilityKey ? this.autoAim() : this.aim;
    return { seq: this.seq++, dx, dy, abilityKey, aimX: aim.x, aimY: aim.z, timestamp: Date.now() };
  }

  private clearMoveTarget() {
    this.moveTarget = null;
    if (this.moveMarker) this.moveMarker.visible = false;
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

  private animateRig(e: Entity, dt: number, time: number) {
    const rig = e.rig; if (!rig) return;
    const cur = e.group.position;
    if (!e.lastPos) e.lastPos = cur.clone();
    const dx = cur.x - e.lastPos.x, dz = cur.z - e.lastPos.z;
    const speed = Math.hypot(dx, dz) / Math.max(dt, 0.001);
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
      (this.fireflies.material as THREE.PointsMaterial).opacity = 0.7 + Math.sin(time * 2) * 0.15;
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
      this.animateRig(e, dt, time);
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
    if (this.cameraMode === 'third' && me) {
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
        #game-hud3d #settingsbtn3d{position:absolute;top:10px;right:12px;pointer-events:auto;background:rgba(10,16,26,.6);
          color:#fff;border:1px solid rgba(255,255,255,.3);border-radius:8px;padding:6px 14px;font-size:13px;cursor:pointer}
        #game-hud3d #cambtn3d{position:absolute;bottom:52px;left:12px;pointer-events:auto;background:rgba(10,16,26,.6);
          color:#fff;border:1px solid rgba(255,255,255,.3);border-radius:8px;padding:6px 14px;font-size:13px;cursor:pointer}
        #game-hud3d #respawn3d{position:absolute;top:44%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,.78);
          color:#ff6b6b;border:2px solid #ff5252;border-radius:12px;padding:16px 30px;font-weight:bold;text-align:center;display:none}
        #game-hud3d #build3d{position:absolute;bottom:14px;left:50%;transform:translateX(-50%);display:none;flex-wrap:wrap;justify-content:center;gap:8px;max-width:min(620px,96vw);pointer-events:auto}
        #game-hud3d #build3d button{background:rgba(10,16,26,.85);color:#fff;border:1px solid rgba(255,255,255,.3);border-radius:8px;
          padding:8px 12px;font-size:12px;cursor:pointer;text-align:center;min-width:120px}
        #game-hud3d #buildbtn3d{position:absolute;bottom:14px;left:12px;pointer-events:auto;background:rgba(10,16,26,.7);color:#fff;
          border:1px solid rgba(255,255,255,.3);border-radius:8px;padding:8px 12px;font-size:13px;cursor:pointer}
        #game-hud3d .controls{position:absolute;bottom:90px;left:12px;font-size:10px;color:rgba(255,255,255,.55)}
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
      <div class="controls">Clic: mover · Clic der./J: atacar · Q/R: habilidades · F: recolectar · B: construir · V: vista</div>
      <button id="back3d">← Volver al campamento</button>
      <button id="settingsbtn3d">Ajustes</button>
      <button id="cambtn3d">🎥 Vista</button>
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
    document.getElementById('buildbtn3d')!.addEventListener('click', () => this.toggleBuildMenu());
    document.getElementById('closeSettings3d')!.addEventListener('click', () => this.closeSettings());
    document.getElementById('leaveGame3d')!.addEventListener('click', () => this.leaveToLobby());
    document.getElementById('installpwa3d')!.addEventListener('click', () => void this.installPWA());
    document.getElementById('fullscreen3d')!.addEventListener('click', () => void this.enterFullscreen());
    el.querySelectorAll<HTMLElement>('#build3d button').forEach((b) => {
      b.addEventListener('click', () => this.selectBuild(b.dataset.build as StructureType));
    });
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
      if (this.buildMode) { hint.style.display = 'block'; hint.textContent = 'Clic para construir · clic der./Esc cancela'; }
      else if (this.nearestNodeId) {
        const verb = this.nearestNodeType === 'wood' ? '🪓 Talar madera'
          : this.nearestNodeType === 'stone' ? '⛏️ Minar piedra'
          : this.nearestNodeType === 'rune_shard' ? '◈ Extraer runa'
          : '✦ Recoger esencia';
        hint.style.display = 'block'; hint.textContent = `F · ${verb}`;
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
        #ab3d button[data-ab="r"]::before{content:"✸"} #ab3d button[data-ab="r"]::after{content:"Especial"}
        #ab3d button[data-ab="basic"]::before{content:"⚔️"} #ab3d button[data-ab="basic"]::after{content:"Atacar"}
        #ab3d button[data-act="harvest"]::before{content:"✋"} #ab3d button[data-act="harvest"]::after{content:"Coger"}
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
    this.players.forEach((e) => disposeGroup(e.group));
    this.enemies.forEach((e) => disposeGroup(e.group));
    this.sanctuaries.forEach((s) => disposeGroup(s.group));
    this.resourceMeshes.forEach((g) => disposeGroup(g));
    this.structureMeshes.forEach((g) => disposeGroup(g));
    if (this.buildGhost) disposeSingleMesh(this.buildGhost);
    if (this.moveMarker) disposeSingleMesh(this.moveMarker);
    if (this.fireflies) disposeGroup(this.fireflies);
    this.composer?.dispose();
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
