/// <reference lib="webworker" />
import {
  CHARACTERS, CharacterId, GameSim, MatchHost, RosterEntry, Team, v3,
} from '@pta/shared';
import type { C2S } from '@pta/shared';
import type { WorkerConfig } from '../net.js';

/**
 * Servidor local en un Web Worker: la MISMA simulación autoritativa que el servidor
 * Node, mediante el adaptador de transporte. El solitario funciona sin red.
 */

let host: MatchHost | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let last = 0;
const TICK_MS = 1000 / 60;

function buildRoster(cfg: WorkerConfig): RosterEntry[] {
  const myChar = (CHARACTERS.includes(cfg.personaje as CharacterId) ? cfg.personaje : 'pikachu') as CharacterId;
  const roster: RosterEntry[] = [
    { id: 1, nombre: cfg.nombre || 'Jugador', team: 0 as Team, character: myChar, isBot: false },
  ];
  if (cfg.modo === 'entrenamiento') {
    const dummies: { dummy: 'estatico' | 'movil' }[] = [
      { dummy: 'estatico' }, { dummy: 'estatico' }, { dummy: 'estatico' },
      { dummy: 'movil' }, { dummy: 'movil' },
    ];
    dummies.forEach((d, i) => {
      roster.push({
        id: 2 + i, nombre: `Muñeco ${i + 1}`, team: 1 as Team,
        character: CHARACTERS[i % CHARACTERS.length], isBot: true, dummy: d.dummy,
      });
    });
  } else {
    for (let i = 0; i < 9; i++) {
      const team = (i < 4 ? 0 : 1) as Team;
      roster.push({
        id: 2 + i, nombre: `Bot ${i + 1}`, team,
        character: CHARACTERS[(i + 1) % CHARACTERS.length],
        isBot: true, dificultad: cfg.dificultad,
      });
    }
  }
  return roster;
}

const DUMMY_SPOTS = [v3(-21, 0, 10), v3(21, 0, 10), v3(0, 1.02, -1.8), v3(-16, 0, 6.5), v3(16, 0, 6.5)];

function placeDummies(sim: GameSim): void {
  let i = 0;
  for (const p of sim.players.values()) {
    if (p.id === 1) continue;
    const spot = DUMMY_SPOTS[i % DUMMY_SPOTS.length];
    p.pos = v3(spot.x, spot.y, spot.z);
    p.yaw = Math.PI;
    i++;
  }
}

self.onmessage = (ev: MessageEvent) => {
  const msg = ev.data as WorkerConfig | C2S;
  if (msg.t === 'config') {
    const sim = new GameSim(msg.seed, buildRoster(msg), undefined, { training: msg.modo === 'entrenamiento' });
    host = new MatchHost(sim);
    if (msg.modo === 'entrenamiento') {
      placeDummies(sim);
      host.onRoundStart = () => placeDummies(sim);
    }
    host.attach(1, (out) => (self as unknown as Worker).postMessage(out));
    (self as unknown as Worker).postMessage({ t: 'inicio', seed: msg.seed, tuId: 1, tick: sim.tick });
    last = performance.now();
    timer = setInterval(() => {
      if (!host) return;
      const now = performance.now();
      let steps = 0;
      while (now - last >= TICK_MS && steps < 10) {
        last += TICK_MS;
        host.tick();
        steps++;
      }
      if (now - last > 1000) last = now; // pestaña dormida: no acumular
    }, TICK_MS / 2);
    return;
  }
  host?.handleMessage(1, msg);
};

self.onclose = () => {
  if (timer) clearInterval(timer);
};
