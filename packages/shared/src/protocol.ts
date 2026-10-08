import { CharacterId, Team, WeaponId } from './constants.js';
import { Vec3 } from './math.js';
import {
  CoreState, MatchState, PlayerInput, ProjectileState, SimEvent, ZoneState,
} from './types.js';

export type BuyItem = 'rafaga' | 'preciso' | 'escudo' | 'habilidad' | 'granada' | 'kit';

// ===== Cliente → Servidor =====
export type C2S =
  | { t: 'crear'; nombre: string }
  | { t: 'unirse'; codigo: string; nombre: string; token?: string }
  | { t: 'lobbyEquipo'; team: Team }
  | { t: 'lobbyPersonaje'; character: CharacterId }
  | { t: 'lobbyListo'; listo: boolean }
  | { t: 'lobbyMover'; playerId: number; team: Team }   // solo anfitrión
  | { t: 'lobbyIniciar' }                                // solo anfitrión
  | { t: 'input'; inputs: PlayerInput[] }
  | { t: 'comprar'; item: BuyItem }
  | { t: 'personaje'; character: CharacterId }
  | { t: 'ping'; time: number }
  | { t: 'salir' };

// ===== Servidor → Cliente =====
export interface LobbyPlayerInfo {
  id: number;
  nombre: string;
  team: Team;
  character: CharacterId;
  listo: boolean;
  esBot: boolean;
  esAnfitrion: boolean;
  conectado: boolean;
}

export interface LobbyState {
  codigo: string;
  jugadores: LobbyPlayerInfo[];
  enPartida: boolean;
}

export interface SnapPlayer {
  id: number;
  nombre: string;
  team: Team;
  character: CharacterId;
  alive: boolean;
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  pitch: number;
  crouching: boolean;
  walking: boolean;
  aiming: boolean;
  hasCore: boolean;
  esBot: boolean;
  // Campos solo presentes para uno mismo / aliados:
  hp?: number;
  shield?: number;
  credits?: number;
  weapon?: WeaponId;
  ammo?: number;
  reloadTicksLeft?: number;
  abilityCharges?: number;
  grenadeCharges?: number;
  defuseKit?: boolean;
  interactTicksLeft?: number;
  interactTotal?: number;
  flashTicksLeft?: number;
  kills?: number;
  deaths?: number;
  assists?: number;
  damageDealt?: number;
}

export interface EnemyMarker { id: number; pos: Vec3; yaw: number; ageTicks: number; }

export interface Snapshot {
  t: 'snap';
  tick: number;
  ackSeq: number;              // último input procesado del receptor
  vivos: [number, number];     // supervivientes por equipo (sin revelar posiciones)
  match: MatchState;
  players: SnapPlayer[];       // uno mismo + aliados + enemigos visibles
  markers: EnemyMarker[];      // últimas posiciones conocidas (≤2 s)
  core: CoreState;
  zones: ZoneState[];
  projectiles: ProjectileState[];
  events: SimEvent[];          // eventos desde el último snapshot (filtrados)
}

export type S2C =
  | { t: 'bienvenida'; id: number; token: string; codigo: string }
  | { t: 'lobby'; estado: LobbyState }
  | { t: 'inicio'; seed: number; tuId: number; tick: number }
  | Snapshot
  | { t: 'compraResultado'; ok: boolean; item: BuyItem; motivo?: string; credits: number }
  | { t: 'pong'; time: number; serverTick: number }
  | { t: 'finPartida'; ganador: Team | 'empate'; score: [number, number] }
  | { t: 'error'; codigo: 'salaNoExiste' | 'salaLlena' | 'nombreInvalido' | 'noAutorizado' | 'formato'; msg: string };

export function encode(msg: C2S | S2C): string {
  return JSON.stringify(msg);
}

export function decode(data: string | ArrayBuffer | Uint8Array): unknown {
  const s = typeof data === 'string' ? data : new TextDecoder().decode(data as ArrayBuffer);
  return JSON.parse(s);
}

/** Alfabeto sin caracteres ambiguos (sin 0/O, 1/I/L). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function isValidRoomCode(code: unknown): code is string {
  return typeof code === 'string' && code.length === 6 && [...code].every((c) => ROOM_CODE_ALPHABET.includes(c));
}

export function isValidAlias(name: unknown): name is string {
  return typeof name === 'string' && name.length >= 2 && name.length <= 16 && !/[\n\r\t<>]/.test(name);
}
