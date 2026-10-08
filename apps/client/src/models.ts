import * as THREE from 'three';
import type { CharacterId } from '@pta/shared';

/**
 * Modelos 3D procedurales de los cuatro personajes (generados localmente por código;
 * ver ASSET_SOURCES.md). Cada modelo se construye por partes (cabeza, extremidades,
 * cola, rasgos) para poder animarlo: reposo, desplazamiento, ataque, recarga,
 * habilidad y debilitamiento. Altura visual ≈1,4 m dentro de la cápsula de 1,5 m.
 */

export interface Pose {
  speed: number;        // 0..1 respecto a la velocidad de carrera
  crouch: boolean;
  firing: boolean;      // disparó hace <150 ms
  reloading: boolean;
  throwing: boolean;    // usó habilidad/granada hace <300 ms
  interacting: boolean;
  dead: boolean;
}

export interface CharacterModel {
  root: THREE.Group;
  /** punto del que salen los ataques (boca/frente) */
  muzzle: THREE.Object3D;
  update(pose: Pose, time: number): void;
  dispose(): void;
}

const MAT_CACHE = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: number, emissive = 0): THREE.MeshStandardMaterial {
  const key = `${color}-${emissive}`;
  let m = MAT_CACHE.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05, emissive, emissiveIntensity: emissive ? 0.6 : 0 });
    MAT_CACHE.set(key, m);
  }
  return m;
}

const SPHERE = new THREE.SphereGeometry(1, 20, 14);
const CONE = new THREE.ConeGeometry(1, 1, 10);
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 10);

function sphere(r: number, color: number, sx = 1, sy = 1, sz = 1): THREE.Mesh {
  const m = new THREE.Mesh(SPHERE, mat(color));
  m.scale.set(r * sx, r * sy, r * sz);
  m.castShadow = true;
  return m;
}
function cone(r: number, h: number, color: number): THREE.Mesh {
  const m = new THREE.Mesh(CONE, mat(color));
  m.scale.set(r, h, r);
  m.castShadow = true;
  return m;
}
function box(w: number, h: number, d: number, color: number): THREE.Mesh {
  const m = new THREE.Mesh(BOX, mat(color));
  m.scale.set(w, h, d);
  m.castShadow = true;
  return m;
}
function cyl(r: number, h: number, color: number): THREE.Mesh {
  const m = new THREE.Mesh(CYL, mat(color));
  m.scale.set(r, h, r);
  m.castShadow = true;
  return m;
}

function eyes(head: THREE.Object3D, y: number, z: number, sep: number, r = 0.045, color = 0x222222): void {
  for (const s of [-1, 1]) {
    const e = sphere(r, color);
    e.position.set(sep * s, y, z);
    head.add(e);
  }
}

interface Rig {
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  armL?: THREE.Group;
  armR?: THREE.Group;
  legBL?: THREE.Group;
  legBR?: THREE.Group;
  tail?: THREE.Group;
  flame?: THREE.Mesh;
  orb: THREE.Mesh;        // orbe de energía (recarga/ataque)
  muzzle: THREE.Object3D;
  quad: boolean;
}

function makeOrb(color: number): THREE.Mesh {
  const g = new THREE.Mesh(SPHERE, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0 }));
  g.scale.setScalar(0.09);
  return g;
}

// ===== Pikachu: amarillo, orejas largas con punta negra, mejillas rojas, cola en rayo =====
function buildPikachu(): Rig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const YELLOW = 0xf7d02c;

  const torso = sphere(0.33, YELLOW, 1, 1.2, 0.92);
  torso.position.y = 0.62;
  body.add(torso);

  const head = new THREE.Group();
  head.position.y = 1.08;
  body.add(head);
  const skull = sphere(0.3, YELLOW, 1, 0.95, 0.95);
  head.add(skull);
  eyes(head, 0.08, -0.24, 0.13, 0.05);
  for (const s of [-1, 1]) {
    const cheek = sphere(0.07, 0xdd3b3b, 1, 1, 0.4);
    cheek.position.set(0.22 * s, -0.04, -0.2);
    head.add(cheek);
    const ear = new THREE.Group();
    ear.position.set(0.16 * s, 0.22, 0);
    ear.rotation.z = -0.5 * s;
    const earBase = cone(0.085, 0.46, YELLOW);
    earBase.position.y = 0.23;
    const earTip = cone(0.055, 0.17, 0x1c1c1c);
    earTip.position.y = 0.46;
    ear.add(earBase, earTip);
    head.add(ear);
  }
  const nose = sphere(0.025, 0x333333);
  nose.position.set(0, 0, -0.29);
  head.add(nose);

  const legL = new THREE.Group();
  const legR = new THREE.Group();
  legL.position.set(-0.13, 0.3, 0);
  legR.position.set(0.13, 0.3, 0);
  for (const [g, s] of [[legL, -1], [legR, 1]] as const) {
    const leg = sphere(0.1, YELLOW, 0.8, 1.6, 0.9);
    leg.position.y = -0.15;
    g.add(leg);
    void s;
  }
  body.add(legL, legR);

  const armL = new THREE.Group();
  const armR = new THREE.Group();
  armL.position.set(-0.3, 0.78, -0.05);
  armR.position.set(0.3, 0.78, -0.05);
  for (const g of [armL, armR]) {
    const arm = sphere(0.075, YELLOW, 0.9, 1.5, 0.9);
    arm.position.y = -0.1;
    g.add(arm);
  }
  body.add(armL, armR);

  // Cola en rayo: segmentos planos en zigzag
  const tail = new THREE.Group();
  tail.position.set(0.05, 0.62, 0.3);
  const segs = [
    { w: 0.09, h: 0.16, x: 0.03, y: 0.08, rz: 0.6 },
    { w: 0.12, h: 0.2, x: -0.07, y: 0.22, rz: -0.6 },
    { w: 0.16, h: 0.26, x: 0.05, y: 0.4, rz: 0.5 },
    { w: 0.26, h: 0.3, x: -0.03, y: 0.58, rz: -0.2 },
  ];
  for (const sgm of segs) {
    const b = box(sgm.w, sgm.h, 0.035, 0xcfa21a);
    b.position.set(sgm.x, sgm.y, 0.06);
    b.rotation.z = sgm.rz;
    tail.add(b);
  }
  body.add(tail);

  const orb = makeOrb(0xffe84a);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 1.08, -0.34);
  muzzle.add(orb);
  body.add(muzzle);

  return { root, body, head, legL, legR, armL, armR, tail, orb, muzzle, quad: false };
}

// ===== Charmander: naranja, vientre crema, hocico, cola con llama =====
function buildCharmander(): Rig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const ORANGE = 0xee8130;

  const torso = sphere(0.32, ORANGE, 1, 1.25, 0.95);
  torso.position.y = 0.6;
  body.add(torso);
  const belly = sphere(0.26, 0xf6e3b4, 0.85, 1.05, 0.5);
  belly.position.set(0, 0.56, -0.14);
  body.add(belly);

  const head = new THREE.Group();
  head.position.y = 1.1;
  body.add(head);
  const skull = sphere(0.26, ORANGE, 1, 1, 1);
  head.add(skull);
  const snout = sphere(0.13, ORANGE, 1, 0.7, 1.1);
  snout.position.set(0, -0.07, -0.2);
  head.add(snout);
  eyes(head, 0.09, -0.2, 0.12, 0.045, 0x2b55aa);

  const legL = new THREE.Group();
  const legR = new THREE.Group();
  legL.position.set(-0.14, 0.3, 0);
  legR.position.set(0.14, 0.3, 0);
  for (const g of [legL, legR]) {
    const leg = sphere(0.11, ORANGE, 0.9, 1.5, 1);
    leg.position.y = -0.14;
    g.add(leg);
  }
  body.add(legL, legR);

  const armL = new THREE.Group();
  const armR = new THREE.Group();
  armL.position.set(-0.29, 0.75, -0.05);
  armR.position.set(0.29, 0.75, -0.05);
  for (const g of [armL, armR]) {
    const arm = sphere(0.08, ORANGE, 0.9, 1.4, 0.9);
    arm.position.y = -0.1;
    g.add(arm);
  }
  body.add(armL, armR);

  const tail = new THREE.Group();
  tail.position.set(0, 0.42, 0.26);
  const t1 = cyl(0.065, 0.38, ORANGE);
  t1.rotation.x = 1.25;
  t1.position.set(0, 0.02, 0.16);
  const t2 = cyl(0.045, 0.24, ORANGE);
  t2.rotation.x = 0.35;
  t2.position.set(0, 0.1, 0.34);
  tail.add(t1, t2);
  const flame = new THREE.Mesh(CONE, new THREE.MeshBasicMaterial({ color: 0xffa02f, transparent: true, opacity: 0.95 }));
  flame.scale.set(0.07, 0.17, 0.07);
  flame.position.set(0, 0.3, 0.4);
  tail.add(flame);
  const flameCore = new THREE.Mesh(CONE, new THREE.MeshBasicMaterial({ color: 0xffe84a }));
  flameCore.scale.set(0.035, 0.09, 0.035);
  flameCore.position.set(0, 0.26, 0.4);
  tail.add(flameCore);
  body.add(tail);

  const orb = makeOrb(0xff7a2f);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 1.03, -0.38);
  muzzle.add(orb);
  body.add(muzzle);

  return { root, body, head, legL, legR, armL, armR, tail, flame, orb, muzzle, quad: false };
}

// ===== Squirtle: azul, caparazón marrón con borde claro, vientre segmentado, cola curvada =====
function buildSquirtle(): Rig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const BLUE = 0x6390f0;

  const torso = sphere(0.3, BLUE, 1, 1.2, 0.9);
  torso.position.y = 0.58;
  body.add(torso);
  const shell = sphere(0.3, 0x8a5a2b, 1.05, 1.1, 0.75);
  shell.position.set(0, 0.6, 0.14);
  body.add(shell);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.045, 8, 20), mat(0xf3ead0));
  rim.position.set(0, 0.6, 0.02);
  rim.rotation.x = 0.1;
  rim.castShadow = true;
  body.add(rim);
  // Vientre segmentado
  for (let i = 0; i < 3; i++) {
    const seg = box(0.3 - i * 0.05, 0.09, 0.06, 0xf3ead0);
    seg.position.set(0, 0.42 + i * 0.12, -0.235);
    body.add(seg);
  }

  const head = new THREE.Group();
  head.position.y = 1.05;
  body.add(head);
  const skull = sphere(0.27, BLUE, 1, 1, 1);
  head.add(skull);
  eyes(head, 0.08, -0.21, 0.12, 0.05, 0x7a3b2e);

  const legL = new THREE.Group();
  const legR = new THREE.Group();
  legL.position.set(-0.14, 0.28, 0);
  legR.position.set(0.14, 0.28, 0);
  for (const g of [legL, legR]) {
    const leg = sphere(0.11, BLUE, 0.9, 1.4, 1);
    leg.position.y = -0.12;
    g.add(leg);
  }
  body.add(legL, legR);

  const armL = new THREE.Group();
  const armR = new THREE.Group();
  armL.position.set(-0.28, 0.72, -0.05);
  armR.position.set(0.28, 0.72, -0.05);
  for (const g of [armL, armR]) {
    const arm = sphere(0.08, BLUE, 0.9, 1.4, 0.9);
    arm.position.y = -0.1;
    g.add(arm);
  }
  body.add(armL, armR);

  // Cola curvada: arco de toro
  const tail = new THREE.Group();
  const curl = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.06, 8, 14, Math.PI * 1.4), mat(BLUE));
  curl.position.set(0, 0.42, 0.34);
  curl.rotation.y = Math.PI / 2;
  curl.castShadow = true;
  tail.add(curl);
  body.add(tail);

  const orb = makeOrb(0x74c6ff);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 1.0, -0.36);
  muzzle.add(orb);
  body.add(muzzle);

  return { root, body, head, legL, legR, armL, armR, tail, orb, muzzle, quad: false };
}

// ===== Bulbasaur: cuadrúpedo turquesa, manchas, ojos rojizos, bulbo verde separado =====
function buildBulbasaur(): Rig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const TEAL = 0x59b5a2;

  const torso = sphere(0.34, TEAL, 1.15, 0.85, 1.25);
  torso.position.y = 0.5;
  body.add(torso);
  // Manchas
  const spots = [[-0.2, 0.62, -0.25], [0.24, 0.55, 0.1], [-0.15, 0.42, 0.3]] as const;
  for (const [x, y, z] of spots) {
    const sp = sphere(0.075, 0x2f7465, 1, 0.5, 1);
    sp.position.set(x, y, z);
    body.add(sp);
  }

  const head = new THREE.Group();
  head.position.set(0, 0.78, -0.42);
  body.add(head);
  const skull = sphere(0.26, TEAL, 1.1, 0.9, 0.95);
  head.add(skull);
  eyes(head, 0.07, -0.2, 0.14, 0.05, 0xc23b22);
  for (const s of [-1, 1]) {
    const ear = cone(0.07, 0.14, TEAL);
    ear.position.set(0.14 * s, 0.24, 0.02);
    head.add(ear);
  }

  // Bulbo claramente separado del cuerpo
  const bulb = new THREE.Group();
  bulb.position.set(0, 0.86, 0.22);
  const bulbCore = sphere(0.22, 0x4caf50, 1, 1.15, 1);
  bulb.add(bulbCore);
  for (let i = 0; i < 4; i++) {
    const leaf = cone(0.1, 0.26, 0x2e7d32);
    const a = (i / 4) * Math.PI * 2;
    leaf.position.set(Math.cos(a) * 0.14, 0.16, Math.sin(a) * 0.14);
    leaf.rotation.set(Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9);
    bulb.add(leaf);
  }
  body.add(bulb);

  const mkLeg = (x: number, z: number): THREE.Group => {
    const g = new THREE.Group();
    g.position.set(x, 0.32, z);
    const leg = sphere(0.1, TEAL, 0.9, 1.7, 0.9);
    leg.position.y = -0.16;
    g.add(leg);
    body.add(g);
    return g;
  };
  const legL = mkLeg(-0.22, -0.3);
  const legR = mkLeg(0.22, -0.3);
  const legBL = mkLeg(-0.24, 0.32);
  const legBR = mkLeg(0.24, 0.32);

  const orb = makeOrb(0x8ee67a);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.82, -0.72);
  muzzle.add(orb);
  body.add(muzzle);

  return { root, body, head, legL, legR, legBL, legBR, orb, muzzle, quad: true };
}

const BUILDERS: Record<CharacterId, () => Rig> = {
  pikachu: buildPikachu,
  charmander: buildCharmander,
  squirtle: buildSquirtle,
  bulbasaur: buildBulbasaur,
};

export function createCharacterModel(id: CharacterId): CharacterModel {
  const rig = BUILDERS[id]();
  // Escalar: bípedos ~1,38 m de alto (cabeza ~1,3), cuadrúpedo más bajo y largo
  const update = (pose: Pose, time: number): void => {
    const r = rig;
    const walk = Math.min(1, pose.speed);
    const t = time * 9;
    const swing = Math.sin(t) * 0.7 * walk;
    // Piernas alternas; cuadrúpedo alterna pares diagonales
    r.legL.rotation.x = swing;
    r.legR.rotation.x = -swing;
    if (r.quad && r.legBL && r.legBR) {
      r.legBL.rotation.x = -swing;
      r.legBR.rotation.x = swing;
    }
    if (r.armL && r.armR) {
      r.armL.rotation.x = -swing * 0.8;
      r.armR.rotation.x = swing * 0.8;
    }
    // Balanceo y respiración en reposo
    const breathe = 1 + Math.sin(time * 2.2) * 0.015;
    r.body.scale.set(1, breathe, 1);
    r.body.position.y = Math.abs(Math.sin(t)) * 0.045 * walk;
    if (r.tail) r.tail.rotation.y = Math.sin(time * 2.6) * 0.25 + swing * 0.2;
    if (r.flame) {
      const f = 1 + Math.sin(time * 17) * 0.22 + Math.sin(time * 29) * 0.1;
      r.flame.scale.set(0.07 * f, 0.17 * (2 - f) * f, 0.07 * f);
    }
    // Agacharse: compresión vertical
    const targetS = pose.crouch ? 0.72 : 1;
    r.root.scale.y += (targetS - r.root.scale.y) * 0.25;
    // Ataque: retroceso y orbe
    const orbMat = r.orb.material as THREE.MeshBasicMaterial;
    if (pose.firing) {
      r.head.position.z = 0.05;
      orbMat.opacity = 0.95;
      r.orb.scale.setScalar(0.13);
    } else {
      r.head.position.z *= 0.8;
      orbMat.opacity = pose.reloading ? 0.4 + Math.sin(time * 14) * 0.3 : orbMat.opacity * 0.85;
      r.orb.scale.setScalar(pose.reloading ? 0.09 + Math.sin(time * 14) * 0.03 : 0.09);
    }
    // Lanzar habilidad: brazo arriba (o cabeceo en cuadrúpedo)
    if (pose.throwing) {
      if (r.armR) r.armR.rotation.x = -2.2;
      else r.head.rotation.x = -0.5;
    } else if (!r.quad) {
      r.head.rotation.x *= 0.8;
    }
    if (pose.interacting) {
      r.head.rotation.x = 0.5; // mirar al suelo mientras instala/desactiva
    } else if (!pose.throwing) {
      r.head.rotation.x *= 0.8;
    }
  };

  return {
    root: rig.root,
    muzzle: rig.muzzle,
    update,
    dispose: () => {
      rig.root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh && mesh.material instanceof THREE.MeshBasicMaterial) mesh.material.dispose();
      });
    },
  };
}

export const CHARACTER_COLORS: Record<CharacterId, number> = {
  pikachu: 0xffe84a,
  charmander: 0xff7a2f,
  squirtle: 0x74c6ff,
  bulbasaur: 0x8ee67a,
};
