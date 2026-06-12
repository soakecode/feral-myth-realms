import * as THREE from 'three';
import { buildHeroMesh, CLASS_COLORS } from '../game3d/heroMesh.js';
import { HERO_MODELS, instantiateModel } from '../game3d/models.js';

/**
 * Class portraits rendered offscreen from the REAL in-game 3D hero models —
 * what you choose is exactly what you play. The professional GLB model is
 * preferred; the procedural hero only covers load failures.
 */

const TRANSPARENT_PX = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const cacheSync = new Map<string, string>();
const cacheGlb = new Map<string, Promise<string>>();

function snapshot(subject: THREE.Object3D, classKey: string, lookY: number, camY: number, camZ: number): string {
  const W = 256, H = 320;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(W, H);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  const color = CLASS_COLORS[classKey] ?? 0xffffff;
  scene.add(new THREE.HemisphereLight(0xbfd2e8, 0x2a2118, 0.9));
  const key = new THREE.DirectionalLight(0xfff0d8, 2.2);
  key.position.set(60, 90, 80);
  scene.add(key);
  const rim = new THREE.DirectionalLight(color, 1.6);
  rim.position.set(-70, 50, -60);
  scene.add(rim);
  scene.add(subject);

  const camera = new THREE.PerspectiveCamera(34, W / H, 1, 500);
  camera.position.set(14, camY, camZ);
  camera.lookAt(0, lookY, 0);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');

  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    if (m.material) {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      mats.forEach((mt) => (mt as THREE.Material).dispose());
    }
  });
  renderer.dispose();
  return url;
}

/** Instant portrait from the procedural fallback hero (placeholder). */
export function getClassPortrait(classKey: string): string {
  const hit = cacheSync.get(classKey);
  if (hit) return hit;
  try {
    const hero = buildHeroMesh(classKey, false, false);
    hero.rotation.y = 0.5;
    const url = snapshot(hero, classKey, 32, 48, 96);
    cacheSync.set(classKey, url);
    return url;
  } catch {
    cacheSync.set(classKey, TRANSPARENT_PX);
    return TRANSPARENT_PX;
  }
}

/** High-quality portrait from the GLB model (async; falls back to procedural). */
export function loadClassPortrait(classKey: string): Promise<string> {
  let p = cacheGlb.get(classKey);
  if (!p) {
    p = (async () => {
      try {
        const ri = await instantiateModel(HERO_MODELS[classKey] ?? HERO_MODELS.stag_druid, 62);
        if (!ri) return getClassPortrait(classKey);
        ri.mixer.update(0.55); // settle into the idle pose, out of the bind pose
        ri.group.rotation.y = 0.45;
        return snapshot(ri.group, classKey, 30, 44, 92);
      } catch {
        return getClassPortrait(classKey);
      }
    })();
    cacheGlb.set(classKey, p);
  }
  return p;
}
