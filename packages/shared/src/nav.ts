import { Vec3, v3 } from './math.js';
import { MapDef } from './map.js';
import { capsuleFree, groundHeight } from './collision.js';
import { PLAYER_HEIGHT } from './constants.js';

const CELL = 0.5;
const MAX_CLIMB = 0.3; // peldaños de rampa (0,25) sí; cajas (0,6+) no

/**
 * Rejilla de navegación generada desde la misma descripción del mapa.
 * Celdas de 0,5 m con altura de suelo; conexión en 8 direcciones.
 */
export class NavGrid {
  readonly w: number;
  readonly h: number;
  readonly x0: number;
  readonly z0: number;
  readonly walkable: Uint8Array;
  readonly ground: Float32Array;

  constructor(map: MapDef) {
    this.x0 = map.bounds.x0;
    this.z0 = map.bounds.z0;
    this.w = Math.round((map.bounds.x1 - map.bounds.x0) / CELL);
    this.h = Math.round((map.bounds.z1 - map.bounds.z0) / CELL);
    this.walkable = new Uint8Array(this.w * this.h);
    this.ground = new Float32Array(this.w * this.h);
    for (let j = 0; j < this.h; j++) {
      for (let i = 0; i < this.w; i++) {
        const x = this.x0 + (i + 0.5) * CELL;
        const z = this.z0 + (j + 0.5) * CELL;
        const g = groundHeight(map, x, z, 2.4);
        if (g === -Infinity || g > 2.1) continue;
        const pos = v3(x, g + 0.02, z);
        // Radio ligeramente menor que el del jugador para no sellar puertas de 1,8 m
        if (capsuleFree(map, pos, 0.32, PLAYER_HEIGHT, false)) {
          const idx = j * this.w + i;
          this.walkable[idx] = 1;
          this.ground[idx] = g;
        }
      }
    }
  }

  idx(i: number, j: number): number { return j * this.w + i; }

  cellAt(x: number, z: number): { i: number; j: number } {
    return {
      i: Math.min(this.w - 1, Math.max(0, Math.floor((x - this.x0) / CELL))),
      j: Math.min(this.h - 1, Math.max(0, Math.floor((z - this.z0) / CELL))),
    };
  }

  cellCenter(i: number, j: number): Vec3 {
    return v3(this.x0 + (i + 0.5) * CELL, this.ground[this.idx(i, j)], this.z0 + (j + 0.5) * CELL);
  }

  isWalkable(i: number, j: number): boolean {
    return i >= 0 && j >= 0 && i < this.w && j < this.h && this.walkable[this.idx(i, j)] === 1;
  }

  canStep(fromIdx: number, i2: number, j2: number): boolean {
    if (!this.isWalkable(i2, j2)) return false;
    return Math.abs(this.ground[this.idx(i2, j2)] - this.ground[fromIdx]) <= MAX_CLIMB;
  }

  /** Celda transitable más cercana a (x, z) (búsqueda en anillos). */
  nearestWalkable(x: number, z: number, maxRadiusCells = 10): { i: number; j: number } | null {
    const { i: ci, j: cj } = this.cellAt(x, z);
    if (this.isWalkable(ci, cj)) return { i: ci, j: cj };
    for (let r = 1; r <= maxRadiusCells; r++) {
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          if (this.isWalkable(ci + di, cj + dj)) return { i: ci + di, j: cj + dj };
        }
      }
    }
    return null;
  }

  /** A* en 8 direcciones; devuelve puntos del mundo (centros de celda) o null. */
  findPath(from: Vec3, to: Vec3): Vec3[] | null {
    const a = this.nearestWalkable(from.x, from.z);
    const b = this.nearestWalkable(to.x, to.z);
    if (!a || !b) return null;
    const start = this.idx(a.i, a.j);
    const goal = this.idx(b.i, b.j);
    if (start === goal) return [this.cellCenter(b.i, b.j)];

    const n = this.w * this.h;
    const gScore = new Float32Array(n).fill(Infinity);
    const parent = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    gScore[start] = 0;
    // Montículo binario simple
    const heap: number[] = [start];
    const fScore = new Float32Array(n).fill(Infinity);
    const hcost = (idx: number): number => {
      const i = idx % this.w, j = (idx / this.w) | 0;
      const gi = goal % this.w, gj = (goal / this.w) | 0;
      const dx = Math.abs(i - gi), dz = Math.abs(j - gj);
      return (Math.max(dx, dz) + 0.4142 * Math.min(dx, dz)) * CELL;
    };
    fScore[start] = hcost(start);
    const push = (v: number) => {
      heap.push(v);
      let c = heap.length - 1;
      while (c > 0) {
        const p = (c - 1) >> 1;
        if (fScore[heap[p]] <= fScore[heap[c]]) break;
        [heap[p], heap[c]] = [heap[c], heap[p]];
        c = p;
      }
    };
    const pop = (): number => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length > 0) {
        heap[0] = last;
        let c = 0;
        for (;;) {
          const l = 2 * c + 1, r = l + 1;
          let m = c;
          if (l < heap.length && fScore[heap[l]] < fScore[heap[m]]) m = l;
          if (r < heap.length && fScore[heap[r]] < fScore[heap[m]]) m = r;
          if (m === c) break;
          [heap[m], heap[c]] = [heap[c], heap[m]];
          c = m;
        }
      }
      return top;
    };

    const DIRS = [
      [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
      [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
    ] as const;

    while (heap.length > 0) {
      const cur = pop();
      if (closed[cur]) continue;
      closed[cur] = 1;
      if (cur === goal) break;
      const ci = cur % this.w, cj = (cur / this.w) | 0;
      for (const [di, dj, cost] of DIRS) {
        const ni = ci + di, nj = cj + dj;
        if (!this.canStep(cur, ni, nj)) continue;
        // Las diagonales no cortan esquinas
        if (di !== 0 && dj !== 0 && (!this.canStep(cur, ci + di, cj) || !this.canStep(cur, ci, cj + dj))) continue;
        const nIdx = this.idx(ni, nj);
        if (closed[nIdx]) continue;
        const g = gScore[cur] + cost * CELL;
        if (g < gScore[nIdx]) {
          gScore[nIdx] = g;
          fScore[nIdx] = g + hcost(nIdx);
          parent[nIdx] = cur;
          push(nIdx);
        }
      }
    }
    if (parent[goal] === -1 && goal !== start) return null;

    const cells: number[] = [];
    let cur = goal;
    while (cur !== -1) {
      cells.push(cur);
      cur = parent[cur];
    }
    cells.reverse();
    // Simplificación: conservar un punto de cada 2 y siempre el último
    const out: Vec3[] = [];
    for (let k = 0; k < cells.length; k++) {
      if (k % 2 === 0 || k === cells.length - 1) {
        const i = cells[k] % this.w, j = (cells[k] / this.w) | 0;
        out.push(this.cellCenter(i, j));
      }
    }
    return out;
  }

  pathLength(path: Vec3[]): number {
    let d = 0;
    for (let k = 1; k < path.length; k++) d += Math.hypot(path[k].x - path[k - 1].x, path[k].z - path[k - 1].z);
    return d;
  }
}

const navCache = new WeakMap<MapDef, NavGrid>();
export function getNavGrid(map: MapDef): NavGrid {
  let g = navCache.get(map);
  if (!g) {
    g = new NavGrid(map);
    navCache.set(map, g);
  }
  return g;
}
