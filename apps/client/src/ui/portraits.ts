import * as THREE from 'three';
import { buildHeroMesh, CLASS_COLORS } from '../game3d/heroMesh.js';

/**
 * Class portraits rendered from the REAL in-game 3D hero models with an
 * offscreen renderer — what you choose is exactly what you play.
 */

const cache = new Map<string, string>();

export function getClassPortrait(classKey: string): string {
  const hit = cache.get(classKey);
  if (hit) return hit;
  try {
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

    const hero = buildHeroMesh(classKey, false, false);
    hero.rotation.y = 0.5;
    scene.add(hero);

    const camera = new THREE.PerspectiveCamera(34, W / H, 1, 500);
    camera.position.set(16, 48, 96);
    camera.lookAt(0, 32, 0);

    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/png');

    // free GPU resources — portraits are plain images from here on
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (m.material) {
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        mats.forEach((mt) => (mt as THREE.Material).dispose());
      }
    });
    renderer.dispose();

    cache.set(classKey, url);
    return url;
  } catch {
    // WebGL unavailable: 1×1 transparent pixel; the card gradient carries the look
    const fallback = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    cache.set(classKey, fallback);
    return fallback;
  }
}
