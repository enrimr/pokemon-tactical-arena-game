import {
  ABILITY_COST, ASSIST_MIN_DAMAGE, ASSIST_WINDOW_S, BOT_TAKEOVER_S, CAMERA_HEIGHT,
  CAMERA_HEIGHT_CROUCH, CharacterId, CORE_COUNTDOWN_S, CORE_PICKUP_DIST, CORTINA_DURATION_S,
  CORTINA_RADIUS, DEFUSE_KIT_COST, DEFUSE_KIT_S, DEFUSE_MAX_DIST, DEFUSE_S, ECO_DEFUSE,
  ECO_KILL, ECO_LOSS_BASE, ECO_LOSS_STREAK_MAX_BONUS, ECO_LOSS_STREAK_STEP, ECO_MAX,
  ECO_PLANT, ECO_START, ECO_WIN, EMBER_DPS, EMBER_DURATION_S, EMBER_RADIUS, ENEMY_MARKER_S,
  FLASH_FUSE_S, FLASH_MAX_S, FLASH_MIN_S, FLASH_RADIUS, GRAVITY, HEAD_MULT, HEAD_OFFSET,
  HEAD_OFFSET_CROUCH, HEAD_SPHERE_RADIUS, HEAR_FIRE_DIST, HEAR_JUMP_DIST, HEAR_RUN_DIST,
  LAG_COMP_MAX_MS, MAX_HP, PLANT_S, PLAYER_RADIUS, PREP_S, RESOLVE_S, ROUNDS_PER_HALF,
  ROUNDS_TO_WIN, ROUND_S, SHIELD_ABSORB, SHIELD_COST, SHIELD_MAX, SMOKE_GRENADE_COST,
  SMOKE_G_DURATION_S, SMOKE_G_RADIUS, SPEED_WALK, SPORE_DURATION_S, SPORE_RADIUS,
  SPORE_SLOW_MULT, Team, TICK_DT, TICK_RATE, WEAPONS,
} from './constants.js';
import { clamp, lookDir, v3, vclone, Vec3, vdist, vdistXZ, vdot, vlen, vnorm, vscale, vsub } from './math.js';
import { buildAuroraMap, inRect, MapDef } from './map.js';
import {
  groundHeight, lineOfSight, raySphere, rayVerticalCylinder, raycastMap,
} from './collision.js';
import { playerHeight, stepMovement, horizontalSpeed } from './movement.js';
import { applySpread, currentSpreadDeg, fireCooldownTicks, reloadTicks } from './weapons.js';
import { Rng } from './rng.js';
import {
  BTN, CoreState, Interaction, LastSeen, MatchState, PlayerInput, PlayerState,
  ProjectileState, RoundEndReason, SimEvent, ZoneState,
} from './types.js';
import { BuyItem, EnemyMarker, SnapPlayer, Snapshot } from './protocol.js';
import { BotBrain } from './bots.js';

export interface RosterEntry {
  id: number;
  nombre: string;
  team: Team;
  character: CharacterId;
  isBot: boolean;
  dificultad?: 'facil' | 'normal' | 'dificil';
  /** muñeco de entrenamiento: sin cerebro, estático o con vaivén */
  dummy?: 'estatico' | 'movil';
}

export interface SimOptions {
  /** campo de entrenamiento: rondas largas, reapariciones, roles relajados */
  training?: boolean;
}

const HIST_TICKS = Math.ceil((LAG_COMP_MAX_MS / 1000) * TICK_RATE) + 3;

interface HistEntry { pos: Vec3; crouching: boolean; alive: boolean; }

export function defaultInput(seq = 0): PlayerInput {
  return { seq, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: 0, ackTick: 0 };
}

export class GameSim {
  readonly map: MapDef;
  readonly seed: number;
  readonly players = new Map<number, PlayerState>();
  readonly match: MatchState;
  core: CoreState;
  zones: ZoneState[] = [];
  projectiles: ProjectileState[] = [];
  tick = 0;
  /** sonidos recientes (≤1 s) para la audición de los bots */
  soundLog: { pos: Vec3; radio: number; team: Team; tick: number; actor: number }[] = [];

  private rng: Rng;
  private nextEntityId = 1;
  private inputQueues = new Map<number, PlayerInput[]>();
  private lastInputs = new Map<number, PlayerInput>();
  private history: Map<number, HistEntry>[] = [];
  private events: SimEvent[] = [];
  private lastSeen: [Map<number, LastSeen>, Map<number, LastSeen>] = [new Map(), new Map()];
  private brains = new Map<number, BotBrain>();
  private firedThisTick = new Set<number>();
  private botTakeoverAt = new Map<number, number>(); // tick en que un bot asume el control
  readonly training: boolean;
  private dummies = new Map<number, 'estatico' | 'movil'>();
  private respawnAt = new Map<number, number>();

  constructor(seed: number, roster: RosterEntry[], map?: MapDef, opts?: SimOptions) {
    this.map = map ?? buildAuroraMap();
    this.seed = seed;
    this.training = opts?.training ?? false;
    this.rng = new Rng(seed);
    this.match = {
      phase: 'prep', phaseTicksLeft: 0, roundNumber: 0, half: 1, attackingTeam: 0,
      score: [0, 0], lossStreak: [0, 0], roundWinner: null, roundEndReason: null, matchWinner: null,
    };
    this.core = { carrier: null, pos: v3(), planted: false, plantedSite: null, lastValidPos: v3() };
    for (const r of [...roster].sort((a, b) => a.id - b.id)) this.addPlayer(r);
    this.startRound(1, 1);
  }

  // ===== Gestión de jugadores =====

  private addPlayer(r: RosterEntry): void {
    const p: PlayerState = {
      id: r.id, name: r.nombre, team: r.team, character: r.character,
      isBot: r.isBot, botDifficulty: r.dificultad ?? 'normal',
      connected: !r.isBot, controlledByBot: r.isBot,
      alive: true, hp: MAX_HP, shield: 0, credits: ECO_START,
      weapon: 'pulso', ammo: WEAPONS.pulso.cargador, reloadTicksLeft: 0,
      fireCooldown: 0, burstShots: 0, lastFireTick: -999,
      abilityCharges: 0, grenadeCharges: 0, defuseKit: false,
      pos: v3(), vel: v3(), yaw: 0, pitch: 0,
      crouching: false, walking: false, aiming: false, onGround: true, slowFactor: 1,
      hasCore: false, interaction: null, flashEndTick: 0, prevButtons: 0,
      kills: 0, deaths: 0, assists: 0, damageDealt: 0, recentDamage: [],
      lastInputSeq: 0, lastAckTick: 0, stepPhase: 0,
    };
    this.players.set(p.id, p);
    this.inputQueues.set(p.id, []);
    this.lastInputs.set(p.id, defaultInput());
    if (r.dummy) this.dummies.set(p.id, r.dummy);
    else if (r.isBot) this.brains.set(p.id, new BotBrain(p.id, new Rng(this.seed ^ (p.id * 7919 + 13))));
  }

  /** Un humano se desconecta: en ≤2 s un bot asume el control de la misma entidad. */
  markDisconnected(id: number): void {
    const p = this.players.get(id);
    if (!p || p.isBot) return;
    p.connected = false;
    this.botTakeoverAt.set(id, this.tick + Math.round(BOT_TAKEOVER_S * TICK_RATE));
  }

  markReconnected(id: number): boolean {
    const p = this.players.get(id);
    if (!p) return false;
    p.connected = true;
    p.controlledByBot = false;
    this.botTakeoverAt.delete(id);
    this.brains.delete(id);
    return true;
  }

  /** Un humano nuevo sustituye a un bot (se aplica al empezar la siguiente ronda). */
  replaceBotWithHuman(botId: number, nombre: string): boolean {
    const p = this.players.get(botId);
    if (!p || !p.isBot) return false;
    p.isBot = false;
    p.name = nombre;
    p.connected = true;
    p.controlledByBot = true; // el bot sigue jugando esta ronda; el humano entra en la próxima
    return true;
  }

  activateHumanControl(id: number): void {
    const p = this.players.get(id);
    if (!p) return;
    p.controlledByBot = false;
    this.brains.delete(id);
  }

  // ===== Rondas =====

  private isAttacker(p: PlayerState): boolean {
    return p.team === this.match.attackingTeam;
  }

  private teamPlayers(team: Team): PlayerState[] {
    return [...this.players.values()].filter((p) => p.team === team);
  }

  private aliveCount(team: Team): number {
    return this.teamPlayers(team).filter((p) => p.alive).length;
  }

  private startRound(roundNumber: number, half: 1 | 2): void {
    const m = this.match;
    const newHalf = half !== m.half || roundNumber === 1 && m.roundNumber === 0;
    m.roundNumber = roundNumber;
    m.half = half;
    m.phase = 'prep';
    m.phaseTicksLeft = (this.training ? 3 : PREP_S) * TICK_RATE;
    m.roundWinner = null;
    m.roundEndReason = null;
    this.zones = [];
    this.projectiles = [];
    this.lastSeen = [new Map(), new Map()];

    let atkIdx = 0;
    let defIdx = 0;
    for (const p of this.playersSorted()) {
      const survived = p.alive;
      p.alive = true;
      p.hp = MAX_HP;
      p.vel = v3();
      p.crouching = false;
      p.interaction = null;
      p.flashEndTick = 0;
      p.slowFactor = 1;
      p.hasCore = false;
      p.reloadTicksLeft = 0;
      p.fireCooldown = 0;
      p.burstShots = 0;
      p.recentDamage = [];
      if (newHalf) {
        p.credits = ECO_START;
        p.weapon = 'pulso';
        p.shield = 0;
        p.defuseKit = false;
        p.abilityCharges = 0;
        p.grenadeCharges = 0;
      } else if (!survived) {
        // Morir elimina mejoras y consumibles; se conserva solo el crédito
        p.weapon = 'pulso';
        p.shield = 0;
        p.defuseKit = false;
        p.abilityCharges = 0;
        p.grenadeCharges = 0;
      }
      if (this.training) p.credits = ECO_MAX;
      p.ammo = WEAPONS[p.weapon].cargador;
      const spawn = this.isAttacker(p) ? this.map.attackerSpawn : this.map.defenderSpawn;
      const idx = this.isAttacker(p) ? atkIdx++ : defIdx++;
      const pt = spawn.points[idx % spawn.points.length];
      p.pos = vclone(pt.pos);
      p.yaw = pt.yaw;
      p.pitch = 0;
      p.onGround = true;
      // Evitar que una entrada antigua pise la orientación de aparición
      this.inputQueues.get(p.id)!.length = 0;
      this.lastInputs.set(p.id, { ...defaultInput(p.lastInputSeq), yaw: pt.yaw });
      // El kit solo tiene sentido para defensores; al cambiar de rol se pierde
      if (this.isAttacker(p)) p.defuseKit = false;
    }
    if (newHalf) {
      m.lossStreak = [0, 0];
    }

    // Núcleo: atacante vivo con menor id estable
    const attackers = this.teamPlayers(m.attackingTeam).sort((a, b) => a.id - b.id);
    this.core = {
      carrier: attackers.length > 0 ? attackers[0].id : null,
      pos: v3(), planted: false, plantedSite: null,
      lastValidPos: attackers.length > 0 ? vclone(attackers[0].pos) : v3(),
    };
    if (this.core.carrier !== null) this.players.get(this.core.carrier)!.hasCore = true;

    for (const brain of this.brains.values()) brain.onRoundStart();
    this.pushEvent({ e: 'fase', fase: 'prep' });
  }

  private playersSorted(): PlayerState[] {
    return [...this.players.values()].sort((a, b) => a.id - b.id);
  }

  private endRound(winner: Team, reason: RoundEndReason): void {
    const m = this.match;
    if (m.phase === 'resolve' || m.phase === 'end') return; // resolución única e idempotente
    m.phase = 'resolve';
    m.phaseTicksLeft = RESOLVE_S * TICK_RATE;
    m.roundWinner = winner;
    m.roundEndReason = reason;
    m.score[winner]++;

    const loser = (1 - winner) as Team;
    m.lossStreak[loser] = Math.min(m.lossStreak[loser] + 1, 1 + ECO_LOSS_STREAK_MAX_BONUS / ECO_LOSS_STREAK_STEP);
    m.lossStreak[winner] = 0;
    const lossBonus = Math.min((m.lossStreak[loser] - 1) * ECO_LOSS_STREAK_STEP, ECO_LOSS_STREAK_MAX_BONUS);
    for (const p of this.players.values()) {
      const amount = p.team === winner ? ECO_WIN : ECO_LOSS_BASE + lossBonus;
      p.credits = Math.min(ECO_MAX, p.credits + amount);
      p.interaction = null;
    }

    if (!this.training) {
      if (m.score[winner] >= ROUNDS_TO_WIN) {
        m.matchWinner = winner;
      } else if (m.score[0] + m.score[1] >= ROUNDS_PER_HALF * 2) {
        m.matchWinner = m.score[0] === m.score[1] ? 'empate' : (m.score[0] > m.score[1] ? 0 : 1);
      }
    }
    this.pushEvent({ e: 'fase', fase: 'resolve', motivo: reason, ganador: winner });
  }

  // ===== Entradas =====

  private lastQueuedSeq = new Map<number, number>();

  queueInput(id: number, input: PlayerInput): void {
    const q = this.inputQueues.get(id);
    const p = this.players.get(id);
    if (!q || !p) return;
    // Descartar duplicados y reordenados (paquetes repetidos por jitter/reenvío)
    const maxSeen = Math.max(p.lastInputSeq, this.lastQueuedSeq.get(id) ?? 0);
    if (input.seq <= maxSeen && input.seq !== 0) return;
    this.lastQueuedSeq.set(id, input.seq);
    this.lastInputReceivedAt.set(id, this.tick);
    if (q.length < 8) q.push(input);
  }

  private lastInputReceivedAt = new Map<number, number>();

  // ===== Compras =====

  buy(id: number, item: BuyItem): { ok: boolean; motivo?: string } {
    const p = this.players.get(id);
    if (!p) return { ok: false, motivo: 'Jugador desconocido' };
    if (!this.training) {
      if (this.match.phase !== 'prep') return { ok: false, motivo: 'Solo se compra en preparación' };
      if (!p.alive) return { ok: false, motivo: 'Debilitado' };
      const zone = this.isAttacker(p) ? this.map.attackerSpawn.zone : this.map.defenderSpawn.zone;
      if (!inRect(zone, p.pos.x, p.pos.z)) return { ok: false, motivo: 'Fuera de la zona de aparición' };
    } else {
      p.credits = ECO_MAX; // compra libre en el campo de entrenamiento
    }

    let precio = 0;
    switch (item) {
      case 'rafaga':
      case 'preciso': {
        if (p.weapon === item) return { ok: false, motivo: 'Ya equipado' };
        precio = WEAPONS[item].precio;
        if (p.credits < precio) return { ok: false, motivo: 'Créditos insuficientes' };
        p.weapon = item;
        p.ammo = WEAPONS[item].cargador;
        p.reloadTicksLeft = 0;
        break;
      }
      case 'escudo': {
        if (p.shield >= SHIELD_MAX) return { ok: false, motivo: 'Escudo completo' };
        precio = SHIELD_COST;
        if (p.credits < precio) return { ok: false, motivo: 'Créditos insuficientes' };
        p.shield = SHIELD_MAX;
        break;
      }
      case 'habilidad': {
        if (p.abilityCharges >= 1) return { ok: false, motivo: 'Ya tienes una carga' };
        precio = ABILITY_COST;
        if (p.credits < precio) return { ok: false, motivo: 'Créditos insuficientes' };
        p.abilityCharges = 1;
        break;
      }
      case 'granada': {
        if (p.grenadeCharges >= 1) return { ok: false, motivo: 'Ya tienes una granada' };
        precio = SMOKE_GRENADE_COST;
        if (p.credits < precio) return { ok: false, motivo: 'Créditos insuficientes' };
        p.grenadeCharges = 1;
        break;
      }
      case 'kit': {
        if (this.isAttacker(p)) return { ok: false, motivo: 'Solo defensores' };
        if (p.defuseKit) return { ok: false, motivo: 'Ya tienes kit' };
        precio = DEFUSE_KIT_COST;
        if (p.credits < precio) return { ok: false, motivo: 'Créditos insuficientes' };
        p.defuseKit = true;
        break;
      }
      default:
        return { ok: false, motivo: 'Artículo desconocido' };
    }
    p.credits -= precio;
    this.pushEvent({ e: 'compra', player: id, item });
    return { ok: true };
  }

  changeCharacter(id: number, character: CharacterId): { ok: boolean; motivo?: string } {
    const p = this.players.get(id);
    if (!p) return { ok: false, motivo: 'Jugador desconocido' };
    if (this.match.phase !== 'prep' && !this.training) return { ok: false, motivo: 'Solo en preparación' };
    if (p.character === character) return { ok: true };
    p.character = character;
    p.abilityCharges = 0; // la carga específica se pierde sin reembolso
    return { ok: true };
  }

  // ===== Bucle principal =====

  step(): SimEvent[] {
    this.events = [];
    this.firedThisTick.clear();
    const m = this.match;
    this.tick++;
    if (this.tick % 30 === 0) {
      this.soundLog = this.soundLog.filter((s) => s.tick > this.tick - TICK_RATE);
    }

    // Relevo por bot tras desconexión
    for (const [id, at] of this.botTakeoverAt) {
      if (this.tick >= at) {
        const p = this.players.get(id)!;
        p.controlledByBot = true;
        if (!this.brains.has(id)) this.brains.set(id, new BotBrain(id, new Rng(this.seed ^ (id * 7919 + 13))));
        this.botTakeoverAt.delete(id);
      }
    }

    if (m.phase === 'end') return this.events;

    // 1) Reloj de fase. El deadline gana los empates exactos: se resuelve ANTES de
    //    procesar las interacciones de este tick, y la resolución congela acciones.
    m.phaseTicksLeft--;
    if (m.phaseTicksLeft <= 0) {
      if (m.phase === 'prep') {
        m.phase = 'active';
        m.phaseTicksLeft = (this.training ? 1800 : ROUND_S) * TICK_RATE;
        this.pushEvent({ e: 'fase', fase: 'active' });
      } else if (m.phase === 'active') {
        this.endRound((1 - m.attackingTeam) as Team, 'tiempo_agotado');
      } else if (m.phase === 'planted') {
        this.endRound(m.attackingTeam, 'nucleo_detonado');
      } else if (m.phase === 'resolve') {
        if (m.matchWinner !== null) {
          m.phase = 'end';
          this.pushEvent({ e: 'fase', fase: 'end', ganador: m.matchWinner === 'empate' ? null : m.matchWinner });
          return this.events;
        }
        if (m.roundNumber >= ROUNDS_PER_HALF && m.half === 1) {
          m.attackingTeam = (1 - m.attackingTeam) as Team;
          this.startRound(1, 2);
        } else {
          this.startRound(m.roundNumber + 1, m.half);
        }
        return this.events;
      }
    }

    // 2) Entradas y movimiento
    const doorsClosed = m.phase === 'prep';
    const actionsAllowed = m.phase === 'active' || m.phase === 'planted';
    for (const p of this.playersSorted()) {
      if (!p.alive) continue;
      let input: PlayerInput;
      const dummyKind = this.dummies.get(p.id);
      if (dummyKind) {
        input = defaultInput(p.lastInputSeq + 1);
        input.yaw = p.yaw;
        input.ackTick = this.tick;
        if (dummyKind === 'movil') {
          input.moveX = Math.sin(this.tick / 45 + p.id) > 0 ? 1 : -1;
        }
      } else if (p.controlledByBot) {
        const brain = this.brains.get(p.id);
        input = brain ? brain.think(this, p) : defaultInput();
        input.seq = p.lastInputSeq + 1;
        input.ackTick = this.tick;
      } else {
        const q = this.inputQueues.get(p.id)!;
        if (q.length > 0) {
          input = q.shift()!;
        } else {
          // Sin entradas nuevas: reutilizar la última solo durante ~0,25 s;
          // después, detener al jugador (evita que el lag lo haga correr solo).
          const last = this.lastInputs.get(p.id)!;
          const stale = this.tick - (this.lastInputReceivedAt.get(p.id) ?? -999) > 15;
          input = stale
            ? { ...last, moveX: 0, moveZ: 0, buttons: 0 }
            : { ...last, buttons: last.buttons & ~BTN.JUMP };
        }
      }
      this.lastInputs.set(p.id, input);
      if (input.seq > p.lastInputSeq) p.lastInputSeq = input.seq;
      p.lastAckTick = Math.max(p.lastAckTick, Math.min(input.ackTick, this.tick));

      const wasOnGround = p.onGround;
      stepMovement(this.map, p, input, doorsClosed);

      // Sonidos de pasos y salto
      const hs = horizontalSpeed(p);
      if (p.onGround && hs > SPEED_WALK + 0.2 && !p.crouching) {
        p.stepPhase += hs * TICK_DT;
        if (p.stepPhase > 2.2) {
          p.stepPhase = 0;
          this.pushEvent({ e: 'sonido', tipo: 'pasos', pos: vclone(p.pos), radio: HEAR_RUN_DIST, team: p.team, actor: p.id });
        }
      }
      if (wasOnGround && !p.onGround && p.vel.y > 1) {
        this.pushEvent({ e: 'sonido', tipo: 'salto', pos: vclone(p.pos), radio: HEAR_JUMP_DIST, team: p.team, actor: p.id });
      }

      this.processActions(p, input, actionsAllowed);
      p.prevButtons = input.buttons;
    }

    // 3) Zonas y proyectiles
    if (actionsAllowed || m.phase === 'prep' || m.phase === 'resolve') {
      this.stepZones(actionsAllowed);
      this.stepProjectiles(actionsAllowed);
    }

    // 4) Núcleo: caída, recogida, posición válida
    this.stepCore(actionsAllowed);

    // Reapariciones de entrenamiento
    if (this.training) {
      for (const p of this.players.values()) {
        if (!p.alive && !this.respawnAt.has(p.id)) this.respawnAt.set(p.id, this.tick + 150);
      }
      for (const [id, at] of this.respawnAt) {
        if (this.tick >= at) {
          const p = this.players.get(id)!;
          p.alive = true;
          p.hp = MAX_HP;
          p.ammo = WEAPONS[p.weapon].cargador;
          const spawn = this.isAttacker(p) ? this.map.attackerSpawn : this.map.defenderSpawn;
          const pt = spawn.points[p.id % spawn.points.length];
          if (this.dummies.has(id)) {
            // Los muñecos reaparecen donde cayeron
            p.hp = MAX_HP;
          } else {
            p.pos = vclone(pt.pos);
            p.yaw = pt.yaw;
          }
          this.respawnAt.delete(id);
        }
      }
    }

    // 5) Eliminaciones del tick (solo si el deadline no resolvió ya la ronda)
    if (actionsAllowed && !this.training && (m.phase === 'active' || m.phase === 'planted')) {
      const atk = this.match.attackingTeam;
      const def = (1 - atk) as Team;
      const aliveAtk = this.aliveCount(atk);
      const aliveDef = this.aliveCount(def);
      if (aliveAtk === 0 && aliveDef === 0) {
        if (this.core.planted) this.endRound(atk, 'eliminacion_defensores');
        else this.endRound(def, 'eliminacion_atacantes');
      } else if (!this.core.planted && aliveAtk === 0) {
        this.endRound(def, 'eliminacion_atacantes');
      } else if (aliveDef === 0) {
        this.endRound(atk, 'eliminacion_defensores');
      }
      // Instalado y atacantes eliminados: la ronda continúa (manda el núcleo)
    }

    // 6) Historial para compensación de latencia
    const hist = new Map<number, HistEntry>();
    for (const p of this.players.values()) {
      hist.set(p.id, { pos: vclone(p.pos), crouching: p.crouching, alive: p.alive });
    }
    this.history[this.tick % HIST_TICKS] = hist;

    // 7) Visibilidad entre equipos (marcadores de última posición), cada 3 ticks
    if (this.tick % 3 === 0) this.updateLastSeen();

    return this.events;
  }

  // ===== Acciones de jugador =====

  private edge(p: PlayerState, input: PlayerInput, btn: number): boolean {
    return (input.buttons & btn) !== 0 && (p.prevButtons & btn) === 0;
  }

  private processActions(p: PlayerState, input: PlayerInput, actionsAllowed: boolean): void {
    if (p.fireCooldown > 0) p.fireCooldown--;
    if (p.reloadTicksLeft > 0) {
      p.reloadTicksLeft--;
      if (p.reloadTicksLeft === 0) p.ammo = WEAPONS[p.weapon].cargador;
    }
    if (this.tick - p.lastFireTick > Math.round(0.3 * TICK_RATE)) p.burstShots = 0;

    // Recarga
    if (this.edge(p, input, BTN.RELOAD) && p.reloadTicksLeft === 0 && p.ammo < WEAPONS[p.weapon].cargador && p.interaction === null) {
      p.reloadTicksLeft = reloadTicks(p.weapon, TICK_RATE);
      this.pushEvent({ e: 'sonido', tipo: 'recarga', pos: vclone(p.pos), radio: 8, team: p.team, actor: p.id });
    }

    // Soltar núcleo
    if (this.edge(p, input, BTN.DROP) && p.hasCore && !this.core.planted) {
      this.dropCore(p);
    }

    if (actionsAllowed) {
      // Disparo
      const wantsFire = (input.buttons & BTN.FIRE) !== 0;
      if (wantsFire && p.fireCooldown === 0 && p.reloadTicksLeft === 0 && p.ammo > 0) {
        if (p.interaction) p.interaction = null; // atacar reinicia el progreso
        this.fireHitscan(p);
      }
      // Habilidad y granada
      if (this.edge(p, input, BTN.ABILITY) && p.abilityCharges > 0) {
        p.abilityCharges--;
        p.interaction = null;
        this.throwUtility(p, p.character === 'pikachu' ? 'destello' : p.character === 'charmander' ? 'ascua' : p.character === 'squirtle' ? 'cortina' : 'esporas');
      }
      if (this.edge(p, input, BTN.GRENADE) && p.grenadeCharges > 0) {
        p.grenadeCharges--;
        p.interaction = null;
        this.throwUtility(p, 'niebla');
      }
      // Interacciones E (instalar / desactivar)
      this.processInteraction(p, input);
    } else {
      p.interaction = null;
    }
  }

  private eyePos(p: PlayerState): Vec3 {
    return v3(p.pos.x, p.pos.y + (p.crouching ? CAMERA_HEIGHT_CROUCH : CAMERA_HEIGHT), p.pos.z);
  }

  private headCenter(pos: Vec3, crouching: boolean): Vec3 {
    return v3(pos.x, pos.y + (crouching ? HEAD_OFFSET_CROUCH : HEAD_OFFSET), pos.z);
  }

  private fireHitscan(shooter: PlayerState): void {
    const w = WEAPONS[shooter.weapon];
    const spread = currentSpreadDeg(shooter);
    shooter.ammo--;
    shooter.fireCooldown = fireCooldownTicks(shooter.weapon, TICK_RATE);
    shooter.burstShots++;
    shooter.lastFireTick = this.tick;
    this.firedThisTick.add(shooter.id);

    const eye = this.eyePos(shooter);
    const dir = applySpread(this.rng, lookDir(shooter.yaw, shooter.pitch), spread);
    const wallHit = raycastMap(this.map, eye, dir, w.alcance, this.match.phase === 'prep');
    const wallDist = wallHit ? wallHit.dist : w.alcance;

    // Compensación de latencia: retroceder a lo que veía el cliente (máx. 150 ms)
    const minTick = this.tick - (HIST_TICKS - 3);
    const rewindTick = shooter.isBot || shooter.controlledByBot
      ? this.tick
      : clamp(shooter.lastAckTick, Math.max(1, minTick), this.tick);
    const hist = this.history[rewindTick % HIST_TICKS];

    let best: { p: PlayerState; t: number; head: boolean } | null = null;
    for (const target of this.players.values()) {
      if (target.team === shooter.team || !target.alive) continue;
      let tPos = target.pos;
      let tCrouch = target.crouching;
      if (hist && rewindTick !== this.tick) {
        const h = hist.get(target.id);
        if (h) {
          if (!h.alive) continue;
          tPos = h.pos;
          tCrouch = h.crouching;
        }
      }
      const h = playerHeight(tCrouch);
      const tBody = rayVerticalCylinder(eye, dir, tPos.x, tPos.z, tPos.y, tPos.y + h, PLAYER_RADIUS);
      const tHead = raySphere(eye, dir, this.headCenter(tPos, tCrouch), HEAD_SPHERE_RADIUS);
      let t: number | null = null;
      let head = false;
      if (tHead !== null && (tBody === null || tHead <= tBody)) { t = tHead; head = true; }
      else if (tBody !== null) t = tBody;
      if (t === null || t > w.alcance || t >= wallDist) continue;
      if (!best || t < best.t) best = { p: target, t, head };
    }

    const hitPoint = best
      ? v3(eye.x + dir.x * best.t, eye.y + dir.y * best.t, eye.z + dir.z * best.t)
      : v3(eye.x + dir.x * wallDist, eye.y + dir.y * wallDist, eye.z + dir.z * wallDist);
    this.pushEvent({ e: 'trazo', from: eye, to: hitPoint, weapon: shooter.weapon, char: shooter.character, shooter: shooter.id });
    this.pushEvent({ e: 'sonido', tipo: 'disparo', pos: vclone(shooter.pos), radio: HEAR_FIRE_DIST, team: shooter.team, actor: shooter.id });

    if (best) {
      const dano = Math.round(w.dano * (best.head ? HEAD_MULT : 1));
      this.applyDamage(best.p, dano, shooter.id, best.head);
    }
  }

  applyDamage(victim: PlayerState, raw: number, attackerId: number, headshot: boolean): void {
    if (!victim.alive) return;
    if (this.match.phase !== 'active' && this.match.phase !== 'planted') return;
    const absorbed = Math.min(victim.shield, raw * SHIELD_ABSORB);
    victim.shield = Math.max(0, victim.shield - absorbed);
    const hpDamage = raw - absorbed;
    const applied = Math.min(victim.hp, hpDamage) + absorbed;
    victim.hp -= hpDamage;
    victim.recentDamage.push({ attacker: attackerId, amount: applied, tick: this.tick });
    const attacker = this.players.get(attackerId);
    if (attacker) attacker.damageDealt += applied;
    this.pushEvent({ e: 'impacto', target: victim.id, shooter: attackerId, headshot, dano: Math.round(hpDamage + absorbed) });
    if (victim.hp <= 0) this.kill(victim, attackerId, headshot);
  }

  private kill(victim: PlayerState, killerId: number, headshot: boolean): void {
    victim.alive = false;
    victim.hp = 0;
    victim.deaths++;
    victim.interaction = null;
    if (victim.hasCore) this.dropCore(victim);
    const killer = this.players.get(killerId);
    if (killer && killer.team !== victim.team) {
      killer.kills++;
      killer.credits = Math.min(ECO_MAX, killer.credits + ECO_KILL);
    }
    // Asistencia: ≥30 de daño en los últimos 5 s, sin ser el autor de la baja
    const windowStart = this.tick - ASSIST_WINDOW_S * TICK_RATE;
    const totals = new Map<number, number>();
    for (const d of victim.recentDamage) {
      if (d.tick >= windowStart && d.attacker !== killerId) {
        totals.set(d.attacker, (totals.get(d.attacker) ?? 0) + d.amount);
      }
    }
    let assist: number | null = null;
    let bestAmount = 0;
    for (const [id, amount] of totals) {
      const a = this.players.get(id);
      if (!a || a.team === victim.team) continue;
      if (amount >= ASSIST_MIN_DAMAGE && amount > bestAmount) { assist = id; bestAmount = amount; }
    }
    if (assist !== null) this.players.get(assist)!.assists++;
    this.pushEvent({ e: 'baja', killer: killerId, victim: victim.id, assist, headshot });
  }

  // ===== Interacciones (instalar / desactivar) =====

  private processInteraction(p: PlayerState, input: PlayerInput): void {
    const useHeld = (input.buttons & BTN.USE) !== 0;
    const immobile = horizontalSpeed(p) < 0.15 && p.onGround;
    const fired = this.firedThisTick.has(p.id);

    let valid: Interaction['kind'] | null = null;
    let site: 'A' | 'B' | null = null;

    const mayPlant = this.training || this.isAttacker(p);
    const mayDefuse = this.training || !this.isAttacker(p);
    if (mayPlant && !this.core.planted && p.hasCore && this.match.phase === 'active') {
      for (const s of this.map.sites) {
        if (vdistXZ(p.pos, s.center) <= s.radius) { valid = 'instalar'; site = s.id; break; }
      }
    } else if (mayDefuse && this.core.planted && this.match.phase === 'planted') {
      const corePos = this.core.pos;
      if (vdist(this.eyePos(p), corePos) <= DEFUSE_MAX_DIST + 1.0 && vdistXZ(p.pos, corePos) <= DEFUSE_MAX_DIST) {
        if (lineOfSight(this.map, this.eyePos(p), v3(corePos.x, corePos.y + 0.3, corePos.z), false)) {
          valid = 'desactivar';
          site = this.core.plantedSite;
        }
      }
    }

    if (p.interaction) {
      const stillValid = valid === p.interaction.kind && useHeld && immobile && !fired;
      if (!stillValid) {
        p.interaction = null;
      } else {
        p.interaction.ticksLeft--;
        if (p.interaction.ticksLeft % 30 === 0) {
          this.pushEvent({
            e: 'sonido', tipo: p.interaction.kind === 'instalar' ? 'instalacion' : 'desactivacion',
            pos: vclone(p.pos), radio: 18, team: p.team, actor: p.id,
          });
        }
        if (p.interaction.ticksLeft <= 0) {
          if (p.interaction.kind === 'instalar') this.completePlant(p, p.interaction.site);
          else this.completeDefuse(p);
          p.interaction = null;
        }
        return;
      }
    }

    // Nota: solo un desactivador a la vez
    if (valid && useHeld && immobile && !fired && site) {
      if (valid === 'desactivar') {
        for (const other of this.players.values()) {
          if (other.id !== p.id && other.alive && other.interaction?.kind === 'desactivar') return;
        }
      }
      const total = valid === 'instalar'
        ? PLANT_S * TICK_RATE
        : (p.defuseKit ? DEFUSE_KIT_S : DEFUSE_S) * TICK_RATE;
      p.interaction = { kind: valid, ticksLeft: total, totalTicks: total, site };
      p.reloadTicksLeft = 0; // iniciar interacción interrumpe la recarga
    }
  }

  private completePlant(p: PlayerState, site: 'A' | 'B'): void {
    this.core.planted = true;
    this.core.plantedSite = site;
    this.core.carrier = null;
    this.core.pos = v3(p.pos.x, groundHeight(this.map, p.pos.x, p.pos.z, p.pos.y + 1), p.pos.z);
    p.hasCore = false;
    p.credits = Math.min(ECO_MAX, p.credits + ECO_PLANT);
    this.match.phase = 'planted';
    this.match.phaseTicksLeft = CORE_COUNTDOWN_S * TICK_RATE;
    this.pushEvent({ e: 'instalado', site, por: p.id });
    this.pushEvent({ e: 'sonido', tipo: 'nucleo', pos: vclone(this.core.pos), radio: 40, team: p.team, actor: p.id });
  }

  private completeDefuse(p: PlayerState): void {
    p.credits = Math.min(ECO_MAX, p.credits + ECO_DEFUSE);
    this.pushEvent({ e: 'desactivado', por: p.id });
    this.endRound((1 - this.match.attackingTeam) as Team, 'nucleo_desactivado');
  }

  // ===== Núcleo =====

  private dropCore(p: PlayerState): void {
    p.hasCore = false;
    this.core.carrier = null;
    const g = groundHeight(this.map, p.pos.x, p.pos.z, p.pos.y + 1);
    let pos = v3(p.pos.x, g === -Infinity ? p.pos.y : g, p.pos.z);
    const b = this.map.bounds;
    if (pos.x < b.x0 || pos.x > b.x1 || pos.z < b.z0 || pos.z > b.z1 || g === -Infinity) {
      pos = vclone(this.core.lastValidPos);
    }
    this.core.pos = pos;
    this.pushEvent({ e: 'nucleoSuelto', pos: vclone(pos) });
  }

  private stepCore(actionsAllowed: boolean): void {
    const core = this.core;
    if (core.planted) return;
    if (core.carrier !== null) {
      const carrier = this.players.get(core.carrier)!;
      if (carrier.onGround) {
        const b = this.map.bounds;
        if (carrier.pos.x >= b.x0 && carrier.pos.x <= b.x1 && carrier.pos.z >= b.z0 && carrier.pos.z <= b.z1) {
          core.lastValidPos = vclone(carrier.pos);
        }
      }
      return;
    }
    if (!actionsAllowed) return;
    // Recogida automática por atacantes a <1 m (si no están interactuando)
    for (const p of this.playersSorted()) {
      if (!p.alive || (!this.isAttacker(p) && !this.training) || p.interaction) continue;
      if (this.dummies.has(p.id)) continue;
      if (vdistXZ(p.pos, core.pos) <= CORE_PICKUP_DIST && Math.abs(p.pos.y - core.pos.y) <= 1.2) {
        core.carrier = p.id;
        p.hasCore = true;
        this.pushEvent({ e: 'nucleoRecogido', por: p.id });
        return;
      }
    }
  }

  // ===== Utilidades =====

  private throwUtility(p: PlayerState, type: ProjectileState['type']): void {
    const eye = this.eyePos(p);
    const dir = lookDir(p.yaw, p.pitch);
    const proj: ProjectileState = {
      id: this.nextEntityId++,
      type, owner: p.id, team: p.team,
      pos: v3(eye.x + dir.x * 0.4, eye.y + dir.y * 0.4, eye.z + dir.z * 0.4),
      vel: vscale(dir, 12),
      bornTick: this.tick,
      resting: false,
    };
    this.projectiles.push(proj);
    this.pushEvent({ e: 'sonido', tipo: 'despliegue', pos: vclone(p.pos), radio: 10, team: p.team, actor: p.id });
  }

  private stepProjectiles(actionsAllowed: boolean): void {
    const remaining: ProjectileState[] = [];
    for (const proj of this.projectiles) {
      let done = false;
      if (!proj.resting) {
        proj.vel.y -= GRAVITY * TICK_DT;
        const delta = vscale(proj.vel, TICK_DT);
        const dist = vlen(delta);
        if (dist > 1e-6) {
          const dir = vscale(delta, 1 / dist);
          const hit = raycastMap(this.map, proj.pos, dir, dist, this.match.phase === 'prep');
          if (hit) {
            const impact = v3(proj.pos.x + dir.x * hit.dist, proj.pos.y + dir.y * hit.dist, proj.pos.z + dir.z * hit.dist);
            if (proj.type === 'destello') {
              proj.pos = impact;
              proj.resting = true;
              proj.vel = v3();
            } else {
              // Primera superficie válida: la zona se asienta en el suelo bajo el impacto
              const retreat = v3(impact.x - dir.x * 0.05, impact.y - dir.y * 0.05, impact.z - dir.z * 0.05);
              const g = groundHeight(this.map, retreat.x, retreat.z, retreat.y + 0.1);
              const zonePos = v3(retreat.x, g === -Infinity ? 0 : g, retreat.z);
              this.spawnZone(proj, zonePos);
              done = true;
            }
          } else {
            proj.pos = v3(proj.pos.x + delta.x, proj.pos.y + delta.y, proj.pos.z + delta.z);
          }
        }
      }
      if (!done && proj.type === 'destello' && this.tick - proj.bornTick >= Math.round(FLASH_FUSE_S * TICK_RATE)) {
        if (actionsAllowed) this.detonateFlash(proj);
        done = true;
      }
      if (!done && this.tick - proj.bornTick > 10 * TICK_RATE) done = true; // red de seguridad
      if (!done) remaining.push(proj);
    }
    this.projectiles = remaining;
  }

  private spawnZone(proj: ProjectileState, pos: Vec3): void {
    const def = {
      ascua: { radius: EMBER_RADIUS, dur: EMBER_DURATION_S },
      esporas: { radius: SPORE_RADIUS, dur: SPORE_DURATION_S },
      cortina: { radius: CORTINA_RADIUS, dur: CORTINA_DURATION_S },
      niebla: { radius: SMOKE_G_RADIUS, dur: SMOKE_G_DURATION_S },
    }[proj.type as Exclude<ProjectileState['type'], 'destello'>];
    this.zones.push({
      id: this.nextEntityId++,
      type: proj.type as ZoneState['type'],
      pos, radius: def.radius,
      endTick: this.tick + Math.round(def.dur * TICK_RATE),
      team: proj.team, owner: proj.owner,
    });
    this.pushEvent({ e: 'sonido', tipo: 'despliegue', pos: vclone(pos), radio: 14, team: proj.team, actor: proj.owner });
  }

  private detonateFlash(proj: ProjectileState): void {
    this.pushEvent({ e: 'sonido', tipo: 'explosion', pos: vclone(proj.pos), radio: 20, team: proj.team, actor: proj.owner });
    for (const p of this.players.values()) {
      if (!p.alive || p.team === proj.team) continue; // no afecta aliados
      const eye = this.eyePos(p);
      if (vdist(eye, proj.pos) > FLASH_RADIUS) continue;
      if (!lineOfSight(this.map, proj.pos, eye, false)) continue;
      if (this.segmentThroughSmoke(proj.pos, eye)) continue;
      const toFlash = vnorm(vsub(proj.pos, eye));
      const look = lookDir(p.yaw, p.pitch);
      const cosA = vdot(toFlash, look); // 1 = mirándolo, -1 = de espaldas
      const t = (1 - cosA) / 2;         // 0 mirando, 1 opuesto
      const durS = FLASH_MAX_S + (FLASH_MIN_S - FLASH_MAX_S) * t;
      const durTicks = Math.round(durS * TICK_RATE);
      p.flashEndTick = Math.max(p.flashEndTick, this.tick + durTicks);
      this.pushEvent({ e: 'destello', victim: p.id, durTicks });
    }
  }

  private stepZones(actionsAllowed: boolean): void {
    this.zones = this.zones.filter((z) => z.endTick > this.tick);
    // Ralentización: recalculada cada tick
    for (const p of this.players.values()) p.slowFactor = 1;
    if (!actionsAllowed) return;
    const emberVictims = new Set<number>();
    for (const z of this.zones) {
      if (z.type !== 'ascua' && z.type !== 'esporas') continue;
      for (const p of this.players.values()) {
        if (!p.alive || p.team === z.team) continue;
        if (vdistXZ(p.pos, z.pos) > z.radius) continue;
        if (Math.abs(p.pos.y - z.pos.y) > 2) continue;
        // Línea de efecto: desde el centro de la zona al torso
        const zc = v3(z.pos.x, z.pos.y + 0.4, z.pos.z);
        const torso = v3(p.pos.x, p.pos.y + 0.7, p.pos.z);
        if (!lineOfSight(this.map, zc, torso, false)) continue;
        if (z.type === 'ascua') emberVictims.add(p.id);
        else p.slowFactor = SPORE_SLOW_MULT;
      }
    }
    for (const id of emberVictims) {
      const p = this.players.get(id)!;
      // Daño por tiempo de simulación, sin acumulación entre zonas
      const zone = this.zones.find((z) => z.type === 'ascua' && vdistXZ(p.pos, z.pos) <= z.radius && p.team !== z.team);
      this.applyDamage(p, EMBER_DPS * TICK_DT, zone ? zone.owner : -1, false);
    }
  }

  // ===== Visibilidad =====

  segmentThroughSmoke(a: Vec3, b: Vec3): boolean {
    for (const z of this.zones) {
      if (z.type !== 'cortina' && z.type !== 'niebla') continue;
      const c = v3(z.pos.x, z.pos.y + z.radius * 0.6, z.pos.z);
      // Distancia segmento-centro
      const ab = vsub(b, a);
      const t = clamp(vdot(vsub(c, a), ab) / Math.max(1e-9, vdot(ab, ab)), 0, 1);
      const closest = v3(a.x + ab.x * t, a.y + ab.y * t, a.z + ab.z * t);
      if (vdist(closest, c) < z.radius) return true;
    }
    return false;
  }

  /** ¿Puede `viewer` ver a `target`? (oclusión estática + niebla; sin FOV). */
  canSee(viewer: PlayerState, target: PlayerState): boolean {
    const eye = this.eyePos(viewer);
    const tgt = v3(target.pos.x, target.pos.y + 0.9, target.pos.z);
    if (this.segmentThroughSmoke(eye, tgt)) return false;
    if (lineOfSight(this.map, eye, tgt, this.match.phase === 'prep')) return true;
    const head = this.headCenter(target.pos, target.crouching);
    if (this.segmentThroughSmoke(eye, head)) return false;
    return lineOfSight(this.map, eye, head, this.match.phase === 'prep');
  }

  private updateLastSeen(): void {
    for (const team of [0, 1] as Team[]) {
      const seen = this.lastSeen[team];
      for (const enemy of this.players.values()) {
        if (enemy.team === team || !enemy.alive) continue;
        for (const viewer of this.players.values()) {
          if (viewer.team !== team || !viewer.alive) continue;
          if (vdist(viewer.pos, enemy.pos) > 60) continue;
          if (this.canSee(viewer, enemy)) {
            seen.set(enemy.id, { pos: vclone(enemy.pos), yaw: enemy.yaw, tick: this.tick });
            break;
          }
        }
      }
      for (const [id, ls] of seen) {
        if (this.tick - ls.tick > ENEMY_MARKER_S * TICK_RATE) seen.delete(id);
      }
    }
  }

  isEnemyVisibleToTeam(team: Team, enemyId: number): boolean {
    const ls = this.lastSeen[team].get(enemyId);
    return ls !== undefined && this.tick - ls.tick <= 3;
  }

  getLastSeen(team: Team): Map<number, LastSeen> {
    return this.lastSeen[team];
  }

  // ===== Snapshots =====

  buildSnapshot(viewerId: number, events: SimEvent[]): Snapshot {
    const viewer = this.players.get(viewerId)!;
    const team = viewer.team;
    const players: SnapPlayer[] = [];
    for (const p of this.playersSorted()) {
      const ally = p.team === team;
      const visible = ally || this.isEnemyVisibleToTeam(team, p.id) || this.match.phase === 'resolve' || this.match.phase === 'end';
      if (!visible && p.alive) continue;
      const base: SnapPlayer = {
        id: p.id, nombre: p.name, team: p.team, character: p.character,
        alive: p.alive, pos: vclone(p.pos), vel: vclone(p.vel),
        yaw: p.yaw, pitch: p.pitch,
        crouching: p.crouching, walking: p.walking, aiming: p.aiming,
        hasCore: p.hasCore, esBot: p.isBot,
      };
      // El marcador y los resultados necesitan bajas/muertes de todos
      base.kills = p.kills; base.deaths = p.deaths; base.assists = p.assists; base.damageDealt = Math.round(p.damageDealt);
      // El ataque equipado es visible para todos (como ver el arma del rival)
      base.weapon = p.weapon;
      if (ally) {
        base.hp = Math.ceil(p.hp);
        base.shield = Math.ceil(p.shield);
        base.credits = p.credits;
        base.ammo = p.ammo;
        base.reloadTicksLeft = p.reloadTicksLeft;
        base.abilityCharges = p.abilityCharges;
        base.grenadeCharges = p.grenadeCharges;
        base.defuseKit = p.defuseKit;
        base.interactTicksLeft = p.interaction?.ticksLeft;
        base.interactTotal = p.interaction?.totalTicks;
        base.flashTicksLeft = Math.max(0, p.flashEndTick - this.tick);
      }
      players.push(base);
    }

    const markers: EnemyMarker[] = [];
    for (const [id, ls] of this.lastSeen[team]) {
      if (this.tick - ls.tick <= 3) continue; // visible ahora mismo: va en players
      markers.push({ id, pos: vclone(ls.pos), yaw: ls.yaw, ageTicks: this.tick - ls.tick });
    }

    const filteredEvents = events.filter((ev) => {
      switch (ev.e) {
        case 'sonido': {
          // Enviar solo sonidos audibles por algún miembro del equipo
          for (const p of this.players.values()) {
            if (p.team !== team) continue;
            if (vdist(p.pos, ev.pos) <= ev.radio * 1.6) return true;
          }
          return false;
        }
        case 'impacto':
          return ev.shooter === viewerId || ev.target === viewerId;
        case 'destello':
          return ev.victim === viewerId;
        case 'compra':
          return this.players.get(ev.player)?.team === team;
        default:
          return true;
      }
    });

    // Núcleo: los defensores no ven la posición del portador oculto; sí el núcleo suelto/instalado
    const core: CoreState = {
      carrier: this.core.carrier,
      pos: vclone(this.core.planted || this.core.carrier === null ? this.core.pos : v3(0, -99, 0)),
      planted: this.core.planted,
      plantedSite: this.core.plantedSite,
      lastValidPos: v3(),
    };
    if (team !== this.match.attackingTeam && this.core.carrier !== null && !this.isEnemyVisibleToTeam(team, this.core.carrier)) {
      core.carrier = -1; // existe, pero sin identidad/posición
    }

    return {
      t: 'snap',
      tick: this.tick,
      ackSeq: viewer.lastInputSeq,
      vivos: [this.aliveCount(0), this.aliveCount(1)],
      match: { ...this.match, score: [...this.match.score] as [number, number], lossStreak: [...this.match.lossStreak] as [number, number] },
      players,
      markers,
      core,
      zones: this.zones.map((z) => ({ ...z, pos: vclone(z.pos) })),
      projectiles: this.projectiles.map((pr) => ({ ...pr, pos: vclone(pr.pos), vel: vclone(pr.vel) })),
      events: filteredEvents,
    };
  }

  private pushEvent(e: SimEvent): void {
    this.events.push(e);
    if (e.e === 'sonido' && e.tipo !== 'recarga') {
      this.soundLog.push({ pos: e.pos, radio: e.radio, team: e.team, tick: this.tick, actor: e.actor });
      if (this.soundLog.length > 64) this.soundLog.shift();
    }
  }

  /** Para pruebas: fuerza el estado de un jugador. */
  _debugGet(id: number): PlayerState {
    return this.players.get(id)!;
  }
}
