import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { S2C, Snapshot } from '@pta/shared';
import { createGameServer, GameServer } from '../src/server.js';
import type { Room } from '../src/room.js';

let gs: GameServer;
let port: number;

beforeAll(async () => {
  gs = await createGameServer(0, '/tmp/no-static');
  const addr = gs.server.address();
  port = typeof addr === 'object' && addr ? addr.port : 0;
});

afterAll(async () => {
  await gs.close();
});

class TestClient {
  ws: WebSocket;
  inbox: S2C[] = [];
  closed = false;

  constructor() {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    this.ws.on('message', (d) => this.inbox.push(JSON.parse(d.toString()) as S2C));
    this.ws.on('close', () => { this.closed = true; });
  }

  async open(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) return;
    await new Promise<void>((res, rej) => {
      this.ws.once('open', res);
      this.ws.once('error', rej);
    });
  }

  send(msg: unknown): void {
    this.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  async waitFor<T extends S2C['t']>(t: T, timeoutMs = 4000): Promise<Extract<S2C, { t: T }>> {
    const start = Date.now();
    for (;;) {
      const idx = this.inbox.findIndex((m) => m.t === t);
      if (idx >= 0) {
        return this.inbox.splice(idx, 1)[0] as Extract<S2C, { t: T }>;
      }
      if (Date.now() - start > timeoutMs) throw new Error(`timeout esperando ${t}`);
      await new Promise((r) => setTimeout(r, 15));
    }
  }

  drain(): void {
    this.inbox.length = 0;
  }

  close(): void {
    this.ws.close();
  }
}

function roomSim(code: string) {
  const room = gs.rooms.get(code) as Room & { host?: { sim: import('@pta/shared').GameSim } };
  return (room as unknown as { host: { sim: import('@pta/shared').GameSim } }).host?.sim;
}

describe('salas y validación', () => {
  it('crear sala devuelve código de 6 caracteres no ambiguos y unirse funciona', async () => {
    const a = new TestClient();
    await a.open();
    a.send({ t: 'crear', nombre: 'Ana' });
    const w = await a.waitFor('bienvenida');
    expect(w.codigo).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    const b = new TestClient();
    await b.open();
    b.send({ t: 'unirse', codigo: w.codigo, nombre: 'Benito' });
    const wb = await b.waitFor('bienvenida');
    expect(wb.codigo).toBe(w.codigo);
    const lobby = await b.waitFor('lobby');
    expect(lobby.estado.jugadores).toHaveLength(2);
    // equilibrio: equipos distintos
    const teams = lobby.estado.jugadores.map((j) => j.team).sort();
    expect(teams).toEqual([0, 1]);
    a.close();
    b.close();
  });

  it('rechaza alias y códigos inválidos y JSON corrupto', async () => {
    const c = new TestClient();
    await c.open();
    c.send({ t: 'crear', nombre: 'X' }); // demasiado corto
    expect((await c.waitFor('error')).codigo).toBe('nombreInvalido');
    c.send({ t: 'unirse', codigo: 'NOPE', nombre: 'Carlos' });
    expect((await c.waitFor('error')).codigo).toBe('salaNoExiste');
    c.send({ t: 'unirse', codigo: 'ZZZZZZ', nombre: 'Carlos' });
    expect((await c.waitFor('error')).codigo).toBe('salaNoExiste');
    c.send('esto no es json{{{');
    expect((await c.waitFor('error')).codigo).toBe('formato');
    c.close();
  });

  it('partida con un humano: inicia, recibe snapshots con 10 jugadores sin duplicados', async () => {
    const a = new TestClient();
    await a.open();
    a.send({ t: 'crear', nombre: 'Solo' });
    const w = await a.waitFor('bienvenida');
    a.send({ t: 'lobbyIniciar' });
    await a.waitFor('inicio');
    const snap = await a.waitFor('snap');
    const sim = roomSim(w.codigo)!;
    expect(sim.players.size).toBe(10);
    const ids = [...sim.players.keys()];
    expect(new Set(ids).size).toBe(10);
    expect(snap.vivos).toEqual([5, 5]);
    a.close();
  });

  it('compras manipuladas y paquetes inválidos son rechazados sin romper el servidor', async () => {
    const a = new TestClient();
    await a.open();
    a.send({ t: 'crear', nombre: 'Tramposa' });
    const w = await a.waitFor('bienvenida');
    a.send({ t: 'lobbyIniciar' });
    await a.waitFor('inicio');
    a.drain();
    // artículo inexistente: ignorado (sin respuesta ni efecto)
    a.send({ t: 'comprar', item: 'megacanon' });
    // sin créditos suficientes
    a.send({ t: 'comprar', item: 'preciso' });
    const res = await a.waitFor('compraResultado');
    expect(res.ok).toBe(false);
    // entradas corruptas: NaN, valores absurdos, tipos erróneos
    a.send({ t: 'input', inputs: [{ seq: 'x', moveX: 999, moveZ: NaN, yaw: 1e99, pitch: {}, buttons: -5, ackTick: 2 ** 40 }] });
    a.send({ t: 'input', inputs: 'nada' });
    a.send({ t: 'input', inputs: [{ seq: 1, moveX: 50, moveZ: -50, yaw: 0, pitch: 0, buttons: 1, ackTick: 0 }] });
    await new Promise((r) => setTimeout(r, 300));
    const sim = roomSim(w.codigo)!;
    const p = sim.players.get(1)!;
    expect(Number.isFinite(p.pos.x)).toBe(true);
    expect(Math.abs(p.pos.x)).toBeLessThanOrEqual(32);
    // el servidor sigue respondiendo
    a.send({ t: 'ping', time: 42 });
    expect((await a.waitFor('pong')).time).toBe(42);
    a.close();
  });

  it('cadencia excesiva de entradas se descarta sin desconectar', async () => {
    const a = new TestClient();
    await a.open();
    a.send({ t: 'crear', nombre: 'Rapida' });
    await a.waitFor('bienvenida');
    a.send({ t: 'lobbyIniciar' });
    await a.waitFor('inicio');
    for (let i = 0; i < 300; i++) {
      a.send({ t: 'input', inputs: [{ seq: i + 1, moveX: 0, moveZ: 1, yaw: 0, pitch: 0, buttons: 0, ackTick: 0 }] });
    }
    a.send({ t: 'ping', time: 7 });
    expect((await a.waitFor('pong')).time).toBe(7);
    expect(a.closed).toBe(false);
    a.close();
  });

  it('duplicados de secuencia (red con jitter) no se aplican dos veces', async () => {
    const a = new TestClient();
    await a.open();
    a.send({ t: 'crear', nombre: 'Jitter' });
    const w = await a.waitFor('bienvenida');
    a.send({ t: 'lobbyIniciar' });
    await a.waitFor('inicio');
    const sim = roomSim(w.codigo)!;
    sim.match.phaseTicksLeft = 2; // saltar preparación (puertas cerradas)
    await new Promise((r) => setTimeout(r, 100));
    const z0 = sim.players.get(1)!.pos.z;
    // 30 entradas hacia delante, cada paquete enviado DOS veces con retardo variable
    const inputs = Array.from({ length: 30 }, (_, i) => ({ seq: i + 1, moveX: 0, moveZ: 1, yaw: Math.PI, pitch: 0, buttons: 0, ackTick: 0 }));
    for (let i = 0; i < 30; i += 2) {
      const packet = { t: 'input', inputs: inputs.slice(i, i + 2) };
      a.send(packet);
      setTimeout(() => a.send(packet), 30 + Math.random() * 60); // duplicado con jitter
      await new Promise((r) => setTimeout(r, 33));
    }
    await new Promise((r) => setTimeout(r, 500));
    const dz = sim.players.get(1)!.pos.z - z0;
    // El jugador avanzó, pero nunca más de lo que permite el tiempo real transcurrido
    expect(dz).toBeGreaterThan(1.2);
    expect(dz).toBeLessThan(8);
    // Mecanismo de deduplicación: una secuencia repetida no vuelve a encolarse
    const queues = (sim as unknown as { inputQueues: Map<number, unknown[]> }).inputQueues;
    const q = queues.get(1)!;
    const before = q.length;
    const dup = { seq: 500, moveX: 0, moveZ: 1, yaw: 0, pitch: 0, buttons: 0, ackTick: 0 };
    sim.queueInput(1, dup);
    sim.queueInput(1, { ...dup });
    sim.queueInput(1, { ...dup, seq: 499 }); // reordenado antiguo
    expect(q.length).toBe(before + 1);
    a.close();
  });

  it('compra duplicada con lag no duplica el efecto ni el cobro', async () => {
    const a = new TestClient();
    await a.open();
    a.send({ t: 'crear', nombre: 'Compras' });
    const w = await a.waitFor('bienvenida');
    a.send({ t: 'lobbyIniciar' });
    await a.waitFor('inicio');
    a.drain();
    a.send({ t: 'comprar', item: 'escudo' });
    a.send({ t: 'comprar', item: 'escudo' });
    const r1 = await a.waitFor('compraResultado');
    const r2 = await a.waitFor('compraResultado');
    expect([r1.ok, r2.ok].sort()).toEqual([false, true]);
    const p = roomSim(w.codigo)!.players.get(1)!;
    expect(p.shield).toBe(50);
    expect(p.credits).toBe(150); // 800 − 650, cobrado una sola vez
    a.close();
  });

  it('desconexión → bot toma el control; reconexión con token recupera la entidad', async () => {
    const a = new TestClient();
    await a.open();
    a.send({ t: 'crear', nombre: 'Volvere' });
    const w = await a.waitFor('bienvenida');
    const b = new TestClient();
    await b.open();
    b.send({ t: 'unirse', codigo: w.codigo, nombre: 'Testigo' });
    await b.waitFor('bienvenida');
    a.send({ t: 'lobbyIniciar' });
    await a.waitFor('inicio');
    await b.waitFor('inicio');
    const sim = roomSim(w.codigo)!;
    const myId = w.id;
    a.ws.terminate(); // desconexión brusca
    await new Promise((r) => setTimeout(r, 2600));
    const p = sim.players.get(myId)!;
    expect(p.controlledByBot).toBe(true); // relevo en ≤2 s
    expect(p.isBot).toBe(false);          // la plaza sigue siendo humana (ventana de 60 s)

    const a2 = new TestClient();
    await a2.open();
    a2.send({ t: 'unirse', codigo: w.codigo, nombre: 'Volvere', token: w.token });
    const w2 = await a2.waitFor('bienvenida');
    expect(w2.id).toBe(myId);
    await a2.waitFor('inicio');
    await new Promise((r) => setTimeout(r, 100));
    expect(sim.players.get(myId)!.controlledByBot).toBe(false);
    a2.close();
    b.close();
  });

  it('el código de sala no otorga control: reconectar sin token crea plaza nueva', async () => {
    const a = new TestClient();
    await a.open();
    a.send({ t: 'crear', nombre: 'Dueno' });
    const w = await a.waitFor('bienvenida');
    const impostor = new TestClient();
    await impostor.open();
    impostor.send({ t: 'unirse', codigo: w.codigo, nombre: 'Dueno', token: 'token-falso-123' });
    const wi = await impostor.waitFor('bienvenida');
    expect(wi.id).not.toBe(w.id);
    a.close();
    impostor.close();
  });

  it('entrada tardía sustituye a un bot y espera a la siguiente ronda', async () => {
    const a = new TestClient();
    await a.open();
    a.send({ t: 'crear', nombre: 'Anfitrion' });
    const w = await a.waitFor('bienvenida');
    a.send({ t: 'lobbyIniciar' });
    await a.waitFor('inicio');
    const sim = roomSim(w.codigo)!;

    const late = new TestClient();
    await late.open();
    late.send({ t: 'unirse', codigo: w.codigo, nombre: 'Tardio' });
    const wl = await late.waitFor('bienvenida');
    await late.waitFor('inicio');
    const p = sim.players.get(wl.id)!;
    expect(p.isBot).toBe(false);
    expect(p.controlledByBot).toBe(true); // juega el bot hasta la próxima ronda
    // acelerar: fin de ronda por tiempo y nueva ronda
    sim.match.phaseTicksLeft = 2;
    await new Promise((r) => setTimeout(r, 200));
    sim.match.phaseTicksLeft = 2;
    await new Promise((r) => setTimeout(r, 200));
    sim.match.phaseTicksLeft = 2;
    await new Promise((r) => setTimeout(r, 400));
    expect(sim.players.get(wl.id)!.controlledByBot).toBe(false);
    const snap = (await late.waitFor('snap')) as Snapshot;
    expect(snap.players.some((q) => q.id === wl.id)).toBe(true);
    a.close();
    late.close();
  });

  it('si se va el anfitrión, se transfiere al humano más antiguo', async () => {
    const a = new TestClient();
    await a.open();
    a.send({ t: 'crear', nombre: 'HostUno' });
    const w = await a.waitFor('bienvenida');
    const b = new TestClient();
    await b.open();
    b.send({ t: 'unirse', codigo: w.codigo, nombre: 'HostDos' });
    await b.waitFor('bienvenida');
    b.drain();
    a.send({ t: 'salir' });
    const lobby = await b.waitFor('lobby');
    const me = lobby.estado.jugadores.find((j) => j.nombre === 'HostDos');
    expect(me?.esAnfitrion).toBe(true);
    b.close();
  });

  it('los snapshots no revelan enemigos ocultos', async () => {
    const a = new TestClient();
    await a.open();
    a.send({ t: 'crear', nombre: 'Oculto' });
    const w = await a.waitFor('bienvenida');
    a.send({ t: 'lobbyIniciar' });
    await a.waitFor('inicio');
    const snap = (await a.waitFor('snap')) as Snapshot;
    const sim = roomSim(w.codigo)!;
    const myTeam = sim.players.get(w.id)!.team;
    // En preparación nadie ve a nadie: solo deben llegar los 5 del propio equipo
    const enemies = snap.players.filter((p) => p.team !== myTeam && p.alive);
    expect(enemies).toHaveLength(0);
    a.close();
  });
});
