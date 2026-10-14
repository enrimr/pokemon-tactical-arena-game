import { v3, Vec3 } from './math.js';
import { SITE_RADIUS } from './constants.js';
import { box, buildAuroraMap, MapDef, MapId, SolidBox } from './map.js';

// ===== Registro de mapas =====

export const MAP_IDS: MapId[] = ['aurora', 'bosque', 'paleta'];

export const MAP_INFO: Record<MapId, { nombre: string; descripcion: string }> = {
  aurora: { nombre: 'Estación Aurora', descripcion: 'Estación de investigación abandonada. Tres rutas y pasarela central.' },
  bosque: { nombre: 'Bosque Verde', descripcion: 'Senderos en zigzag entre hileras de árboles, hierba alta y claros.' },
  paleta: { nombre: 'Pueblo Paleta', descripcion: 'El pueblo de inicio: dos casas, el laboratorio y el mar al sur.' },
};

export function isMapId(v: unknown): v is MapId {
  return v === 'aurora' || v === 'bosque' || v === 'paleta';
}

export function buildMapById(id: MapId): MapDef {
  switch (id) {
    case 'bosque': return buildBosqueVerde();
    case 'paleta': return buildPuebloPaleta();
    default: return buildAuroraMap();
  }
}

// Helpers comunes
const seto = (x0: number, z0: number, x1: number, z1: number, h = 4): SolidBox => box(x0, 0, z0, x1, h, z1, 'seto');
const valla = (x0: number, z0: number, x1: number, z1: number, h = 1.1): SolidBox => box(x0, 0, z0, x1, h, z1, 'valla');
/** Tocón/tronco caído: cobertura baja de madera. */
const tocon = (cx: number, cz: number, h = 1.1, sx = 1.2, sz = 1.2): SolidBox =>
  box(cx - sx / 2, 0, cz - sz / 2, cx + sx / 2, h, cz + sz / 2, 'tronco');

/**
 * «Bosque Verde»: adaptación fiel del bosque entre Ciudad Verde y Ciudad Plateada.
 * Como en el original: se entra por la caseta del sur-este, un sendero recorre el
 * borde inferior, los pasillos zigzaguean entre hileras impenetrables de árboles
 * con campos de hierba alta, y se sale por el norte. Los claros oeste (A) y
 * este (B) hacen de zonas de instalación.
 */
export function buildBosqueVerde(): MapDef {
  const solids: SolidBox[] = [];
  const S = (b: SolidBox) => solids.push(b);

  // Suelo y perímetro de árboles
  S(box(-32, -1, -24, 32, 0, 24, 'suelo'));
  S(seto(-32, -24, 32, -22));
  S(seto(-32, 22, 32, 24));
  S(seto(-32, -24, -30, 24));
  S(seto(30, -24, 32, 24));

  // Caseta de entrada (spawn atacante, sur-este como en el original)
  S(seto(1.5, -22, 2, -16.5));
  S(seto(16, -22, 16.5, -16.5));
  S(seto(2, -17, 4, -16.5));
  S(box(4, 0, -17, 6, 3.5, -16.5, 'puerta', 'atkW'));
  S(seto(6, -17, 8.5, -16.5));
  S(box(8.5, 0, -17, 10.5, 3.5, -16.5, 'puerta', 'atkC'));
  S(seto(10.5, -17, 12.5, -16.5));
  S(box(12.5, 0, -17, 14.5, 3.5, -16.5, 'puerta', 'atkE'));
  S(seto(14.5, -17, 16, -16.5));

  // Banda de árboles SUR (z −12…−5): pasillos en el oeste, centro-oeste, sureste y este
  S(seto(-24, -12, -8, -5));
  S(seto(-4, -12, 14, -5));
  S(seto(18, -12, 26, -5));

  // Campo central (z −5…5) flanqueado por hileras con una ventana a media altura
  S(seto(-24, -5, -22, -1));
  S(seto(-24, 2, -22, 5));
  S(seto(22, -5, 24, -1));
  S(seto(22, 2, 24, 5));
  // Islas de árboles como cobertura dura del campo
  S(seto(-11, -1, -7, 1.5));
  S(seto(7, -1, 11, 1.5));

  // Banda de árboles NORTE (z 5…12)
  S(seto(-24, 5, -14, 12));
  S(seto(-8, 5, 8, 12));
  S(seto(12, 5, 24, 12));

  // Claros norte y separador central
  S(seto(-2, 11, 2, 17.5));

  // Caseta de salida (spawn defensor, norte-centro)
  S(seto(-5.5, 17.5, -5, 22));
  S(seto(7, 17.5, 7.5, 22));
  S(seto(-5, 17.5, -4.5, 18));
  S(box(-4.5, 0, 17.5, -2.5, 3.5, 18, 'puerta', 'defW'));
  S(seto(-2.5, 17.5, 2.5, 18));
  S(box(2.5, 0, 17.5, 4.5, 3.5, 18, 'puerta', 'defE'));
  S(seto(4.5, 17.5, 7, 18));

  // Coberturas: tocones y troncos caídos
  S(tocon(-14, -1));
  S(tocon(16, 1));
  S(tocon(-4, 3.2));
  S(tocon(6, -3));
  S(box(-18, 0, -15, -15.6, 0.8, -14.2, 'tronco')); // tronco caído, sendero sur
  S(box(20, 0, -15.2, 22.4, 0.8, -14.4, 'tronco'));
  S(tocon(-23, 13));
  S(tocon(-13, 16.2));
  S(box(-22, 0, 12.6, -19.6, 0.8, 13.4, 'tronco'));
  S(tocon(11, 13));
  S(tocon(23, 16));
  S(box(14, 0, 12.4, 16.4, 0.8, 13.2, 'tronco'));

  const atkPoints = [4, 7, 9.5, 12, 14.5].map((x, i) => ({ pos: v3(x, 0, -19.5 - (i % 2)), yaw: Math.PI }));
  const defPoints = [-4, -2, 1, 3.5, 6].map((x, i) => ({ pos: v3(x, 0, 19.5 + (i % 2)), yaw: 0 }));

  const arboles: { pos: Vec3; s: number }[] = [];
  // Copas decorativas plantadas dentro de las hileras (inaccesibles)
  const spots: [number, number][] = [
    [-20, -8.5], [-14, -8.5], [-10, -8.5], [0, -8.5], [6, -8.5], [11, -8.5], [22, -8.5],
    [-21, 8.5], [-16, 8.5], [-5, 8.5], [0, 8.5], [5, 8.5], [15, 8.5], [21, 8.5], [0, 14.5],
    [-28, -23], [-20, -23], [-10, -23], [0, -23], [20, -23], [28, -23],
    [-24, 23], [-12, 23], [10, 23], [18, 23], [26, 23],
    [-31, -16], [-31, -6], [-31, 6], [-31, 16], [31, -16], [31, -4], [31, 8], [31, 18],
    [-9, 0.2], [9, 0.2],
  ];
  spots.forEach(([x, z], i) => arboles.push({ pos: v3(x, 0, z), s: 0.9 + ((i * 7) % 5) / 10 }));

  return {
    id: 'bosque',
    name: 'Bosque Verde',
    bounds: { x0: -32, z0: -24, x1: 32, z1: 24 },
    solids,
    decor: [],
    sites: [
      { id: 'A', center: v3(-18, 0, 14.5), radius: SITE_RADIUS, label: v3(-18, 3, 14.5) },
      { id: 'B', center: v3(18, 0, 14.5), radius: SITE_RADIUS, label: v3(18, 3, 14.5) },
    ],
    attackerSpawn: { zone: { x0: 2, z0: -22, x1: 16, z1: -17 }, points: atkPoints },
    defenderSpawn: { zone: { x0: -5, z0: 18, x1: 7, z1: 22 }, points: defPoints },
    botHints: {
      routeAnchors: { oeste: v3(-27, 0, -8), centro: v3(0, 0, -2), este: v3(27, 0, -8) },
      posts: {
        A: [
          { pos: v3(-22, 0, 15.8), look: v3(-27, 0, 8) },
          { pos: v3(-13, 0, 15.5), look: v3(-11, 0, 7) },
        ],
        B: [
          { pos: v3(22, 0, 15.8), look: v3(26, 0, 8) },
          { pos: v3(13, 0, 15.5), look: v3(10, 0, 7) },
        ],
        mid: [{ pos: v3(5, 0, 16.5), look: v3(10, 0, 8) }],
      },
    },
    killY: -5,
    pokeballSpots: [
      v3(-27, 0, -14.5), v3(0, 0, -14.5), v3(20, 0, -14.5),  // sendero sur
      v3(-27, 0, 0), v3(27, 0, 0),                           // pasillos laterales
      v3(0, 0, 3), v3(0, 0, -3),                             // campo central
      v3(-11, 0, 8), v3(10, 0, 8),                           // pasos a los claros
      v3(-18, 0, 17), v3(18, 0, 17),                         // claros A y B
    ],
    dummySpots: [v3(-18, 0, 14.5), v3(18, 0, 14.5), v3(0, 0, 0), v3(-27, 0, -5), v3(27, 0, -5)],
    theming: {
      cielo: 0xa5d8bb,
      niebla: 0xb9dcbf,
      murales: [
        { pos: v3(9, 1.7, -21.95), rotY: 0 },
        { pos: v3(1, 1.7, 21.95), rotY: Math.PI },
      ],
      letreros: [
        { texto: 'BOSQUE VERDE', pos: v3(6.4, 0, -16), rotY: Math.PI },
        { texto: 'BOSQUE VERDE', pos: v3(5.5, 0, 17), rotY: 0 },
        { texto: '← ZONA A', pos: v3(-11, 0, 11.3), rotY: Math.PI },
        { texto: 'ZONA B →', pos: v3(10, 0, 11.3), rotY: Math.PI },
      ],
      hierba: [
        // Campo central: el gran herbazal del bosque
        [-18, -3, 1.3], [-15, 2, 1.2], [-12, -2.5, 1.1], [-6, 3.4, 1.2], [-2, -2, 1.3], [0, 2.6, 1.2],
        [3, -3.5, 1.1], [5, 2, 1.3], [12, -2, 1.2], [14, 3, 1.1], [18, -3.5, 1.2], [19, 2.4, 1.1],
        // Sendero sur y pasillos
        [-24, -14, 1], [-10, -14.5, 0.9], [8, -13.5, 0.9], [24, -14, 1],
        [-27.5, -8, 1], [-26.5, 6, 0.9], [27.5, -8, 1], [26.5, 6, 0.9],
        // Claros
        [-24, 16.5, 1], [-16, 12.6, 0.9], [-10, 15, 0.9], [10, 15.5, 0.9], [16, 12.6, 0.9], [24, 16.5, 1],
      ].map(([x, z, s]) => ({ pos: v3(x, 0, z), s })),
      arbustos: [
        v3(-28, 0, -13), v3(-21, 0, -13.5), v3(13, 0, -13.8), v3(28, 0, -13),
        v3(-27.5, 0, 10), v3(27.5, 0, 10), v3(-26, 0, 17), v3(26, 0, 17),
      ],
      arboles,
    },
  };
}

/**
 * «Pueblo Paleta»: adaptación fiel del pueblo de inicio. Las dos casas arriba
 * con la salida a la Ruta 1 entre ellas (spawn defensor), el Laboratorio
 * Pokémon al sureste y el mar de la Ruta 21 al suroeste. Los atacantes
 * desembarcan en la playa del sureste. Zonas: la plaza del cartel (A) y la
 * entrada del laboratorio (B).
 */
export function buildPuebloPaleta(): MapDef {
  const solids: SolidBox[] = [];
  const S = (b: SolidBox) => solids.push(b);

  // Suelo y arboleda perimetral
  S(box(-32, -1, -24, 32, 0, 24, 'suelo'));
  S(seto(-32, -24, 32, -22));
  S(seto(-32, 22, 32, 24));
  S(seto(-32, -24, -30, 24));
  S(seto(30, -24, 32, 24));

  // Mar de la Ruta 21 (suroeste): agua decorativa cercada por una valla
  S(valla(-30, -16, 6.4, -15.6, 0.9));
  S(valla(6, -22, 6.4, -16, 0.9));

  // Casa del jugador (noroeste) y casa del rival (noreste), con la Ruta 1 entre ambas
  S(box(-22, 0, 7, -12, 3, 14, 'casa'));
  S(box(2, 0, 7, 12, 3, 14, 'casa'));

  // Salida a la Ruta 1 (spawn defensor): hilera de árboles con dos huecos y
  // un bloque interior que impide la línea recta hacia la playa
  S(seto(-12, 15.5, -11, 22));
  S(seto(1, 15.5, 2, 22));
  S(seto(-11, 15.5, -8, 16));
  S(box(-8, 0, 15.5, -6, 3, 16, 'puerta', 'defW'));
  S(seto(-6, 15.5, -4, 16));
  S(box(-4, 0, 15.5, -2, 3, 16, 'puerta', 'defE'));
  S(seto(-2, 15.5, 1, 16));
  S(seto(-8, 17.5, -3, 19.5));

  // Laboratorio Pokémon (sureste, el edificio grande)
  S(box(8, 0, -10, 24, 3.5, -1, 'casa'));

  // Playa de desembarco (spawn atacante, sureste) con portones
  S(valla(9.6, -21, 10, -16.1, 1.1));
  S(valla(10, -16.5, 13, -16.1, 1.1));
  S(box(13, 0, -16.5, 15, 3, -16.1, 'puerta', 'atkW'));
  S(valla(15, -16.5, 19, -16.1, 1.1));
  S(box(19, 0, -16.5, 21, 3, -16.1, 'puerta', 'atkC'));
  S(valla(21, -16.5, 24.5, -16.1, 1.1));
  S(box(24.5, 0, -16.5, 26.5, 3, -16.1, 'puerta', 'atkE'));
  S(valla(26.5, -16.5, 30, -16.1, 1.1));

  // Vallas del pueblo (al sur de las casas, como en el original) y setos bajos
  S(valla(-22, 4.4, -14, 4.8, 0.9));
  S(valla(4, 4.4, 12, 4.8, 0.9));
  S(valla(2, -4, 6, -3.6, 0.9));
  // Arboleda de la plaza: corta la diagonal playa ↔ Ruta 1
  S(seto(-7, 9, -4, 11));

  // Coberturas del pueblo: cajas del laboratorio y jardineras floridas
  S(box(10.5, 0, 1.2, 12.5, 1.1, 3.2, 'cajaBaja'));
  S(box(20, 0, 0.6, 21.6, 0.7, 2.2, 'cajaBaja'));
  S(box(-9, 0, -0.5, -7, 1.2, 1.5, 'cajaBaja'));
  S(box(-20, 0, 2, -18.4, 0.45, 3.2, 'jardinera'));
  S(box(8, 0, 2, 9.6, 0.45, 3.2, 'jardinera'));
  S(tocon(-25, -6, 1.1));
  S(tocon(26, -5, 1.1));
  S(tocon(-16, -12.6, 0.8, 2.2, 1));

  const decor: SolidBox[] = [
    // Mar (visual, sin colisión; la valla impide pisarlo)
    box(-30, 0.02, -22, 6, 0.26, -16, 'agua'),
    // Tejados rojos de las casas y tejado del laboratorio
    box(-22.6, 3, 6.4, -11.4, 4.1, 14.6, 'tejado'),
    box(1.4, 3, 6.4, 12.6, 4.1, 14.6, 'tejado'),
    box(7.4, 3.5, -10.6, 24.6, 4.6, -0.4, 'tejado'),
    // Muelle de madera sobre el agua
    box(-14, 0.1, -19.5, -11.5, 0.4, -16, 'tronco'),
  ];

  const atkPoints = [12, 16, 19.5, 23, 27].map((x, i) => ({ pos: v3(x, 0, -19.5 - (i % 2) * 0.8), yaw: Math.PI }));
  const defPoints = [-9, -7, -5, -3, -1].map((x, i) => ({ pos: v3(x, 0, 20 + (i % 2) * 1.5), yaw: 0 }));

  const arboles: { pos: Vec3; s: number }[] = [];
  const spots: [number, number][] = [
    [-26, 23], [-18, 23], [-6, 23], [6, 23], [16, 23], [26, 23],
    [-31, -12], [-31, -2], [-31, 8], [-31, 18], [31, -12], [31, 0], [31, 10], [31, 20],
    [-24, -23], [-12, -23], [0, -23], [12, -23], [24, -23],
    [-11.5, 18], [1.5, 18],
  ];
  spots.forEach(([x, z], i) => arboles.push({ pos: v3(x, 0, z), s: 0.9 + ((i * 5) % 5) / 10 }));

  return {
    id: 'paleta',
    name: 'Pueblo Paleta',
    bounds: { x0: -32, z0: -24, x1: 32, z1: 24 },
    solids,
    decor,
    sites: [
      { id: 'A', center: v3(-5, 0, 3.5), radius: SITE_RADIUS, label: v3(-5, 3, 3.5) },
      { id: 'B', center: v3(14, 0, 4), radius: SITE_RADIUS, label: v3(14, 3, 4) },
    ],
    attackerSpawn: { zone: { x0: 10, z0: -21, x1: 28, z1: -16.5 }, points: atkPoints },
    defenderSpawn: { zone: { x0: -10, z0: 16, x1: 0, z1: 22 }, points: defPoints },
    botHints: {
      routeAnchors: { oeste: v3(-26, 0, -6), centro: v3(3, 0, -6), este: v3(27, 0, -6) },
      posts: {
        A: [
          { pos: v3(-10, 0, 7.5), look: v3(-5, 0, -6) },
          { pos: v3(-21, 0, 6), look: v3(-26, 0, -8) },
        ],
        B: [
          { pos: v3(13, 0, 5.5), look: v3(14, 0, -8) },
          { pos: v3(23, 0, 5.5), look: v3(27, 0, -7) },
        ],
        mid: [{ pos: v3(-1, 0, 6), look: v3(0, 0, -10) }],
      },
    },
    killY: -5,
    pokeballSpots: [
      v3(-14, 0, -13), v3(4, 0, -13), v3(26, 0, -13),  // calle del mar y playa
      v3(-26, 0, -2), v3(27, 0, 2),                     // calles oeste y este
      v3(-18, 0, 0.5), v3(-9.5, 0, 12.3), v3(22, 0, 6), // plaza y traseras
      v3(-20, 0, 14.8), v3(14, 0, 14.8),                // callejones norte
    ],
    dummySpots: [v3(-5, 0, 3.5), v3(14, 0, 4), v3(0, 0, -13), v3(-24, 0, 4), v3(26, 0, 8)],
    theming: {
      cielo: 0xaedcf5,
      niebla: 0xd8ecf5,
      murales: [
        { pos: v3(-11.96, 1.6, 10.5), rotY: Math.PI / 2 },
        { pos: v3(16, 1.8, -0.96), rotY: 0 },
      ],
      letreros: [
        { texto: 'PUEBLO PALETA', pos: v3(-5, 0, -0.4), rotY: Math.PI },
        { texto: 'LAB. POKÉMON', pos: v3(11, 0, 0.4), rotY: Math.PI },
        { texto: 'RUTA 1 →', pos: v3(-9.5, 0, 14.3), rotY: Math.PI },
        { texto: 'RUTA 21', pos: v3(2, 0, -14.6), rotY: 0 },
      ],
      hierba: [
        // Hierba alta de la Ruta 1, justo en la salida norte (como en el original)
        [-8, 13, 1.2], [-6.2, 14.6, 1.3], [-3.4, 13.4, 1.2], [-1, 14.8, 1.1], [-9.4, 15.4, 1],
        // Bordes del pueblo
        [-27, 8, 1], [-27, 16, 0.9], [27, 12, 1], [25, 16.5, 0.9],
        [-21, -10, 0.9], [-27, -13, 1], [8, -14.8, 0.8], [28, -8, 0.9],
      ].map(([x, z, s]) => ({ pos: v3(x, 0, z), s })),
      arbustos: [
        v3(-24, 0, 1), v3(-16, 0, 16), v3(6, 0, 16.4), v3(24, 0, 10),
        v3(28.6, 0, -14), v3(-28, 0, 20),
      ],
      arboles,
    },
  };
}
