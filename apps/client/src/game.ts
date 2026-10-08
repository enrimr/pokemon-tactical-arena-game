import {
  BTN, buildAuroraMap, CAMERA_HEIGHT, CAMERA_HEIGHT_CROUCH, CharacterId, defaultInput,
  fireCooldownTicks, lookDir, MapDef, PlayerInput, PlayerState, raycastMap, SnapPlayer,
  Snapshot, STR, Team, TICK_RATE, vdistXZ, WEAPONS, currentSpreadDeg, angleDiff,
  stepMovement, v3, Vec3,
} from '@pta/shared';
import { GameRenderer, PlayerView } from './renderer.js';
import { Hud } from './hud.js';
import { InputManager } from './input.js';
import { audio } from './audio.js';
import { settings, persist } from './settings.js';
import type { Transport } from './net.js';
import { buildSettingsPanel } from './settingsUI.js';

const TICK_MS = 1000 / 60;
const INTERP_TICKS = 6; // 100 ms

interface SnapEntry { snap: Snapshot; at: number; }

export interface GameOptions {
  container: HTMLElement;
  transport: Transport;
  myId: number;
  modo: 'solo' | 'multi' | 'entrenamiento';
  onExit: () => void;
  onResults: (players: SnapPlayer[], score: [number, number], ganador: Team | 'empate', myTeam: Team) => void;
  /** multi: intenta obtener un transporte nuevo con el token (reconexión) */
  reconnect?: () => Promise<Transport | null>;
}

interface Registry { nombre: string; team: Team; character: CharacterId; lastPos: Vec3; }

export class GameClient {
  private opts: GameOptions;
  private map: MapDef;
  private renderer: GameRenderer;
  private hud: Hud;
  private input: InputManager;
  private transport: Transport;
  private myId: number;

  private snaps: SnapEntry[] = [];
  private latest: Snapshot | null = null;
  private registry = new Map<number, Registry>();

  // Predicción propia
  private self: PlayerState;
  private pending: PlayerInput[] = [];
  private seq = 0;
  private localAmmo = 16;
  private localCooldown = 0;
  private localReload = 0;
  private sendBuffer: PlayerInput[] = [];

  private raf = 0;
  private last = performance.now();
  private acc = 0;
  private time = 0;
  private pingTimer: number;
  private rtt = 0;
  private fps = 60;
  private frameMs = 16;
  private devVisible = false;

  private spectateId: number | null = null;
  private prevMouseFire = false;
  private lastFireAt = new Map<number, number>();
  private lastThrowAt = new Map<number, number>();
  private lastInteractAt = new Map<number, number>();
  private beepIn = 0;

  private pauseOverlay: HTMLElement;
  private disconnectOverlay: HTMLElement;
  private disposed = false;
  private ended = false;

  constructor(opts: GameOptions) {
    this.opts = opts;
    this.transport = opts.transport;
    this.myId = opts.myId;
    this.map = buildAuroraMap();
    this.renderer = new GameRenderer(opts.container, this.map);
    this.hud = new Hud(opts.container, this.map, {
      buy: (item) => this.transport.send({ t: 'comprar', item: item as never }),
      changeCharacter: (c) => {
        this.transport.send({ t: 'personaje', character: c as CharacterId });
        this.hud.showBuyMenu(false);
      },
    });
    this.input = new InputManager(this.renderer.renderer.domElement);
    this.input.attach();
    this.input.onLockChange = (locked) => {
      if (!locked && !this.hud.buyVisible && !this.ended && !this.disposed) this.showPause(true);
      if (locked) this.showPause(false);
    };
    this.input.onKeyPress = (code) => this.onKey(code);

    this.self = this.makePlayerState();
    this.transport.onMessage = (msg) => this.onMessage(msg);
    this.transport.onClose = () => this.onTransportClosed();

    window.addEventListener('resize', this.onResize);
    this.pingTimer = window.setInterval(() => {
      this.transport.send({ t: 'ping', time: performance.now() });
    }, 2000);

    this.pauseOverlay = document.createElement('div');
    this.pauseOverlay.className = 'pause-overlay hidden';
    opts.container.appendChild(this.pauseOverlay);
    this.disconnectOverlay = document.createElement('div');
    this.disconnectOverlay.className = 'pause-overlay hidden';
    opts.container.appendChild(this.disconnectOverlay);

    audio.stopMusic();
    if (opts.modo === 'entrenamiento') this.hud.showTrainingHelp();
    this.input.requestLock();
    (window as unknown as { __pta?: GameClient }).__pta = this; // gancho de depuración/pruebas
    this.loop(performance.now());
  }

  /** Estado interno para pruebas automatizadas. */
  debugState(): {
    pos: Vec3; yaw: number; locked: boolean; pending: number;
    phase: string | undefined; serverPos: Vec3 | undefined;
    score: [number, number] | undefined; tick: number | undefined; vivos: [number, number] | undefined;
    myId: number;
  } {
    return {
      pos: { ...this.self.pos },
      yaw: this.self.yaw,
      locked: this.input.locked,
      pending: this.pending.length,
      phase: this.latest?.match.phase,
      serverPos: this.selfSnap()?.pos,
      score: this.latest?.match.score,
      tick: this.latest?.tick,
      vivos: this.latest?.vivos,
      myId: this.myId,
    };
  }

  /** Para pruebas: volver al menú limpiamente. */
  debugExit(): void {
    this.opts.onExit();
  }

  private makePlayerState(): PlayerState {
    const p = {
      id: this.myId, name: '', team: 0 as Team, character: 'pikachu' as CharacterId,
      isBot: false, botDifficulty: 'normal' as const, connected: true, controlledByBot: false,
      alive: true, hp: 100, shield: 0, credits: 0,
      weapon: 'pulso' as const, ammo: 16, reloadTicksLeft: 0, fireCooldown: 0, burstShots: 0, lastFireTick: -99,
      abilityCharges: 0, grenadeCharges: 0, defuseKit: false,
      pos: v3(0, 0, -20), vel: v3(), yaw: 0, pitch: 0,
      crouching: false, walking: false, aiming: false, onGround: true, slowFactor: 1,
      hasCore: false, interaction: null, flashEndTick: 0, prevButtons: 0,
      kills: 0, deaths: 0, assists: 0, damageDealt: 0, recentDamage: [],
      lastInputSeq: 0, lastAckTick: 0, stepPhase: 0,
    } satisfies PlayerState;
    return p;
  }

  private onResize = (): void => this.renderer.resize();

  private onKey(code: string): void {
    const b = settings.binds;
    if (code === b.comprar) {
      const selfSnap = this.selfSnap();
      if ((this.latest?.match.phase === 'prep' || this.opts.modo === 'entrenamiento') && selfSnap?.alive) {
        if (this.hud.buyVisible) {
          this.hud.showBuyMenu(false);
          this.input.requestLock();
        } else {
          document.exitPointerLock();
          setTimeout(() => this.refreshBuy(), 50);
        }
      }
    } else if (code === 'F3') {
      this.devVisible = !this.devVisible;
    } else if (code === 'F4') {
      this.renderer.debugHitboxes = !this.renderer.debugHitboxes;
    }
  }

  private refreshBuy(): void {
    const s = this.selfSnap();
    if (!s || !this.latest) return;
    const isDef = s.team !== this.latest.match.attackingTeam;
    this.hud.showBuyMenu(true, s, isDef);
  }

  private selfSnap(): SnapPlayer | undefined {
    return this.latest?.players.find((p) => p.id === this.myId);
  }

  // ===== Red =====

  setTransport(t: Transport): void {
    this.transport = t;
    t.onMessage = (msg) => this.onMessage(msg);
    t.onClose = () => this.onTransportClosed();
    this.disconnectOverlay.classList.add('hidden');
  }

  private onTransportClosed(): void {
    if (this.disposed || this.ended) return;
    if (!this.opts.reconnect) return;
    this.showDisconnect(`${STR.conexionPerdida} — ${STR.reconectando}`, false);
    void this.tryReconnect();
  }

  private async tryReconnect(): Promise<void> {
    const deadline = Date.now() + 55_000;
    while (Date.now() < deadline && !this.disposed) {
      const t = await this.opts.reconnect!();
      if (t) {
        this.setTransport(t);
        return;
      }
      await new Promise((r) => setTimeout(r, 2500));
    }
    if (!this.disposed) this.showDisconnect(STR.desconectado, true);
  }

  private showDisconnect(texto: string, final: boolean): void {
    this.disconnectOverlay.classList.remove('hidden');
    this.disconnectOverlay.innerHTML = `<div class="pause-box"><h2>${texto}</h2>${final ? `<button class="menu-btn" id="dc-exit">${STR.volverMenu}</button>` : '<div class="spinner"></div>'}</div>`;
    this.disconnectOverlay.querySelector<HTMLButtonElement>('#dc-exit')?.addEventListener('click', () => {
      this.opts.onExit();
    });
  }

  private onMessage(msg: import('@pta/shared').S2C): void {
    switch (msg.t) {
      case 'snap':
        this.onSnapshot(msg);
        break;
      case 'compraResultado':
        this.hud.buyToast(msg.ok, msg.ok ? `${STR.comprado} (${msg.credits} cr)` : msg.motivo ?? 'Rechazado');
        if (this.hud.buyVisible) setTimeout(() => this.refreshBuy(), 60);
        break;
      case 'pong':
        this.rtt = performance.now() - msg.time;
        break;
      case 'finPartida': {
        this.ended = true;
        const myTeam = (this.registry.get(this.myId)?.team ?? 0) as Team;
        const players = this.latest?.players ?? [];
        audio.fase(msg.ganador === 'empate' ? 'inicio' : msg.ganador === myTeam ? 'victoria' : 'derrota');
        setTimeout(() => {
          if (!this.disposed) this.opts.onResults(players, msg.score, msg.ganador, myTeam);
        }, 1600);
        break;
      }
      case 'error':
        this.hud.buyToast(false, msg.msg);
        break;
      default:
        break;
    }
  }

  private yawInitialized = false;

  private onSnapshot(snap: Snapshot): void {
    const prevPhase = this.latest?.match.phase;
    this.latest = snap;
    this.snaps.push({ snap, at: performance.now() });
    if (this.snaps.length > 40) this.snaps.shift();

    for (const p of snap.players) {
      const r = this.registry.get(p.id);
      if (r) {
        r.lastPos = p.pos;
        r.team = p.team;
        r.character = p.character;
        r.nombre = p.nombre;
      } else {
        this.registry.set(p.id, { nombre: p.nombre, team: p.team, character: p.character, lastPos: p.pos });
      }
    }

    const self = snap.players.find((p) => p.id === this.myId);
    if (self) {
      // Orientación inicial: mirar hacia donde mira el personaje al aparecer
      if (!this.yawInitialized || (snap.match.phase === 'prep' && prevPhase !== 'prep' && prevPhase !== undefined)) {
        this.yawInitialized = true;
        this.input.yaw = self.yaw;
        this.input.pitch = 0;
        this.self.yaw = self.yaw;
      }
      // Reconciliación: estado del servidor + replay de entradas pendientes
      this.self.pos = { ...self.pos };
      this.self.vel = { ...self.vel };
      this.self.crouching = self.crouching;
      this.self.onGround = true;
      this.self.slowFactor = 1;
      this.pending = this.pending.filter((i) => i.seq > snap.ackSeq);
      const doors = snap.match.phase === 'prep';
      for (const inp of this.pending) {
        this.applySlow();
        stepMovement(this.map, this.self, inp, doors);
      }
      this.localAmmo = self.ammo ?? this.localAmmo;
      this.localReload = self.reloadTicksLeft ?? 0;
      this.self.weapon = (self.weapon ?? 'pulso');
      this.renderer.setFirstPersonCharacter(self.character);
      if (!self.alive && this.spectateId === null && this.opts.modo !== 'entrenamiento') {
        this.pickSpectate(1);
      }
      if (self.alive) {
        this.spectateId = null;
        this.hud.setSpectator(null);
      }
    }

    // Eventos
    for (const e of snap.events) {
      this.handleEvent(e);
    }

    // Transiciones de fase visibles
    const phase = snap.match.phase;
    if (phase !== prevPhase) {
      if (phase === 'prep') {
        this.hud.centerMessage(`${STR.ronda} ${snap.match.roundNumber} · ${STR.preparacion}`, 'Pulsa B para comprar');
        if (snap.match.roundNumber === 1 && snap.match.half === 2) {
          this.hud.centerMessage(STR.cambioMitad, 'Pulsa B para comprar', 3200);
        }
        this.hud.showBuyMenu(false);
      } else if (phase === 'active') {
        this.hud.centerMessage(STR.rondaActiva);
        audio.fase('inicio');
        this.hud.showBuyMenu(false);
      }
      this.renderer.setDoorsClosed(phase === 'prep');
    }
  }

  private handleEvent(e: Snapshot['events'][number]): void {
    switch (e.e) {
      case 'trazo':
        this.lastFireAt.set(e.shooter, this.time);
        if (e.shooter !== this.myId) {
          this.renderer.spawnTracer(e.from, e.to, e.char);
        }
        break;
      case 'sonido': {
        const own = e.actor === this.myId;
        const pos: [number, number, number] = [e.pos.x, e.pos.y + 1, e.pos.z];
        switch (e.tipo) {
          case 'disparo':
            if (!own) {
              const reg = this.registry.get(e.actor);
              audio.disparo('pulso', reg?.character ?? 'pikachu', pos);
            }
            break;
          case 'pasos': if (!own) audio.pasos(pos); break;
          case 'salto': if (!own) audio.salto(pos); break;
          case 'recarga': if (!own) audio.recarga(pos); else audio.recarga(); break;
          case 'instalacion':
          case 'desactivacion':
            this.lastInteractAt.set(e.actor, this.time);
            audio.interaccion(e.tipo, own ? undefined : pos);
            break;
          case 'explosion': audio.explosion(pos); break;
          case 'despliegue':
            this.lastThrowAt.set(e.actor, this.time);
            if (!own) audio.despliegue(pos);
            break;
          case 'nucleo': break;
        }
        break;
      }
      case 'impacto':
        if (e.shooter === this.myId) {
          audio.impacto(e.headshot);
          this.hud.setCrosshairSpread(14);
        }
        if (e.target === this.myId) {
          this.hud.damagePulse();
          audio.danoRecibido();
        }
        break;
      case 'destello':
        if (e.victim === this.myId) audio.destelloPersonal();
        break;
      case 'baja': {
        const k = this.registry.get(e.killer);
        const v = this.registry.get(e.victim);
        const a = e.assist !== null ? this.registry.get(e.assist)?.nombre ?? null : null;
        this.hud.addKill(k?.nombre ?? '—', v?.nombre ?? '—', (k?.team ?? 0) as Team, e.headshot, a);
        if (v) this.renderer.deathEffect(v.lastPos, v.character);
        if (e.killer === this.myId) audio.baja();
        if (e.victim === this.myId) {
          audio.danoRecibido();
          this.hud.centerMessage('Debilitado', 'Observando a tu equipo hasta la próxima ronda');
        }
        break;
      }
      case 'fase':
        if (e.fase === 'resolve' && e.ganador !== undefined && e.ganador !== null) {
          const myTeam = this.registry.get(this.myId)?.team ?? 0;
          const win = e.ganador === myTeam;
          this.hud.centerMessage(
            win ? `${STR.victoriaRonda} ${e.ganador === 0 ? 'Azul' : 'Naranja'} ✔` : `${STR.victoriaRonda} ${e.ganador === 0 ? 'Azul' : 'Naranja'}`,
            e.motivo === 'nucleo_detonado' ? 'Descarga del núcleo completada' : e.motivo === 'nucleo_desactivado' ? STR.nucleoDesactivado : '',
            3000,
          );
          audio.fase(win ? 'victoria' : 'derrota');
        }
        break;
      case 'instalado':
        this.hud.centerMessage(STR.nucleoInstalado, `${e.site === 'A' ? STR.sitioA : STR.sitioB} · 35 s`, 2800);
        audio.fase('instalado');
        break;
      case 'desactivado':
        this.hud.centerMessage(STR.nucleoDesactivado, '', 2200);
        break;
      case 'nucleoSuelto':
        this.hud.centerMessage(STR.nucleoSoltado, '', 1500);
        break;
      case 'nucleoRecogido':
        if (e.por === this.myId) this.hud.centerMessage(STR.llevasNucleo, 'E para instalar en A o B', 2200);
        break;
      default:
        break;
    }
  }

  // ===== Bucle principal =====

  private loop = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.frameMs = this.frameMs * 0.95 + (now - this.last) * 0.05;
    this.fps = this.fps * 0.95 + (dt > 0 ? 1 / dt : 60) * 0.05;
    this.last = now;
    this.time += dt;
    this.acc += dt * 1000;
    while (this.acc >= TICK_MS) {
      this.acc -= TICK_MS;
      this.fixedStep();
    }
    this.render(dt);
  };

  private fixedStep(): void {
    if (!this.latest) return;
    const selfSnap = this.selfSnap();
    const alive = selfSnap?.alive ?? true;
    const sample = this.input.sample();

    if (!alive) {
      // Espectador: clic cambia de aliado
      const fire = (sample.buttons & BTN.FIRE) !== 0;
      if (fire && !this.prevMouseFire) this.pickSpectate(1);
      this.prevMouseFire = fire;
      return;
    }

    const inp: PlayerInput = {
      ...defaultInput(++this.seq),
      moveX: sample.moveX,
      moveZ: sample.moveZ,
      yaw: sample.yaw,
      pitch: sample.pitch,
      buttons: this.hud.buyVisible ? 0 : sample.buttons,
      ackTick: this.latest.tick,
    };
    const doors = this.latest.match.phase === 'prep';
    this.applySlow();
    stepMovement(this.map, this.self, inp, doors);
    this.pending.push(inp);
    if (this.pending.length > 120) this.pending.shift();
    this.sendBuffer.push(inp);
    if (this.sendBuffer.length >= 2) {
      this.transport.send({ t: 'input', inputs: this.sendBuffer });
      this.sendBuffer = [];
    }

    // Predicción de disparo (efectos locales inmediatos)
    if (this.localCooldown > 0) this.localCooldown--;
    if (this.localReload > 0) this.localReload--;
    const phase = this.latest.match.phase;
    const canFire = (phase === 'active' || phase === 'planted') && this.localAmmo > 0 && this.localCooldown <= 0 && this.localReload <= 0;
    if ((inp.buttons & BTN.FIRE) !== 0 && canFire) {
      const w = WEAPONS[this.self.weapon];
      this.localAmmo--;
      this.localCooldown = fireCooldownTicks(this.self.weapon, TICK_RATE);
      this.renderer.fireRecoil(w.retrocesoVisual * (settings.movimientoReducido ? 0.3 : 1));
      audio.disparo(this.self.weapon, selfSnap?.character ?? 'pikachu');
      // Trazo local contra la geometría
      const eye = this.eyePos();
      const dir = lookDir(this.self.yaw, this.self.pitch);
      const hit = raycastMap(this.map, eye, dir, w.alcance, doors);
      const d = hit ? hit.dist : w.alcance;
      this.renderer.spawnTracer(
        { x: eye.x + dir.x * 0.4, y: eye.y - 0.15, z: eye.z + dir.z * 0.4 },
        { x: eye.x + dir.x * d, y: eye.y + dir.y * d, z: eye.z + dir.z * d },
        selfSnap?.character ?? 'pikachu',
      );
    }
    if ((inp.buttons & BTN.RELOAD) !== 0 && this.localReload <= 0 && this.localAmmo < WEAPONS[this.self.weapon].cargador) {
      this.localReload = Math.round(WEAPONS[this.self.weapon].recargaS * TICK_RATE);
    }
  }

  private applySlow(): void {
    this.self.slowFactor = 1;
    if (!this.latest) return;
    const myTeam = this.registry.get(this.myId)?.team ?? 0;
    for (const z of this.latest.zones) {
      if (z.type === 'esporas' && z.team !== myTeam && vdistXZ(this.self.pos, z.pos) <= z.radius && Math.abs(this.self.pos.y - z.pos.y) < 2) {
        this.self.slowFactor = 0.65;
      }
    }
  }

  private eyePos(): Vec3 {
    return v3(this.self.pos.x, this.self.pos.y + (this.self.crouching ? CAMERA_HEIGHT_CROUCH : CAMERA_HEIGHT), this.self.pos.z);
  }

  private pickSpectate(dirStep: number): void {
    if (!this.latest) return;
    const myTeam = this.registry.get(this.myId)?.team ?? 0;
    const allies = this.latest.players.filter((p) => p.team === myTeam && p.alive && p.id !== this.myId);
    if (allies.length === 0) {
      this.spectateId = null;
      this.hud.setSpectator(null);
      return;
    }
    const idx = allies.findIndex((p) => p.id === this.spectateId);
    const next = allies[(idx + dirStep + allies.length) % allies.length];
    this.spectateId = next.id;
    this.hud.setSpectator(next.nombre);
  }

  // ===== Render =====

  private interpolated(): { views: PlayerView[]; specView: { pos: Vec3; yaw: number; pitch: number } | null } {
    const views: PlayerView[] = [];
    let specView: { pos: Vec3; yaw: number; pitch: number } | null = null;
    if (this.snaps.length === 0 || !this.latest) return { views, specView };
    const newest = this.snaps[this.snaps.length - 1];
    const rt = newest.snap.tick - INTERP_TICKS + ((performance.now() - newest.at) / TICK_MS);
    const renderTick = Math.min(newest.snap.tick, rt);

    const ids = new Set<number>();
    for (const p of newest.snap.players) ids.add(p.id);

    for (const id of ids) {
      // Buscar las dos instantáneas que acotan renderTick para este jugador
      let before: { tick: number; p: SnapPlayer } | null = null;
      let after: { tick: number; p: SnapPlayer } | null = null;
      for (let i = this.snaps.length - 1; i >= 0 && i >= this.snaps.length - 12; i--) {
        const s = this.snaps[i].snap;
        const p = s.players.find((q) => q.id === id);
        if (!p) continue;
        if (s.tick >= renderTick) after = { tick: s.tick, p };
        else {
          before = { tick: s.tick, p };
          break;
        }
      }
      const target = after ?? before;
      if (!target) continue;
      let pos = target.p.pos;
      let yaw = target.p.yaw;
      let pitch = target.p.pitch;
      if (before && after && after.tick > before.tick) {
        const t = Math.max(0, Math.min(1, (renderTick - before.tick) / (after.tick - before.tick)));
        pos = {
          x: before.p.pos.x + (after.p.pos.x - before.p.pos.x) * t,
          y: before.p.pos.y + (after.p.pos.y - before.p.pos.y) * t,
          z: before.p.pos.z + (after.p.pos.z - before.p.pos.z) * t,
        };
        yaw = before.p.yaw + angleDiff(after.p.yaw, before.p.yaw) * t;
        pitch = before.p.pitch + (after.p.pitch - before.p.pitch) * t;
      }
      const p = target.p;
      const speed = Math.min(1, Math.hypot(p.vel.x, p.vel.z) / 4.5);
      views.push({
        id, character: p.character, team: p.team, pos, yaw, speed,
        crouching: p.crouching, alive: p.alive, hasCore: p.hasCore,
        firing: this.time - (this.lastFireAt.get(id) ?? -9) < 0.15,
        reloading: (p.reloadTicksLeft ?? 0) > 0,
        throwing: this.time - (this.lastThrowAt.get(id) ?? -9) < 0.3,
        interacting: (p.interactTicksLeft ?? 0) > 0 || this.time - (this.lastInteractAt.get(id) ?? -9) < 0.6,
        esBot: p.esBot, nombre: p.nombre,
      });
      if (this.spectateId === id) {
        specView = { pos: v3(pos.x, pos.y + (p.crouching ? CAMERA_HEIGHT_CROUCH : CAMERA_HEIGHT), pos.z), yaw, pitch };
      }
    }
    return { views, specView };
  }

  private render(dt: number): void {
    if (!this.latest) return;
    const snap = this.latest;
    const selfSnap = this.selfSnap();
    const alive = selfSnap?.alive ?? true;
    const { views, specView } = this.interpolated();

    const hideId = alive || this.spectateId === null ? this.myId : this.spectateId;
    const myTeam = this.registry.get(this.myId)?.team ?? 0;
    this.renderer.setFirstPersonVisible(alive);
    this.renderer.updatePlayers(views.filter((vv) => vv.id !== hideId || !vv.alive), hideId, this.time, myTeam);
    this.renderer.updateZones(snap.zones, snap.tick, this.time);
    this.renderer.updateProjectiles(snap.projectiles);

    // Núcleo
    const carrier = snap.core.carrier;
    let carrierPos: Vec3 | null = null;
    if (carrier === this.myId) carrierPos = this.self.pos;
    else if (carrier !== null && carrier >= 0) {
      const cv = views.find((vv) => vv.id === carrier);
      if (cv) carrierPos = cv.pos;
    }
    this.renderer.updateCore(snap.core, carrierPos, this.time);

    // Pulsos del núcleo instalado
    if (snap.match.phase === 'planted') {
      this.beepIn -= dt;
      if (this.beepIn <= 0) {
        const frac = snap.match.phaseTicksLeft / (35 * TICK_RATE);
        const interval = 0.15 + frac * 0.85;
        this.beepIn = interval;
        audio.nucleoPulso(1 - frac, [snap.core.pos.x, snap.core.pos.y + 0.5, snap.core.pos.z]);
      }
    }

    // Cámara
    let camPos: Vec3;
    let yaw: number;
    let pitch: number;
    if (alive) {
      camPos = this.eyePos();
      yaw = this.self.yaw;
      pitch = this.self.pitch;
    } else if (specView) {
      camPos = specView.pos;
      yaw = specView.yaw;
      pitch = specView.pitch;
    } else {
      camPos = v3(this.self.pos.x, this.self.pos.y + 2.2, this.self.pos.z);
      yaw = this.self.yaw;
      pitch = -0.5;
    }
    audio.setListener(camPos.x, camPos.y, camPos.z, -Math.sin(yaw), -Math.cos(yaw));

    // FOV: concentración de apuntado −10°
    const baseFov = settings.fov;
    this.renderer.setFov(this.self.aiming && alive ? baseFov - 10 : baseFov);
    this.renderer.render(camPos, yaw, pitch, dt);

    // HUD
    this.hud.update(snap, selfSnap, this.myId);
    const corePos = snap.core.planted || snap.core.carrier === null
      ? (snap.core.pos.y > -50 ? { x: snap.core.pos.x, z: snap.core.pos.z } : null)
      : carrierPos ? { x: carrierPos.x, z: carrierPos.z } : null;
    this.hud.drawMinimap(snap.players, snap.markers, this.myId, (selfSnap?.team ?? 0) as Team, snap.zones, corePos);
    this.hud.showScoreboard(this.input.held(settings.binds.marcador), snap.players, snap.match);

    // Dispersión en retícula
    if (selfSnap) {
      this.self.weapon = selfSnap.weapon ?? this.self.weapon;
      const spread = currentSpreadDeg(this.self);
      this.hud.setCrosshairSpread(4 + spread * 10);
    }

    if (this.devVisible) {
      const st = this.renderer.stats();
      this.hud.setDevOverlay(true,
        `FPS ${this.fps.toFixed(0)} · frame ${this.frameMs.toFixed(1)} ms · ping ${this.rtt.toFixed(0)} ms · tick ${snap.tick} · ` +
        `entidades ${snap.players.length + snap.zones.length + snap.projectiles.length} · draw calls ${st.drawCalls} · tris ${st.triangles}`);
    } else {
      this.hud.setDevOverlay(false);
    }
  }

  // ===== Pausa =====

  private showPause(show: boolean): void {
    this.pauseOverlay.classList.toggle('hidden', !show);
    if (!show) {
      this.pauseOverlay.innerHTML = '';
      return;
    }
    this.pauseOverlay.innerHTML = `<div class="pause-box">
      <h2>${STR.titulo}</h2>
      <button class="menu-btn" id="p-resume">${STR.continuar}</button>
      <button class="menu-btn" id="p-settings">${STR.ajustes}</button>
      <button class="menu-btn danger" id="p-exit">${STR.volverMenu}</button>
    </div>`;
    this.pauseOverlay.querySelector('#p-resume')!.addEventListener('click', () => {
      this.showPause(false);
      this.input.requestLock();
    });
    this.pauseOverlay.querySelector('#p-exit')!.addEventListener('click', () => this.opts.onExit());
    this.pauseOverlay.querySelector('#p-settings')!.addEventListener('click', () => {
      const box = this.pauseOverlay.querySelector('.pause-box') as HTMLElement;
      box.innerHTML = '';
      buildSettingsPanel(box, () => {
        persist();
        this.renderer.applyQuality();
        this.renderer.resize();
        audio.applyVolumes();
        this.showPause(true);
      });
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    clearInterval(this.pingTimer);
    window.removeEventListener('resize', this.onResize);
    this.input.detach();
    this.hud.dispose();
    this.renderer.dispose();
    this.pauseOverlay.remove();
    this.disconnectOverlay.remove();
    this.transport.onMessage = null;
    this.transport.onClose = null;
    this.transport.close();
  }
}
