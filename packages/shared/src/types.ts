import { Vec3 } from './math.js';
import { CharacterId, Team, WeaponId } from './constants.js';

export const BTN = {
  FIRE: 1 << 0,
  WALK: 1 << 1,
  CROUCH: 1 << 2,
  JUMP: 1 << 3,
  USE: 1 << 4,       // E: instalar / desactivar / interactuar
  RELOAD: 1 << 5,
  AIM: 1 << 6,       // clic derecho: concentrar apuntado
  ABILITY: 1 << 7,   // Q
  GRENADE: 1 << 8,   // G
  DROP: 1 << 9,      // F: soltar núcleo
} as const;

export interface PlayerInput {
  seq: number;
  moveX: number;   // -1..1 (derecha +)
  moveZ: number;   // -1..1 (adelante +)
  yaw: number;
  pitch: number;
  buttons: number;
  /** último tick de snapshot visto por el cliente (compensación de latencia) */
  ackTick: number;
}

export type InteractKind = 'instalar' | 'desactivar';

export interface Interaction {
  kind: InteractKind;
  ticksLeft: number;
  totalTicks: number;
  site: 'A' | 'B';
}

export interface DamageEntry { attacker: number; amount: number; tick: number; }

export interface PlayerState {
  id: number;
  name: string;
  team: Team;
  character: CharacterId;
  isBot: boolean;
  botDifficulty: 'facil' | 'normal' | 'dificil';
  connected: boolean;         // humano conectado (si no, bot de relevo)
  controlledByBot: boolean;

  alive: boolean;
  hp: number;
  shield: number;
  credits: number;

  weapon: WeaponId;
  ammo: number;
  reloadTicksLeft: number;    // 0 = no recargando
  fireCooldown: number;
  burstShots: number;
  lastFireTick: number;

  abilityCharges: number;     // 0 ó 1
  grenadeCharges: number;     // 0 ó 1
  defuseKit: boolean;

  pos: Vec3;                  // pies
  vel: Vec3;
  yaw: number;
  pitch: number;
  crouching: boolean;
  walking: boolean;
  aiming: boolean;
  onGround: boolean;
  slowFactor: number;         // 1 normal, 0.65 en esporas

  hasCore: boolean;
  interaction: Interaction | null;

  flashEndTick: number;
  prevButtons: number;

  kills: number;
  deaths: number;
  assists: number;
  damageDealt: number;
  recentDamage: DamageEntry[];

  lastInputSeq: number;
  lastAckTick: number;
  stepPhase: number;          // acumulador para sonido de pasos
}

export type Phase = 'lobby' | 'prep' | 'active' | 'planted' | 'resolve' | 'end';

export type RoundEndReason =
  | 'eliminacion_atacantes' | 'eliminacion_defensores' | 'tiempo_agotado'
  | 'nucleo_detonado' | 'nucleo_desactivado' | 'empate_tecnico';

export interface CoreState {
  carrier: number | null;     // id de jugador
  pos: Vec3;                  // válida si carrier === null y !planted
  planted: boolean;
  plantedSite: 'A' | 'B' | null;
  lastValidPos: Vec3;
}

export type ZoneType = 'ascua' | 'esporas' | 'cortina' | 'niebla';

export interface ZoneState {
  id: number;
  type: ZoneType;
  pos: Vec3;
  radius: number;
  endTick: number;
  team: Team;
  owner: number;
}

export type ProjectileType = 'destello' | 'ascua' | 'cortina' | 'esporas' | 'niebla';

export interface ProjectileState {
  id: number;
  type: ProjectileType;
  owner: number;
  team: Team;
  pos: Vec3;
  vel: Vec3;
  bornTick: number;
  resting: boolean;
}

export interface MatchState {
  phase: Phase;
  phaseTicksLeft: number;
  roundNumber: number;        // 1-based dentro de la mitad
  half: 1 | 2;
  attackingTeam: Team;
  score: [number, number];    // por equipo (0 azul, 1 naranja)
  lossStreak: [number, number];
  roundWinner: Team | null;
  roundEndReason: RoundEndReason | null;
  matchWinner: Team | 'empate' | null;
}

// Eventos de un tick, difundidos en los snapshots
export type SimEvent =
  | { e: 'baja'; killer: number; victim: number; assist: number | null; headshot: boolean }
  | { e: 'sonido'; tipo: 'pasos' | 'salto' | 'disparo' | 'recarga' | 'instalacion' | 'desactivacion' | 'explosion' | 'despliegue' | 'nucleo'; pos: Vec3; radio: number; team: Team; actor: number }
  | { e: 'trazo'; from: Vec3; to: Vec3; weapon: WeaponId; char: CharacterId; shooter: number }
  | { e: 'impacto'; target: number; shooter: number; headshot: boolean; dano: number }
  | { e: 'destello'; victim: number; durTicks: number }
  | { e: 'fase'; fase: Phase; motivo?: RoundEndReason; ganador?: Team | null }
  | { e: 'instalado'; site: 'A' | 'B'; por: number }
  | { e: 'desactivado'; por: number }
  | { e: 'nucleoSuelto'; pos: Vec3 }
  | { e: 'nucleoRecogido'; por: number }
  | { e: 'compra'; player: number; item: string };

export interface LastSeen { pos: Vec3; yaw: number; tick: number; }
