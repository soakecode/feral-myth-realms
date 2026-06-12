import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

/**
 * Professional CC0 character models (KayKit — Kay Lousberg) with full skeletal
 * animation, replacing the procedural "doll" meshes. Loaded on demand and
 * cached; every consumer must keep a procedural fallback for load failures.
 */

export const HERO_MODELS: Record<string, string> = {
  stag_druid: '/models/Barbarian.glb',
  raven_witch: '/models/Mage.glb',
  wolf_guardian: '/models/Knight.glb',
  fox_trickster: '/models/Rogue.glb',
};

export const ENEMY_MODELS: Record<string, string> = {
  bramble_beast: '/models/Skeleton_Warrior.glb',
  rune_imp: '/models/Skeleton_Mage.glb',
  // wisp stays procedural — it's a glowing spirit, not a body
};

export const ENEMY_MODEL_HEIGHTS: Record<string, number> = {
  bramble_beast: 54,
  rune_imp: 48,
};

interface LoadedModel {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
  height: number;
}

const loader = new GLTFLoader();
const cache = new Map<string, Promise<LoadedModel | null>>();

export function preloadModel(url: string): Promise<LoadedModel | null> {
  let p = cache.get(url);
  if (!p) {
    p = loader.loadAsync(url).then((gltf) => {
      const scene = gltf.scene as THREE.Group;
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) { m.castShadow = true; m.frustumCulled = false; }
      });
      const box = new THREE.Box3().setFromObject(scene);
      return { scene, animations: gltf.animations, height: Math.max(0.001, box.max.y - box.min.y) };
    }).catch((err) => {
      console.warn('[models] failed to load', url, err);
      return null;
    });
    cache.set(url, p);
  }
  return p;
}

export interface RiggedActions {
  idle?: THREE.AnimationAction;
  walk?: THREE.AnimationAction;
  attack?: THREE.AnimationAction;
}

export interface RiggedInstance {
  group: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: RiggedActions;
}

/** Clone a cached model (skeleton-aware), scaled to a world-units height. */
export async function instantiateModel(url: string, targetHeight: number): Promise<RiggedInstance | null> {
  const model = await preloadModel(url);
  if (!model) return null;
  const inst = skeletonClone(model.scene) as THREE.Group;
  inst.scale.setScalar(targetHeight / model.height);
  const wrapper = new THREE.Group();
  wrapper.add(inst);

  const mixer = new THREE.AnimationMixer(inst);
  const find = (re: RegExp) => model.animations.find((c) => re.test(c.name));
  const idleClip = find(/^idle$/i) ?? find(/idle/i) ?? model.animations[0];
  const walkClip = find(/walking_a/i) ?? find(/walk/i) ?? find(/run/i);
  const attackClip = find(/melee_attack_(chop|slice)/i) ?? find(/attack|slash|chop|cast|punch|stab/i);
  const actions: RiggedActions = {};
  if (idleClip) { actions.idle = mixer.clipAction(idleClip); actions.idle.play(); }
  if (walkClip) actions.walk = mixer.clipAction(walkClip);
  if (attackClip) {
    actions.attack = mixer.clipAction(attackClip);
    actions.attack.setLoop(THREE.LoopOnce, 1);
    actions.attack.clampWhenFinished = false;
  }
  return { group: wrapper, mixer, actions };
}
