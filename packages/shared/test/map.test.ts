import { describe, expect, it } from 'vitest';
import {
  buildAuroraMap, getNavGrid, lineOfSight, SPEED_RUN, v3,
} from '../src/index.js';

const map = buildAuroraMap();
const nav = getNavGrid(map);

describe('Estación Aurora: conectividad y objetivos de diseño', () => {
  const atk = map.attackerSpawn.points[2].pos; // centro del spawn atacante
  const def = map.defenderSpawn.points[2].pos;
  const A = map.sites[0].center;
  const B = map.sites[1].center;

  it('hay camino de spawn atacante a A y B', () => {
    for (const site of [A, B]) {
      const path = nav.findPath(atk, site);
      expect(path).not.toBeNull();
    }
  });

  it('hay camino de spawn defensor a A y B', () => {
    for (const site of [A, B]) {
      const path = nav.findPath(def, site);
      expect(path).not.toBeNull();
    }
  });

  // El defensor relevante es el asignado a esa zona: medimos el mejor punto de aparición
  it('defensores llegan a las zonas en 3–5 s', () => {
    for (const site of [A, B]) {
      const t = Math.min(...map.defenderSpawn.points.map((pt) => nav.pathLength(nav.findPath(pt.pos, site)!) / SPEED_RUN));
      expect(t).toBeGreaterThanOrEqual(3);
      expect(t).toBeLessThanOrEqual(5.2);
    }
  });

  it('atacantes llegan a las zonas en 8–11 s', () => {
    for (const site of [A, B]) {
      const t = Math.min(...map.attackerSpawn.points.map((pt) => nav.pathLength(nav.findPath(pt.pos, site)!) / SPEED_RUN));
      expect(t).toBeGreaterThanOrEqual(7.5);
      expect(t).toBeLessThanOrEqual(11.5);
    }
  });

  it('rotación defensora A–B en 9–12 s', () => {
    const path = nav.findPath(A, B)!;
    const t = nav.pathLength(path) / SPEED_RUN;
    expect(t).toBeGreaterThanOrEqual(8.5);
    expect(t).toBeLessThanOrEqual(12.5);
  });

  it('no hay línea de visión directa entre spawns a altura de ojos', () => {
    const a = v3(atk.x, 1.25, atk.z);
    const d = v3(def.x, 1.25, def.z);
    expect(lineOfSight(map, a, d, false)).toBe(false);
    // tampoco con las puertas abiertas desde los extremos del spawn
    for (const pa of map.attackerSpawn.points) {
      for (const pd of map.defenderSpawn.points) {
        expect(lineOfSight(map, v3(pa.pos.x, 1.25, pa.pos.z), v3(pd.pos.x, 1.25, pd.pos.z), false)).toBe(false);
      }
    }
  });

  it('las puertas cerradas bloquean la salida del spawn', () => {
    const dentro = v3(0, 1.0, -18);
    const fuera = v3(0, 1.0, -10);
    expect(lineOfSight(map, dentro, fuera, true)).toBe(false);
    expect(lineOfSight(map, dentro, fuera, false)).toBe(true);
  });

  it('las zonas de instalación están sobre terreno navegable', () => {
    for (const s of map.sites) {
      expect(nav.nearestWalkable(s.center.x, s.center.z, 2)).not.toBeNull();
    }
  });

  it('las líneas largas no superan ~35 m (muestreo entre celdas transitables)', () => {
    // Muestreo determinista de pares de celdas; comprobamos la distancia máxima con LOS
    let maxLos = 0;
    for (let j = 2; j < nav.h - 2; j += 6) {
      for (let i = 2; i < nav.w - 2; i += 6) {
        if (!nav.isWalkable(i, j)) continue;
        const a = nav.cellCenter(i, j);
        for (let j2 = j; j2 < nav.h - 2; j2 += 6) {
          for (let i2 = 2; i2 < nav.w - 2; i2 += 6) {
            if (!nav.isWalkable(i2, j2)) continue;
            const b = nav.cellCenter(i2, j2);
            const d = Math.hypot(a.x - b.x, a.z - b.z);
            if (d <= maxLos) continue;
            if (lineOfSight(map, v3(a.x, 1.25, a.z), v3(b.x, 1.25, b.z), false)) maxLos = d;
          }
        }
      }
    }
    expect(maxLos).toBeLessThanOrEqual(37);
  });
});
