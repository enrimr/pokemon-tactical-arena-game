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

export type WeaponId = 'pulso' | 'rafaga' | 'preciso';

export const WEAPONS: Record<WeaponId, WeaponProfile> = {
  pulso:   { id: 'pulso',   nombre: 'Pulso básico',   precio: 0,    dano: 20, disparosPorSegundo: 4,   cargador: 16, recargaS: 1.5, alcance: 45, dispersionBase: 0.35, retrocesoVisual: 0.4 },
  rafaga:  { id: 'rafaga',  nombre: 'Ráfaga táctica', precio: 1800, dano: 23, disparosPorSegundo: 6,   cargador: 24, recargaS: 1.8, alcance: 55, dispersionBase: 0.45, retrocesoVisual: 0.6 },
  preciso: { id: 'preciso', nombre: 'Pulso preciso',  precio: 2400, dano: 55, disparosPorSegundo: 1.2, cargador: 5,  recargaS: 2.2, alcance: 70, dispersionBase: 0.08, retrocesoVisual: 1.5 },
};

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
export type CharacterId = 'pikachu' | 'charmander' | 'squirtle' | 'bulbasaur';
export const CHARACTERS: CharacterId[] = ['pikachu', 'charmander', 'squirtle', 'bulbasaur'];

/**
 * Nombre del ataque según el personaje y el perfil equipado. Los tres perfiles son
 * mecánicamente comunes (daño/cadencia/alcance idénticos); solo cambia su identidad
 * elemental: Impactrueno y Ascuas son el pulso básico, Rayo o Hidrobomba el preciso, etc.
 */
export const ATTACK_NAMES: Record<CharacterId, Record<WeaponId, string>> = {
  pikachu: { pulso: 'Impactrueno', rafaga: 'Chispa', preciso: 'Rayo' },
  charmander: { pulso: 'Ascuas', rafaga: 'Lanzallamas', preciso: 'Llamarada' },
  squirtle: { pulso: 'Pistola Agua', rafaga: 'Rayo Burbuja', preciso: 'Hidrobomba' },
  bulbasaur: { pulso: 'Hoja Afilada', rafaga: 'Bala Semilla', preciso: 'Rayo Solar' },
};

export const CHARACTER_INFO: Record<CharacterId, { nombre: string; habilidad: string; descripcionHabilidad: string }> = {
  pikachu: { nombre: 'Pikachu', habilidad: 'Destello', descripcionHabilidad: 'Lanza una esfera que detona tras 0,8 s y ciega hasta 1,2 s a los enemigos con línea de visión en 8 m. Mirar en dirección opuesta reduce el efecto a 0,3 s. No afecta a aliados.' },
  charmander: { nombre: 'Charmander', habilidad: 'Ascua', descripcionHabilidad: 'Proyectil que crea una zona ígnea de 2,5 m de radio durante 5 s al tocar el suelo. Inflige 8 PV/s a los enemigos dentro. Las zonas superpuestas no acumulan daño.' },
  squirtle: { nombre: 'Squirtle', habilidad: 'Cortina', descripcionHabilidad: 'Proyectil que despliega una niebla de 3 m de radio durante 7 s. Bloquea la visión y la detección de los bots; no detiene ataques ni movimiento.' },
  bulbasaur: { nombre: 'Bulbasaur', habilidad: 'Esporas', descripcionHabilidad: 'Proyectil que crea una zona de esporas de 2,5 m de radio durante 5 s. Reduce la velocidad enemiga al 65 % mientras permanecen dentro. Sin daño.' },
};
