import type { EnemyMarker, MapDef, MatchState, SnapPlayer, Snapshot, Team, WeaponId, ZoneState } from '@pta/shared';
import { CHARACTER_INFO, STR, TICK_RATE, WEAPONS, inRect } from '@pta/shared';
import { settings } from './settings.js';

function el(tag: string, cls: string, parent: HTMLElement): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  parent.appendChild(e);
  return e;
}

export interface BuyHandler {
  buy(item: string): void;
  changeCharacter(char: string): void;
}

export class Hud {
  root: HTMLElement;
  private hpBar: HTMLElement;
  private hpText: HTMLElement;
  private shieldBar: HTMLElement;
  private weaponText: HTMLElement;
  private ammoText: HTMLElement;
  private utilText: HTMLElement;
  private timerText: HTMLElement;
  private scoreBlue: HTMLElement;
  private scoreOrange: HTMLElement;
  private aliveText: HTMLElement;
  private roundText: HTMLElement;
  private killfeed: HTMLElement;
  private centerMsg: HTMLElement;
  private subMsg: HTMLElement;
  private interactWrap: HTMLElement;
  private interactBar: HTMLElement;
  private interactLabel: HTMLElement;
  private flashOverlay: HTMLElement;
  private damageOverlay: HTMLElement;
  private crosshair: HTMLElement;
  private scoreboard: HTMLElement;
  private buyMenu: HTMLElement;
  private buyStatus: HTMLElement;
  private spectatorBanner: HTMLElement;
  private devOverlay: HTMLElement;
  private minimapCanvas: HTMLCanvasElement;
  private minimapBg: HTMLCanvasElement;
  private map: MapDef;
  private centerTimeout = 0;
  buyVisible = false;
  private buyHandler: BuyHandler;
  private myTeam: Team = 0;

  constructor(parent: HTMLElement, map: MapDef, buyHandler: BuyHandler) {
    this.map = map;
    this.buyHandler = buyHandler;
    this.root = el('div', 'hud', parent);

    // Retícula central
    this.crosshair = el('div', 'crosshair', this.root);
    this.crosshair.innerHTML = '<span></span>';

    // Superior: tiempo, marcador, supervivientes
    const top = el('div', 'hud-top', this.root);
    this.scoreBlue = el('div', 'score blue', top);
    const mid = el('div', 'hud-top-mid', top);
    this.timerText = el('div', 'timer', mid);
    this.roundText = el('div', 'round-label', mid);
    this.aliveText = el('div', 'alive', mid);
    this.scoreOrange = el('div', 'score orange', top);

    // Minimapa arriba a la izquierda
    const mmWrap = el('div', 'minimap', this.root);
    this.minimapCanvas = document.createElement('canvas');
    this.minimapCanvas.width = 200;
    this.minimapCanvas.height = 150;
    mmWrap.appendChild(this.minimapCanvas);
    this.minimapBg = document.createElement('canvas');
    this.minimapBg.width = 200;
    this.minimapBg.height = 150;
    this.renderMinimapBase();

    // Eliminaciones arriba a la derecha
    this.killfeed = el('div', 'killfeed', this.root);

    // Abajo izquierda: PV / escudo
    const bl = el('div', 'hud-bl', this.root);
    const hpRow = el('div', 'bar-row', bl);
    this.hpText = el('div', 'bar-num', hpRow);
    const hpOuter = el('div', 'bar hp', hpRow);
    this.hpBar = el('div', 'bar-fill', hpOuter);
    const shRow = el('div', 'bar-row', bl);
    el('div', 'bar-num small', shRow).textContent = '🛡';
    const shOuter = el('div', 'bar shield', shRow);
    this.shieldBar = el('div', 'bar-fill', shOuter);

    // Abajo derecha: ataque, cargador, utilidad
    const br = el('div', 'hud-br', this.root);
    this.weaponText = el('div', 'weapon', br);
    this.ammoText = el('div', 'ammo', br);
    this.utilText = el('div', 'util', br);

    // Mensajes centrales
    this.centerMsg = el('div', 'center-msg', this.root);
    this.subMsg = el('div', 'sub-msg', this.root);

    // Progreso de interacción
    this.interactWrap = el('div', 'interact', this.root);
    this.interactLabel = el('div', 'interact-label', this.interactWrap);
    const io = el('div', 'bar interact-bar', this.interactWrap);
    this.interactBar = el('div', 'bar-fill', io);

    // Overlays
    this.flashOverlay = el('div', 'flash-overlay', this.root);
    this.damageOverlay = el('div', 'damage-overlay', this.root);
    this.spectatorBanner = el('div', 'spectator', this.root);

    // Marcador (Tab)
    this.scoreboard = el('div', 'scoreboard hidden', this.root);

    // Menú de compra
    this.buyMenu = el('div', 'buymenu hidden', this.root);
    this.buyStatus = el('div', 'buy-status', this.root);

    // Overlay de desarrollo
    this.devOverlay = el('div', 'dev-overlay hidden', this.root);
  }

  /** Resumen de controles para el campo de entrenamiento. */
  showTrainingHelp(): void {
    const help = el('div', 'training-help', this.root);
    help.innerHTML = `<b>${STR.entrenamiento}</b><br>
      WASD mover · ratón apuntar · clic izq. atacar · clic der. concentrar<br>
      R recargar · Q habilidad · G niebla · E instalar/desactivar · B compra libre<br>
      Muñecos: 3 estáticos y 2 móviles · Núcleo de práctica en las zonas A/B`;
  }

  // ===== Minimapa =====

  private mmScale(): { sx: number; sz: number; ox: number; oz: number } {
    const b = this.map.bounds;
    const sx = this.minimapCanvas.width / (b.x1 - b.x0);
    const sz = this.minimapCanvas.height / (b.z1 - b.z0);
    return { sx, sz, ox: -b.x0, oz: -b.z0 };
  }

  private renderMinimapBase(): void {
    const ctx = this.minimapBg.getContext('2d')!;
    const { sx, sz, ox, oz } = this.mmScale();
    ctx.fillStyle = 'rgba(16,24,34,0.85)';
    ctx.fillRect(0, 0, 200, 150);
    ctx.fillStyle = 'rgba(190,205,220,0.8)';
    for (const s of this.map.solids) {
      if (s.door || s.max.y - s.min.y < 1 || s.min.y > 0.5) continue;
      ctx.fillRect((s.min.x + ox) * sx, (s.min.z + oz) * sz, (s.max.x - s.min.x) * sx, (s.max.z - s.min.z) * sz);
    }
    ctx.fillStyle = '#ffb13d';
    ctx.font = 'bold 13px system-ui';
    for (const site of this.map.sites) {
      ctx.fillText(site.id, (site.center.x + ox) * sx - 4, (site.center.z + oz) * sz + 4);
    }
  }

  drawMinimap(
    players: SnapPlayer[], markers: EnemyMarker[], myId: number, myTeam: Team,
    zones: ZoneState[], corePos: { x: number; z: number } | null,
  ): void {
    const ctx = this.minimapCanvas.getContext('2d')!;
    const { sx, sz, ox, oz } = this.mmScale();
    ctx.clearRect(0, 0, 200, 150);
    ctx.drawImage(this.minimapBg, 0, 0);
    const pt = (x: number, z: number): [number, number] => [(x + ox) * sx, (z + oz) * sz];
    for (const z of zones) {
      if (z.type === 'cortina' || z.type === 'niebla') ctx.fillStyle = 'rgba(220,230,240,0.5)';
      else if (z.type === 'ascua') ctx.fillStyle = 'rgba(255,122,47,0.5)';
      else ctx.fillStyle = 'rgba(121,214,92,0.5)';
      const [x, y] = pt(z.pos.x, z.pos.z);
      ctx.beginPath();
      ctx.arc(x, y, z.radius * sx, 0, Math.PI * 2);
      ctx.fill();
    }
    if (corePos) {
      const [x, y] = pt(corePos.x, corePos.z);
      ctx.fillStyle = '#53e0e8';
      ctx.fillRect(x - 3, y - 3, 6, 6);
    }
    for (const m of markers) {
      const alpha = 1 - m.ageTicks / (2 * TICK_RATE);
      ctx.fillStyle = `rgba(255,90,90,${Math.max(0.2, alpha)})`;
      const [x, y] = pt(m.pos.x, m.pos.z);
      ctx.beginPath();
      ctx.arc(x, y, 3.4, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const p of players) {
      if (!p.alive) continue;
      const [x, y] = pt(p.pos.x, p.pos.z);
      const ally = p.team === myTeam;
      if (p.id === myId) {
        ctx.fillStyle = '#ffffff';
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(-p.yaw);
        ctx.beginPath();
        ctx.moveTo(0, -6);
        ctx.lineTo(4, 4);
        ctx.lineTo(-4, 4);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else {
        ctx.fillStyle = ally ? (p.team === 0 ? '#6fa8ff' : '#ffb36b') : '#ff5a5a';
        ctx.beginPath();
        ctx.arc(x, y, 3.4, 0, Math.PI * 2);
        ctx.fill();
        if (ally) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }
  }

  // ===== Estado principal =====

  update(snap: Snapshot, self: SnapPlayer | undefined, myId: number): void {
    const m = snap.match;
    this.myTeam = (self?.team ?? 0) as Team;
    const secs = Math.max(0, Math.ceil(m.phaseTicksLeft / TICK_RATE));
    const mm = Math.floor(secs / 60);
    const ss = (secs % 60).toString().padStart(2, '0');
    this.timerText.textContent = `${mm}:${ss}`;
    this.timerText.classList.toggle('planted', m.phase === 'planted');
    this.scoreBlue.textContent = `${STR.equipoAzul.split(' ')[1]} ${m.score[0]}`;
    this.scoreOrange.textContent = `${m.score[1]} ${STR.equipoNaranja.split(' ')[1]}`;
    const phaseName = m.phase === 'prep' ? STR.preparacion : m.phase === 'planted' ? STR.nucleoInstalado : '';
    this.roundText.textContent = `${STR.ronda} ${m.roundNumber} · ${m.half}ª mitad ${phaseName ? '· ' + phaseName : ''}`;

    if (self) {
      const hp = self.hp ?? 0;
      this.hpText.textContent = String(hp);
      this.hpBar.style.width = `${hp}%`;
      this.hpBar.classList.toggle('low', hp <= 30);
      this.shieldBar.style.width = `${((self.shield ?? 0) / 50) * 100}%`;
      const w = WEAPONS[(self.weapon ?? 'pulso') as WeaponId];
      this.weaponText.textContent = w.nombre;
      this.ammoText.textContent = (self.reloadTicksLeft ?? 0) > 0 ? '···' : `${self.ammo ?? 0} / ${w.cargador}`;
      const util: string[] = [];
      if ((self.abilityCharges ?? 0) > 0) util.push(`Q ${CHARACTER_INFO[self.character].habilidad}`);
      if ((self.grenadeCharges ?? 0) > 0) util.push('G Niebla');
      if (self.defuseKit) util.push('Kit');
      if (self.hasCore) util.push(`◆ ${STR.llevasNucleo}`);
      this.utilText.textContent = util.join('  ·  ');
      this.utilText.classList.toggle('core', self.hasCore);
    }

    // Supervivientes (recuento autoritativo, sin revelar posiciones)
    this.aliveText.textContent = `${snap.vivos[0]} — ${snap.vivos[1]} ${STR.supervivientes}`;

    // Interacción propia
    if (self && (self.interactTicksLeft ?? 0) > 0 && self.interactTotal) {
      this.interactWrap.classList.add('visible');
      this.interactLabel.textContent = snap.match.phase === 'planted' ? STR.desactivando : STR.instalando;
      this.interactBar.style.width = `${(1 - self.interactTicksLeft! / self.interactTotal) * 100}%`;
    } else {
      this.interactWrap.classList.remove('visible');
    }

    // Destello propio
    const flash = self?.flashTicksLeft ?? 0;
    if (flash > 0) {
      const op = Math.min(1, flash / 30);
      this.flashOverlay.style.background = settings.destelloAccesible ? '#05080c' : '#ffffff';
      this.flashOverlay.style.opacity = String(op);
    } else {
      this.flashOverlay.style.opacity = '0';
    }
    void myId;
  }

  setCrosshairSpread(px: number): void {
    this.crosshair.style.setProperty('--spread', `${px.toFixed(1)}px`);
  }

  damagePulse(): void {
    this.damageOverlay.style.opacity = '0.55';
    setTimeout(() => { this.damageOverlay.style.opacity = '0'; }, 160);
  }

  centerMessage(text: string, sub = '', ms = 2400): void {
    this.centerMsg.textContent = text;
    this.subMsg.textContent = sub;
    this.centerMsg.classList.add('visible');
    this.subMsg.classList.toggle('visible', sub !== '');
    clearTimeout(this.centerTimeout);
    this.centerTimeout = window.setTimeout(() => {
      this.centerMsg.classList.remove('visible');
      this.subMsg.classList.remove('visible');
    }, ms);
  }

  addKill(killer: string, victim: string, killerTeam: Team, headshot: boolean, assist: string | null): void {
    const row = document.createElement('div');
    row.className = 'kill-row';
    const k = document.createElement('span');
    k.className = killerTeam === 0 ? 'team-blue' : 'team-orange';
    k.textContent = killer + (assist ? ` + ${assist}` : '');
    const mid = document.createElement('span');
    mid.textContent = headshot ? ' ⦿ ' : ' ▸ ';
    const v = document.createElement('span');
    v.className = killerTeam === 0 ? 'team-orange' : 'team-blue';
    v.textContent = victim;
    row.append(k, mid, v);
    this.killfeed.prepend(row);
    while (this.killfeed.children.length > 5) this.killfeed.lastChild?.remove();
    setTimeout(() => row.remove(), 5000);
  }

  setSpectator(name: string | null): void {
    if (name) {
      this.spectatorBanner.textContent = `${STR.spectating} ${name} · ${STR.cambiaConFuego}`;
      this.spectatorBanner.classList.add('visible');
    } else {
      this.spectatorBanner.classList.remove('visible');
    }
  }

  // ===== Marcador =====

  showScoreboard(show: boolean, players?: SnapPlayer[], match?: MatchState): void {
    this.scoreboard.classList.toggle('hidden', !show);
    if (!show || !players || !match) return;
    const rows = (team: Team): string =>
      players
        .filter((p) => p.team === team)
        .sort((a, b) => (b.kills ?? 0) - (a.kills ?? 0))
        .map((p) => `<tr${p.alive ? '' : ' class="dead"'}><td>${p.esBot ? '🤖 ' : ''}${esc(p.nombre)}</td><td>${p.kills ?? 0}</td><td>${p.deaths ?? 0}</td><td>${p.assists ?? 0}</td><td>${p.damageDealt ?? 0}</td></tr>`)
        .join('');
    this.scoreboard.innerHTML = `
      <h3>${STR.marcador} — ${match.score[0]} : ${match.score[1]}</h3>
      <div class="sb-cols">
        <table class="blue"><thead><tr><th>${STR.equipoAzul}</th><th>B</th><th>M</th><th>A</th><th>${STR.dano}</th></tr></thead><tbody>${rows(0)}</tbody></table>
        <table class="orange"><thead><tr><th>${STR.equipoNaranja}</th><th>B</th><th>M</th><th>A</th><th>${STR.dano}</th></tr></thead><tbody>${rows(1)}</tbody></table>
      </div>`;
  }

  // ===== Compra =====

  showBuyMenu(show: boolean, self?: SnapPlayer, isDefender?: boolean): void {
    this.buyVisible = show;
    this.buyMenu.classList.toggle('hidden', !show);
    if (!show || !self) return;
    const credits = self.credits ?? 0;
    const item = (id: string, nombre: string, precio: number, owned: boolean, disabled: boolean): string =>
      `<button class="buy-item" data-item="${id}" ${owned || disabled || credits < precio ? 'disabled' : ''}>
         <span>${nombre}</span><span class="price">${owned ? STR.equipado : precio === 0 ? '—' : precio + ' cr'}</span>
       </button>`;
    const charBtns = (['pikachu', 'charmander', 'squirtle', 'bulbasaur'] as const)
      .map((c) => `<button class="char-btn ${self.character === c ? 'sel' : ''}" data-char="${c}">${CHARACTER_INFO[c].nombre}</button>`)
      .join('');
    this.buyMenu.innerHTML = `
      <h3>${STR.compra} · <span class="credits">${credits} cr</span></h3>
      <div class="buy-grid">
        ${item('rafaga', WEAPONS.rafaga.nombre, WEAPONS.rafaga.precio, self.weapon === 'rafaga', false)}
        ${item('preciso', WEAPONS.preciso.nombre, WEAPONS.preciso.precio, self.weapon === 'preciso', false)}
        ${item('escudo', 'Escudo (50)', 650, (self.shield ?? 0) >= 50, false)}
        ${item('habilidad', `Q · ${CHARACTER_INFO[self.character].habilidad}`, 400, (self.abilityCharges ?? 0) > 0, false)}
        ${item('granada', 'G · Granada de niebla', 300, (self.grenadeCharges ?? 0) > 0, false)}
        ${item('kit', 'Kit de desactivación', 400, self.defuseKit === true, !isDefender)}
      </div>
      <div class="char-row">${charBtns}</div>
      <p class="buy-hint">${STR.comprarFueraDeFase.replace('Solo se compra', 'Solo disponible')} · B para cerrar</p>`;
    this.buyMenu.querySelectorAll<HTMLButtonElement>('.buy-item').forEach((b) => {
      b.onclick = () => this.buyHandler.buy(b.dataset.item!);
    });
    this.buyMenu.querySelectorAll<HTMLButtonElement>('.char-btn').forEach((b) => {
      b.onclick = () => {
        if ((self.abilityCharges ?? 0) > 0 && b.dataset.char !== self.character) {
          if (!confirm(STR.cambioPersonajeAviso)) return;
        }
        this.buyHandler.changeCharacter(b.dataset.char!);
      };
    });
  }

  buyToast(ok: boolean, texto: string): void {
    this.buyStatus.textContent = texto;
    this.buyStatus.className = `buy-status visible ${ok ? 'ok' : 'bad'}`;
    setTimeout(() => this.buyStatus.classList.remove('visible'), 1800);
  }

  canBuyHere(selfPos: { x: number; z: number }, isAttacker: boolean): boolean {
    const zone = isAttacker ? this.map.attackerSpawn.zone : this.map.defenderSpawn.zone;
    return inRect(zone, selfPos.x, selfPos.z);
  }

  // ===== Overlay de desarrollo =====

  setDevOverlay(visible: boolean, text?: string): void {
    this.devOverlay.classList.toggle('hidden', !visible);
    if (text) this.devOverlay.textContent = text;
  }

  dispose(): void {
    this.root.remove();
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
