import { Vec3, v3, vclone } from './math.js';
import { MapDef, SolidBox } from './map.js';
import { MAX_STEP, PLAYER_RADIUS } from './constants.js';

const EPS = 1e-4;

/** ¿Está activa (sólida) esta caja? Las puertas solo son sólidas con las puertas cerradas. */
export function solidActive(b: SolidBox, doorsClosed: boolean): boolean {
  return b.door === undefined || doorsClosed;
}

export function boxOverlapsCapsule(b: SolidBox, pos: Vec3, r: number, h: number): boolean {
  return (
    pos.x - r < b.max.x && pos.x + r > b.min.x &&
    pos.z - r < b.max.z && pos.z + r > b.min.z &&
    pos.y < b.max.y && pos.y + h > b.min.y
  );
}

export function capsuleFree(map: MapDef, pos: Vec3, r: number, h: number, doorsClosed: boolean): boolean {
  for (const b of map.solids) {
    if (!solidActive(b, doorsClosed)) continue;
    if (boxOverlapsCapsule(b, pos, r, h)) return false;
  }
  return true;
}

function resolveAxis(map: MapDef, pos: Vec3, r: number, h: number, axis: 'x' | 'z', dir: number, doorsClosed: boolean): boolean {
  // Devuelve true si hubo bloqueo (tras recolocar en la cara de contacto).
  let blocked = false;
  for (let iter = 0; iter < 4; iter++) {
    let hit: SolidBox | null = null;
    for (const b of map.solids) {
      if (!solidActive(b, doorsClosed)) continue;
      if (boxOverlapsCapsule(b, pos, r, h)) { hit = b; break; }
    }
    if (!hit) return blocked;
    blocked = true;
    if (dir > 0) pos[axis] = hit.min[axis] - r - EPS;
    else pos[axis] = hit.max[axis] + r + EPS;
  }
  return blocked;
}

export interface MoveResult { onGround: boolean; blockedX: boolean; blockedZ: boolean; hitCeiling: boolean; }

/**
 * Integra un paso de movimiento del jugador contra la geometría estática.
 * pos es la posición de los pies; muta pos y vel.
 */
export function moveCapsule(
  map: MapDef, pos: Vec3, vel: Vec3, dt: number, h: number, doorsClosed: boolean, wasOnGround: boolean,
): MoveResult {
  const r = PLAYER_RADIUS;
  const res: MoveResult = { onGround: false, blockedX: false, blockedZ: false, hitCeiling: false };

  // Horizontal por ejes, con intento de escalón (≤ 0,25 m) si está en el suelo.
  for (const axis of ['x', 'z'] as const) {
    const delta = (axis === 'x' ? vel.x : vel.z) * dt;
    if (delta === 0) continue;
    const before = pos[axis];
    pos[axis] += delta;
    const blocked = resolveAxis(map, pos, r, h, axis, Math.sign(delta), doorsClosed);
    if (blocked && wasOnGround) {
      // Reintento elevado: subir el escalón si el destino es transitable.
      const flatResult = pos[axis];
      const stepPos = v3(pos.x, pos.y + MAX_STEP + 2 * EPS, pos.z);
      stepPos[axis] = before + delta;
      if (capsuleFree(map, stepPos, r, h, doorsClosed)) {
        // Asentar sobre el peldaño: bajar hasta contacto (máximo MAX_STEP).
        const ground = dropToGround(map, stepPos, r, h, MAX_STEP + 0.05, doorsClosed);
        pos.x = stepPos.x; pos.z = stepPos.z; pos.y = ground;
      } else {
        pos[axis] = flatResult;
        if (axis === 'x') res.blockedX = true; else res.blockedZ = true;
      }
    } else if (blocked) {
      if (axis === 'x') res.blockedX = true; else res.blockedZ = true;
    }
  }

  // Vertical
  const dy = vel.y * dt;
  pos.y += dy;
  for (let iter = 0; iter < 4; iter++) {
    let hit: SolidBox | null = null;
    for (const b of map.solids) {
      if (!solidActive(b, doorsClosed)) continue;
      if (boxOverlapsCapsule(b, pos, r, h)) { hit = b; break; }
    }
    if (!hit) break;
    if (dy <= 0) {
      pos.y = hit.max.y + EPS;
      vel.y = 0;
      res.onGround = true;
    } else {
      pos.y = hit.min.y - h - EPS;
      vel.y = 0;
      res.hitCeiling = true;
    }
  }

  // Pegado al suelo al descender rampas/peldaños
  if (!res.onGround && wasOnGround && vel.y <= 0) {
    const snapped = dropToGround(map, pos, r, h, MAX_STEP + 0.05, doorsClosed);
    if (snapped > -Infinity && pos.y - snapped <= MAX_STEP + 0.05 && snapped <= pos.y + EPS) {
      pos.y = snapped;
      vel.y = 0;
      res.onGround = true;
    }
  }
  return res;
}

/** Altura de suelo bajo pos (dentro de maxDrop); devuelve pos.y si no hay contacto. */
function dropToGround(map: MapDef, pos: Vec3, r: number, h: number, maxDrop: number, doorsClosed: boolean): number {
  let best = pos.y - maxDrop;
  let found = false;
  for (const b of map.solids) {
    if (!solidActive(b, doorsClosed)) continue;
    if (pos.x - r < b.max.x && pos.x + r > b.min.x && pos.z - r < b.max.z && pos.z + r > b.min.z) {
      if (b.max.y <= pos.y + EPS && b.max.y >= pos.y - maxDrop) {
        if (!found || b.max.y > best) { best = b.max.y; found = true; }
      }
    }
  }
  return found ? best + EPS : pos.y;
}

export interface RayHit { dist: number; box: SolidBox; }

/** Raycast contra la geometría estática (método de losas). dir debe estar normalizado. */
export function raycastMap(map: MapDef, origin: Vec3, dir: Vec3, maxDist: number, doorsClosed: boolean): RayHit | null {
  let best: RayHit | null = null;
  for (const b of map.solids) {
    if (!solidActive(b, doorsClosed)) continue;
    const t = rayBox(origin, dir, b.min, b.max);
    if (t !== null && t >= 0 && t <= maxDist && (!best || t < best.dist)) {
      best = { dist: t, box: b };
    }
  }
  return best;
}

export function rayBox(o: Vec3, d: Vec3, min: Vec3, max: Vec3): number | null {
  let tmin = -Infinity;
  let tmax = Infinity;
  for (const ax of ['x', 'y', 'z'] as const) {
    const dv = d[ax];
    if (Math.abs(dv) < 1e-9) {
      if (o[ax] < min[ax] || o[ax] > max[ax]) return null;
    } else {
      let t1 = (min[ax] - o[ax]) / dv;
      let t2 = (max[ax] - o[ax]) / dv;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  if (tmax < 0) return null;
  return tmin >= 0 ? tmin : 0;
}

/** ¿Hay línea recta despejada entre a y b (solo geometría estática)? */
export function lineOfSight(map: MapDef, a: Vec3, b: Vec3, doorsClosed: boolean): boolean {
  const d = v3(b.x - a.x, b.y - a.y, b.z - a.z);
  const len = Math.hypot(d.x, d.y, d.z);
  if (len < EPS) return true;
  const dir = v3(d.x / len, d.y / len, d.z / len);
  const hit = raycastMap(map, a, dir, len - EPS, doorsClosed);
  return hit === null;
}

/** Intersección rayo-esfera; devuelve distancia o null. */
export function raySphere(o: Vec3, d: Vec3, center: Vec3, radius: number): number | null {
  const oc = v3(o.x - center.x, o.y - center.y, o.z - center.z);
  const b = oc.x * d.x + oc.y * d.y + oc.z * d.z;
  const c = oc.x * oc.x + oc.y * oc.y + oc.z * oc.z - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  if (t < 0) return c <= 0 ? 0 : null;
  return t;
}

/** Intersección rayo-cilindro vertical (eje Y) con tapas planas. */
export function rayVerticalCylinder(o: Vec3, d: Vec3, cx: number, cz: number, yMin: number, yMax: number, radius: number): number | null {
  const ox = o.x - cx, oz = o.z - cz;
  const a = d.x * d.x + d.z * d.z;
  let tHit: number | null = null;
  if (a > 1e-9) {
    const b = ox * d.x + oz * d.z;
    const c = ox * ox + oz * oz - radius * radius;
    const disc = b * b - a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      for (const t of [(-b - sq) / a, (-b + sq) / a]) {
        if (t < 0) continue;
        const y = o.y + d.y * t;
        if (y >= yMin && y <= yMax) { tHit = tHit === null ? t : Math.min(tHit, t); break; }
      }
    }
  } else if (ox * ox + oz * oz <= radius * radius) {
    // Rayo vertical dentro del cilindro
    if (d.y > 0 && o.y < yMin) tHit = yMin - o.y;
    else if (d.y < 0 && o.y > yMax) tHit = o.y - yMax;
    else if (o.y >= yMin && o.y <= yMax) tHit = 0;
  }
  // Tapas
  if (Math.abs(d.y) > 1e-9) {
    for (const yCap of [yMin, yMax]) {
      const t = (yCap - o.y) / d.y;
      if (t >= 0) {
        const x = o.x + d.x * t - cx;
        const z = o.z + d.z * t - cz;
        if (x * x + z * z <= radius * radius) tHit = tHit === null ? t : Math.min(tHit, t);
      }
    }
  }
  return tHit;
}

export function pointInSolid(map: MapDef, p: Vec3, doorsClosed: boolean): boolean {
  for (const b of map.solids) {
    if (!solidActive(b, doorsClosed)) continue;
    if (p.x > b.min.x && p.x < b.max.x && p.y > b.min.y && p.y < b.max.y && p.z > b.min.z && p.z < b.max.z) return true;
  }
  return false;
}

/** Suelo bajo un punto arbitrario (para proyectiles/caída del núcleo). */
export function groundHeight(map: MapDef, x: number, z: number, fromY = 6): number {
  let best = -Infinity;
  for (const b of map.solids) {
    if (b.door !== undefined) continue;
    if (x >= b.min.x && x <= b.max.x && z >= b.min.z && z <= b.max.z) {
      if (b.max.y <= fromY && b.max.y > best) best = b.max.y;
    }
  }
  return best;
}

export { vclone };
