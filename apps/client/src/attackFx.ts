import * as THREE from 'three';
import type { CharacterId, Vec3, WeaponId } from '@pta/shared';
import { CHARACTER_COLORS } from './models.js';

/**
 * Efectos visuales de los ataques (el daño sigue siendo hitscan en la sim; esto
 * es solo presentación). Cada personaje tiene identidad elemental propia:
 *  - Pikachu: rayo en zigzag con ramificaciones y parpadeo.
 *  - Charmander: chorro de llamas que crece, deriva hacia arriba y se apaga.
 *  - Squirtle: chorro de agua con gotas que caen; la ráfaga son burbujas.
 *  - Bulbasaur: hojas giratorias a lo largo del trazo (Rayo Solar: haz dorado).
 *  - Mewtwo: anillos psíquicos que se expanden a lo largo del haz.
 * El perfil equipado modula el tamaño/intensidad (preciso > pulso > ráfaga).
 * Con «movimiento reducido» se usa el trazo sencillo de siempre.
 */

export interface AttackFx {
  group: THREE.Group;
  /** Avanza la animación; false cuando el efecto ha terminado. */
  update(dt: number): boolean;
  dispose(): void;
}

// Geometrías compartidas entre todos los efectos (no se liberan)
const CYL = new THREE.CylinderGeometry(1, 1, 1, 6);
CYL.rotateX(Math.PI / 2); // eje Z: se orienta con lookAt
const SPHERE = new THREE.SphereGeometry(1, 10, 8);
const LEAF = new THREE.ConeGeometry(0.5, 1, 6);
LEAF.scale(1, 1, 0.25);
const RING = new THREE.TorusGeometry(1, 0.07, 6, 20);

const V_FROM = new THREE.Vector3();
const V_TO = new THREE.Vector3();
const V_DIR = new THREE.Vector3();
const V_SIDE = new THREE.Vector3();
const V_UP = new THREE.Vector3();

function basics(from: Vec3, to: Vec3): { len: number } {
  V_FROM.set(from.x, from.y, from.z);
  V_TO.set(to.x, to.y, to.z);
  V_DIR.subVectors(V_TO, V_FROM);
  const len = V_DIR.length();
  if (len > 1e-5) V_DIR.multiplyScalar(1 / len);
  V_SIDE.set(0, 1, 0);
  if (Math.abs(V_DIR.y) > 0.95) V_SIDE.set(1, 0, 0);
  V_SIDE.crossVectors(V_DIR, V_SIDE).normalize();
  V_UP.crossVectors(V_DIR, V_SIDE).normalize();
  return { len };
}

function addMat(color: number, opacity = 0.9): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

/** Punto sobre el trazo + desvío lateral. */
function pointAt(t: number, s1: number, s2: number, out: THREE.Vector3): THREE.Vector3 {
  return out.copy(V_FROM).addScaledVector(V_DIR, t)
    .addScaledVector(V_SIDE, s1).addScaledVector(V_UP, s2);
}

/** Cilindro fino entre dos puntos (geometría compartida). */
function segment(a: THREE.Vector3, b: THREE.Vector3, r: number, m: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(CYL, m);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.scale.set(r, r, a.distanceTo(b));
  mesh.lookAt(b);
  return mesh;
}

interface Mote {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  grow: number;  // factor de crecimiento por segundo
  spin: number;  // giro aleatorio (hojas)
}

class ElementalFx implements AttackFx {
  group = new THREE.Group();
  private mats: THREE.MeshBasicMaterial[] = [];
  private motes: Mote[] = [];
  private age = 0;
  private flicker = false;

  constructor(private life: number) {}

  mat(color: number, opacity = 0.9): THREE.MeshBasicMaterial {
    const m = addMat(color, opacity);
    m.userData.base = opacity;
    this.mats.push(m);
    return m;
  }

  mote(mesh: Mote['mesh'], vel: THREE.Vector3, grow = 0, spin = 0): void {
    this.motes.push({ mesh, vel, grow, spin });
    this.group.add(mesh);
  }

  setFlicker(): void { this.flicker = true; }

  update(dt: number): boolean {
    this.age += dt;
    if (this.age >= this.life) return false;
    const fade = 1 - this.age / this.life;
    const flick = this.flicker ? 0.55 + Math.random() * 0.45 : 1;
    for (const m of this.mats) m.opacity = (m.userData.base as number) * fade * flick;
    for (const p of this.motes) {
      p.mesh.position.addScaledVector(p.vel, dt);
      if (p.grow) p.mesh.scale.multiplyScalar(1 + p.grow * dt);
      if (p.spin) { p.mesh.rotation.x += p.spin * dt; p.mesh.rotation.y += p.spin * 0.7 * dt; }
    }
    return true;
  }

  dispose(): void {
    for (const m of this.mats) m.dispose();
  }
}

const TMP = new THREE.Vector3();
const TMP2 = new THREE.Vector3();

// ===== Rayo (Pikachu): zigzag brillante con ramas =====
function rayo(fx: ElementalFx, len: number, f: number): void {
  const mCore = fx.mat(0xfffbe0, 1);
  const mGlow = fx.mat(0xffe84a, 0.65);
  const n = Math.max(3, Math.min(14, Math.round(len * 1.1)));
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const amp = (i === 0 || i === n) ? 0 : 0.14 * f;
    pts.push(pointAt(t * len, (Math.random() - 0.5) * 2 * amp, (Math.random() - 0.5) * 2 * amp, new THREE.Vector3()));
  }
  for (let i = 0; i < n; i++) {
    fx.mote(segment(pts[i], pts[i + 1], 0.014 * f, mCore), TMP.set(0, 0, 0).clone());
    fx.mote(segment(pts[i], pts[i + 1], 0.05 * f, mGlow), TMP.set(0, 0, 0).clone());
  }
  // Ramas cortas desde puntos intermedios
  const ramas = Math.min(3, Math.round(len / 7) + 1);
  for (let r = 0; r < ramas; r++) {
    const base = pts[1 + Math.floor(Math.random() * Math.max(1, n - 2))];
    TMP.copy(base).addScaledVector(V_SIDE, (Math.random() - 0.5) * 0.9).addScaledVector(V_UP, (Math.random() - 0.5) * 0.9).addScaledVector(V_DIR, 0.4);
    fx.mote(segment(base, TMP, 0.01 * f, mCore), TMP2.set(0, 0, 0).clone());
  }
  fx.setFlicker();
}

// ===== Llamas (Charmander): chorro que crece y asciende =====
function llamas(fx: ElementalFx, len: number, f: number): void {
  const paleta = [0xfff1a8, 0xffcf5c, 0xff8a2f, 0xe84f1d];
  const n = Math.max(6, Math.min(16, Math.round(len * 1.4)));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const color = paleta[Math.min(paleta.length - 1, Math.floor(t * paleta.length))];
    const m = fx.mat(color, 0.85);
    const blob = new THREE.Mesh(SPHERE, m);
    // Cono: el chorro se abre con la distancia (visible también en primera persona)
    const spread = (0.06 + t * 0.3) * f;
    pointAt(t * len, (Math.random() - 0.5) * 2 * spread, (Math.random() - 0.5) * 2 * spread, blob.position);
    blob.scale.setScalar((0.05 + t * 0.14) * f);
    fx.mote(blob, new THREE.Vector3(
      V_DIR.x * 1.2 + (Math.random() - 0.5) * 0.5,
      0.9 + Math.random() * 0.6,
      V_DIR.z * 1.2 + (Math.random() - 0.5) * 0.5,
    ), 2.2);
  }
}

// ===== Agua (Squirtle): chorro con gotas; ráfaga = burbujas =====
function agua(fx: ElementalFx, len: number, f: number, burbujas: boolean): void {
  if (burbujas) {
    const m = fx.mat(0xbfe6ff, 0.5);
    const n = Math.max(6, Math.min(14, Math.round(len * 1.2)));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const b = new THREE.Mesh(SPHERE, m);
      pointAt(t * len, (Math.random() - 0.5) * 0.22, (Math.random() - 0.5) * 0.22, b.position);
      b.scale.setScalar(0.035 + Math.random() * 0.055);
      fx.mote(b, new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.5 + Math.random() * 0.5, (Math.random() - 0.5) * 0.4), 1.6);
    }
    return;
  }
  const mJet = fx.mat(0x9fd8ff, 0.75);
  const mCore = fx.mat(0xe8f7ff, 0.9);
  fx.mote(segment(V_FROM, V_TO, 0.03 * f, mJet), new THREE.Vector3());
  fx.mote(segment(V_FROM, V_TO, 0.012 * f, mCore), new THREE.Vector3());
  const n = Math.max(5, Math.min(12, Math.round(len)));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const g = new THREE.Mesh(SPHERE, mJet);
    pointAt(t * len, Math.sin(t * 14) * 0.05 * f, Math.cos(t * 11) * 0.05 * f, g.position);
    g.scale.setScalar(0.03 * f + t * 0.02);
    // Las gotas caen por gravedad suave
    fx.mote(g, new THREE.Vector3((Math.random() - 0.5) * 0.6, -0.8 - Math.random() * 1.4, (Math.random() - 0.5) * 0.6));
  }
}

// ===== Hojas (Bulbasaur): hojas giratorias; Rayo Solar = haz dorado =====
function hojas(fx: ElementalFx, len: number, f: number, solar: boolean): void {
  if (solar) {
    fx.mote(segment(V_FROM, V_TO, 0.06, fx.mat(0xfff3b0, 0.9)), new THREE.Vector3());
    fx.mote(segment(V_FROM, V_TO, 0.14, fx.mat(0xd8f27a, 0.35)), new THREE.Vector3());
  } else {
    fx.mote(segment(V_FROM, V_TO, 0.01 * f, fx.mat(0xa8e87a, 0.5)), new THREE.Vector3());
  }
  const mA = fx.mat(0x7ad95e, 0.95);
  const mB = fx.mat(0x3f9a3a, 0.95);
  const n = Math.max(4, Math.min(10, Math.round(len * (solar ? 0.6 : 1))));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const leaf = new THREE.Mesh(LEAF, i % 2 ? mA : mB);
    pointAt(t * len, (Math.random() - 0.5) * 0.16, (Math.random() - 0.5) * 0.16, leaf.position);
    leaf.scale.setScalar(0.09 * f);
    leaf.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    fx.mote(leaf, new THREE.Vector3(V_DIR.x * 2.5, V_DIR.y * 2.5 - 0.2, V_DIR.z * 2.5), 0, 9 + Math.random() * 8);
  }
}

// ===== Psíquico (Mewtwo): anillos que se expanden a lo largo del haz =====
function psiquico(fx: ElementalFx, len: number, f: number): void {
  fx.mote(segment(V_FROM, V_TO, 0.018 * f, fx.mat(0xe3c8f7, 0.8)), new THREE.Vector3());
  const mRing = fx.mat(0xc08ae8, 0.8);
  const n = Math.max(3, Math.min(7, Math.round(len / 3) + 2));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.6) / (n + 0.6);
    const ring = new THREE.Mesh(RING, mRing);
    pointAt(t * len, 0, 0, ring.position);
    ring.scale.setScalar(0.07 * f);
    ring.lookAt(TMP.copy(ring.position).add(V_DIR));
    fx.mote(ring, new THREE.Vector3(), 5.5);
  }
}

/** Trazo sencillo (modo «movimiento reducido»): el cilindro clásico. */
function simple(fx: ElementalFx, char: CharacterId): void {
  fx.mote(segment(V_FROM, V_TO, 0.015, fx.mat(CHARACTER_COLORS[char], 0.85)), new THREE.Vector3());
}

/**
 * Detonación de un ataque explosivo: destello central, onda esférica del color
 * elemental, anillo rasante al suelo y chispas radiales. Con «movimiento
 * reducido» queda un destello breve y contenido.
 */
export function createExplosionFx(char: CharacterId, pos: Vec3, radius: number, reduced: boolean): AttackFx {
  const color = CHARACTER_COLORS[char];
  const fx = new ElementalFx(reduced ? 0.22 : 0.5);
  fx.group.position.set(pos.x, pos.y, pos.z);
  // Destello blanco y onda del color del personaje
  const flash = new THREE.Mesh(SPHERE, fx.mat(0xfff6dc, 0.95));
  flash.scale.setScalar(radius * 0.22);
  fx.mote(flash, new THREE.Vector3(), reduced ? 3 : 5);
  const wave = new THREE.Mesh(SPHERE, fx.mat(color, 0.5));
  wave.scale.setScalar(radius * 0.3);
  fx.mote(wave, new THREE.Vector3(), reduced ? 3.5 : 6);
  if (!reduced) {
    // Anillo en el suelo que marca el área afectada
    const ring = new THREE.Mesh(RING, fx.mat(color, 0.8));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    ring.scale.setScalar(radius * 0.25);
    fx.mote(ring, new THREE.Vector3(), 7);
    // Chispas radiales
    const mSpark = fx.mat(color, 0.9);
    for (let i = 0; i < 10; i++) {
      const s = new THREE.Mesh(SPHERE, mSpark);
      s.scale.setScalar(0.07);
      const a = (i / 10) * Math.PI * 2;
      const up = 1.5 + Math.random() * 3;
      fx.mote(s, new THREE.Vector3(Math.cos(a) * (3 + Math.random() * 3), up, Math.sin(a) * (3 + Math.random() * 3)));
    }
  }
  return fx;
}

export function createAttackFx(char: CharacterId, weapon: WeaponId, from: Vec3, to: Vec3, reduced: boolean): AttackFx | null {
  const { len } = basics(from, to);
  if (len < 0.1) return null;
  // El perfil modula tamaño y duración: preciso contundente, ráfaga ligera
  const f = weapon === 'preciso' ? 1.7 : weapon === 'rafaga' ? 0.85 : 1;
  const life = (weapon === 'preciso' ? 0.32 : 0.24) * (reduced ? 0.5 : 1);
  const fx = new ElementalFx(life);
  if (reduced) {
    simple(fx, char);
    return fx;
  }
  switch (char) {
    case 'pikachu': rayo(fx, len, f); break;
    case 'charmander': llamas(fx, len, f); break;
    case 'squirtle': agua(fx, len, f, weapon === 'rafaga'); break;
    case 'bulbasaur': hojas(fx, len, f, weapon === 'preciso'); break;
    case 'mewtwo': psiquico(fx, len, f); break;
  }
  return fx;
}
