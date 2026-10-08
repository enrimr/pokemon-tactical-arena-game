import { describe, expect, it } from 'vitest';
import { CharacterId, GameSim, RosterEntry, Team, TICK_RATE, vdistXZ } from '../src/index.js';

function botRoster(): RosterEntry[] {
  const chars: CharacterId[] = ['pikachu', 'charmander', 'squirtle', 'bulbasaur'];
  const out: RosterEntry[] = [];
  for (let i = 0; i < 10; i++) {
    out.push({
      id: i + 1,
      nombre: `Bot${i + 1}`,
      team: (i < 5 ? 0 : 1) as Team,
      character: chars[i % 4],
      isBot: true,
      dificultad: 'normal',
    });
  }
  return out;
}

describe('partida completa de bots (semillas fijas)', () => {
  it('los atacantes progresan hacia una zona en la primera ronda', () => {
    const sim = new GameSim(2024, botRoster());
    sim.match.phaseTicksLeft = 10; // acortar preparación
    for (let t = 0; t < 26 * TICK_RATE; t++) {
      sim.step();
      if (sim.match.phase === 'resolve' || sim.match.phase === 'planted') break;
    }
    const attackers = [...sim.players.values()].filter((p) => p.team === sim.match.attackingTeam && p.alive);
    const nearSite = attackers.some((p) =>
      sim.map.sites.some((s) => vdistXZ(p.pos, s.center) < 12),
    );
    expect(sim.core.planted || nearSite || sim.match.phase === 'resolve').toBe(true);
  });

  it('una partida 5v5 de bots termina con marcador coherente y hay combate', () => {
    const sim = new GameSim(7, botRoster());
    const maxTicks = 130 * 60 * TICK_RATE; // red de seguridad muy holgada
    let plants = 0;
    let kills = 0;
    let t = 0;
    while (sim.match.phase !== 'end' && t < maxTicks) {
      const events = sim.step();
      for (const e of events) {
        if (e.e === 'instalado') plants++;
        if (e.e === 'baja') kills++;
      }
      t++;
    }
    expect(sim.match.phase).toBe('end');
    const [a, b] = sim.match.score;
    expect(a + b).toBeGreaterThanOrEqual(7);
    expect(a + b).toBeLessThanOrEqual(12);
    expect(sim.match.matchWinner).not.toBeNull();
    expect(kills).toBeGreaterThan(10); // los bots combaten de verdad
    expect(plants).toBeGreaterThanOrEqual(1); // los bots juegan el objetivo
    // Nadie se sale del mapa
    for (const p of sim.players.values()) {
      expect(Math.abs(p.pos.x)).toBeLessThanOrEqual(32);
      expect(Math.abs(p.pos.z)).toBeLessThanOrEqual(24);
      expect(p.pos.y).toBeGreaterThanOrEqual(-0.5);
    }
    // La partida con la misma semilla es determinista en resultado
    const sim2 = new GameSim(7, botRoster());
    let t2 = 0;
    while (sim2.match.phase !== 'end' && t2 < maxTicks) { sim2.step(); t2++; }
    expect(sim2.match.score).toEqual(sim.match.score);
    expect(t2).toBe(t);
  }, 120000);
});
