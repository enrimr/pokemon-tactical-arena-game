import { Vec3, v3 } from './math.js';
import { SITE_RADIUS } from './constants.js';

// «Estación Aurora»: estación de investigación Pokémon abandonada. 64 × 48 m en planta
// (X ∈ [-32, 32], Z ∈ [-24, 24]), eje Y vertical. Tres rutas: pasillo oeste → A,
// centro disputado con conectores, invernadero este → B. Sin pisos superpuestos;
// un único desnivel: la pasarela central de 1 m con rampas escalonadas.

export type SolidTag =
  | 'suelo' | 'muro' | 'muroBajo' | 'caja' | 'cajaBaja' | 'pilar'
  | 'rampa' | 'pasarela' | 'puerta' | 'jardinera' | 'tuberia' | 'panel';

export interface SolidBox {
  min: Vec3;
  max: Vec3;
  tag: SolidTag;
  /** id de puerta: las puertas son sólidas (bloquean movimiento y disparos) solo en preparación */
  door?: 'atkW' | 'atkC' | 'atkE' | 'defW' | 'defC' | 'defE';
}

export interface Rect { x0: number; z0: number; x1: number; z1: number; }

export interface SiteDef { id: 'A' | 'B'; center: Vec3; radius: number; label: Vec3; }

export interface SpawnDef {
  /** rectángulo de la zona de aparición (también zona de compra) */
  zone: Rect;
  points: { pos: Vec3; yaw: number }[];
}

export interface BotPost { pos: Vec3; look: Vec3; }

export interface BotHints {
  /** anclas de ruta para variar el camino de los atacantes */
  routeAnchors: { oeste: Vec3; centro: Vec3; este: Vec3 };
  /** puestos defensivos con dirección de vigilancia */
  posts: { A: BotPost[]; B: BotPost[]; mid: BotPost[] };
}

export interface MapDef {
  name: string;
  bounds: Rect;
  solids: SolidBox[];        // geometría de colisión (incluye puertas)
  decor: SolidBox[];         // visual sin colisión (tuberías altas, paneles)
  sites: SiteDef[];
  attackerSpawn: SpawnDef;   // lado sur (z < 0)
  defenderSpawn: SpawnDef;   // lado norte (z > 0)
  botHints: BotHints;
  killY: number;             // por debajo, reponer (no debería ocurrir)
}

function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, tag: SolidTag, door?: SolidBox['door']): SolidBox {
  return { min: v3(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)), max: v3(Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)), tag, door };
}

/** Muro estándar (h 3,5 m) desde el suelo. */
const wall = (x0: number, z0: number, x1: number, z1: number, h = 3.5, tag: SolidTag = 'muro') => box(x0, 0, z0, x1, h, z1, tag);

/** Caja de cobertura centrada. */
const crate = (cx: number, cz: number, h: number, size = 1.4): SolidBox =>
  box(cx - size / 2, 0, cz - size / 2, cx + size / 2, h, cz + size / 2, h >= 1 ? 'caja' : 'cajaBaja');

const pillar = (cx: number, cz: number, size = 0.9, h = 3.5): SolidBox =>
  box(cx - size / 2, 0, cz - size / 2, cx + size / 2, h, cz + size / 2, 'pilar');

/** Rampa escalonada a lo largo de Z (peldaños ≤ 0,25 m para el solucionador de escalón). */
function rampZ(x0: number, x1: number, zStart: number, zEnd: number, y0: number, y1: number): SolidBox[] {
  const steps = Math.max(1, Math.ceil(Math.abs(y1 - y0) / 0.25));
  const out: SolidBox[] = [];
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps, t1 = (i + 1) / steps;
    const za = zStart + (zEnd - zStart) * t0;
    const zb = zStart + (zEnd - zStart) * t1;
    const h = y0 + (y1 - y0) * t1;
    if (h <= 0) continue;
    out.push(box(x0, 0, za, x1, h, zb, 'rampa'));
  }
  return out;
}

export function buildAuroraMap(): MapDef {
  const solids: SolidBox[] = [];
  const S = (b: SolidBox) => solids.push(b);

  // Suelo general
  S(box(-32, -1, -24, 32, 0, 24, 'suelo'));

  // Perímetro (h 5)
  S(wall(-32, -24, 32, -23.5, 5));
  S(wall(-32, 23.5, 32, 24, 5));
  S(wall(-32, -24, -31.5, 24, 5));
  S(wall(31.5, -24, 32, 24, 5));

  // ===== Lado sur: aparición atacante x[-10,10] z[-24,-16] =====
  // Muro norte del spawn con tres puertas de 2 m
  S(wall(-10, -16.5, -8.5, -16));
  S(wall(-6.5, -16.5, -1, -16));
  S(wall(1, -16.5, 6.5, -16));
  S(wall(8.5, -16.5, 10, -16));
  S(box(-8.5, 0, -16.5, -6.5, 3.5, -16, 'puerta', 'atkW'));
  S(box(-1, 0, -16.5, 1, 3.5, -16, 'puerta', 'atkC'));
  S(box(6.5, 0, -16.5, 8.5, 3.5, -16, 'puerta', 'atkE'));
  S(wall(-10.5, -24, -10, -16)); // laterales del spawn
  S(wall(10, -24, 10.5, -16));

  // Bloques macizos del sur
  S(wall(-32, -24, -10.5, -16)); // suroeste
  S(wall(10.5, -24, 32, -16));   // sureste

  // Antesalas (z[-16,-12]): oeste x[-28,-6], este x[6,28], corredor central x[-2,2]
  S(wall(-32, -16, -28, -12));       // tope oeste de la antesala
  S(wall(28, -16, 32, -12));
  S(wall(-6.5, -16, -2, -12));       // separadores antesala/corredor central
  S(wall(2, -16, 6.5, -12));
  S(wall(-22.5, -12.5, -6.5, -12));  // muro norte antesala oeste (hueco al pasillo x[-28,-22.5])
  S(wall(6.5, -12.5, 22.5, -12));

  // Pasillos laterales z[-12,2]: oeste x[-28,-22.5], este x[22.5,28]
  S(wall(-32, -12, -28.5, 2));
  S(wall(-28.5, -12, -28, 2, 3.5, 'panel'));
  S(wall(28, -12, 28.5, 2, 3.5, 'panel'));
  S(wall(28.5, -12, 32, 2));

  // Macizos entre pasillos y sala central
  S(wall(-22.5, -12.5, -6.5, 2));  // oeste (cara este = muro oeste de la sala central)
  S(wall(6.5, -12.5, 22.5, 2));    // este
  // Nota: la franja x[-12,-6.5] z[-12.5,2] queda dentro del macizo oeste ✔

  // Sala central x[-6,6] z[-12,6]; muros laterales con hueco conector en z[2.8,4.8]
  S(wall(-6.5, -12, -6, 2.8));
  S(wall(6, -12, 6.5, 2.8));

  // Pasarela central elevada (1 m) con rampas norte/sur
  S(box(-3, 0, -3, 3, 1, 3, 'pasarela'));
  rampZ(-1.5, 1.5, -6, -3, 0, 1).forEach(S);
  rampZ(-1.5, 1.5, 6, 3, 0, 1).forEach(S);
  S(box(-1.4, 1, -1, 2.5, 2.3, 1, 'caja')); // caja sobre la pasarela: corta las diagonales spawn-spawn

  // Corredor central norte x[1.5,4.5] z[6,15.5] (desplazado al este para
  // romper la línea recta spawn-spawn) y macizos laterales
  S(wall(-6.5, 6, 1.5, 15.5));
  S(wall(4.5, 6, 6.5, 15.5));

  // Conectores en S de la sala central a las plazas (sin línea recta este–oeste):
  // oeste: tramo de plaza x[-12,-8.5] z[5,8] + tramo de sala x[-10.5,-6] z[2,5]
  S(wall(-12, 2, -10.5, 5));   // tapón suroeste
  S(wall(-12, 8, -8.5, 14));   // macizo norte del tramo de plaza
  S(wall(-8.5, 4.8, -6, 14));  // macizo este del tramo de sala
  // este (simétrico)
  S(wall(10.5, 2, 12, 5));
  S(wall(8.5, 8, 12, 14));
  S(wall(6, 4.8, 8.5, 14));

  // ===== Lado norte: aparición defensora x[-6,6] z[16,24] =====
  S(wall(-6, 15.5, 1.5, 16));
  S(wall(3.5, 15.5, 6, 16));
  S(box(1.5, 0, 15.5, 3.5, 3.5, 16, 'puerta', 'defC'));
  // Bloque interior: impide la línea recta entre las dos puertas laterales
  S(wall(-4, 16, 0, 18.5));
  S(wall(-6.5, 14, -6, 15));
  S(wall(6, 14, 6.5, 15));
  S(box(-6.5, 0, 15, -6, 3.5, 18, 'puerta', 'defW'));
  S(box(6, 0, 15, 6.5, 3.5, 18, 'puerta', 'defE'));
  S(wall(-6.5, 18, -6, 24));
  S(wall(6, 18, 6.5, 24));

  // Macizos norte
  S(wall(-32, 18, -6.5, 24));
  S(wall(6.5, 18, 32, 24));

  // Plazas: A x[-30,-12] z[2,18], B x[12,30] z[2,18]
  S(wall(-32, 2, -30, 18));
  S(wall(30, 2, 32, 18));

  // ===== Coberturas (≈22) =====
  // Antesalas
  S(crate(-16, -14, 1.2));
  S(crate(16, -14, 1.2));
  // Pasillos laterales
  S(crate(-25.5, -5, 0.6));
  S(crate(25.5, -5, 0.6));
  // Sala central
  S(crate(-5, -8, 1.2));
  S(crate(5, -8, 1.2));
  S(crate(-4.8, 1, 0.6));
  S(crate(4.8, 1, 0.6));
  // Corredor central norte
  S(crate(3, 11, 0.6, 1.2));
  // Conectores: cajas apiladas a altura de vista para cegar la diagonal
  S(crate(-10.4, 5.7, 1.9, 1.4));
  S(crate(10.4, 5.7, 1.9, 1.4));
  // Plaza A (zona de instalación en (-21,10))
  S(crate(-21, 13.8, 1.2, 1.8));   // cobertura sólida para instalar
  S(crate(-17, 6.5, 0.6));
  S(crate(-25.5, 6.5, 1.2));
  S(pillar(-13.8, 11.5));
  S(crate(-27.5, 14.5, 1.2));
  S(crate(-24.5, 10, 0.6));
  // Plaza B (invernadero, (21,10)): jardineras
  S({ ...crate(21, 13.8, 1.2, 1.8), tag: 'jardinera' });
  S({ ...crate(17, 6.5, 0.6), tag: 'jardinera' });
  S({ ...crate(25.5, 6.5, 1.2), tag: 'jardinera' });
  S(pillar(13.8, 11.5));
  S({ ...crate(27.5, 14.5, 1.2), tag: 'jardinera' });
  S({ ...crate(24.5, 10, 0.6), tag: 'jardinera' });
  // Franjas defensoras
  S(crate(-9, 16, 0.6));
  S(crate(9, 16, 0.6));

  // ===== Decoración sin colisión =====
  const decor: SolidBox[] = [
    box(-30, 3.4, -12, -28, 3.8, 2, 'tuberia'),
    box(28, 3.4, -12, 30, 3.8, 2, 'tuberia'),
    box(-29.9, 2.6, 4, -29.5, 3.4, 16, 'panel'),
    box(29.5, 2.6, 4, 29.9, 3.4, 16, 'panel'),
    box(-4, 3.2, -24, 4, 3.6, -23.4, 'tuberia'),
    box(-4, 3.2, 23.4, 4, 3.6, 24, 'tuberia'),
  ];

  const atkPoints = [-8, -4, 0, 4, 8].map((x, i) => ({ pos: v3(x, 0, -20 - (i % 2)), yaw: Math.PI }));
  const defPoints = [-5.2, -4.6, 1.2, 3, 4.8].map((x, i) => ({ pos: v3(x, 0, 19 + (i % 2) * 1.3), yaw: 0 }));

  return {
    name: 'Estación Aurora',
    bounds: { x0: -32, z0: -24, x1: 32, z1: 24 },
    solids,
    decor,
    sites: [
      { id: 'A', center: v3(-21, 0, 10), radius: SITE_RADIUS, label: v3(-21, 3, 10) },
      { id: 'B', center: v3(21, 0, 10), radius: SITE_RADIUS, label: v3(21, 3, 10) },
    ],
    attackerSpawn: { zone: { x0: -10, z0: -24, x1: 10, z1: -16 }, points: atkPoints },
    defenderSpawn: { zone: { x0: -6, z0: 16, x1: 6, z1: 24 }, points: defPoints },
    botHints: {
      routeAnchors: { oeste: v3(-25.2, 0, -5), centro: v3(0, 0, -1), este: v3(25.2, 0, -5) },
      posts: {
        A: [
          { pos: v3(-23.5, 0, 13), look: v3(-25.2, 0, 2) },
          { pos: v3(-18, 0, 13.5), look: v3(-11, 0, 4) },
        ],
        B: [
          { pos: v3(23.5, 0, 13), look: v3(25.2, 0, 2) },
          { pos: v3(18, 0, 13.5), look: v3(11, 0, 4) },
        ],
        mid: [{ pos: v3(3, 0, 13.5), look: v3(3, 0, 0) }],
      },
    },
    killY: -5,
  };
}

export function inRect(r: Rect, x: number, z: number): boolean {
  return x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
}
