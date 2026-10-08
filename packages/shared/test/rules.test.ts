import { describe, expect, it } from 'vitest';
import {
  BTN, CharacterId, defaultInput, GameSim, PlayerInput, RosterEntry, Team, TICK_RATE, v3,
  ECO_START, ECO_WIN, ECO_LOSS_BASE, ECO_MAX, WEAPONS,
} from '../src/index.js';

function roster10(humans = 0): RosterEntry[] {
  const chars: CharacterId[] = ['pikachu', 'charmander', 'squirtle', 'bulbasaur'];
  const out: RosterEntry[] = [];
  for (let i = 0; i < 10; i++) {
    out.push({
      id: i + 1,
      nombre: `J${i + 1}`,
      team: (i < 5 ? 0 : 1) as Team,
      character: chars[i % 4],
      isBot: i >= humans,
      dificultad: 'normal',
    });
  }
  return out;
}

/** Sim con jugadores humanos quietos (sin bots) para pruebas con guion. */
function scriptedSim(seed = 42): GameSim {
  return new GameSim(seed, roster10(10));
}

function input(partial: Partial<PlayerInput>): PlayerInput {
  return { ...defaultInput(1), ...partial };
}

function skipPrep(sim: GameSim): void {
  sim.match.phaseTicksLeft = 1;
  sim.step();
  expect(sim.match.phase).toBe('active');
}

let seqCounter = 1000;
function hold(sim: GameSim, id: number, partial: Partial<PlayerInput>, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    sim.queueInput(id, input({ ...partial, seq: seqCounter++, ackTick: sim.tick }));
    sim.step();
  }
}

describe('economía', () => {
  it('reparte victoria, derrota y rachas con tope', () => {
    const sim = scriptedSim();
    skipPrep(sim);
    // Equipo 0 ataca. Forzamos victoria defensora por tiempo.
    sim.match.phaseTicksLeft = 1;
    sim.step();
    expect(sim.match.phase).toBe('resolve');
    expect(sim.match.roundWinner).toBe(1);
    expect(sim.match.roundEndReason).toBe('tiempo_agotado');
    const winner = sim._debugGet(6);
    const loser = sim._debugGet(1);
    expect(winner.credits).toBe(ECO_START + ECO_WIN);
    expect(loser.credits).toBe(ECO_START + ECO_LOSS_BASE);

    // Segunda derrota consecutiva: +400 extra
    sim.match.phaseTicksLeft = 1;
    sim.step(); // empieza ronda 2 (prep)
    expect(sim.match.phase).toBe('prep');
    sim.match.phaseTicksLeft = 1;
    sim.step(); // activa
    sim.match.phaseTicksLeft = 1;
    sim.step(); // tiempo agotado otra vez
    expect(sim._debugGet(1).credits).toBe(ECO_START + ECO_LOSS_BASE * 2 + 400);
    // Tope de créditos
    const p = sim._debugGet(6);
    expect(p.credits).toBeLessThanOrEqual(ECO_MAX);
  });

  it('rechaza compras fuera de fase, duplicadas y sin saldo', () => {
    const sim = scriptedSim();
    expect(sim.match.phase).toBe('prep');
    const p = sim._debugGet(1);
    expect(sim.buy(1, 'preciso').ok).toBe(false); // 2400 > 800
    expect(sim.buy(1, 'escudo').ok).toBe(true);
    expect(sim.buy(1, 'escudo').ok).toBe(false); // duplicado
    expect(p.credits).toBe(ECO_START - 650);
    skipPrep(sim);
    expect(sim.buy(1, 'granada').ok).toBe(false); // fuera de fase
  });

  it('kit solo para defensores; compra solo dentro del spawn', () => {
    const sim = scriptedSim();
    expect(sim.buy(1, 'kit').ok).toBe(false); // el equipo 0 ataca la primera mitad
    expect(sim.buy(6, 'kit').ok).toBe(true);
    const p = sim._debugGet(6);
    p.pos = v3(0, 0, 0); // fuera del spawn
    expect(sim.buy(6, 'granada').ok).toBe(false);
  });
});

describe('daño, escudo y debilitamiento', () => {
  it('ejemplo del documento: daño 20 contra escudo 5 → consume 5 de escudo y 15 PV', () => {
    const sim = scriptedSim();
    skipPrep(sim);
    const v = sim._debugGet(6);
    v.shield = 5;
    sim.applyDamage(v, 20, 1, false);
    expect(v.shield).toBe(0);
    expect(v.hp).toBe(85);
  });

  it('escudo absorbe el 50 %', () => {
    const sim = scriptedSim();
    skipPrep(sim);
    const v = sim._debugGet(6);
    v.shield = 50;
    sim.applyDamage(v, 20, 1, false);
    expect(v.shield).toBe(40);
    expect(v.hp).toBe(90);
  });

  it('no hay daño fuera de las fases activas', () => {
    const sim = scriptedSim();
    const v = sim._debugGet(6);
    sim.applyDamage(v, 50, 1, false); // prep
    expect(v.hp).toBe(100);
  });

  it('a 0 PV queda debilitado, suelta el núcleo y reparte baja + créditos', () => {
    const sim = scriptedSim();
    skipPrep(sim);
    const carrier = sim._debugGet(1); // menor id atacante → núcleo
    expect(carrier.hasCore).toBe(true);
    const before = sim._debugGet(6).credits;
    sim.applyDamage(carrier, 200, 6, false);
    expect(carrier.alive).toBe(false);
    expect(carrier.hasCore).toBe(false);
    expect(sim.core.carrier).toBeNull();
    expect(sim._debugGet(6).kills).toBe(1);
    expect(sim._debugGet(6).credits).toBe(before + 200);
  });
});

describe('núcleo: instalar, desactivar y desempates', () => {
  function plant(sim: GameSim, id: number): void {
    const p = sim._debugGet(id);
    const site = sim.map.sites[0];
    p.pos = v3(site.center.x, 0.001, site.center.z);
    p.vel = v3();
    hold(sim, id, { buttons: BTN.USE }, 3 * TICK_RATE + 2);
    expect(sim.core.planted).toBe(true);
    expect(sim.match.phase).toBe('planted');
  }

  it('instalación completa tras 3 s y pasa a cuenta atrás de 35 s', () => {
    const sim = scriptedSim();
    skipPrep(sim);
    plant(sim, 1);
    expect(sim.match.phaseTicksLeft).toBeGreaterThan(34 * TICK_RATE);
    expect(sim._debugGet(1).credits).toBe(ECO_START + 200);
  });

  it('moverse o atacar reinicia el progreso de instalación', () => {
    const sim = scriptedSim();
    skipPrep(sim);
    const p = sim._debugGet(1);
    const site = sim.map.sites[0];
    p.pos = v3(site.center.x, 0.001, site.center.z);
    hold(sim, 1, { buttons: BTN.USE }, 60);
    expect(p.interaction).not.toBeNull();
    const progress = p.interaction!.ticksLeft;
    expect(progress).toBeLessThan(3 * TICK_RATE);
    hold(sim, 1, { buttons: BTN.USE, moveZ: 1 }, 10); // moverse cancela
    expect(p.interaction).toBeNull();
    hold(sim, 1, { buttons: BTN.USE }, 20); // frenar y reiniciar desde cero
    expect(p.interaction).not.toBeNull();
    expect(p.interaction!.ticksLeft).toBeGreaterThan(progress); // progreso reiniciado
    expect(sim.core.planted).toBe(false);
  });

  it('recibir daño no reinicia el progreso', () => {
    const sim = scriptedSim();
    skipPrep(sim);
    const p = sim._debugGet(1);
    const site = sim.map.sites[0];
    p.pos = v3(site.center.x, 0.001, site.center.z);
    hold(sim, 1, { buttons: BTN.USE }, 60);
    const progress = p.interaction!.ticksLeft;
    sim.applyDamage(p, 10, 6, false);
    hold(sim, 1, { buttons: BTN.USE }, 10);
    expect(p.interaction!.ticksLeft).toBe(progress - 10);
  });

  it('la expiración del reloj con instalación en curso da victoria defensora', () => {
    const sim = scriptedSim();
    skipPrep(sim);
    const p = sim._debugGet(1);
    const site = sim.map.sites[0];
    p.pos = v3(site.center.x, 0.001, site.center.z);
    hold(sim, 1, { buttons: BTN.USE }, 30);
    expect(p.interaction).not.toBeNull();
    sim.match.phaseTicksLeft = 1;
    sim.step();
    expect(sim.match.roundWinner).toBe(1);
    expect(sim.match.roundEndReason).toBe('tiempo_agotado');
  });

  it('desactivar a tiempo da victoria defensora (7 s sin kit, 4 s con kit)', () => {
    const sim = scriptedSim(7);
    skipPrep(sim);
    plant(sim, 1);
    const d = sim._debugGet(6);
    d.pos = v3(sim.core.pos.x + 1, sim.core.pos.y, sim.core.pos.z);
    d.defuseKit = true;
    hold(sim, 6, { buttons: BTN.USE }, 4 * TICK_RATE + 2);
    expect(sim.match.phase).toBe('resolve');
    expect(sim.match.roundWinner).toBe(1);
    expect(sim.match.roundEndReason).toBe('nucleo_desactivado');
  });

  it('empate exacto desactivación/cuenta atrás: vence el deadline (atacantes)', () => {
    const sim = scriptedSim(9);
    skipPrep(sim);
    plant(sim, 1);
    const d = sim._debugGet(6);
    d.pos = v3(sim.core.pos.x + 1, sim.core.pos.y, sim.core.pos.z);
    hold(sim, 6, { buttons: BTN.USE }, 5);
    expect(d.interaction).not.toBeNull();
    // Igualar: la interacción terminaría en el mismo tick en que expira la cuenta atrás
    sim.match.phaseTicksLeft = d.interaction!.ticksLeft;
    hold(sim, 6, { buttons: BTN.USE }, d.interaction!.ticksLeft + 1);
    expect(sim.match.roundWinner).toBe(0); // atacan los azules (equipo 0)
    expect(sim.match.roundEndReason).toBe('nucleo_detonado');
  });

  it('eliminación doble en el mismo tick: defensa si no está instalado, ataque si lo está', () => {
    // Caso sin instalar
    let sim = scriptedSim();
    skipPrep(sim);
    for (const p of sim.players.values()) p.hp = 1;
    for (const p of sim.players.values()) sim.applyDamage(p, 10, p.team === 0 ? 6 : 1, false);
    sim.step();
    expect(sim.match.roundWinner).toBe(1);

    // Caso instalado
    sim = scriptedSim();
    skipPrep(sim);
    const site = sim.map.sites[0];
    const c = sim._debugGet(1);
    c.pos = v3(site.center.x, 0.001, site.center.z);
    hold(sim, 1, { buttons: BTN.USE }, 3 * TICK_RATE + 2);
    expect(sim.core.planted).toBe(true);
    for (const p of sim.players.values()) p.hp = 1;
    for (const p of sim.players.values()) sim.applyDamage(p, 10, p.team === 0 ? 6 : 1, false);
    sim.step();
    expect(sim.match.roundWinner).toBe(0);
  });

  it('tras instalar, eliminar a todos los atacantes no termina la ronda', () => {
    const sim = scriptedSim();
    skipPrep(sim);
    const site = sim.map.sites[0];
    const c = sim._debugGet(1);
    c.pos = v3(site.center.x, 0.001, site.center.z);
    hold(sim, 1, { buttons: BTN.USE }, 3 * TICK_RATE + 2);
    for (const p of sim.players.values()) {
      if (p.team === 0) sim.applyDamage(p, 999, 6, false);
    }
    sim.step();
    expect(sim.match.phase).toBe('planted'); // sigue la cuenta atrás
    sim.match.phaseTicksLeft = 1;
    sim.step();
    expect(sim.match.roundWinner).toBe(0);
    expect(sim.match.roundEndReason).toBe('nucleo_detonado');
  });

  it('los defensores no pueden recoger el núcleo; los atacantes sí (auto <1 m)', () => {
    const sim = scriptedSim();
    skipPrep(sim);
    const c = sim._debugGet(1);
    sim.applyDamage(c, 999, 6, false); // suelta el núcleo
    const corePos = sim.core.pos;
    const def = sim._debugGet(6);
    def.pos = v3(corePos.x, corePos.y, corePos.z);
    sim.step();
    expect(sim.core.carrier).toBeNull();
    const atk = sim._debugGet(2);
    atk.pos = v3(corePos.x + 0.5, corePos.y, corePos.z);
    sim.step();
    expect(sim.core.carrier).toBe(2);
  });
});

describe('mitades y final de partida', () => {
  it('tras 6 rondas se intercambian roles y se reinicia la economía', () => {
    const sim = scriptedSim();
    expect(sim.match.attackingTeam).toBe(0);
    for (let r = 0; r < 6; r++) {
      if (sim.match.phase === 'prep') { sim.match.phaseTicksLeft = 1; sim.step(); }
      sim.match.phaseTicksLeft = 1; sim.step(); // fin de ronda por tiempo
      expect(sim.match.phase).toBe('resolve');
      sim.match.phaseTicksLeft = 1; sim.step(); // siguiente
    }
    expect(sim.match.half).toBe(2);
    expect(sim.match.attackingTeam).toBe(1);
    expect(sim.match.roundNumber).toBe(1);
    for (const p of sim.players.values()) {
      expect(p.credits).toBe(ECO_START);
      expect(p.weapon).toBe('pulso');
    }
    expect(sim.match.lossStreak).toEqual([0, 0]);
    expect(sim.match.score).toEqual([0, 6]); // el equipo 1 defendía y ganó las 6 por tiempo
  });

  it('primera a 7 gana; 6-6 es empate sin prórroga', () => {
    const sim = scriptedSim();
    // 12 rondas por tiempo: gana siempre el defensor → 6-6 → empate
    for (let r = 0; r < 12; r++) {
      if (sim.match.phase === 'prep') { sim.match.phaseTicksLeft = 1; sim.step(); }
      sim.match.phaseTicksLeft = 1; sim.step();
      sim.match.phaseTicksLeft = 1; sim.step();
    }
    expect(sim.match.phase).toBe('end');
    expect(sim.match.matchWinner).toBe('empate');
    expect(sim.match.score).toEqual([6, 6]);
  });
});

describe('supervivencia y equipamiento entre rondas', () => {
  it('sobrevivir conserva arma y escudo; morir lo pierde todo', () => {
    const sim = scriptedSim();
    const survivor = sim._debugGet(6);
    survivor.credits = 3000;
    expect(sim.buy(6, 'rafaga').ok).toBe(true);
    expect(sim.buy(6, 'escudo').ok).toBe(true);
    const dead = sim._debugGet(7);
    dead.credits = 3000;
    expect(sim.buy(7, 'rafaga').ok).toBe(true);
    skipPrep(sim);
    survivor.shield = 17;
    sim.applyDamage(dead, 999, 1, false);
    sim.match.phaseTicksLeft = 1; sim.step(); // fin por tiempo
    sim.match.phaseTicksLeft = 1; sim.step(); // nueva ronda
    expect(sim.match.phase).toBe('prep');
    expect(sim._debugGet(6).weapon).toBe('rafaga');
    expect(sim._debugGet(6).shield).toBe(17);
    expect(sim._debugGet(6).ammo).toBe(WEAPONS.rafaga.cargador); // cargador repuesto
    expect(sim._debugGet(7).weapon).toBe('pulso');
    expect(sim._debugGet(7).shield).toBe(0);
    expect(sim._debugGet(7).alive).toBe(true); // PV repuestos
  });

  it('cambiar de personaje en preparación elimina la carga de habilidad sin reembolso', () => {
    const sim = scriptedSim();
    const p = sim._debugGet(1);
    expect(sim.buy(1, 'habilidad').ok).toBe(true);
    expect(p.abilityCharges).toBe(1);
    const credits = p.credits;
    expect(sim.changeCharacter(1, 'squirtle').ok).toBe(true);
    expect(p.abilityCharges).toBe(0);
    expect(p.credits).toBe(credits);
    skipPrep(sim);
    expect(sim.changeCharacter(1, 'pikachu').ok).toBe(false); // no durante la ronda
  });
});

describe('disparo y cobertura', () => {
  it('no se puede dañar a través de una pared', () => {
    const sim = scriptedSim(123);
    skipPrep(sim);
    const shooter = sim._debugGet(1);
    const target = sim._debugGet(6);
    // A ambos lados del muro norte del spawn atacante (z=-16)
    shooter.pos = v3(-3, 0.001, -18);
    shooter.yaw = Math.PI; // mirar a +Z
    shooter.pitch = 0;
    target.pos = v3(-3, 0.001, -14);
    const hpBefore = target.hp;
    hold(sim, 1, { buttons: BTN.FIRE, yaw: Math.PI }, 30);
    expect(target.hp).toBe(hpBefore);
  });

  it('a cielo abierto el disparo impacta y el cargador se agota y recarga', () => {
    const sim = scriptedSim(123);
    skipPrep(sim);
    const shooter = sim._debugGet(1);
    const target = sim._debugGet(6);
    shooter.pos = v3(-21, 0.001, 6);
    target.pos = v3(-21, 0.001, 12);
    target.vel = v3();
    const yaw = Math.PI; // +Z
    const hpBefore = target.hp;
    hold(sim, 1, { buttons: BTN.FIRE, yaw }, 90);
    expect(target.hp).toBeLessThan(hpBefore);
    expect(shooter.ammo).toBeLessThan(WEAPONS.pulso.cargador);
    const ammoNow = shooter.ammo;
    hold(sim, 1, { buttons: BTN.RELOAD, yaw }, Math.round(WEAPONS.pulso.recargaS * TICK_RATE) + 5);
    expect(shooter.ammo).toBe(WEAPONS.pulso.cargador);
    expect(ammoNow).toBeLessThan(WEAPONS.pulso.cargador);
  });

  it('no se permite recargar con el cargador lleno', () => {
    const sim = scriptedSim();
    skipPrep(sim);
    const p = sim._debugGet(1);
    hold(sim, 1, { buttons: BTN.RELOAD }, 3);
    expect(p.reloadTicksLeft).toBe(0);
  });

  it('no se dispara en preparación', () => {
    const sim = scriptedSim();
    const p = sim._debugGet(1);
    hold(sim, 1, { buttons: BTN.FIRE }, 10);
    expect(p.ammo).toBe(WEAPONS.pulso.cargador);
  });
});
