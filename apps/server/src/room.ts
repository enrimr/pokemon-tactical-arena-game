import { WebSocket } from 'ws';
import { randomBytes, randomInt } from 'node:crypto';
import {
  C2S, S2C, CharacterId, CHARACTERS, GameSim, LobbyState, MatchHost, RosterEntry,
  Team, TEAM_SIZE, encode, isValidAlias, ROOM_CODE_ALPHABET, RECONNECT_GRACE_S,
} from '@pta/shared';

const TICK_MS = 1000 / 60;
const MAX_HUMANS = 10;

interface Member {
  id: number;
  nombre: string;
  team: Team;
  character: CharacterId;
  listo: boolean;
  esAnfitrion: boolean;
  token: string;
  ws: WebSocket | null;
  joinedAt: number;
  disconnectedAt: number | null;
  pendingActivation: boolean; // entró en partida: espera a la siguiente ronda
  // Limitación de frecuencia
  msgWindowStart: number;
  msgCount: number;
  inputWindowStart: number;
  inputCount: number;
}

export class Room {
  readonly code: string;
  private members = new Map<number, Member>();
  private nextId = 1;
  private host: MatchHost | null = null;
  private interval: NodeJS.Timeout | null = null;
  private lastTick = 0;
  private emptySince: number | null = Date.now();
  private onDestroy: (code: string) => void;
  enPartida = false;

  constructor(code: string, onDestroy: (code: string) => void) {
    this.code = code;
    this.onDestroy = onDestroy;
  }

  static generateCode(existing: (code: string) => boolean): string {
    for (let i = 0; i < 100; i++) {
      let code = '';
      for (let j = 0; j < 6; j++) code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
      if (!existing(code)) return code;
    }
    throw new Error('No hay códigos libres');
  }

  humanCount(): number {
    return [...this.members.values()].filter((m) => m.disconnectedAt === null || m.ws !== null).length;
  }

  // ===== Entrada de jugadores =====

  join(ws: WebSocket, nombre: string, token?: string): { ok: boolean; error?: 'salaLlena' | 'nombreInvalido' } {
    // Reconexión por token (ventana de 60 s)
    if (token) {
      for (const m of this.members.values()) {
        if (m.token === token) {
          m.ws = ws;
          m.disconnectedAt = null;
          this.bindSocket(m);
          this.send(m, { t: 'bienvenida', id: m.id, token: m.token, codigo: this.code });
          if (this.host && this.enPartida) {
            this.host.sim.markReconnected(m.id);
            this.send(m, { t: 'inicio', seed: this.host.sim.seed, tuId: m.id, tick: this.host.sim.tick });
            this.host.attach(m.id, (msg) => this.send(m, msg));
          } else {
            this.broadcastLobby();
          }
          this.emptySince = null;
          return { ok: true };
        }
      }
    }
    if (!isValidAlias(nombre)) return { ok: false, error: 'nombreInvalido' };
    if (this.members.size >= MAX_HUMANS) return { ok: false, error: 'salaLlena' };

    const id = this.allocateId();
    if (id === null) return { ok: false, error: 'salaLlena' };
    // Mantener equipos humanos equilibrados (diferencia máxima de 1)
    const counts: [number, number] = [0, 0];
    for (const m of this.members.values()) counts[m.team]++;
    const team: Team = counts[0] <= counts[1] ? 0 : 1;
    const member: Member = {
      id, nombre, team,
      character: CHARACTERS[this.members.size % CHARACTERS.length],
      listo: false,
      esAnfitrion: this.members.size === 0,
      token: randomBytes(16).toString('hex'),
      ws, joinedAt: Date.now(), disconnectedAt: null,
      pendingActivation: false,
      msgWindowStart: 0, msgCount: 0, inputWindowStart: 0, inputCount: 0,
    };
    if (this.enPartida && this.host) {
      // Entrada tardía: sustituye a un bot y espera a la siguiente ronda
      const bot = this.pickReplaceableBot(member.team) ?? this.pickReplaceableBot((1 - member.team) as Team);
      if (bot === null) return { ok: false, error: 'salaLlena' };
      member.id = bot;
      member.team = this.host.sim.players.get(bot)!.team;
      member.pendingActivation = true;
      this.members.set(bot, member);
      this.emptySince = null;
      this.bindSocket(member);
      this.host.sim.replaceBotWithHuman(bot, nombre);
      this.send(member, { t: 'bienvenida', id: bot, token: member.token, codigo: this.code });
      this.send(member, { t: 'inicio', seed: this.host.sim.seed, tuId: bot, tick: this.host.sim.tick });
      this.host.attach(bot, (msg) => this.send(member, msg));
    } else {
      this.members.set(id, member);
      this.emptySince = null;
      this.bindSocket(member);
      this.send(member, { t: 'bienvenida', id, token: member.token, codigo: this.code });
      this.broadcastLobby();
    }
    return { ok: true };
  }

  private allocateId(): number | null {
    if (!this.enPartida) return this.nextId++;
    return this.nextId++;
  }

  private pickReplaceableBot(team: Team): number | null {
    if (!this.host) return null;
    for (const p of [...this.host.sim.players.values()].sort((a, b) => a.id - b.id)) {
      if (p.team === team && p.isBot && !this.members.has(p.id)) return p.id;
    }
    return null;
  }

  private bindSocket(m: Member): void {
    const ws = m.ws!;
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      this.onMessage(m, data.toString());
    });
    ws.on('close', () => this.onLeave(m, false));
    ws.on('error', () => this.onLeave(m, false));
  }

  private send(m: Member, msg: S2C): void {
    if (m.ws && m.ws.readyState === WebSocket.OPEN) {
      m.ws.send(encode(msg));
    }
  }

  private broadcast(msg: S2C): void {
    for (const m of this.members.values()) this.send(m, msg);
  }

  // ===== Mensajes =====

  private onMessage(m: Member, text: string): void {
    if (text.length > 8192) return;
    const now = Date.now();
    let msg: C2S;
    try {
      msg = JSON.parse(text) as C2S;
    } catch {
      this.send(m, { t: 'error', codigo: 'formato', msg: 'JSON inválido' });
      return;
    }
    if (typeof msg !== 'object' || msg === null || typeof msg.t !== 'string') return;

    if (msg.t === 'input') {
      // ≤40 paquetes de entrada por segundo
      if (now - m.inputWindowStart > 1000) { m.inputWindowStart = now; m.inputCount = 0; }
      if (++m.inputCount > 45) return;
      this.host?.handleMessage(m.id, msg);
      return;
    }
    // Resto de mensajes: ≤10 por segundo
    if (now - m.msgWindowStart > 1000) { m.msgWindowStart = now; m.msgCount = 0; }
    if (++m.msgCount > 10) return;

    switch (msg.t) {
      case 'ping':
        this.send(m, { t: 'pong', time: typeof msg.time === 'number' ? msg.time : 0, serverTick: this.host?.sim.tick ?? 0 });
        break;
      case 'lobbyEquipo': {
        if (this.enPartida || (msg.team !== 0 && msg.team !== 1)) break;
        const counts: [number, number] = [0, 0];
        for (const o of this.members.values()) if (o.id !== m.id) counts[o.team]++;
        // Desequilibrio humano máximo de 1 al cambiarse uno mismo
        if (counts[msg.team] + 1 - counts[(1 - msg.team) as Team] > 1) break;
        if (counts[msg.team] >= TEAM_SIZE) break;
        m.team = msg.team;
        this.broadcastLobby();
        break;
      }
      case 'lobbyPersonaje':
        if (!this.enPartida && CHARACTERS.includes(msg.character)) {
          m.character = msg.character;
          this.broadcastLobby();
        }
        break;
      case 'lobbyListo':
        if (!this.enPartida) {
          m.listo = msg.listo === true;
          this.broadcastLobby();
        }
        break;
      case 'lobbyMover': {
        if (this.enPartida || !m.esAnfitrion) break;
        const target = this.members.get(msg.playerId);
        if (target && (msg.team === 0 || msg.team === 1)) {
          target.team = msg.team;
          this.broadcastLobby();
        }
        break;
      }
      case 'lobbyIniciar':
        if (!this.enPartida && m.esAnfitrion) this.startMatch();
        break;
      case 'comprar':
      case 'personaje':
        if (!m.pendingActivation) this.host?.handleMessage(m.id, msg);
        break;
      case 'salir':
        this.onLeave(m, true);
        m.ws?.close();
        break;
      default:
        break;
    }
  }

  // ===== Partida =====

  private startMatch(): void {
    if (this.enPartida) return;
    this.enPartida = true;
    // Reasignar ids estables: humanos primero por antigüedad, bots de relleno después
    const humans = [...this.members.values()].sort((a, b) => a.joinedAt - b.joinedAt);
    const roster: RosterEntry[] = [];
    const used: [number, number] = [0, 0];
    const remap = new Map<number, Member>();
    let nextId = 1;
    for (const h of humans) {
      const team = used[h.team] < TEAM_SIZE ? h.team : ((1 - h.team) as Team);
      const id = nextId++;
      roster.push({ id, nombre: h.nombre, team, character: h.character, isBot: false });
      h.id = id;
      h.team = team;
      used[team]++;
      remap.set(id, h);
    }
    const dif: ('facil' | 'normal' | 'dificil')[] = ['normal', 'normal', 'dificil', 'facil'];
    let botN = 1;
    for (const team of [0, 1] as Team[]) {
      while (used[team] < TEAM_SIZE) {
        const id = nextId++;
        roster.push({
          id,
          nombre: `Bot ${botN}`,
          team,
          character: CHARACTERS[(id - 1) % CHARACTERS.length],
          isBot: true,
          dificultad: dif[botN % dif.length],
        });
        botN++;
        used[team]++;
      }
    }
    this.members = new Map([...remap.entries()]);

    const seed = randomInt(2 ** 31);
    const sim = new GameSim(seed, roster);
    this.host = new MatchHost(sim);
    this.host.onRoundStart = () => {
      for (const m of this.members.values()) {
        if (m.pendingActivation) {
          m.pendingActivation = false;
          sim.activateHumanControl(m.id);
        }
      }
    };
    for (const m of this.members.values()) {
      this.send(m, { t: 'inicio', seed, tuId: m.id, tick: 0 });
      this.host.attach(m.id, (msg) => this.send(m, msg));
    }
    this.lastTick = Date.now();
    this.interval = setInterval(() => this.loop(), TICK_MS / 2);
  }

  private loop(): void {
    if (!this.host) return;
    const now = Date.now();
    let steps = 0;
    while (now - this.lastTick >= TICK_MS && steps < 6) {
      this.lastTick += TICK_MS;
      this.host.tick();
      steps++;
    }
    if (now - this.lastTick > 500) this.lastTick = now; // tras una pausa larga, no acumular

    // Expirar ventanas de reconexión y vigilar sala vacía
    for (const m of this.members.values()) {
      if (m.ws === null && m.disconnectedAt !== null && now - m.disconnectedAt > RECONNECT_GRACE_S * 1000) {
        // La plaza queda definitivamente en manos del bot
        this.members.delete(m.id);
        this.host.detach(m.id);
        const p = this.host.sim.players.get(m.id);
        if (p) p.isBot = true;
        this.ensureHost();
      }
    }
    if (this.humanCountConnected() === 0) {
      if (this.emptySince === null) this.emptySince = now;
      if (now - this.emptySince > 60_000) this.destroy();
    } else {
      this.emptySince = null;
    }
  }

  humanCountConnected(): number {
    return [...this.members.values()].filter((m) => m.ws !== null && m.ws.readyState === WebSocket.OPEN).length;
  }

  private onLeave(m: Member, definitivo: boolean): void {
    if (m.ws) {
      m.ws.removeAllListeners();
      m.ws = null;
    }
    m.disconnectedAt = Date.now();
    if (this.enPartida && this.host) {
      this.host.detach(m.id);
      this.host.sim.markDisconnected(m.id); // un bot toma el control en ≤2 s
      if (definitivo) {
        this.members.delete(m.id);
        const p = this.host.sim.players.get(m.id);
        if (p) p.isBot = true;
      }
    } else if (!this.enPartida) {
      this.members.delete(m.id);
      this.ensureHost();
      this.broadcastLobby();
      return;
    }
    this.ensureHost();
  }

  private ensureHost(): void {
    const connected = [...this.members.values()]
      .filter((m) => m.ws !== null)
      .sort((a, b) => a.joinedAt - b.joinedAt);
    if (connected.length > 0 && !connected.some((m) => m.esAnfitrion)) {
      for (const m of this.members.values()) m.esAnfitrion = false;
      connected[0].esAnfitrion = true;
      if (!this.enPartida) this.broadcastLobby();
    }
  }

  private broadcastLobby(): void {
    const estado: LobbyState = {
      codigo: this.code,
      enPartida: this.enPartida,
      jugadores: [...this.members.values()].map((m) => ({
        id: m.id,
        nombre: m.nombre,
        team: m.team,
        character: m.character,
        listo: m.listo,
        esBot: false,
        esAnfitrion: m.esAnfitrion,
        conectado: m.ws !== null,
      })),
    };
    this.broadcast({ t: 'lobby', estado });
  }

  destroy(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    for (const m of this.members.values()) m.ws?.close();
    this.members.clear();
    this.onDestroy(this.code);
  }
}
