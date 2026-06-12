import * as THREE from 'three';

/**
 * The hero model used in-game AND for the class-select portraits, so what you
 * pick is exactly what you play — no placeholder art.
 */

export const CLASS_COLORS: Record<string, number> = {
  stag_druid: 0x4caf50, raven_witch: 0x7c4dff, wolf_guardian: 0x90a4ae, fox_trickster: 0xff7043,
};

export interface Rig {
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

export function buildHeroMesh(classKey: string, isLocal: boolean, withRing = true): THREE.Group {
  const color = CLASS_COLORS[classKey] ?? 0xffffff;
  const g = new THREE.Group();
  const main = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color).offsetHSL(0, 0.04, 0.08),
    emissive: new THREE.Color(color).multiplyScalar(0.2),
    emissiveIntensity: isLocal ? 0.34 : 0.2,
    roughness: 0.62,
    metalness: 0.04,
  });
  const dark = new THREE.MeshStandardMaterial({ color: 0x302418, roughness: 0.82 });
  const bone = new THREE.MeshStandardMaterial({ color: 0xf0dca4, emissive: 0x3b2c12, emissiveIntensity: 0.12, roughness: 0.66 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xd9e8ef, roughness: 0.36, metalness: 0.45 });
  const accent = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.45, roughness: 0.3 });

  const rig: Rig = { phase: Math.random() * Math.PI * 2, stride: 0, attack: 0 };

  // Legs — hip pivot groups so they swing while walking
  const mkLeg = (sx: number) => {
    const hip = new THREE.Group(); hip.position.set(sx, 20, 0);
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(4.6, 14, 3, 10), dark);
    leg.position.y = -9; leg.castShadow = true;
    const foot = new THREE.Mesh(new THREE.BoxGeometry(7, 4, 12), dark);
    foot.position.set(0, -18, 3);
    hip.add(leg, foot); g.add(hip); return hip;
  };
  rig.legL = mkLeg(-6); rig.legR = mkLeg(6);

  // Torso
  const torso = new THREE.Group(); torso.position.y = 20;
  const belly = new THREE.Mesh(new THREE.CapsuleGeometry(10, 16, 4, 14), main);
  belly.position.y = 11; belly.castShadow = true;
  const chest = new THREE.Mesh(new THREE.BoxGeometry(21, 16, 13), dark);
  chest.position.y = 16; chest.castShadow = true;
  torso.add(belly, chest); g.add(torso); rig.torso = torso;

  // Head (animal-like, with snout)
  const head = new THREE.Group(); head.position.set(0, 46, 0);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(8.5, 18, 14), main); skull.castShadow = true;
  const muzzle = new THREE.Mesh(new THREE.ConeGeometry(4.2, 10, 10), bone);
  muzzle.rotation.x = Math.PI / 2; muzzle.position.set(0, -3, 9);
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(1.7, 10, 8), accent);
  const eyeR = eyeL.clone();
  eyeL.position.set(-3.2, 1.5, 7.2); eyeR.position.set(3.2, 1.5, 7.2);
  head.add(skull, muzzle, eyeL, eyeR); g.add(head);

  // Arms — shoulder pivot groups (right arm wields / attacks)
  const mkArm = (sx: number) => {
    const sh = new THREE.Group(); sh.position.set(sx, 36, 0);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(3.7, 13, 3, 10), main);
    arm.position.y = -8; arm.castShadow = true;
    sh.add(arm); g.add(sh); return sh;
  };
  const armL = mkArm(-12), armR = mkArm(12);
  rig.armL = armL; rig.armR = armR;

  if (classKey === 'stag_druid') {
    for (const side of [-1, 1]) {
      const antler = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.5, 22, 8), bone);
      antler.position.set(side * 6, 12, -1); antler.rotation.z = side * -0.45;
      const tine = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.1, 13, 7), bone);
      tine.position.set(side * 10, 19, -1); tine.rotation.z = side * -0.9;
      head.add(antler, tine);
    }
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.4, 58, 9), bone);
    staff.position.set(2, 6, 4); staff.castShadow = true;
    const gem = new THREE.Mesh(new THREE.IcosahedronGeometry(5.5, 1), accent);
    gem.position.set(2, 34, 4);
    armR.add(staff, gem);
  } else if (classKey === 'raven_witch') {
    const beak = new THREE.Mesh(new THREE.ConeGeometry(4.5, 14, 8), new THREE.MeshStandardMaterial({ color: 0x141017, roughness: 0.7 }));
    beak.rotation.x = Math.PI / 2; beak.position.set(0, -2, 12); head.add(beak);
    for (const side of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.ConeGeometry(7, 34, 6), dark);
      wing.position.set(side * 15, 10, -4); wing.rotation.set(0.65, 0.2 * side, side * 0.8);
      wing.castShadow = true; torso.add(wing);
    }
    const orb = new THREE.Mesh(new THREE.SphereGeometry(5, 16, 12), accent);
    orb.position.set(0, -12, 9);
    const light = new THREE.PointLight(color, 0.6, 130); light.position.copy(orb.position);
    armL.add(orb, light);
  } else if (classKey === 'wolf_guardian') {
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(4, 13, 8), main);
      ear.position.set(side * 6.5, 8, 0); ear.rotation.z = side * -0.35; head.add(ear);
    }
    const shield = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 3, 12), metal);
    shield.position.set(0, -8, 9); shield.rotation.set(Math.PI / 2, 0, 0.12);
    const crest = new THREE.Mesh(new THREE.OctahedronGeometry(4, 1), accent);
    crest.position.set(0, -8, 11);
    armL.add(shield, crest);
    const sword = new THREE.Mesh(new THREE.BoxGeometry(3, 38, 4), metal);
    sword.position.set(0, -6, 7); sword.castShadow = true; armR.add(sword);
  } else if (classKey === 'fox_trickster') {
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(4.8, 15, 8), main);
      ear.position.set(side * 6.7, 9, 0); ear.rotation.z = side * -0.45; head.add(ear);
    }
    const daggerL = new THREE.Mesh(new THREE.ConeGeometry(2.5, 21, 8), metal);
    daggerL.position.set(0, -12, 8); daggerL.rotation.x = Math.PI / 2; armL.add(daggerL);
    const daggerR = daggerL.clone(); armR.add(daggerR);
    const tail = new THREE.Mesh(new THREE.CapsuleGeometry(5.5, 30, 4, 12), main);
    tail.position.set(0, 4, -15); tail.rotation.x = -0.8; tail.castShadow = true;
    const tip = new THREE.Mesh(new THREE.SphereGeometry(5.2, 12, 10), bone);
    tip.position.set(0, -10, -27);
    torso.add(tail, tip);
  }

  if (withRing) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(15, 19, 24),
      new THREE.MeshBasicMaterial({ color: isLocal ? 0xffe082 : color, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2; ring.position.y = 1; g.add(ring);
  }

  g.userData.rig = rig;
  return g;
}
