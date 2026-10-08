import {
  BOT_DIFFICULTIES, BOT_FOV_DEG, BOT_MEMORY_S, BOT_VIEW_DIST, GRAVITY,
  TICK_RATE, UTIL_PROJ_SPEED, WEAPONS,
} from './constants.js';
import { angleDiff, clamp, DEG2RAD, v3, vclone, Vec3, vdist, vdistXZ, yawTo } from './math.js';
import { PlayerInput, PlayerState, BTN } from './types.js';
import { Rng } from './rng.js';
import { getNavGrid } from './nav.js';
import type { GameSim } from './sim.js';
import { defaultInput } from './sim.js';

const TURN_SPEED = 2 * Math.PI; // rad/s: giro limitado, nunca apuntado instantáneo
const MEMORY_TICKS = BOT_MEMORY_S * TICK_RATE;

type AttackerRole = 'principal' | 'flanqueador';
type DefenderRole = 'A' | 'B' | 'mid';

interface ThrowPlan { kind: 'habilidad' | 'granada'; target: Vec3; ticksLeft: number; }

export class BotBrain {
  private readonly id: number;
  private readonly rng: Rng;

  private path: Vec3[] | null = null;
  private pathIdx = 0;
  private pathGoal: Vec3 | null = null;
  private repathAt = 0;

  private targetId: number | null = null;
  private targetLastPos: Vec3 = v3();
  private targetLastSeenTick = -9999;
  private perceivedSince = -9999;
  private aimErrYaw = 0;
  private aimErrPitch = 0;
  private aimErrRefreshAt = 0;
  private strafeDir = 1;
  private strafeFlipAt = 0;

  private investigate: Vec3 | null = null;
  private investigateUntil = 0;

  private buyAt = 0;
  private buysDone = false;
  private throwPlan: ThrowPlan | null = null;
  private usedAbility = false;
  private usedGrenade = false;

  private atkRole: AttackerRole = 'principal';
  private defRole: DefenderRole = 'mid';
  private rolesAssigned = false;
  private holdLook: Vec3 | null = null;
  private holdJitterAt = 0;

  private lastPos = v3();
  private stuckTicks = 0;
  private altRoute = false;

  constructor(id: number, rng: Rng) {
    this.id = id;
    this.rng = rng;
  }

  onRoundStart(): void {
    this.path = null;
    this.pathGoal = null;
    this.targetId = null;
    this.targetLastSeenTick = -9999;
    this.perceivedSince = -9999;
    this.investigate = null;
    this.buysDone = false;
    this.buyAt = 0;
    this.throwPlan = null;
    this.usedAbility = false;
    this.usedGrenade = false;
    this.rolesAssigned = false;
    this.stuckTicks = 0;
    this.altRoute = false;
  }

  think(sim: GameSim, p: PlayerState): PlayerInput {
    const input = defaultInput();
    input.yaw = p.yaw;
    input.pitch = p.pitch;
    const m = sim.match;

    if (!this.rolesAssigned) this.assignRoles(sim, p);

    if (m.phase === 'prep') {
      this.doBuys(sim, p);
      // Mirar hacia la salida
      this.turnToward(p, input, p.yaw + Math.sin(sim.tick / 60) * 0.3, 0);
      return input;
    }
    if (m.phase !== 'active' && m.phase !== 'planted') return input;

    this.perceive(sim, p);
    this.hearSounds(sim, p);

    const inCombat = this.targetId !== null && sim.tick - this.targetLastSeenTick < MEMORY_TICKS;
    if (this.throwPlan) {
      this.executeThrow(sim, p, input);
      return input;
    }
    if (inCombat) {
      this.combat(sim, p, input);
    } else {
      this.targetId = null;
      this.objective(sim, p, input);
    }
    this.maybeUseUtility(sim, p);
    this.detectStuck(sim, p, input);
    return input;
  }

  // ===== Roles y compras =====

  private isAttacker(sim: GameSim, p: PlayerState): boolean {
    return p.team === sim.match.attackingTeam;
  }

  /** Elección de sitio compartida y determinista para el equipo atacante. */
  private teamSite(sim: GameSim): 'A' | 'B' {
    const h = (sim.seed ^ (sim.match.half * 97) ^ (sim.match.roundNumber * 31)) >>> 0;
    return h % 2 === 0 ? 'A' : 'B';
  }

  private assignRoles(sim: GameSim, p: PlayerState): void {
    this.rolesAssigned = true;
    const mates = [...sim.players.values()].filter((q) => q.team === p.team).sort((a, b) => a.id - b.id);
    const idx = mates.findIndex((q) => q.id === p.id);
    this.atkRole = idx >= 3 ? 'flanqueador' : 'principal';
    this.defRole = idx === 0 || idx === 1 ? 'A' : idx === 2 || idx === 3 ? 'B' : 'mid';
    this.buyAt = 60 + this.rng.int(240); // compra entre el s1 y el s5 de preparación
  }

  private doBuys(sim: GameSim, p: PlayerState): void {
    if (this.buysDone || sim.tick < this.buyAt) return;
    this.buysDone = true;
    const atk = this.isAttacker(sim, p);
    if (p.weapon === 'pulso') {
      if (p.credits >= WEAPONS.preciso.precio + 650 && this.rng.next() < 0.3) sim.buy(p.id, 'preciso');
      else if (p.credits >= WEAPONS.rafaga.precio + 650) sim.buy(p.id, 'rafaga');
    }
    if (p.credits >= 650 && p.shield < 25) sim.buy(p.id, 'escudo');
    if (!atk && !p.defuseKit && p.credits >= 400) sim.buy(p.id, 'kit');
    if (p.abilityCharges === 0 && p.credits >= 400 && this.rng.next() < 0.8) sim.buy(p.id, 'habilidad');
    if (p.grenadeCharges === 0 && p.credits >= 300 && this.rng.next() < 0.5) sim.buy(p.id, 'granada');
  }

  // ===== Percepción =====

  private perceive(sim: GameSim, p: PlayerState): void {
    if (sim.tick % 3 !== 0) return;
    const halfFov = (BOT_FOV_DEG / 2) * DEG2RAD;
    let best: PlayerState | null = null;
    let bestDist = Infinity;
    for (const e of sim.players.values()) {
      if (e.team === p.team || !e.alive) continue;
      const d = vdist(p.pos, e.pos);
      if (d > BOT_VIEW_DIST) continue;
      const yawToEnemy = yawTo(p.pos, e.pos);
      if (Math.abs(angleDiff(yawToEnemy, p.yaw)) > halfFov) continue;
      if (!sim.canSee(p, e)) continue;
      if (d < bestDist) { best = e; bestDist = d; }
    }
    if (best) {
      if (this.targetId === null || sim.tick - this.targetLastSeenTick >= MEMORY_TICKS) {
        this.perceivedSince = sim.tick; // reacción desde la primera percepción
      }
      this.targetId = best.id;
      this.targetLastPos = vclone(best.pos);
      this.targetLastSeenTick = sim.tick;
    }
  }

  private hearSounds(sim: GameSim, p: PlayerState): void {
    for (const s of sim.soundLog) {
      if (s.tick < sim.tick - 5) continue;
      if (s.team === p.team) continue;
      if (vdist(p.pos, s.pos) > s.radio) continue;
      // Posición aproximada, no tracking: redondeada a 2 m
      const approx = v3(Math.round(s.pos.x / 2) * 2, s.pos.y, Math.round(s.pos.z / 2) * 2);
      this.investigate = approx;
      this.investigateUntil = sim.tick + 6 * TICK_RATE;
    }
  }

  // ===== Combate =====

  private combat(sim: GameSim, p: PlayerState, input: PlayerInput): void {
    const target = this.targetId !== null ? sim.players.get(this.targetId) : undefined;
    const visibleNow = target !== undefined && target.alive && sim.tick - this.targetLastSeenTick <= 3;
    const aimPos = visibleNow && target
      ? v3(target.pos.x, target.pos.y + (target.crouching ? 0.6 : 1.0), target.pos.z)
      : v3(this.targetLastPos.x, this.targetLastPos.y + 1.0, this.targetLastPos.z);

    // Error angular sembrado, refrescado periódicamente
    const diff = BOT_DIFFICULTIES[p.botDifficulty];
    if (sim.tick >= this.aimErrRefreshAt) {
      this.aimErrRefreshAt = sim.tick + 24 + this.rng.int(24);
      this.aimErrYaw = (this.rng.next() * 2 - 1) * diff.aimErrorDeg * DEG2RAD;
      this.aimErrPitch = (this.rng.next() * 2 - 1) * diff.aimErrorDeg * DEG2RAD * 0.6;
    }
    const dx = aimPos.x - p.pos.x;
    const dz = aimPos.z - p.pos.z;
    const dy = aimPos.y - (p.pos.y + 1.25);
    const flat = Math.hypot(dx, dz);
    const wantYaw = Math.atan2(-dx, -dz) + this.aimErrYaw;
    const wantPitch = Math.atan2(dy, flat) + this.aimErrPitch;
    this.turnToward(p, input, wantYaw, wantPitch);

    const reactionTicks = Math.round((diff.reactionMs / 1000) * TICK_RATE);
    const aligned = Math.abs(angleDiff(wantYaw, p.yaw)) < 3.5 * DEG2RAD && Math.abs(wantPitch - p.pitch) < 4 * DEG2RAD;
    const dist = vdist(p.pos, aimPos);
    const flashed = p.flashEndTick > sim.tick + 10;

    if (p.ammo === 0) {
      input.buttons |= BTN.RELOAD;
      // Retroceder mientras recarga
      this.moveWorldDir(p, input, v3(-dx / Math.max(0.1, flat), 0, -dz / Math.max(0.1, flat)));
      return;
    }

    if (visibleNow && aligned && !flashed && sim.tick - this.perceivedSince >= reactionTicks && dist <= WEAPONS[p.weapon].alcance) {
      input.buttons |= BTN.FIRE;
    }

    if (visibleNow) {
      // Strafe lateral; el perfil preciso prefiere agacharse quieto
      if (p.weapon === 'preciso') {
        input.buttons |= BTN.CROUCH;
      } else {
        if (sim.tick >= this.strafeFlipAt) {
          this.strafeFlipAt = sim.tick + 30 + this.rng.int(50);
          this.strafeDir = this.rng.next() < 0.5 ? -1 : 1;
        }
        input.moveX = this.strafeDir;
        if (dist < 4) input.moveZ = -0.6; // mantener distancia
      }
    } else {
      // Ir hacia la última posición conocida
      this.moveTo(sim, p, input, this.targetLastPos, false);
    }
  }

  // ===== Objetivo =====

  private objective(sim: GameSim, p: PlayerState, input: PlayerInput): void {
    const m = sim.match;
    const atk = this.isAttacker(sim, p);
    const site = this.teamSite(sim);
    const sites = { A: sim.map.sites[0], B: sim.map.sites[1] };
    const core = sim.core;

    // Recarga táctica fuera de combate
    if (p.ammo < WEAPONS[p.weapon].cargador * 0.4 && p.reloadTicksLeft === 0) input.buttons |= BTN.RELOAD;

    if (atk) {
      if (m.phase === 'planted') {
        // Proteger el núcleo instalado
        const sdef = core.plantedSite ? sites[core.plantedSite] : sites[site];
        this.holdNear(sim, p, input, sdef.center, 4.5);
        return;
      }
      if (p.hasCore) {
        const s = sites[site];
        if (vdistXZ(p.pos, s.center) <= s.radius - 0.5) {
          // Instalar: inmóvil, E mantenida
          input.buttons |= BTN.USE;
          this.turnToward(p, input, p.yaw, -0.5);
          return;
        }
        this.moveVia(sim, p, input, s.center, site);
        return;
      }
      if (core.carrier === null && !core.planted) {
        // Recuperar el núcleo: van los dos atacantes más cercanos
        const attackers = [...sim.players.values()]
          .filter((q) => q.alive && q.team === p.team)
          .sort((a, b) => vdistXZ(a.pos, core.pos) - vdistXZ(b.pos, core.pos));
        const rank = attackers.findIndex((q) => q.id === p.id);
        if (rank >= 0 && rank < 2) {
          this.moveTo(sim, p, input, core.pos, false);
          return;
        }
      }
      // Escolta / flanqueo hacia el sitio
      if (this.investigate && sim.tick < this.investigateUntil && vdistXZ(p.pos, this.investigate) < 10) {
        this.moveTo(sim, p, input, this.investigate, true);
        return;
      }
      this.moveVia(sim, p, input, sites[site].center, site);
      return;
    }

    // ===== Defensores =====
    if (m.phase === 'planted' || core.planted) {
      const corePos = core.pos;
      const someoneDefusing = [...sim.players.values()].some(
        (q) => q.id !== p.id && q.alive && q.team === p.team && q.interaction?.kind === 'desactivar',
      );
      if (someoneDefusing) {
        this.holdNear(sim, p, input, corePos, 5);
        return;
      }
      if (vdistXZ(p.pos, corePos) <= 1.2) {
        input.buttons |= BTN.USE; // desactivar: inmóvil
        this.turnToward(p, input, yawTo(p.pos, corePos), -0.6);
        return;
      }
      this.moveTo(sim, p, input, corePos, false);
      return;
    }

    if (this.investigate && sim.tick < this.investigateUntil) {
      this.moveTo(sim, p, input, this.investigate, true);
      if (vdistXZ(p.pos, this.investigate) < 1.5) {
        this.investigate = null;
      }
      return;
    }

    const posts = sim.map.botHints.posts;
    const myPosts = this.defRole === 'mid' ? posts.mid : posts[this.defRole];
    const mates = [...sim.players.values()].filter((q) => q.team === p.team).sort((a, b) => a.id - b.id);
    const myIdx = mates.findIndex((q) => q.id === p.id);
    const post = myPosts[myIdx % myPosts.length];
    if (vdistXZ(p.pos, post.pos) > 1) {
      this.moveTo(sim, p, input, post.pos, false);
    } else {
      // En el puesto: vigilar la entrada con pequeñas variaciones
      if (sim.tick >= this.holdJitterAt) {
        this.holdJitterAt = sim.tick + 90 + this.rng.int(120);
        this.holdLook = v3(post.look.x + this.rng.range(-2, 2), 0, post.look.z + this.rng.range(-2, 2));
      }
      const look = this.holdLook ?? post.look;
      this.turnToward(p, input, yawTo(p.pos, look), 0);
      if (this.rng.next() < 0.002) input.buttons |= BTN.CROUCH;
    }
  }

  private holdNear(sim: GameSim, p: PlayerState, input: PlayerInput, center: Vec3, radius: number): void {
    if (vdistXZ(p.pos, center) > radius) {
      this.moveTo(sim, p, input, center, false);
    } else {
      // Mirar hacia fuera (aproximaciones)
      if (sim.tick >= this.holdJitterAt) {
        this.holdJitterAt = sim.tick + 80 + this.rng.int(100);
        const ang = this.rng.next() * Math.PI * 2;
        this.holdLook = v3(center.x + Math.cos(ang) * 12, 0, center.z + Math.sin(ang) * 12);
      }
      if (this.holdLook) this.turnToward(p, input, yawTo(p.pos, this.holdLook), 0);
    }
  }

  // ===== Utilidades =====

  private maybeUseUtility(sim: GameSim, p: PlayerState): void {
    if (this.throwPlan || sim.match.phase !== 'active') return;
    const atk = this.isAttacker(sim, p);
    const site = this.teamSite(sim);
    const sites = { A: sim.map.sites[0], B: sim.map.sites[1] };
    if (atk) {
      const d = vdistXZ(p.pos, sites[site].center);
      if (d > 9 && d < 15) {
        if (!this.usedAbility && p.abilityCharges > 0) {
          this.usedAbility = true;
          this.throwPlan = { kind: 'habilidad', target: vclone(sites[site].center), ticksLeft: 25 };
        } else if (!this.usedGrenade && p.grenadeCharges > 0 && this.rng.next() < 0.5) {
          this.usedGrenade = true;
          this.throwPlan = { kind: 'granada', target: vclone(sites[site].center), ticksLeft: 25 };
        }
      }
    } else if (this.targetId !== null && sim.tick - this.targetLastSeenTick < MEMORY_TICKS) {
      const d = vdistXZ(p.pos, this.targetLastPos);
      if (d > 5 && d < 14 && !this.usedAbility && p.abilityCharges > 0) {
        this.usedAbility = true;
        this.throwPlan = { kind: 'habilidad', target: vclone(this.targetLastPos), ticksLeft: 25 };
      }
    }
  }

  private executeThrow(sim: GameSim, p: PlayerState, input: PlayerInput): void {
    const plan = this.throwPlan!;
    const dx = plan.target.x - p.pos.x;
    const dz = plan.target.z - p.pos.z;
    const flat = Math.hypot(dx, dz);
    // Balística v=12 m/s: pitch = ½·asin(d·g/v²), 45° si no alcanza
    const s = clamp((flat * GRAVITY) / (UTIL_PROJ_SPEED * UTIL_PROJ_SPEED), 0, 1);
    const pitch = 0.5 * Math.asin(s);
    this.turnToward(p, input, Math.atan2(-dx, -dz), pitch);
    plan.ticksLeft--;
    if (plan.ticksLeft <= 0) {
      input.buttons |= plan.kind === 'habilidad' ? BTN.ABILITY : BTN.GRENADE;
      this.throwPlan = null;
    }
  }

  // ===== Navegación =====

  private moveVia(sim: GameSim, p: PlayerState, input: PlayerInput, goal: Vec3, site: 'A' | 'B'): void {
    const anchors = sim.map.botHints.routeAnchors;
    let anchor: Vec3;
    if (this.atkRole === 'flanqueador' || this.altRoute) {
      anchor = anchors.centro;
    } else {
      anchor = site === 'A' ? anchors.oeste : anchors.este;
    }
    // Si todavía no ha pasado por el ancla, ir primero al ancla
    const target = vdistXZ(p.pos, anchor) > 3 && vdistXZ(p.pos, goal) > vdistXZ(anchor, goal) + 2 ? anchor : goal;
    this.moveTo(sim, p, input, target, false);
  }

  private nextPathAllowed = 0;

  private moveTo(sim: GameSim, p: PlayerState, input: PlayerInput, goal: Vec3, cautious: boolean): void {
    // Cerca del objetivo: dirigirse en línea recta, sin A*
    if (vdistXZ(p.pos, goal) < 1.4) {
      this.steerTo(p, input, goal, cautious);
      return;
    }
    const nav = getNavGrid(sim.map);
    const needRepath =
      !this.path || !this.pathGoal || vdistXZ(this.pathGoal, goal) > 1.5 || sim.tick >= this.repathAt;
    if (needRepath && sim.tick >= this.nextPathAllowed) {
      this.path = nav.findPath(p.pos, goal);
      this.pathGoal = vclone(goal);
      this.pathIdx = 0;
      this.repathAt = sim.tick + 6 * TICK_RATE + this.rng.int(TICK_RATE);
      this.nextPathAllowed = sim.tick + TICK_RATE / 2; // como mucho 2 A* por segundo y bot
    }
    if (!this.path || this.path.length === 0) {
      this.steerTo(p, input, goal, cautious); // sin ruta: avanzar directo como último recurso
      return;
    }
    let wp = this.path[Math.min(this.pathIdx, this.path.length - 1)];
    while (this.pathIdx < this.path.length - 1 && vdistXZ(p.pos, wp) < 0.6) {
      this.pathIdx++;
      wp = this.path[this.pathIdx];
    }
    if (this.pathIdx >= this.path.length - 1 && vdistXZ(p.pos, wp) < 0.6) {
      this.steerTo(p, input, goal, cautious); // ruta consumida: acercamiento final directo
      return;
    }
    this.steerTo(p, input, wp, cautious);
  }

  private steerTo(p: PlayerState, input: PlayerInput, point: Vec3, cautious: boolean): void {
    const dir = v3(point.x - p.pos.x, 0, point.z - p.pos.z);
    const len = Math.hypot(dir.x, dir.z);
    if (len < 0.05) return;
    dir.x /= len; dir.z /= len;
    this.moveWorldDir(p, input, dir);
    // Mirar hacia donde se camina (giro limitado)
    this.turnToward(p, input, Math.atan2(-dir.x, -dir.z), 0);
    if (cautious) input.buttons |= BTN.WALK;
  }

  private moveWorldDir(p: PlayerState, input: PlayerInput, dir: Vec3): void {
    // Convertir dirección mundial a ejes locales del jugador
    const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
    const fwd = { x: -sin, z: -cos };
    const right = { x: -fwd.z, z: fwd.x };
    input.moveZ = clamp(dir.x * fwd.x + dir.z * fwd.z, -1, 1);
    input.moveX = clamp(dir.x * right.x + dir.z * right.z, -1, 1);
  }

  private turnToward(p: PlayerState, input: PlayerInput, wantYaw: number, wantPitch: number): void {
    const maxTurn = TURN_SPEED / TICK_RATE;
    const dy = angleDiff(wantYaw, p.yaw);
    input.yaw = p.yaw + clamp(dy, -maxTurn, maxTurn);
    const dp = wantPitch - p.pitch;
    input.pitch = p.pitch + clamp(dp, -maxTurn, maxTurn);
  }

  private detectStuck(sim: GameSim, p: PlayerState, input: PlayerInput): void {
    const moving = Math.abs(input.moveX) + Math.abs(input.moveZ) > 0.1;
    if (moving && vdistXZ(p.pos, this.lastPos) < 0.02) {
      this.stuckTicks++;
    } else {
      this.stuckTicks = 0;
    }
    this.lastPos = vclone(p.pos);
    if (this.stuckTicks === 2 * TICK_RATE) {
      this.path = null; // recalcular ruta
      input.buttons |= BTN.JUMP;
    } else if (this.stuckTicks >= 5 * TICK_RATE) {
      this.altRoute = !this.altRoute; // ruta alternativa, sin teletransporte
      this.path = null;
      this.stuckTicks = 0;
    }
  }
}
