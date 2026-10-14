import { describe, expect, it } from 'vitest';
import {
  BTN, CharacterId, defaultInput, EXPLOSION_RADIUS, GameSim, PlayerInput, RosterEntry,
  Team, WEAPONS,
} from '../src/index.js';

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

function input(partial: Partial<PlayerInput>): PlayerInput {
  return { ...defaultInput(1), ...partial };
}

function skipPrep(sim: GameSim): void {
  sim.match.phaseTicksLeft = 1;
  sim.step();
  expect(sim.match.phase).toBe('active');
}

let seqCounter = 5000;
function hold(sim: GameSim, id: number, partial: Partial<PlayerInput>, ticks: number): ReturnType<GameSim['step']>[] {
  const out = [];
  for (let i = 0; i < ticks; i++) {
    sim.queueInput(id, input({ ...partial, seq: seqCounter++, ackTick: sim.tick }));
    out.push(sim.step());
  }
  return out;
}

/** Arma al jugador con el explosivo sin pasar por la compra. */
function armExplosive(sim: GameSim, id: number): void {
  const p = sim._debugGet(id);
  p.weapon = 'explosivo';
  p.ammo = WEAPONS.explosivo.cargador;
}

describe('ataque explosivo', () => {
  it('se compra en preparación y equipa con cargador lleno', () => {
    const sim = scriptedSim();
    sim._debugGet(1).credits = 3000;
    const res = sim.buy(1, 'explosivo');
    expect(res.ok).toBe(true);
    const p = sim._debugGet(1);
    expect(p.weapon).toBe('explosivo');
    expect(p.ammo).toBe(WEAPONS.explosivo.cargador);
    expect(p.credits).toBe(3000 - WEAPONS.explosivo.precio);
  });

  it('disparar lanza un proyectil (sin trazo hitscan) y gasta munición', () => {
    const sim = scriptedSim();
    skipPrep(sim);
    armExplosive(sim, 1);
    const eventos = hold(sim, 1, { buttons: BTN.FIRE, yaw: Math.PI }, 1).flat();
    expect(sim.projectiles.filter((pr) => pr.type === 'explosivo').length).toBe(1);
    expect(sim._debugGet(1).ammo).toBe(WEAPONS.explosivo.cargador - 1);
    expect(eventos.some((e) => e.e === 'trazo')).toBe(false);
    expect(eventos.some((e) => e.e === 'sonido' && e.tipo === 'disparo')).toBe(true);
  });

  it('detona en el suelo: daño en área con atenuación, sin dañar aliados', () => {
    const sim = scriptedSim();
    skipPrep(sim);
    armExplosive(sim, 1);
    const shooter = sim._debugGet(1);
    shooter.pos = { x: -25.2, y: 0, z: -8 }; // pasillo oeste, despejado
    const cerca = sim._debugGet(6);   // enemigo a ~1 m
    cerca.pos = { x: -24.2, y: 0, z: -8 };
    const lejos = sim._debugGet(7);   // enemigo a ~2,8 m
    lejos.pos = { x: -25.2, y: 0, z: -5.2 };
    const aliado = sim._debugGet(2);  // aliado a ~1 m
    aliado.pos = { x: -26.2, y: 0, z: -8 };
    // Disparo vertical al suelo y vuelo del proyectil
    const eventos = [
      ...hold(sim, 1, { buttons: BTN.FIRE, pitch: -1.55 }, 1),
      ...hold(sim, 1, { pitch: -1.55 }, 30),
    ].flat();
    expect(eventos.some((e) => e.e === 'explosionFx')).toBe(true);
    expect(sim.projectiles.length).toBe(0);
    expect(cerca.hp).toBeLessThan(100);
    expect(lejos.hp).toBeLessThan(100);
    expect(cerca.hp).toBeLessThan(lejos.hp); // atenuación con la distancia
    expect(aliado.hp).toBe(100);
    expect(shooter.hp).toBe(100);
  });

  it('fuera del radio no hay daño', () => {
    const sim = scriptedSim();
    skipPrep(sim);
    armExplosive(sim, 1);
    sim._debugGet(1).pos = { x: -25.2, y: 0, z: -8 };
    const enemigo = sim._debugGet(6);
    enemigo.pos = { x: -25.2, y: 0, z: -8 + EXPLOSION_RADIUS + 1 };
    hold(sim, 1, { buttons: BTN.FIRE, pitch: -1.55 }, 1);
    hold(sim, 1, { pitch: -1.55 }, 30);
    expect(enemigo.hp).toBe(100);
  });

  it('las paredes bloquean la onda expansiva (línea de efecto)', () => {
    const sim = scriptedSim();
    skipPrep(sim);
    armExplosive(sim, 1);
    // Sobre la pasarela: la caja central (y 1→2,3) separa al tirador del enemigo cubierto
    sim._debugGet(1).pos = { x: 0.5, y: 1, z: -1.6 };
    const cubierto = sim._debugGet(6);
    cubierto.pos = { x: 0.5, y: 1, z: 1.4 };
    const expuesto = sim._debugGet(7);
    expuesto.pos = { x: -1.9, y: 1, z: -1.6 };
    hold(sim, 1, { buttons: BTN.FIRE, pitch: -1.55 }, 1);
    hold(sim, 1, { pitch: -1.55 }, 30);
    expect(expuesto.hp).toBeLessThan(100);
    expect(cubierto.hp).toBe(100);
  });

  it('el impacto directo sobre un enemigo detona al contacto', () => {
    const sim = scriptedSim();
    skipPrep(sim);
    armExplosive(sim, 1);
    sim._debugGet(1).pos = { x: -25.2, y: 0, z: -8 };
    const enemigo = sim._debugGet(6);
    enemigo.pos = { x: -25.2, y: 0, z: -3 }; // 5 m al norte, a tiro directo
    hold(sim, 1, { buttons: BTN.FIRE, yaw: Math.PI, pitch: 0 }, 1);
    hold(sim, 1, { yaw: Math.PI, pitch: 0 }, 30);
    expect(sim.projectiles.length).toBe(0);
    expect(enemigo.hp).toBeLessThan(60); // casi daño máximo junto al impacto
  });
});
