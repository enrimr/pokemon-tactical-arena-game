import * as THREE from 'three';
import type { CharacterId, WeaponId } from '@pta/shared';
import { settings } from './settings.js';
import { createOfficialModel } from './officialModels.js';

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

const SPHERE = new THREE.SphereGeometry(1, 28, 20);
const CONE = new THREE.ConeGeometry(1, 1, 14);
const BOX = new THREE.BoxGeometry(1, 1, 1);

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

/** Sonrisa: arco fino (toro parcial) en la cara frontal, curvado hacia arriba. */
function smile(head: THREE.Object3D, y: number, z: number, r: number, color = 0x4a2d20): void {
  const arc = new THREE.Mesh(new THREE.TorusGeometry(r, 0.013, 5, 18, Math.PI * 0.85), mat(color));
  arc.position.set(0, y + r * 0.75, z);
  arc.rotation.z = Math.PI + (Math.PI * (1 - 0.85)) / 2; // centrar el arco abajo
  arc.castShadow = false;
  head.add(arc);
}

/** Garras o dedos: pequeños conos apuntando al frente (-Z) repartidos en X. */
function claws(parent: THREE.Object3D, n: number, spread: number, y: number, z: number, size = 0.024, color = 0xf5f2ea): void {
  for (let i = 0; i < n; i++) {
    const c = cone(size, size * 2.6, color);
    c.position.set(n === 1 ? 0 : (i / (n - 1) - 0.5) * spread, y, z);
    c.rotation.x = -Math.PI / 2;
    parent.add(c);
  }
}

/** Cadena de esferas a lo largo de una curva suave con radio decreciente (colas, hocicos). */
function blobChain(parent: THREE.Object3D, points: [number, number, number][], rStart: number, rEnd: number, color: number, n = 10): THREE.Mesh[] {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const out: THREE.Mesh[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const s = sphere(rStart + (rEnd - rStart) * t, color);
    s.position.copy(curve.getPoint(t));
    parent.add(s);
    out.push(s);
  }
  return out;
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

  // Torso en pera: caderas anchas y pecho más estrecho
  const hips = sphere(0.3, YELLOW, 1.08, 1, 0.98);
  hips.position.y = 0.48;
  body.add(hips);
  const chest = sphere(0.26, YELLOW, 1, 1.15, 0.9);
  chest.position.y = 0.72;
  body.add(chest);
  // Dos rayas marrones curvadas sobre la espalda
  for (const [y, w, rx] of [[0.72, 0.34, 0.5], [0.56, 0.42, 0.25]] as const) {
    const stripe = sphere(0.05, BROWN, w / 0.1, 0.9, 0.6);
    stripe.position.set(0, y, 0.235);
    stripe.rotation.x = rx;
    body.add(stripe);
  }

  const head = new THREE.Group();
  head.position.y = 1.1;
  body.add(head);
  const skull = sphere(0.3, YELLOW, 1.06, 0.9, 0.95);
  head.add(skull);
  eyes(head, 0.07, -0.24, 0.135, 0.058, 0x1c1c1c);
  smile(head, -0.12, -0.285, 0.055);
  const nose = sphere(0.018, 0x333333, 1.4, 0.8, 0.8);
  nose.position.set(0, -0.015, -0.3);
  head.add(nose);
  for (const s of [-1, 1]) {
    // Mejillas rojas prominentes con brillo
    const cheek = sphere(0.085, 0xdd3b3b, 1, 1, 0.45);
    cheek.position.set(0.23 * s, -0.06, -0.2);
    head.add(cheek);
    // Oreja larga ligeramente abierta hacia fuera, con punta negra integrada
    const ear = new THREE.Group();
    ear.position.set(0.15 * s, 0.2, 0.02);
    ear.rotation.z = -0.38 * s;
    ear.rotation.x = 0.12;
    const earBase = sphere(0.075, YELLOW, 1, 3.4, 1);
    earBase.position.y = 0.26;
    ear.add(earBase);
    const earTip = sphere(0.05, 0x1c1c1c, 1, 2.2, 1);
    earTip.position.y = 0.5;
    ear.add(earTip);
    head.add(ear);
  }

  const legL = new THREE.Group();
  const legR = new THREE.Group();
  legL.position.set(-0.13, 0.3, 0);
  legR.position.set(0.13, 0.3, 0);
  for (const g of [legL, legR]) {
    const leg = sphere(0.1, YELLOW, 0.8, 1.6, 0.9);
    leg.position.y = -0.15;
    g.add(leg);
    const foot = sphere(0.075, YELLOW, 1, 0.5, 1.9);
    foot.position.set(0, -0.3, -0.06);
    g.add(foot);
    claws(g, 3, 0.08, -0.31, -0.19, 0.018, 0xe3bd20);
  }
  body.add(legL, legR);

  const armL = new THREE.Group();
  const armR = new THREE.Group();
  armL.position.set(-0.24, 0.78, -0.06);
  armR.position.set(0.24, 0.78, -0.06);
  for (const g of [armL, armR]) {
    const arm = sphere(0.07, YELLOW, 0.9, 1.6, 0.9);
    arm.position.y = -0.1;
    g.add(arm);
    claws(g, 3, 0.06, -0.2, -0.03, 0.014, 0xe3bd20);
  }
  body.add(armL, armR);

  // Cola en rayo: base marrón + zigzag amarillo con más cuerpo, de canto hacia atrás
  const tail = new THREE.Group();
  tail.position.set(0.06, 0.5, 0.28);
  tail.rotation.x = -0.25;
  const base = box(0.07, 0.16, 0.055, BROWN);
  base.position.set(-0.02, 0.03, 0.03);
  base.rotation.z = 0.5;
  tail.add(base);
  const base2 = box(0.06, 0.12, 0.05, BROWN);
  base2.position.set(-0.08, 0.11, 0.04);
  base2.rotation.z = -0.4;
  tail.add(base2);
  const segs = [
    { w: 0.2, h: 0.1, x: -0.06, y: 0.2, rz: -0.55 },
    { w: 0.1, h: 0.24, x: 0.01, y: 0.33, rz: -0.15 },
    { w: 0.3, h: 0.13, x: 0.1, y: 0.48, rz: -0.5 },
    { w: 0.24, h: 0.3, x: 0.17, y: 0.63, rz: 0.1 },
  ];
  for (const sgm of segs) {
    const b = box(sgm.w, sgm.h, 0.05, YELLOW);
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
  // Vientre crema segmentado en placas
  for (const [y, r] of [[0.74, 0.2], [0.57, 0.23], [0.4, 0.19]] as const) {
    const plate = sphere(r, CREAM, 0.95, 0.6, 0.62);
    plate.position.set(0, y, -0.19);
    body.add(plate);
  }

  const head = new THREE.Group();
  head.position.y = 1.12;
  body.add(head);
  const skull = sphere(0.25, ORANGE, 1, 1.05, 1);
  head.add(skull);
  // Hocico con mandíbula y sonrisa amplia
  const snout = sphere(0.15, ORANGE, 1, 0.6, 1.2);
  snout.position.set(0, -0.08, -0.18);
  head.add(snout);
  const jaw = sphere(0.12, 0xf0a05a, 1, 0.4, 1.05);
  jaw.position.set(0, -0.16, -0.17);
  head.add(jaw);
  smile(head, -0.15, -0.33, 0.06, 0x7a3c12);
  eyes(head, 0.08, -0.19, 0.12, 0.052, 0x2b55aa);
  // Arcos de las cejas, dan expresión decidida
  for (const s of [-1, 1]) {
    const brow = sphere(0.055, ORANGE, 1.3, 0.5, 0.7);
    brow.position.set(0.11 * s, 0.16, -0.17);
    head.add(brow);
    const nostril = sphere(0.012, 0x7a3c12);
    nostril.position.set(0.045 * s, -0.04, -0.345);
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
    const foot = sphere(0.085, ORANGE, 1, 0.5, 1.6);
    foot.position.set(0, -0.28, -0.05);
    g.add(foot);
    claws(g, 3, 0.09, -0.29, -0.17);
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

  // Cola orgánica que se curva hacia arriba, con llama de tres capas
  const tail = new THREE.Group();
  tail.position.set(0, 0.42, 0.26);
  blobChain(tail, [[0, 0, 0], [0, -0.02, 0.2], [0, 0.04, 0.38], [0, 0.18, 0.5], [0, 0.3, 0.54]], 0.085, 0.03, ORANGE, 12);
  const flame = new THREE.Mesh(CONE, new THREE.MeshBasicMaterial({
    color: 0xff8822, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  flame.scale.set(0.085, 0.22, 0.085);
  flame.position.set(0, 0.42, 0.54);
  tail.add(flame);
  const flameMid = new THREE.Mesh(CONE, new THREE.MeshBasicMaterial({ color: 0xffc24a, transparent: true, opacity: 0.95 }));
  flameMid.scale.set(0.05, 0.13, 0.05);
  flameMid.position.set(0, 0.38, 0.54);
  tail.add(flameMid);
  const flameCore = new THREE.Mesh(CONE, new THREE.MeshBasicMaterial({ color: 0xfff3b8 }));
  flameCore.scale.set(0.026, 0.07, 0.026);
  flameCore.position.set(0, 0.35, 0.54);
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
  // Patrón del caparazón: costuras oscuras en rejilla sobre la cúpula
  for (const [ry, rz] of [[0, 0], [0.65, 0], [-0.65, 0], [0, 0.6], [0, -0.6]] as const) {
    const seam = new THREE.Mesh(new THREE.TorusGeometry(0.305, 0.012, 5, 24, Math.PI), mat(0x5e3c1b));
    seam.position.set(0, 0.6, 0.16);
    seam.rotation.set(Math.PI / 2 + rz, ry, 0);
    seam.scale.set(1.06, 1.1, 0.74);
    seam.castShadow = false;
    body.add(seam);
  }
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.055, 10, 26), mat(CREAM));
  rim.position.set(0, 0.6, 0.0);
  rim.scale.set(1.05, 1.1, 1);
  rim.castShadow = true;
  body.add(rim);
  // Vientre: placa crema curvada con costuras horizontales y central
  const plate = sphere(0.24, CREAM, 0.82, 1.02, 0.56);
  plate.position.set(0, 0.56, -0.17);
  body.add(plate);
  for (const y of [0.46, 0.56, 0.66]) {
    const seam = box(0.28, 0.012, 0.02, 0xc9b98a);
    seam.position.set(0, y, -0.295);
    seam.castShadow = false;
    body.add(seam);
  }
  const seamV = box(0.012, 0.3, 0.02, 0xc9b98a);
  seamV.position.set(0, 0.56, -0.3);
  seamV.castShadow = false;
  body.add(seamV);

  const head = new THREE.Group();
  head.position.y = 1.07;
  body.add(head);
  const skull = sphere(0.27, BLUE, 1, 1, 1);
  head.add(skull);
  // Hocico suave con orificios nasales
  const snout = sphere(0.1, BLUE, 1.2, 0.6, 0.8);
  snout.position.set(0, -0.04, -0.22);
  head.add(snout);
  for (const s of [-1, 1]) {
    const nostril = sphere(0.01, 0x2d4a7a);
    nostril.position.set(0.035 * s, -0.01, -0.29);
    head.add(nostril);
  }
  eyes(head, 0.08, -0.21, 0.125, 0.06, 0x7a3b2e);
  smile(head, -0.13, -0.26, 0.065, 0x2d4a7a);

  const legL = new THREE.Group();
  const legR = new THREE.Group();
  legL.position.set(-0.14, 0.28, 0);
  legR.position.set(0.14, 0.28, 0);
  for (const g of [legL, legR]) {
    const leg = sphere(0.11, BLUE, 0.9, 1.4, 1);
    leg.position.y = -0.12;
    g.add(leg);
    const foot = sphere(0.08, BLUE, 1, 0.5, 1.5);
    foot.position.set(0, -0.25, -0.05);
    g.add(foot);
    claws(g, 3, 0.08, -0.26, -0.16);
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
    claws(g, 3, 0.06, -0.21, -0.03, 0.016);
  }
  body.add(armL, armR);

  // Cola gruesa que se estrecha y se riza en espiral
  const tail = new THREE.Group();
  blobChain(tail, [
    [0, 0.4, 0.3], [0, 0.3, 0.46], [0, 0.42, 0.6], [0, 0.58, 0.52], [0.03, 0.56, 0.4], [0.05, 0.46, 0.44],
  ], 0.095, 0.025, BLUE, 16);
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
  const spots: [number, number, number, number][] = [
    [-0.2, 0.62, -0.25, 0.07], [0.24, 0.55, 0.1, 0.08], [-0.15, 0.42, 0.3, 0.06],
    [0.18, 0.6, -0.3, 0.07], [-0.3, 0.52, 0.05, 0.08], [0.1, 0.44, 0.38, 0.05], [-0.05, 0.66, 0.1, 0.06],
  ];
  for (const [x, y, z, r] of spots) {
    const sp = sphere(r, SPOT, 1, 0.45, 1);
    sp.position.set(x, y, z);
    body.add(sp);
  }

  const head = new THREE.Group();
  head.position.set(0, 0.78, -0.44);
  body.add(head);
  const skull = sphere(0.27, TEAL, 1.12, 0.88, 0.95);
  head.add(skull);
  // Manchas también en la cabeza
  for (const [x, y, z] of [[-0.16, 0.14, -0.08], [0.19, 0.1, 0.06]] as const) {
    const sp = sphere(0.05, SPOT, 1, 0.5, 1);
    sp.position.set(x, y, z);
    head.add(sp);
  }
  eyes(head, 0.08, -0.2, 0.15, 0.062, 0xc23b22);
  // Boca ancha con dos colmillos asomando en los extremos
  smile(head, -0.14, -0.235, 0.09, 0x3a2420);
  for (const s of [-1, 1]) {
    const fang = cone(0.016, 0.045, 0xf5f2ea);
    fang.position.set(0.085 * s, -0.1, -0.235);
    fang.rotation.x = Math.PI;
    head.add(fang);
  }
  for (const s of [-1, 1]) {
    const ear = cone(0.085, 0.16, TEAL);
    ear.position.set(0.15 * s, 0.24, 0.03);
    ear.rotation.z = -0.2 * s;
    head.add(ear);
    const earIn = cone(0.045, 0.08, SPOT);
    earIn.position.set(0.15 * s, 0.24, 0.025);
    head.add(earIn);
  }

  // Bulbo claramente separado del cuerpo: gota verde con vetas y hojas anchas
  const bulb = new THREE.Group();
  bulb.position.set(0, 0.88, 0.24);
  const bulbCore = sphere(0.25, 0x4caf50, 1, 1.2, 1);
  bulb.add(bulbCore);
  // Vetas verticales más oscuras
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const vein = sphere(0.035, 0x3a8c3f, 0.6, 1.18, 0.6);
    vein.position.set(Math.cos(a) * 0.23, 0.02, Math.sin(a) * 0.23);
    bulb.add(vein);
  }
  // Hojas anchas y planas abiertas en la base, con una fila superior más cerrada
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    const leaf = cone(0.12, 0.34, 0x2e7d32);
    leaf.scale.z *= 0.35;
    leaf.position.set(Math.cos(a) * 0.2, 0.1, Math.sin(a) * 0.2);
    leaf.rotation.set(Math.sin(a) * 1.15, -a, -Math.cos(a) * 1.15);
    bulb.add(leaf);
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const leaf = cone(0.085, 0.22, 0x2e7d32);
    leaf.scale.z *= 0.4;
    leaf.position.set(Math.cos(a) * 0.12, 0.26, Math.sin(a) * 0.12);
    leaf.rotation.set(Math.sin(a) * 0.6, -a, -Math.cos(a) * 0.6);
    bulb.add(leaf);
  }
  const bulbTip = cone(0.05, 0.12, 0x2e7d32);
  bulbTip.position.y = 0.36;
  bulb.add(bulbTip);
  body.add(bulb);

  const mkLeg = (x: number, z: number): THREE.Group => {
    const g = new THREE.Group();
    g.position.set(x, 0.32, z);
    const leg = sphere(0.1, TEAL, 0.9, 1.7, 0.9);
    leg.position.y = -0.16;
    g.add(leg);
    claws(g, 3, 0.08, -0.3, -0.08, 0.02);
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

/**
 * Crea el modelo del personaje: el oficial (si el ajuste está activo y el .glb
 * local ya está cargado) o el procedural propio.
 */
export function createCharacterModel(id: CharacterId): CharacterModel {
  if (settings.modelosOficiales) {
    const oficial = createOfficialModel(id);
    if (oficial) return oficial;
  }
  return createProceduralModel(id);
}

export function createProceduralModel(id: CharacterId): CharacterModel {
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
      r.flame.scale.set(0.085 * f, 0.22 * (2 - f) * f, 0.085 * f);
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
