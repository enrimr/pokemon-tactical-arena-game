import { GameSim } from './sim.js';
import { C2S, S2C, BuyItem } from './protocol.js';
import { SimEvent, PlayerInput } from './types.js';
import { CHARACTERS, CharacterId } from './constants.js';

export type Sink = (msg: S2C) => void;

const SNAP_EVERY_TICKS = 3; // 60 Hz de simulación → snapshots a 20 Hz

/**
 * Bucle de partida compartido entre el servidor (una sala) y el Web Worker local
 * (solitario y entrenamiento): enruta mensajes al GameSim y difunde snapshots.
 */
export class MatchHost {
  readonly sim: GameSim;
  private sinks = new Map<number, Sink>();
  private eventBuffer: SimEvent[] = [];
  /** se invoca al empezar cada ronda (prep); el servidor activa humanos pendientes */
  onRoundStart: (() => void) | null = null;
  onMatchEnd: (() => void) | null = null;
  private ended = false;

  constructor(sim: GameSim) {
    this.sim = sim;
  }

  attach(playerId: number, sink: Sink): void {
    this.sinks.set(playerId, sink);
  }

  detach(playerId: number): void {
    this.sinks.delete(playerId);
  }

  /** Mensajes de juego (las fases de lobby las gestiona el servidor aparte). */
  handleMessage(playerId: number, msg: C2S): void {
    switch (msg.t) {
      case 'input': {
        if (!Array.isArray(msg.inputs) || msg.inputs.length > 4) return;
        for (const raw of msg.inputs) {
          const input = sanitizeInput(raw);
          if (input) this.sim.queueInput(playerId, input);
        }
        break;
      }
      case 'comprar': {
        const item = msg.item;
        const valid: BuyItem[] = ['rafaga', 'preciso', 'escudo', 'habilidad', 'granada', 'kit'];
        if (!valid.includes(item)) return;
        const res = this.sim.buy(playerId, item);
        const p = this.sim.players.get(playerId);
        this.sinks.get(playerId)?.({
          t: 'compraResultado', ok: res.ok, item, motivo: res.motivo, credits: p?.credits ?? 0,
        });
        break;
      }
      case 'personaje': {
        if (!CHARACTERS.includes(msg.character as CharacterId)) return;
        this.sim.changeCharacter(playerId, msg.character);
        break;
      }
      default:
        break;
    }
  }

  /** Un tick de simulación (llamar a 60 Hz). */
  tick(): void {
    const events = this.sim.step();
    this.eventBuffer.push(...events);
    for (const e of events) {
      if (e.e === 'fase' && e.fase === 'prep') this.onRoundStart?.();
      if (e.e === 'fase' && e.fase === 'end' && !this.ended) {
        this.ended = true;
        // Difundir el final antes del último snapshot
        for (const sink of this.sinks.values()) {
          sink({
            t: 'finPartida',
            ganador: this.sim.match.matchWinner ?? 'empate',
            score: [this.sim.match.score[0], this.sim.match.score[1]],
          });
        }
        this.onMatchEnd?.();
      }
    }
    if (this.sim.tick % SNAP_EVERY_TICKS === 0) {
      for (const [id, sink] of this.sinks) {
        if (!this.sim.players.has(id)) continue;
        sink(this.sim.buildSnapshot(id, this.eventBuffer));
      }
      this.eventBuffer = [];
    }
  }
}

/** Valida y acota una entrada de cliente; devuelve null si es inservible. */
export function sanitizeInput(raw: unknown): PlayerInput | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
  const seq = num(r.seq);
  const moveX = num(r.moveX);
  const moveZ = num(r.moveZ);
  const yaw = num(r.yaw);
  const pitch = num(r.pitch);
  const buttons = num(r.buttons);
  const ackTick = num(r.ackTick);
  if ([seq, moveX, moveZ, yaw, pitch, buttons, ackTick].some(Number.isNaN)) return null;
  if (seq < 0 || seq > 1e9 || !Number.isInteger(seq)) return null;
  return {
    seq,
    moveX: Math.max(-1, Math.min(1, moveX)),
    moveZ: Math.max(-1, Math.min(1, moveZ)),
    yaw: Math.max(-Math.PI * 2, Math.min(Math.PI * 2, yaw)),
    pitch: Math.max(-1.56, Math.min(1.56, pitch)),
    buttons: buttons & 0x3ff,
    ackTick: Math.max(0, Math.min(1e9, Math.floor(ackTick))),
  };
}
