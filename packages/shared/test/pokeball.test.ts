import { describe, expect, it } from 'vitest';
import {
  buildAuroraMap, CharacterId, ECO_MAX, GameSim, getNavGrid, inRect,
  maxHpFor, POKEBALL_COUNT, POKEBALL_CREDITS, POKEBALL_EVO_POINTS, POKEBALL_HEAL,
  RosterEntry, Team, WEAPONS,
} from '../src/index.js';

const map = buildAuroraMap();

function roster10(): RosterEntry[] {
  const chars: CharacterId[] = ['pikachu', 'charmander', 'squirtle', 'bulbasaur'];
  const out: RosterEntry[] = [];
  for (let i = 0; i < 10; i++) {
    out.push({
      id: i + 1, nombre: `J${i + 1}`, team: (i < 5 ? 0 : 1) as Team,
      character: chars[i % 4], isBot: false,
    });
  }
  return out;
}

function scriptedSim(seed = 42): GameSim {
  return new GameSim(seed, roster10());
}

function skipPrep(sim: GameSim): void {
  sim.match.phaseTicksLeft = 1;
  sim.step();
  expect(sim.match.phase).toBe('active');
}

/** Coloca al jugador sobre la primera pokéball y avanza un tick. */
function collectFirst(sim: GameSim, id: number): ReturnType<GameSim['step']> {
  const p = sim._debugGet(id);
  const pb = sim.pickups[0];
  p.pos = { x: pb.pos.x, y: pb.pos.y, z: pb.pos.z };
  return sim.step();
}

describe('pokéballs: puntos de aparición', () => {
  const nav = getNavGrid(map);

  it('hay suficientes candidatas y todas en zonas neutrales y transitables', () => {
    expect(map.pokeballSpots.length).toBeGreaterThanOrEqual(POKEBALL_COUNT);
    for (const s of map.pokeballSpots) {
      expect(inRect(map.bounds, s.x, s.z)).toBe(true);
      expect(inRect(map.attackerSpawn.zone, s.x, s.z)).toBe(false);
      expect(inRect(map.defenderSpawn.zone, s.x, s.z)).toBe(false);
      expect(nav.nearestWalkable(s.x, s.z, 1)).not.toBeNull();
      // El punto (a media altura de jugador) no está dentro de ningún sólido
      for (const b of map.solids) {
        const dentro = s.x > b.min.x && s.x < b.max.x && s.z > b.min.z && s.z < b.max.z
          && s.y + 0.5 > b.min.y && s.y + 0.5 < b.max.y;
        expect(dentro, `(${s.x},${s.y},${s.z}) dentro de ${b.tag}`).toBe(false);
      }
    }
  });
});

describe('pokéballs: aparición y recogida', () => {
  it('aparecen POKEBALL_COUNT por ronda, en puntos distintos del mapa', () => {
    const sim = scriptedSim();
    expect(sim.pickups.length).toBe(POKEBALL_COUNT);
    const claves = new Set(sim.pickups.map((p) => `${p.pos.x},${p.pos.z}`));
    expect(claves.size).toBe(POKEBALL_COUNT);
    for (const pk of sim.pickups) {
      expect(map.pokeballSpots.some((s) => s.x === pk.pos.x && s.z === pk.pos.z)).toBe(true);
    }
  });

  it('misma semilla → mismas posiciones (determinismo)', () => {
    const a = scriptedSim(7).pickups.map((p) => `${p.pos.x},${p.pos.z}`);
    const b = scriptedSim(7).pickups.map((p) => `${p.pos.x},${p.pos.z}`);
    expect(a).toEqual(b);
    const c = scriptedSim(8).pickups.map((p) => `${p.pos.x},${p.pos.z}`);
    expect(a).not.toEqual(c); // con otra semilla, otra distribución (casi seguro)
  });

  it('no se recogen durante la preparación', () => {
    const sim = scriptedSim();
    const eventos = collectFirst(sim, 1);
    expect(sim.pickups.length).toBe(POKEBALL_COUNT);
    expect(eventos.some((e) => e.e === 'pokeball')).toBe(false);
  });

  it('en ronda activa se recoge por proximidad y emite el evento', () => {
    const sim = scriptedSim();
    skipPrep(sim);
    const eventos = collectFirst(sim, 1);
    expect(sim.pickups.length).toBe(POKEBALL_COUNT - 1);
    const ev = eventos.find((e) => e.e === 'pokeball');
    expect(ev).toBeDefined();
    if (ev?.e === 'pokeball') expect(ev.player).toBe(1);
  });

  it('reaparecen al empezar la siguiente ronda', () => {
    const sim = scriptedSim();
    skipPrep(sim);
    collectFirst(sim, 1);
    expect(sim.pickups.length).toBe(POKEBALL_COUNT - 1);
    sim.match.phaseTicksLeft = 1;
    sim.step(); // resolve
    sim.match.phaseTicksLeft = 1;
    sim.step(); // nueva ronda (prep)
    expect(sim.match.phase).toBe('prep');
    expect(sim.pickups.length).toBe(POKEBALL_COUNT);
  });

  it('el snapshot incluye las pokéballs pendientes', () => {
    const sim = scriptedSim();
    const snap = sim.buildSnapshot(1, []);
    expect(snap.pickups.length).toBe(POKEBALL_COUNT);
  });
});

describe('pokéballs: premios', () => {
  /** Recoge pokéballs con semillas distintas hasta obtener el premio buscado. */
  function collectUntil(premio: string, prepara?: (sim: GameSim) => void): { sim: GameSim; ev: { cantidad: number; detalle?: string } } {
    for (let seed = 1; seed < 400; seed++) {
      const sim = scriptedSim(seed);
      skipPrep(sim);
      prepara?.(sim);
      const eventos = collectFirst(sim, 1);
      const ev = eventos.find((e) => e.e === 'pokeball');
      if (ev?.e === 'pokeball' && ev.premio === premio) return { sim, ev };
    }
    throw new Error(`sin premio ${premio} en 400 semillas`);
  }

  it('energía: suma puntos de evolución', () => {
    const { sim } = collectUntil('energia');
    expect(sim._debugGet(1).evoPoints).toBe(POKEBALL_EVO_POINTS);
  });

  it('cura: restaura PS hasta el máximo', () => {
    const { sim, ev } = collectUntil('cura', (s) => { s._debugGet(1).hp = 50; });
    expect(ev.cantidad).toBe(POKEBALL_HEAL);
    expect(sim._debugGet(1).hp).toBe(50 + POKEBALL_HEAL);
  });

  it('cura parcial: no supera el máximo', () => {
    const { sim, ev } = collectUntil('cura', (s) => { s._debugGet(1).hp = maxHpFor(0) - 10; });
    expect(ev.cantidad).toBe(10);
    expect(sim._debugGet(1).hp).toBe(maxHpFor(0));
  });

  it('MT: aprende el siguiente ataque con cargador lleno', () => {
    const { sim, ev } = collectUntil('mt');
    const p = sim._debugGet(1);
    expect(p.weapon).toBe('rafaga');
    expect(ev.detalle).toBe('rafaga');
    expect(p.ammo).toBe(WEAPONS.rafaga.cargador);
  });

  it('MT con ráfaga equipada: pasa al pulso preciso', () => {
    const { sim } = collectUntil('mt', (s) => { s._debugGet(1).weapon = 'rafaga'; });
    expect(sim._debugGet(1).weapon).toBe('preciso');
  });

  it('MO: recarga la habilidad; con habilidad, la granada', () => {
    const a = collectUntil('mo');
    expect(a.sim._debugGet(1).abilityCharges).toBe(1);
    expect(a.ev.detalle).toBe('habilidad');
    const b = collectUntil('mo', (s) => { s._debugGet(1).abilityCharges = 1; });
    expect(b.sim._debugGet(1).grenadeCharges).toBe(1);
    expect(b.ev.detalle).toBe('granada');
  });

  it('premio sin efecto → créditos de consolación (con tope de economía)', () => {
    // Todo al máximo: cualquier premio degenera en créditos
    const prepara = (s: GameSim): void => {
      const p = s._debugGet(1);
      p.weapon = 'preciso';
      p.abilityCharges = 1;
      p.grenadeCharges = 1;
      p.evoPoints = 0;
      p.character = 'mewtwo'; // sin evolución
    };
    const sim = scriptedSim(1);
    skipPrep(sim);
    prepara(sim);
    const antes = sim._debugGet(1).credits;
    const eventos = collectFirst(sim, 1);
    const ev = eventos.find((e) => e.e === 'pokeball');
    expect(ev?.e === 'pokeball' && ev.premio).toBe('creditos');
    expect(sim._debugGet(1).credits).toBe(Math.min(ECO_MAX, antes + POKEBALL_CREDITS));
  });
});
