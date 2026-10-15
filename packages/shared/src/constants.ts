// Valores de diseño fijados por el documento maestro. Unidades SI (m, s) salvo indicación.

export const TICK_RATE = 60;
export const TICK_DT = 1 / TICK_RATE;
export const SNAPSHOT_RATE = 20;
export const INPUT_SEND_RATE = 30;

// Cápsula del jugador
export const PLAYER_RADIUS = 0.35;
export const PLAYER_HEIGHT = 1.5;
export const PLAYER_HEIGHT_CROUCH = 1.0;
export const CAMERA_HEIGHT = 1.25;
export const CAMERA_HEIGHT_CROUCH = 0.8;
export const HEAD_SPHERE_RADIUS = 0.18; // esfera de cabeza común, independiente del modelo
export const HEAD_OFFSET = 1.3;          // centro de la esfera de cabeza (de pie)
export const HEAD_OFFSET_CROUCH = 0.85;

// Movimiento
export const SPEED_RUN = 4.5;
export const SPEED_WALK = 2.2;
export const SPEED_CROUCH = 1.6;
export const AIM_SPEED_MULT = 0.75;
export const ACCEL = 30;
export const AIR_CONTROL = 0.2;
export const JUMP_SPEED = 4.8;
export const GRAVITY = 18;
export const MAX_STEP = 0.25;
export const MAX_SLOPE_DEG = 45;

// Combate
export const MAX_HP = 100;
export const HEAD_MULT = 1.5;
export const SHIELD_MAX = 50;
export const SHIELD_ABSORB = 0.5;
export const SHIELD_COST = 650;

export interface WeaponProfile {
  id: WeaponId;
  nombre: string;
  precio: number;
  dano: number;
  disparosPorSegundo: number;
  cargador: number;
  recargaS: number;
  alcance: number;
  dispersionBase: number; // grados, en reposo
  retrocesoVisual: number; // grados
}

export type WeaponId = 'pulso' | 'rafaga' | 'preciso' | 'explosivo';

export const WEAPONS: Record<WeaponId, WeaponProfile> = {
  pulso:   { id: 'pulso',   nombre: 'Pulso básico',   precio: 0,    dano: 20, disparosPorSegundo: 4,   cargador: 16, recargaS: 1.5, alcance: 45, dispersionBase: 0.35, retrocesoVisual: 0.4 },
  rafaga:  { id: 'rafaga',  nombre: 'Ráfaga táctica', precio: 1800, dano: 23, disparosPorSegundo: 6,   cargador: 24, recargaS: 1.8, alcance: 55, dispersionBase: 0.45, retrocesoVisual: 0.6 },
  preciso: { id: 'preciso', nombre: 'Pulso preciso',  precio: 2400, dano: 55, disparosPorSegundo: 1.2, cargador: 5,  recargaS: 2.2, alcance: 70, dispersionBase: 0.08, retrocesoVisual: 1.5 },
  // Proyectil con detonación en área (dano = en el centro, con atenuación lineal)
  explosivo: { id: 'explosivo', nombre: 'Carga explosiva', precio: 2600, dano: 65, disparosPorSegundo: 0.9, cargador: 4, recargaS: 2.4, alcance: 50, dispersionBase: 0.4, retrocesoVisual: 1.8 },
};

// Ataque explosivo: proyectil rápido que detona al impactar (mapa o enemigo) o al
// agotar el alcance. Daño en área con atenuación lineal hasta el borde; las paredes
// bloquean la onda (línea de efecto). No afecta a aliados ni al lanzador.
export const EXPLOSION_RADIUS = 3.2;
export const EXPLOSIVE_PROJ_SPEED = 22;
export const EXPLOSION_EDGE_FACTOR = 0.25; // fracción del daño en el borde del radio

export const SPREAD_MOVE_ADD = 1.5;   // grados si se mueve
export const SPREAD_AIR_ADD = 3.0;    // grados en el aire
export const SPREAD_CROUCH_MULT = 0.75;
export const SPREAD_AIM_MULT = 0.5;
export const SPREAD_BURST_ADD = 0.15; // por disparo consecutivo (ráfaga)
export const SPREAD_BURST_MAX = 1.2;
export const SPREAD_BURST_RESET_S = 0.3;
export const MOVE_SPREAD_THRESHOLD = 0.5; // m/s para considerarse "en movimiento"

// Economía
export const ECO_START = 800;
export const ECO_MAX = 6000;
export const ECO_KILL = 200;
export const ECO_PLANT = 200;
export const ECO_DEFUSE = 300;
export const ECO_WIN = 2400;
export const ECO_LOSS_BASE = 1900;
export const ECO_LOSS_STREAK_STEP = 400;
export const ECO_LOSS_STREAK_MAX_BONUS = 1200;

export const ABILITY_COST = 400;
export const SMOKE_GRENADE_COST = 300;
export const DEFUSE_KIT_COST = 400;

// Rondas
export const PREP_S = 20;
export const ROUND_S = 100;
export const RESOLVE_S = 6;
export const CORE_COUNTDOWN_S = 35;
export const PLANT_S = 3;
export const DEFUSE_S = 7;
export const DEFUSE_KIT_S = 4;
export const DEFUSE_MAX_DIST = 1.5;
export const CORE_PICKUP_DIST = 1.0;
export const ROUNDS_PER_HALF = 6;
export const ROUNDS_TO_WIN = 7;
export const SITE_RADIUS = 3;
export const TEAM_SIZE = 5;

// Utilidades
export const UTIL_PROJ_SPEED = 12;
export const FLASH_FUSE_S = 0.8;
export const FLASH_RADIUS = 8;
export const FLASH_MAX_S = 1.2;
export const FLASH_MIN_S = 0.3;
export const EMBER_RADIUS = 2.5;
export const EMBER_DURATION_S = 5;
export const EMBER_DPS = 8;
export const CORTINA_RADIUS = 3;
export const CORTINA_DURATION_S = 7;
export const SPORE_RADIUS = 2.5;
export const SPORE_DURATION_S = 5;
export const SPORE_SLOW_MULT = 0.65;
export const SMOKE_G_RADIUS = 2.5;
export const SMOKE_G_DURATION_S = 6;

// Asistencias
export const ASSIST_MIN_DAMAGE = 30;
export const ASSIST_WINDOW_S = 5;

// Percepción de bots
export const BOT_FOV_DEG = 110;
export const BOT_VIEW_DIST = 35;
export const BOT_MEMORY_S = 3;
export const HEAR_RUN_DIST = 12;
export const HEAR_JUMP_DIST = 10;
export const HEAR_FIRE_DIST = 25;

export interface BotDifficulty { reactionMs: number; aimErrorDeg: number; }
export const BOT_DIFFICULTIES: Record<'facil' | 'normal' | 'dificil', BotDifficulty> = {
  facil: { reactionMs: 450, aimErrorDeg: 4 },
  normal: { reactionMs: 280, aimErrorDeg: 2 },
  dificil: { reactionMs: 180, aimErrorDeg: 1 },
};

// Red
export const INTERP_BUFFER_MS = 100;
export const LAG_COMP_MAX_MS = 150;
export const RECONNECT_GRACE_S = 60;
export const BOT_TAKEOVER_S = 2;
export const ENEMY_MARKER_S = 2;

export type Team = 0 | 1; // 0 = azul, 1 = naranja
// Los cuatro últimos vienen del plantel de Pokkén Tournament (gens 1-4)
export type CharacterId =
  | 'pikachu' | 'charmander' | 'squirtle' | 'bulbasaur' | 'mewtwo'
  | 'gengar' | 'gardevoir' | 'lucario' | 'garchomp';
export const CHARACTERS: CharacterId[] = [
  'pikachu', 'charmander', 'squirtle', 'bulbasaur', 'mewtwo',
  'gengar', 'gardevoir', 'lucario', 'garchomp',
];

/**
 * Nombre del ataque según el personaje y el perfil equipado. Los tres perfiles son
 * mecánicamente comunes (daño/cadencia/alcance idénticos); solo cambia su identidad
 * elemental: Impactrueno y Ascuas son el pulso básico, Rayo o Hidrobomba el preciso, etc.
 */
export const ATTACK_NAMES: Record<CharacterId, Record<WeaponId, string>> = {
  pikachu: { pulso: 'Impactrueno', rafaga: 'Chispa', preciso: 'Rayo', explosivo: 'Bola Voltio' },
  charmander: { pulso: 'Ascuas', rafaga: 'Lanzallamas', preciso: 'Llamarada', explosivo: 'Estallido' },
  squirtle: { pulso: 'Pistola Agua', rafaga: 'Rayo Burbuja', preciso: 'Hidrobomba', explosivo: 'Hidropulso' },
  bulbasaur: { pulso: 'Hoja Afilada', rafaga: 'Bala Semilla', preciso: 'Rayo Solar', explosivo: 'Bomba Germen' },
  mewtwo: { pulso: 'Confusión', rafaga: 'Psicorrayo', preciso: 'Psíquico', explosivo: 'Esfera Aural' },
  gengar: { pulso: 'Bola Sombra', rafaga: 'Tinieblas', preciso: 'Pulso Umbrío', explosivo: 'Bomba Lodo' },
  gardevoir: { pulso: 'Hoja Mágica', rafaga: 'Psicochoque', preciso: 'Fuerza Lunar', explosivo: 'Brillo Mágico' },
  lucario: { pulso: 'Palmeo', rafaga: 'Hueso Veloz', preciso: 'Esfera Aural', explosivo: 'A Bocajarro' },
  garchomp: { pulso: 'Garra Dragón', rafaga: 'Dragoaliento', preciso: 'Carga Dragón', explosivo: 'Terremoto' },
};

export const CHARACTER_INFO: Record<CharacterId, { nombre: string; habilidad: string; descripcionHabilidad: string }> = {
  pikachu: { nombre: 'Pikachu', habilidad: 'Destello', descripcionHabilidad: 'Lanza una esfera que detona tras 0,8 s y ciega hasta 1,2 s a los enemigos con línea de visión en 8 m. Mirar en dirección opuesta reduce el efecto a 0,3 s. No afecta a aliados.' },
  charmander: { nombre: 'Charmander', habilidad: 'Ascua', descripcionHabilidad: 'Proyectil que crea una zona ígnea de 2,5 m de radio durante 5 s al tocar el suelo. Inflige 8 PV/s a los enemigos dentro. Las zonas superpuestas no acumulan daño.' },
  squirtle: { nombre: 'Squirtle', habilidad: 'Cortina', descripcionHabilidad: 'Proyectil que despliega una niebla de 3 m de radio durante 7 s. Bloquea la visión y la detección de los bots; no detiene ataques ni movimiento.' },
  bulbasaur: { nombre: 'Bulbasaur', habilidad: 'Esporas', descripcionHabilidad: 'Proyectil que crea una zona de esporas de 2,5 m de radio durante 5 s. Reduce la velocidad enemiga al 65 % mientras permanecen dentro. Sin daño.' },
  mewtwo: { nombre: 'Mewtwo', habilidad: 'Premonición', descripcionHabilidad: 'Esfera psíquica que detona tras 0,8 s y revela durante 3 s a los enemigos en 10 m, incluso a través de paredes (aparecen en el minimapa y como marcadores). No inflige daño.' },
  gengar: { nombre: 'Gengar', habilidad: 'Niebla Sombría', descripcionHabilidad: 'Proyectil que despliega una niebla espectral de 3 m de radio durante 7 s. Bloquea la visión y la detección de los bots; no detiene ataques ni movimiento.' },
  gardevoir: { nombre: 'Gardevoir', habilidad: 'Premonición', descripcionHabilidad: 'Esfera psíquica que detona tras 0,8 s y revela durante 3 s a los enemigos en 10 m, incluso a través de paredes (aparecen en el minimapa y como marcadores). No inflige daño.' },
  lucario: { nombre: 'Lucario', habilidad: 'Destello de Aura', descripcionHabilidad: 'Esfera de aura que detona tras 0,8 s y ciega hasta 1,2 s a los enemigos con línea de visión en 8 m. Mirar en dirección opuesta reduce el efecto a 0,3 s. No afecta a aliados.' },
  garchomp: { nombre: 'Garchomp', habilidad: 'Bramido Dragón', descripcionHabilidad: 'Proyectil que crea una zona de presión dracónica de 2,5 m de radio durante 5 s. Reduce la velocidad enemiga al 65 % mientras permanecen dentro. Sin daño.' },
};

// ===== Evolución en mitad de la partida =====
// Se gana energía con bajas, asistencias y acciones de objetivo. Al alcanzar
// el umbral se evoluciona automáticamente: +PS máximos (con cura), recarga más
// rápida y la habilidad se recarga. El progreso persiste entre rondas.
export const EVO_KILL_POINTS = 40;
export const EVO_ASSIST_POINTS = 20;
export const EVO_OBJECTIVE_POINTS = 35; // instalar o desactivar el núcleo
export const EVO_THRESHOLDS = [80, 180]; // puntos totales para la 1.ª y 2.ª evolución
export const EVO_HP_BONUS = 15;          // PS máximos extra por etapa (y cura al evolucionar)
export const EVO_RELOAD_MULT = 0.88;     // recarga por etapa (multiplicativo)
export const EVO_SCALE: [number, number, number] = [1, 1.12, 1.24]; // escala visual por etapa

/** Cadenas evolutivas (nombre mostrado por etapa > 0). Mewtwo no evoluciona. */
export const EVOLUTIONS: Record<CharacterId, string[]> = {
  pikachu: ['Raichu'],
  charmander: ['Charmeleon', 'Charizard'],
  squirtle: ['Wartortle', 'Blastoise'],
  bulbasaur: ['Ivysaur', 'Venusaur'],
  mewtwo: [],
  gengar: [],
  gardevoir: [],
  lucario: [],
  garchomp: [],
};

export function maxEvoStage(id: CharacterId): number {
  return EVOLUTIONS[id].length;
}

export function characterDisplayName(id: CharacterId, stage: number): string {
  return stage > 0 ? EVOLUTIONS[id][stage - 1] ?? CHARACTER_INFO[id].nombre : CHARACTER_INFO[id].nombre;
}

export function maxHpFor(stage: number): number {
  return MAX_HP + EVO_HP_BONUS * stage;
}

// Premonición (habilidad de Mewtwo)
export const PREMONICION_RADIUS = 10;
export const PREMONICION_DURATION_S = 3;

// ===== Pokéballs (objetos aleatorios en el mapa) =====
// En cada ronda aparecen POKEBALL_COUNT pokéballs en puntos aleatorios del mapa
// (map.pokeballSpots). Al pisarlas se abren con un premio aleatorio; si el premio
// no aporta nada (todo al máximo), se convierte en créditos de consolación.
export const POKEBALL_COUNT = 4;
export const POKEBALL_PICKUP_DIST = 1.0;  // recogida automática (m, en planta)
export const POKEBALL_HEAL = 40;          // cura: PS restaurados (hasta el máximo)
export const POKEBALL_EVO_POINTS = 30;    // energía: puntos de evolución
export const POKEBALL_CREDITS = 300;      // consolación: créditos

export type PokeballPrize = 'energia' | 'cura' | 'mt' | 'mo' | 'creditos';
