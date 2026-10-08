import * as THREE from 'three';
import type { CharacterId, WeaponId } from '@pta/shared';

/**
 * Modelos 3D procedurales de los cuatro personajes (generados localmente por código;
 * ver ASSET_SOURCES.md). Cada modelo se construye por partes (cabeza, extremidades,
 * cola, rasgos) para poder animarlo: reposo, desplazamiento, ataque, recarga,
 * habilidad y debilitamiento. Altura visual ≈1,4 m dentro de la cápsula de 1,5 m.
 *
 * Cada personaje muestra ante la boca/manos un «orbe de ataque» cuya forma indica el
 * perfil equipado: orbe sencillo (pulso), tres chispas orbitando (ráfaga) u orbe
 * grande con anillo (preciso). El color es el elemental del personaje.
 */

export interface Pose {
  speed: number;        // 0..1 respecto a la velocidad de carrera
  crouch: boolean;
  firing: boolean;      // disparó hace <150 ms
  reloading: boolean;
  throwing: boolean;    // usó habilidad/granada hace <300 ms
  interacting: boolean;
  dead: boolean;
  weapon: WeaponId;
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

/** Ojos con esclerótica blanca y pupila de color (mirando a -Z). */
function eyes(head: THREE.Object3D, y: number, z: number, sep: number, r = 0.055, pupilColor = 0x222222): void {
  for (const s of [-1, 1]) {
    const white = sphere(r, 0xffffff, 1, 1.15, 0.55);
    white.position.set(sep * s, y, z);
    head.add(white);
    const pupil = sphere(r * 0.55, pupilColor, 1, 1, 0.6);
    pupil.position.set(sep * s, y, z - r * 0.45);
    head.add(pupil);
    const glint = sphere(r * 0.18, 0xffffff);
    glint.position.set(sep * s - 0.015, y + r * 0.3, z - r * 0.75);
    head.add(glint);
  }
}

/** Boca: línea oscura fina en la cara frontal. */
function mouth(head: THREE.Object3D, y: number, z: number, w: number): void {
  const m = box(w, 0.018, 0.02, 0x4a2d20);
  m.position.set(0, y, z);
  m.castShadow = false;
  head.add(m);
}

export const CHARACTER_COLORS: Record<CharacterId, number> = {
  pikachu: 0xffe84a,
  charmander: 0xff7a2f,
  squirtle: 0x74c6ff,
  bulbasaur: 0x8ee67a,
};

// ===== Indicador de ataque: la forma del orbe revela el perfil equipado =====

interface AttackIndicator {
  group: THREE.Group;
  variants: Record<WeaponId, THREE.Group>;
  mats: THREE.MeshBasicMaterial[];
}

export function buildAttackIndicator(color: number, scale = 1): AttackIndicator {
  const group = new THREE.Group();
  const mats: THREE.MeshBasicMaterial[] = [];
  const orbMat = (): THREE.MeshBasicMaterial => {
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending });
    mats.push(m);
    return m;
  };

  // Pulso: un orbe sencillo
  const pulso = new THREE.Group();
  const o1 = new THREE.Mesh(SPHERE, orbMat());
  o1.scale.setScalar(0.055 * scale);
  pulso.add(o1);

  // Ráfaga: tres chispas orbitando
  const rafaga = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Mesh(SPHERE, orbMat());
    s.scale.setScalar(0.032 * scale);
    const a = (i / 3) * Math.PI * 2;
    s.position.set(Math.cos(a) * 0.07 * scale, Math.sin(a) * 0.07 * scale, 0);
    rafaga.add(s);
  }

  // Preciso: orbe grande con anillo
  const preciso = new THREE.Group();
  const big = new THREE.Mesh(SPHERE, orbMat());
  big.scale.setScalar(0.08 * scale);
  preciso.add(big);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.13 * scale, 0.012 * scale, 6, 24), orbMat());
  preciso.add(ring);

  group.add(pulso, rafaga, preciso);
  const variants: Record<WeaponId, THREE.Group> = { pulso, rafaga, preciso };
  return { group, variants, mats };
}

export function updateAttackIndicator(ind: AttackIndicator, weapon: WeaponId, time: number, firing: boolean, reloading: boolean): void {
  for (const [k, g] of Object.entries(ind.variants) as [WeaponId, THREE.Group][]) {
    g.visible = k === weapon;
  }
  const active = ind.variants[weapon];
  // Animación: giro de chispas/anillo y latido suave
  active.rotation.z = time * (weapon === 'rafaga' ? 3.2 : 1.1);
  active.rotation.y = weapon === 'preciso' ? time * 1.7 : 0;
  const pulse = 1 + Math.sin(time * 5) * 0.08;
  const boost = firing ? 1.8 : 1;
  active.scale.setScalar(pulse * boost);
  const op = reloading ? 0.25 + Math.abs(Math.sin(time * 12)) * 0.5 : firing ? 1 : 0.8;
  for (const m of ind.mats) m.opacity = op;
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
  indicator: AttackIndicator;
  muzzle: THREE.Object3D;
  quad: boolean;
}

function attachIndicator(body: THREE.Group, color: number, x: number, y: number, z: number): { muzzle: THREE.Object3D; indicator: AttackIndicator } {
  const muzzle = new THREE.Object3D();
  muzzle.position.set(x, y, z);
  const indicator = buildAttackIndicator(color);
  muzzle.add(indicator.group);
  body.add(muzzle);
  return { muzzle, indicator };
}

// ===== Pikachu: amarillo, orejas largas de punta negra, mejillas rojas, rayas, cola en rayo =====
function buildPikachu(): Rig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const YELLOW = 0xf7d02c;
  const BROWN = 0x9a6a2f;

  const torso = sphere(0.32, YELLOW, 1, 1.22, 0.92);
  torso.position.y = 0.6;
  body.add(torso);
  // Rayas marrones de la espalda
  for (const [y, w] of [[0.74, 0.3], [0.6, 0.36]] as const) {
    const stripe = box(w, 0.07, 0.1, BROWN);
    stripe.position.set(0, y, 0.26);
    body.add(stripe);
  }

  const head = new THREE.Group();
  head.position.y = 1.1;
  body.add(head);
  const skull = sphere(0.3, YELLOW, 1, 0.92, 0.95);
  head.add(skull);
  eyes(head, 0.07, -0.24, 0.13, 0.055, 0x1c1c1c);
  mouth(head, -0.1, -0.285, 0.1);
  for (const s of [-1, 1]) {
    const cheek = sphere(0.075, 0xdd3b3b, 1, 1, 0.4);
    cheek.position.set(0.22 * s, -0.05, -0.2);
    head.add(cheek);
    const ear = new THREE.Group();
    ear.position.set(0.14 * s, 0.2, 0.02);
    ear.rotation.z = -0.32 * s;
    ear.rotation.x = 0.12;
    const earBase = cone(0.08, 0.52, YELLOW);
    earBase.position.y = 0.26;
    const earTip = cone(0.052, 0.2, 0x1c1c1c);
    earTip.position.y = 0.54;
    ear.add(earBase, earTip);
    head.add(ear);
  }
  const nose = sphere(0.02, 0x333333);
  nose.position.set(0, -0.02, -0.3);
  head.add(nose);

  const legL = new THREE.Group();
  const legR = new THREE.Group();
  legL.position.set(-0.13, 0.3, 0);
  legR.position.set(0.13, 0.3, 0);
  for (const g of [legL, legR]) {
    const leg = sphere(0.1, YELLOW, 0.8, 1.6, 0.9);
    leg.position.y = -0.15;
    g.add(leg);
    const foot = sphere(0.07, YELLOW, 1, 0.5, 1.7);
    foot.position.set(0, -0.3, -0.05);
    g.add(foot);
  }
  body.add(legL, legR);

  const armL = new THREE.Group();
  const armR = new THREE.Group();
  armL.position.set(-0.28, 0.76, -0.06);
  armR.position.set(0.28, 0.76, -0.06);
  for (const g of [armL, armR]) {
    const arm = sphere(0.07, YELLOW, 0.9, 1.5, 0.9);
    arm.position.y = -0.1;
    g.add(arm);
  }
  body.add(armL, armR);

  // Cola en rayo: base marrón + zigzag amarillo plano (de canto hacia atrás)
  const tail = new THREE.Group();
  tail.position.set(0.06, 0.52, 0.3);
  tail.rotation.x = -0.25;
  const base = box(0.07, 0.14, 0.045, BROWN);
  base.position.set(0, 0.04, 0.03);
  base.rotation.z = 0.5;
  tail.add(base);
  const segs = [
    { w: 0.2, h: 0.09, x: -0.07, y: 0.16, rz: -0.55 },
    { w: 0.09, h: 0.22, x: 0.0, y: 0.3, rz: -0.15 },
    { w: 0.3, h: 0.12, x: 0.09, y: 0.46, rz: -0.5 },
    { w: 0.22, h: 0.26, x: 0.16, y: 0.6, rz: 0.1 },
  ];
  for (const sgm of segs) {
    const b = box(sgm.w, sgm.h, 0.04, 0xf7d02c);
    b.position.set(sgm.x, sgm.y, 0.05);
    b.rotation.z = sgm.rz;
    tail.add(b);
  }
  body.add(tail);

  const { muzzle, indicator } = attachIndicator(body, CHARACTER_COLORS.pikachu, 0, 0.95, -0.58);
  return { root, body, head, legL, legR, armL, armR, tail, indicator, muzzle, quad: false };
}

// ===== Charmander: naranja, vientre crema, hocico con sonrisa, garras, cola con llama =====
function buildCharmander(): Rig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const ORANGE = 0xee8130;
  const CREAM = 0xf6e3b4;

  const torso = sphere(0.31, ORANGE, 1, 1.28, 0.95);
  torso.position.y = 0.6;
  body.add(torso);
  const belly = sphere(0.26, CREAM, 0.85, 1.15, 0.5);
  belly.position.set(0, 0.56, -0.13);
  body.add(belly);

  const head = new THREE.Group();
  head.position.y = 1.12;
  body.add(head);
  const skull = sphere(0.25, ORANGE, 1, 1.02, 1);
  head.add(skull);
  const snout = sphere(0.14, ORANGE, 1, 0.65, 1.15);
  snout.position.set(0, -0.09, -0.18);
  head.add(snout);
  eyes(head, 0.08, -0.19, 0.12, 0.05, 0x2b55aa);
  mouth(head, -0.12, -0.32, 0.14);
  for (const s of [-1, 1]) {
    const nostril = sphere(0.012, 0x7a3c12);
    nostril.position.set(0.045 * s, -0.05, -0.33);
    head.add(nostril);
  }

  const legL = new THREE.Group();
  const legR = new THREE.Group();
  legL.position.set(-0.14, 0.3, 0);
  legR.position.set(0.14, 0.3, 0);
  for (const g of [legL, legR]) {
    const leg = sphere(0.11, ORANGE, 0.9, 1.5, 1);
    leg.position.y = -0.14;
    g.add(leg);
    const foot = sphere(0.08, ORANGE, 1, 0.5, 1.5);
    foot.position.set(0, -0.28, -0.04);
    g.add(foot);
  }
  body.add(legL, legR);

  const armL = new THREE.Group();
  const armR = new THREE.Group();
  armL.position.set(-0.28, 0.76, -0.05);
  armR.position.set(0.28, 0.76, -0.05);
  for (const [g, s] of [[armL, -1], [armR, 1]] as const) {
    const arm = sphere(0.075, ORANGE, 0.9, 1.45, 0.9);
    arm.position.y = -0.1;
    g.add(arm);
    for (let c = 0; c < 2; c++) {
      const claw = cone(0.016, 0.05, 0xffffff);
      claw.position.set(s * 0.015 * (c === 0 ? 1 : -1), -0.21, -0.02 - c * 0.03);
      claw.rotation.x = Math.PI;
      g.add(claw);
    }
  }
  body.add(armL, armR);

  const tail = new THREE.Group();
  tail.position.set(0, 0.4, 0.28);
  const t1 = cyl(0.06, 0.4, ORANGE);
  t1.rotation.x = 1.45;
  t1.position.set(0, 0.0, 0.2);
  const t2 = cyl(0.042, 0.26, ORANGE);
  t2.rotation.x = 0.9;
  t2.position.set(0, 0.08, 0.44);
  tail.add(t1, t2);
  const flame = new THREE.Mesh(CONE, new THREE.MeshBasicMaterial({ color: 0xffa02f, transparent: true, opacity: 0.95 }));
  flame.scale.set(0.07, 0.17, 0.07);
  flame.position.set(0, 0.26, 0.56);
  tail.add(flame);
  const flameCore = new THREE.Mesh(CONE, new THREE.MeshBasicMaterial({ color: 0xffe84a }));
  flameCore.scale.set(0.035, 0.09, 0.035);
  flameCore.position.set(0, 0.22, 0.56);
  tail.add(flameCore);
  body.add(tail);

  const { muzzle, indicator } = attachIndicator(body, CHARACTER_COLORS.charmander, 0, 0.93, -0.6);
  return { root, body, head, legL, legR, armL, armR, tail, flame, indicator, muzzle, quad: false };
}

// ===== Squirtle: azul, caparazón marrón con borde crema, vientre liso, cola rizada =====
function buildSquirtle(): Rig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const BLUE = 0x6390f0;
  const CREAM = 0xf3ead0;
  const SHELL = 0x8a5a2b;

  const torso = sphere(0.29, BLUE, 1, 1.2, 0.9);
  torso.position.y = 0.58;
  body.add(torso);
  const shell = sphere(0.3, SHELL, 1.08, 1.12, 0.72);
  shell.position.set(0, 0.6, 0.15);
  body.add(shell);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.05, 8, 22), mat(CREAM));
  rim.position.set(0, 0.6, 0.0);
  rim.castShadow = true;
  body.add(rim);
  // Vientre: placa crema curvada con costuras
  const plate = sphere(0.24, CREAM, 0.82, 1.02, 0.42);
  plate.position.set(0, 0.56, -0.14);
  body.add(plate);
  for (const y of [0.5, 0.62]) {
    const seam = box(0.3, 0.014, 0.02, 0xc9b98a);
    seam.position.set(0, y, -0.238);
    seam.castShadow = false;
    body.add(seam);
  }

  const head = new THREE.Group();
  head.position.y = 1.07;
  body.add(head);
  const skull = sphere(0.27, BLUE, 1, 1, 1);
  head.add(skull);
  eyes(head, 0.08, -0.21, 0.12, 0.055, 0x7a3b2e);
  mouth(head, -0.08, -0.26, 0.12);

  const legL = new THREE.Group();
  const legR = new THREE.Group();
  legL.position.set(-0.14, 0.28, 0);
  legR.position.set(0.14, 0.28, 0);
  for (const g of [legL, legR]) {
    const leg = sphere(0.11, BLUE, 0.9, 1.4, 1);
    leg.position.y = -0.12;
    g.add(leg);
    const foot = sphere(0.08, BLUE, 1, 0.5, 1.4);
    foot.position.set(0, -0.25, -0.04);
    g.add(foot);
  }
  body.add(legL, legR);

  const armL = new THREE.Group();
  const armR = new THREE.Group();
  armL.position.set(-0.27, 0.72, -0.05);
  armR.position.set(0.27, 0.72, -0.05);
  for (const g of [armL, armR]) {
    const arm = sphere(0.08, BLUE, 0.9, 1.4, 0.9);
    arm.position.y = -0.1;
    g.add(arm);
  }
  body.add(armL, armR);

  // Cola rizada gruesa
  const tail = new THREE.Group();
  const curl = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.075, 8, 14, Math.PI * 1.5), mat(BLUE));
  curl.position.set(0, 0.36, 0.36);
  curl.rotation.y = Math.PI / 2;
  curl.rotation.z = 0.4;
  curl.castShadow = true;
  tail.add(curl);
  body.add(tail);

  const { muzzle, indicator } = attachIndicator(body, CHARACTER_COLORS.squirtle, 0, 0.92, -0.58);
  return { root, body, head, legL, legR, armL, armR, tail, indicator, muzzle, quad: false };
}

// ===== Bulbasaur: cuadrúpedo turquesa con manchas, ojos rojizos, bulbo con hojas =====
function buildBulbasaur(): Rig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const TEAL = 0x59b5a2;
  const SPOT = 0x2f7465;

  const torso = sphere(0.34, TEAL, 1.15, 0.85, 1.25);
  torso.position.y = 0.5;
  body.add(torso);
  const spots: [number, number, number][] = [
    [-0.2, 0.62, -0.25], [0.24, 0.55, 0.1], [-0.15, 0.42, 0.3], [0.18, 0.6, -0.3], [-0.3, 0.52, 0.05],
  ];
  for (const [x, y, z] of spots) {
    const sp = sphere(0.07, SPOT, 1, 0.45, 1);
    sp.position.set(x, y, z);
    body.add(sp);
  }

  const head = new THREE.Group();
  head.position.set(0, 0.78, -0.44);
  body.add(head);
  const skull = sphere(0.27, TEAL, 1.12, 0.88, 0.95);
  head.add(skull);
  eyes(head, 0.08, -0.2, 0.15, 0.06, 0xc23b22);
  mouth(head, -0.1, -0.24, 0.2);
  for (const s of [-1, 1]) {
    const ear = cone(0.085, 0.16, TEAL);
    ear.position.set(0.15 * s, 0.24, 0.03);
    ear.rotation.z = -0.2 * s;
    head.add(ear);
    const earIn = cone(0.045, 0.08, SPOT);
    earIn.position.set(0.15 * s, 0.24, 0.025);
    head.add(earIn);
  }

  // Bulbo claramente separado del cuerpo
  const bulb = new THREE.Group();
  bulb.position.set(0, 0.88, 0.24);
  const bulbCore = sphere(0.24, 0x4caf50, 1, 1.18, 1);
  bulb.add(bulbCore);
  for (let i = 0; i < 6; i++) {
    const leaf = cone(0.1, 0.3, 0x2e7d32);
    const a = (i / 6) * Math.PI * 2 + 0.3;
    leaf.position.set(Math.cos(a) * 0.16, 0.14, Math.sin(a) * 0.16);
    leaf.rotation.set(Math.sin(a) * 1.0, 0, -Math.cos(a) * 1.0);
    bulb.add(leaf);
  }
  const bulbTip = cone(0.05, 0.1, 0x2e7d32);
  bulbTip.position.y = 0.32;
  bulb.add(bulbTip);
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

  const { muzzle, indicator } = attachIndicator(body, CHARACTER_COLORS.bulbasaur, 0, 0.78, -0.9);
  return { root, body, head, legL, legR, legBL, legBR, indicator, muzzle, quad: true };
}

const BUILDERS: Record<CharacterId, () => Rig> = {
  pikachu: buildPikachu,
  charmander: buildCharmander,
  squirtle: buildSquirtle,
  bulbasaur: buildBulbasaur,
};

export function createCharacterModel(id: CharacterId): CharacterModel {
  const rig = BUILDERS[id]();
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
    // Indicador del ataque equipado
    updateAttackIndicator(r.indicator, pose.weapon, time, pose.firing, pose.reloading);
    // Ataque: pequeño retroceso de cabeza
    if (pose.firing) {
      r.head.position.z = 0.05;
    } else {
      r.head.position.z *= 0.8;
    }
    // Lanzar habilidad: brazo arriba (o cabeceo en cuadrúpedo)
    if (pose.throwing) {
      if (r.armR) r.armR.rotation.x = -2.2;
      else r.head.rotation.x = -0.5;
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
