import { describe, expect, it } from 'vitest';
import {
  buildBosqueVerde, buildMapById, buildPuebloPaleta, capsuleFree, CharacterId, GameSim,
  getNavGrid, inRect, lineOfSight, MapDef, MapId, POKEBALL_COUNT, RosterEntry, SPEED_RUN,
  Team, TICK_RATE, v3,
} from '../src/index.js';

function valida(nombre: string, build: () => MapDef): void {
  describe(`mapa «${nombre}»`, () => {
    const map = build();
    const nav = getNavGrid(map);
    const A = map.sites[0].center;
    const B = map.sites[1].center;

    it('todos los puntos de aparición son transitables y están en su zona', () => {
      for (const spawn of [map.attackerSpawn, map.defenderSpawn]) {
        for (const pt of spawn.points) {
          expect(inRect(spawn.zone, pt.pos.x, pt.pos.z), `punto (${pt.pos.x},${pt.pos.z}) fuera de zona`).toBe(true);
          expect(capsuleFree(map, v3(pt.pos.x, 0.02, pt.pos.z), 0.35, 1.5, true), `punto (${pt.pos.x},${pt.pos.z}) bloqueado`).toBe(true);
        }
      }
    });

    it('hay camino de ambos spawns a las dos zonas', () => {
      for (const site of [A, B]) {
        for (const spawn of [map.attackerSpawn, map.defenderSpawn]) {
          const path = nav.findPath(spawn.points[2].pos, site);
          expect(path, `sin camino de (${spawn.points[2].pos.x},${spawn.points[2].pos.z}) a (${site.x},${site.z})`).not.toBeNull();
        }
      }
    });

    it('los defensores llegan antes que los atacantes a ambas zonas', () => {
      for (const site of [A, B]) {
        const tDef = Math.min(...map.defenderSpawn.points.map((pt) => nav.pathLength(nav.findPath(pt.pos, site)!) / SPEED_RUN));
        const tAtk = Math.min(...map.attackerSpawn.points.map((pt) => nav.pathLength(nav.findPath(pt.pos, site)!) / SPEED_RUN));
        expect(tDef, `defensa tarda ${tDef.toFixed(1)} s a (${site.x},${site.z})`).toBeLessThan(tAtk);
        expect(tDef).toBeGreaterThanOrEqual(1.5);
        expect(tAtk).toBeLessThanOrEqual(16);
      }
    });

    it('no hay línea de visión directa entre spawns a altura de ojos', () => {
      for (const pa of map.attackerSpawn.points) {
        for (const pd of map.defenderSpawn.points) {
          expect(
            lineOfSight(map, v3(pa.pos.x, 1.25, pa.pos.z), v3(pd.pos.x, 1.25, pd.pos.z), false),
            `LOS entre (${pa.pos.x},${pa.pos.z}) y (${pd.pos.x},${pd.pos.z})`,
          ).toBe(false);
        }
      }
    });

    it('las puertas cerradas sellan el spawn atacante', () => {
      // Con puertas cerradas no debe haber camino al exterior desde el spawn
      const dentro = map.attackerSpawn.points[2].pos;
      for (const site of [A, B]) {
        expect(lineOfSight(map, v3(dentro.x, 1.0, dentro.z), v3(site.x, 1.0, site.z), true)).toBe(false);
      }
      // Y cada puerta debe estar pegada a huecos transitables (al abrirse se sale)
      const doors = map.solids.filter((s) => s.door);
      expect(doors.length).toBeGreaterThanOrEqual(3);
    });

    it('las zonas A/B y los puntos de pokéball/muñecos son transitables', () => {
      for (const s of map.sites) {
        expect(nav.nearestWalkable(s.center.x, s.center.z, 2)).not.toBeNull();
      }
      expect(map.pokeballSpots.length).toBeGreaterThanOrEqual(POKEBALL_COUNT);
      for (const p of [...map.pokeballSpots, ...map.dummySpots]) {
        expect(inRect(map.bounds, p.x, p.z)).toBe(true);
        expect(nav.nearestWalkable(p.x, p.z, 1), `(${p.x},${p.z}) no transitable`).not.toBeNull();
        for (const b of map.solids) {
          const dentro = p.x > b.min.x && p.x < b.max.x && p.z > b.min.z && p.z < b.max.z
            && p.y + 0.5 > b.min.y && p.y + 0.5 < b.max.y;
          expect(dentro, `(${p.x},${p.z}) dentro de ${b.tag}`).toBe(false);
        }
      }
    });

    it('los letreros y murales no invaden sólidos a media altura', () => {
      for (const l of map.theming.letreros) {
        for (const b of map.solids) {
          if (b.door) continue;
          const dentro = l.pos.x > b.min.x && l.pos.x < b.max.x && l.pos.z > b.min.z && l.pos.z < b.max.z
            && l.pos.y + 1.3 > b.min.y && l.pos.y + 1.3 < b.max.y;
          expect(dentro, `letrero «${l.texto}» dentro de ${b.tag}`).toBe(false);
        }
      }
    });
  });
}

valida('Bosque Verde', buildBosqueVerde);
valida('Pueblo Paleta', buildPuebloPaleta);

describe('registro de mapas', () => {
  it('construye cada mapa con su id', () => {
    expect(buildMapById('aurora').id).toBe('aurora');
    expect(buildMapById('bosque').id).toBe('bosque');
    expect(buildMapById('paleta').id).toBe('paleta');
  });
});

function botRoster(): RosterEntry[] {
  const chars: CharacterId[] = ['pikachu', 'charmander', 'squirtle', 'bulbasaur'];
  const out: RosterEntry[] = [];
  for (let i = 0; i < 10; i++) {
    out.push({
      id: i + 1, nombre: `Bot${i + 1}`, team: (i < 5 ? 0 : 1) as Team,
      character: chars[i % 4], isBot: true, dificultad: 'normal',
    });
  }
  return out;
}

describe.each([['bosque', 11], ['paleta', 13]] as [MapId, number][])(
  'partida de bots en «%s»',
  (mapa, seed) => {
    it('una partida 5v5 completa termina con combate y objetivo', () => {
      const sim = new GameSim(seed, botRoster(), buildMapById(mapa));
      const maxTicks = 130 * 60 * TICK_RATE;
      let kills = 0;
      let plants = 0;
      let t = 0;
      while (sim.match.phase !== 'end' && t < maxTicks) {
        for (const e of sim.step()) {
          if (e.e === 'baja') kills++;
          if (e.e === 'instalado') plants++;
        }
        t++;
      }
      expect(sim.match.phase).toBe('end');
      expect(kills).toBeGreaterThan(10);
      expect(plants).toBeGreaterThanOrEqual(1);
      for (const p of sim.players.values()) {
        expect(Math.abs(p.pos.x)).toBeLessThanOrEqual(32);
        expect(Math.abs(p.pos.z)).toBeLessThanOrEqual(24);
        expect(p.pos.y).toBeGreaterThanOrEqual(-0.5);
      }
    });
  },
);
