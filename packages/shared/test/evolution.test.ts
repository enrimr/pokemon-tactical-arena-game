import { describe, expect, it } from 'vitest';
import {
  CharacterId, EVO_HP_BONUS, EVO_THRESHOLDS, GameSim, MAX_HP, maxHpFor, RosterEntry, Team,
} from '../src/index.js';

function roster10(): RosterEntry[] {
  const chars: CharacterId[] = ['pikachu', 'charmander', 'squirtle', 'bulbasaur', 'mewtwo'];
  const out: RosterEntry[] = [];
  for (let i = 0; i < 10; i++) {
    out.push({
      id: i + 1,
      nombre: `J${i + 1}`,
      team: (i < 5 ? 0 : 1) as Team,
      character: chars[i % 5],
      isBot: false,
      dificultad: 'normal',
    });
  }
  return out;
}

function activar(sim: GameSim): void {
  sim.match.phaseTicksLeft = 1;
  sim.step();
  expect(sim.match.phase).toBe('active');
}

/** Mata a `victim` con daño directo de `killer` (requiere fase activa). */
function matar(sim: GameSim, killerId: number, victimId: number): void {
  const victim = sim._debugGet(victimId);
  victim.alive = true;
  victim.hp = 1;
  sim.applyDamage(victim, 10, killerId, false);
  expect(victim.alive).toBe(false);
}

describe('evolución en partida', () => {
  it('evoluciona al alcanzar el umbral: etapa, PS y habilidad', () => {
    const sim = new GameSim(7, roster10());
    activar(sim);
    const charmander = sim._debugGet(2);
    expect(charmander.character).toBe('charmander');
    expect(charmander.evoStage).toBe(0);
    // Dos bajas: 80 puntos → Charmeleon
    matar(sim, 2, 6);
    expect(sim._debugGet(2).evoStage).toBe(0);
    charmander.hp = 60;
    matar(sim, 2, 7);
    expect(charmander.evoPoints).toBeGreaterThanOrEqual(EVO_THRESHOLDS[0]);
    expect(charmander.evoStage).toBe(1);
    expect(charmander.hp).toBe(60 + EVO_HP_BONUS); // cura al evolucionar
    expect(charmander.abilityCharges).toBe(1);     // habilidad recargada
    // Tres bajas más: 200 puntos → Charizard (tope en etapa 2)
    matar(sim, 2, 8);
    matar(sim, 2, 9);
    matar(sim, 2, 10);
    expect(charmander.evoStage).toBe(2);
  });

  it('los PS máximos por etapa se aplican al empezar ronda y Mewtwo no evoluciona', () => {
    const sim = new GameSim(7, roster10());
    activar(sim);
    const pikachu = sim._debugGet(1);
    const mewtwo = sim._debugGet(5);
    expect(mewtwo.character).toBe('mewtwo');
    // Forzar etapas y comprobar la vida al reiniciar ronda
    pikachu.evoStage = 1;
    for (let i = 0; i < 6; i++) { matar(sim, 5, 6); } // Mewtwo acumula puntos…
    expect(mewtwo.evoStage).toBe(0);                   // …pero no evoluciona
    sim.match.phaseTicksLeft = 1;
    sim.step(); // fin de ronda por tiempo → resolve
    expect(sim.match.phase).toBe('resolve');
    sim.match.phaseTicksLeft = 1;
    sim.step(); // resolve → nueva ronda
    expect(pikachu.hp).toBe(maxHpFor(1));
    expect(pikachu.evoStage).toBe(1); // persiste entre rondas
    expect(mewtwo.hp).toBe(MAX_HP);
  });

  it('Premonición revela a los enemigos cercanos a través de las paredes', () => {
    const sim = new GameSim(7, roster10());
    activar(sim);
    const mewtwo = sim._debugGet(5);  // equipo 0
    const enemigo = sim._debugGet(6); // equipo 1
    expect(mewtwo.character).toBe('mewtwo');
    // Enemigo a 5 m (dentro del radio de 10 m), sin exigir línea de visión
    enemigo.pos = { x: mewtwo.pos.x + 5, y: mewtwo.pos.y, z: mewtwo.pos.z };
    mewtwo.pitch = -1.4; // lanzar hacia el suelo para que repose cerca
    (sim as unknown as { throwUtility(p: unknown, t: string): void }).throwUtility(mewtwo, 'premonicion');
    for (let i = 0; i < 120; i++) sim.step(); // mecha 0,8 s + margen
    // Marcado internamente (sin exigir línea de visión) y presente en el snapshot
    const marked = (sim as unknown as { marked: [Map<number, number>, Map<number, number>] }).marked;
    expect(marked[0].has(6)).toBe(true);
    const snap = sim.buildSnapshot(5, []);
    const revelado = snap.players.some((p) => p.id === 6) || snap.markers.some((m) => m.id === 6);
    expect(revelado).toBe(true);
  });

  it('cambiar de personaje reinicia la cadena evolutiva', () => {
    const sim = new GameSim(7, roster10());
    const p = sim._debugGet(1);
    p.evoStage = 1;
    p.evoPoints = 120;
    const res = sim.changeCharacter(1, 'squirtle');
    expect(res.ok).toBe(true);
    expect(p.evoStage).toBe(0);
    expect(p.evoPoints).toBe(0);
  });
});
