import * as THREE from 'three';
import {
  CHARACTERS, CHARACTER_INFO, CharacterId, LobbyState, S2C, SnapPlayer, STR, Team,
} from '@pta/shared';
import { createCharacterModel, CharacterModel } from './models.js';
import { GameClient } from './game.js';
import { Transport, WSTransport, WorkerTransport, wsUrl } from './net.js';
import { settings, persist } from './settings.js';
import { buildSettingsPanel } from './settingsUI.js';
import { audio } from './audio.js';

/** Visor 3D sencillo para menú y selección de personaje. */
class ModelViewer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private model: CharacterModel | null = null;
  private raf = 0;
  private t = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.setSize(canvas.clientWidth || 300, canvas.clientHeight || 300, false);
    this.camera = new THREE.PerspectiveCamera(40, (canvas.clientWidth || 300) / (canvas.clientHeight || 300), 0.1, 20);
    this.camera.position.set(0, 1.1, 2.6);
    this.camera.lookAt(0, 0.7, 0);
    this.scene.add(new THREE.HemisphereLight(0xdfeaff, 0x8a8172, 1.1));
    const d = new THREE.DirectionalLight(0xfff1d6, 1.3);
    d.position.set(2, 3, 2);
    this.scene.add(d);
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(0.9, 32),
      new THREE.MeshStandardMaterial({ color: 0x2b3a4d, roughness: 0.9 }),
    );
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
    this.loop();
  }

  setCharacter(id: CharacterId): void {
    if (this.model) {
      this.scene.remove(this.model.root);
      this.model.dispose();
    }
    this.model = createCharacterModel(id);
    this.scene.add(this.model.root);
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    this.t += 1 / 60;
    if (this.model) {
      this.model.root.rotation.y = this.t * 0.7;
      this.model.update(
        { speed: 0, crouch: false, firing: false, reloading: false, throwing: false, interacting: false, dead: false },
        this.t,
      );
    }
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.model?.dispose();
    this.renderer.dispose();
  }
}

export class App {
  private root: HTMLElement;
  private viewer: ModelViewer | null = null;
  private game: GameClient | null = null;
  private lobbyTransport: WSTransport | null = null;
  private session: { codigo: string; token: string; id: number } | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  start(): void {
    if (!this.webglOk()) {
      this.root.innerHTML = `<div class="screen"><div class="panel"><h2>WebGL no disponible</h2><p>${STR.webglNoDisponible}</p></div></div>`;
      return;
    }
    this.showMenu();
  }

  private webglOk(): boolean {
    try {
      const c = document.createElement('canvas');
      return !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch {
      return false;
    }
  }

  private clear(): void {
    this.viewer?.dispose();
    this.viewer = null;
    this.root.innerHTML = '';
  }

  private screen(cls = ''): HTMLElement {
    this.clear();
    const s = document.createElement('div');
    s.className = `screen ${cls}`;
    this.root.appendChild(s);
    return s;
  }

  // ===== Menú principal =====

  showMenu(): void {
    this.disposeGame();
    this.closeLobby();
    const s = this.screen('menu');
    audio.startMusic();
    s.innerHTML = `
      <div class="menu-left">
        <h1>${STR.titulo}</h1>
        <p class="tagline">${STR.subtitulo}</p>
        <nav class="menu-nav"></nav>
      </div>
      <div class="menu-right"><canvas id="menu-model" width="420" height="460"></canvas></div>`;
    const nav = s.querySelector('.menu-nav')!;
    const buttons: [string, () => void][] = [
      [STR.jugarBots, () => this.showSoloSetup('solo')],
      [STR.crearSala, () => this.showMultiForm('crear')],
      [STR.unirse, () => this.showMultiForm('unirse')],
      [STR.entrenamiento, () => this.showSoloSetup('entrenamiento')],
      [STR.ajustes, () => this.showSettings()],
      [STR.creditos, () => this.showCredits()],
    ];
    for (const [label, cb] of buttons) {
      const b = document.createElement('button');
      b.className = 'menu-btn big';
      b.textContent = label;
      b.onclick = () => { audio.unlock(); cb(); };
      nav.appendChild(b);
    }
    const canvas = s.querySelector<HTMLCanvasElement>('#menu-model')!;
    this.viewer = new ModelViewer(canvas);
    this.viewer.setCharacter(CHARACTERS[Math.floor(Math.random() * 4)]);
  }

  // ===== Selección para solo / entrenamiento =====

  private showSoloSetup(modo: 'solo' | 'entrenamiento'): void {
    const s = this.screen('charselect');
    let char: CharacterId = (settings as { ultimoPersonaje?: CharacterId } & typeof settings).ultimoPersonaje ?? 'pikachu';
    let dificultad: 'facil' | 'normal' | 'dificil' = 'normal';
    s.innerHTML = `
      <h2>${STR.seleccionPersonaje}</h2>
      <div class="cs-wrap">
        <div class="cs-list"></div>
        <div class="cs-view"><canvas id="cs-model" width="380" height="420"></canvas></div>
        <div class="cs-info">
          <h3 id="cs-name"></h3>
          <p id="cs-ability"></p>
          ${modo === 'solo' ? `<label class="set-row"><span>Dificultad de los bots</span>
            <select id="cs-dif">
              <option value="facil">Fácil</option>
              <option value="normal" selected>Normal</option>
              <option value="dificil">Difícil</option>
            </select></label>` : `<p>${STR.munecos}: 3 estáticos y 2 móviles. ${STR.practicaNucleo} incluido. Compra libre.</p>`}
          <button class="menu-btn primary" id="cs-play">${modo === 'solo' ? STR.jugarBots : STR.entrenamiento}</button>
          <button class="menu-btn" id="cs-back">${STR.volver}</button>
        </div>
      </div>`;
    const list = s.querySelector('.cs-list')!;
    const update = (): void => {
      s.querySelector('#cs-name')!.textContent = CHARACTER_INFO[char].nombre;
      s.querySelector('#cs-ability')!.textContent = `${CHARACTER_INFO[char].habilidad}: ${CHARACTER_INFO[char].descripcionHabilidad}`;
      this.viewer?.setCharacter(char);
      list.querySelectorAll('button').forEach((b) => b.classList.toggle('sel', b.dataset.c === char));
    };
    for (const c of CHARACTERS) {
      const b = document.createElement('button');
      b.className = 'menu-btn';
      b.dataset.c = c;
      b.textContent = CHARACTER_INFO[c].nombre;
      b.onclick = () => { char = c; update(); };
      list.appendChild(b);
    }
    this.viewer = new ModelViewer(s.querySelector<HTMLCanvasElement>('#cs-model')!);
    update();
    s.querySelector<HTMLSelectElement>('#cs-dif')?.addEventListener('change', (e) => {
      dificultad = (e.target as HTMLSelectElement).value as typeof dificultad;
    });
    s.querySelector('#cs-back')!.addEventListener('click', () => this.showMenu());
    s.querySelector('#cs-play')!.addEventListener('click', () => {
      this.startLocal(modo, char, dificultad);
    });
  }

  private startLocal(modo: 'solo' | 'entrenamiento', char: CharacterId, dificultad: 'facil' | 'normal' | 'dificil'): void {
    const loading = this.showLoading();
    const transport = new WorkerTransport({
      t: 'config', modo, nombre: settings.alias || 'Jugador', personaje: char, dificultad,
      seed: (Date.now() ^ (Math.random() * 1e9)) >>> 0,
    });
    const timeout = setTimeout(() => {
      loading.fail(STR.errorCarga, () => this.startLocal(modo, char, dificultad));
    }, 8000);
    transport.onMessage = (msg: S2C) => {
      if (msg.t === 'inicio') {
        clearTimeout(timeout);
        loading.step('Generando «Estación Aurora»…', 0.6);
        requestAnimationFrame(() => {
          this.launchGame(transport, msg.tuId, modo);
          loading.done();
        });
      }
    };
    loading.step('Iniciando simulación local…', 0.3);
  }

  // ===== Multijugador =====

  private showMultiForm(kind: 'crear' | 'unirse'): void {
    const s = this.screen('multiform');
    s.innerHTML = `
      <div class="panel">
        <h2>${kind === 'crear' ? STR.crearSala : STR.unirse}</h2>
        <label class="set-row"><span>${STR.alias}</span><input id="mf-alias" maxlength="16" value="${settings.alias.replace(/"/g, '')}"></label>
        ${kind === 'unirse' ? `<label class="set-row"><span>${STR.codigoSala}</span><input id="mf-code" maxlength="6" style="text-transform:uppercase"></label>` : ''}
        <p class="error" id="mf-error"></p>
        <button class="menu-btn primary" id="mf-go">${STR.continuar}</button>
        <button class="menu-btn" id="mf-back">${STR.volver}</button>
      </div>`;
    s.querySelector('#mf-back')!.addEventListener('click', () => this.showMenu());
    s.querySelector('#mf-go')!.addEventListener('click', () => {
      const alias = (s.querySelector('#mf-alias') as HTMLInputElement).value.trim();
      if (alias.length < 2 || alias.length > 16) {
        (s.querySelector('#mf-error') as HTMLElement).textContent = STR.nombreInvalido;
        return;
      }
      settings.alias = alias;
      persist();
      const code = kind === 'unirse' ? (s.querySelector('#mf-code') as HTMLInputElement).value.trim().toUpperCase() : '';
      this.connectMulti(kind, alias, code, (err) => {
        (s.querySelector('#mf-error') as HTMLElement).textContent = err;
      });
    });
  }

  private connectMulti(kind: 'crear' | 'unirse', alias: string, code: string, onError: (e: string) => void): void {
    const t = new WSTransport(wsUrl());
    let joined = false;
    t.onOpen = () => {
      t.send(kind === 'crear' ? { t: 'crear', nombre: alias } : { t: 'unirse', codigo: code, nombre: alias });
    };
    t.onMessage = (msg) => {
      if (msg.t === 'bienvenida') {
        joined = true;
        this.session = { codigo: msg.codigo, token: msg.token, id: msg.id };
        this.lobbyTransport = t;
        this.showLobby(t, msg.id);
      } else if (msg.t === 'error') {
        onError(msg.msg);
        t.close();
      }
    };
    t.onClose = () => {
      if (!joined) onError('No se pudo conectar con el servidor. ¿Está en marcha? (npm run dev)');
    };
  }

  private showLobby(t: WSTransport, myId: number): void {
    const s = this.screen('lobby');
    let state: LobbyState | null = null;
    let myChar: CharacterId = 'pikachu';
    s.innerHTML = `
      <div class="panel wide">
        <h2>${STR.crearSala} — <span class="code" id="lb-code"></span></h2>
        <div class="lobby-teams">
          <div><h3 class="team-blue">${STR.equipoAzul}</h3><ul id="lb-blue"></ul><button class="menu-btn mini" id="lb-join-blue">Unirme</button></div>
          <div><h3 class="team-orange">${STR.equipoNaranja}</h3><ul id="lb-orange"></ul><button class="menu-btn mini" id="lb-join-orange">Unirme</button></div>
        </div>
        <div class="char-row" id="lb-chars"></div>
        <div class="lobby-actions">
          <button class="menu-btn" id="lb-ready">${STR.listo}</button>
          <button class="menu-btn primary hidden" id="lb-start">${STR.iniciarPartida}</button>
          <span id="lb-wait">${STR.esperandoAnfitrion}</span>
          <button class="menu-btn danger" id="lb-leave">${STR.salir}</button>
        </div>
        <p class="hint">Las plazas vacías se rellenan con bots (5 contra 5). Comparte el código para jugar hasta 10 humanos.</p>
      </div>`;
    const charsRow = s.querySelector('#lb-chars')!;
    for (const c of CHARACTERS) {
      const b = document.createElement('button');
      b.className = 'char-btn';
      b.dataset.c = c;
      b.textContent = CHARACTER_INFO[c].nombre;
      b.onclick = () => {
        myChar = c;
        t.send({ t: 'lobbyPersonaje', character: c });
      };
      charsRow.appendChild(b);
    }
    let ready = false;
    s.querySelector('#lb-ready')!.addEventListener('click', () => {
      ready = !ready;
      t.send({ t: 'lobbyListo', listo: ready });
    });
    s.querySelector('#lb-start')!.addEventListener('click', () => t.send({ t: 'lobbyIniciar' }));
    s.querySelector('#lb-leave')!.addEventListener('click', () => {
      t.send({ t: 'salir' });
      t.close();
      this.lobbyTransport = null;
      this.session = null;
      this.showMenu();
    });
    s.querySelector('#lb-join-blue')!.addEventListener('click', () => t.send({ t: 'lobbyEquipo', team: 0 }));
    s.querySelector('#lb-join-orange')!.addEventListener('click', () => t.send({ t: 'lobbyEquipo', team: 1 }));

    const render = (): void => {
      if (!state) return;
      (s.querySelector('#lb-code') as HTMLElement).textContent = state.codigo;
      const fill = (team: Team, sel: string): void => {
        const ul = s.querySelector(sel)!;
        ul.innerHTML = '';
        for (const p of state!.jugadores.filter((j) => j.team === team)) {
          const li = document.createElement('li');
          li.textContent = `${p.esAnfitrion ? '★ ' : ''}${p.nombre}${p.listo ? ' ✓' : ''}${p.conectado ? '' : ' (desc.)'}`;
          if (p.id === myId) li.classList.add('me');
          ul.appendChild(li);
        }
      };
      fill(0, '#lb-blue');
      fill(1, '#lb-orange');
      const me = state.jugadores.find((j) => j.id === myId);
      const isHost = me?.esAnfitrion === true;
      s.querySelector('#lb-start')!.classList.toggle('hidden', !isHost);
      s.querySelector('#lb-wait')!.classList.toggle('hidden', isHost);
      charsRow.querySelectorAll('button').forEach((b) => b.classList.toggle('sel', b.dataset.c === myChar));
    };

    t.onMessage = (msg) => {
      if (msg.t === 'lobby') {
        state = msg.estado;
        render();
      } else if (msg.t === 'inicio') {
        this.lobbyTransport = null;
        this.launchGame(t, msg.tuId, 'multi');
      } else if (msg.t === 'error') {
        alert(msg.msg);
      }
    };
    t.onClose = () => {
      if (this.lobbyTransport === t) {
        this.lobbyTransport = null;
        this.showMenu();
      }
    };
  }

  /** Reconexión multi: devuelve un transporte nuevo ya autenticado o null. */
  private reconnect = async (): Promise<Transport | null> => {
    const ses = this.session;
    if (!ses) return null;
    return new Promise((resolve) => {
      const t = new WSTransport(wsUrl());
      const timeout = setTimeout(() => { t.close(); resolve(null); }, 4000);
      t.onOpen = () => t.send({ t: 'unirse', codigo: ses.codigo, nombre: settings.alias || 'Jugador', token: ses.token });
      t.onMessage = (msg) => {
        if (msg.t === 'bienvenida') {
          clearTimeout(timeout);
          resolve(t);
        } else if (msg.t === 'error') {
          clearTimeout(timeout);
          t.close();
          resolve(null);
        }
      };
      t.onClose = () => { clearTimeout(timeout); resolve(null); };
    });
  };

  // ===== Juego =====

  private launchGame(transport: Transport, myId: number, modo: 'solo' | 'multi' | 'entrenamiento'): void {
    this.clear();
    audio.stopMusic();
    const container = document.createElement('div');
    container.className = 'game-container';
    this.root.appendChild(container);
    this.game = new GameClient({
      container,
      transport,
      myId,
      modo,
      onExit: () => this.showMenu(),
      onResults: (players, score, ganador, myTeam) => this.showResults(players, score, ganador, myTeam),
      reconnect: modo === 'multi' ? this.reconnect : undefined,
    });
  }

  private disposeGame(): void {
    this.game?.dispose();
    this.game = null;
  }

  private closeLobby(): void {
    if (this.lobbyTransport) {
      this.lobbyTransport.onClose = null;
      this.lobbyTransport.close();
      this.lobbyTransport = null;
    }
  }

  // ===== Resultados =====

  private showResults(players: SnapPlayer[], score: [number, number], ganador: Team | 'empate', myTeam: Team): void {
    this.disposeGame();
    const s = this.screen('results');
    const title = ganador === 'empate' ? STR.empate : ganador === myTeam ? STR.victoria : STR.derrota;
    const rows = (team: Team): string =>
      players
        .filter((p) => p.team === team)
        .sort((a, b) => (b.kills ?? 0) - (a.kills ?? 0))
        .map((p) => `<tr><td>${p.esBot ? '🤖 ' : ''}${p.nombre.replace(/</g, '&lt;')}</td><td>${p.kills ?? 0}</td><td>${p.deaths ?? 0}</td><td>${p.assists ?? 0}</td><td>${p.damageDealt ?? 0}</td></tr>`)
        .join('');
    s.innerHTML = `
      <div class="panel wide">
        <h1 class="${ganador === 'empate' ? '' : ganador === myTeam ? 'win' : 'lose'}">${title}</h1>
        <h2>${STR.resultado}: ${score[0]} — ${score[1]}</h2>
        <div class="sb-cols">
          <table class="blue"><thead><tr><th>${STR.equipoAzul}</th><th>${STR.bajas}</th><th>${STR.muertes}</th><th>${STR.asistencias}</th><th>${STR.dano}</th></tr></thead><tbody>${rows(0)}</tbody></table>
          <table class="orange"><thead><tr><th>${STR.equipoNaranja}</th><th>${STR.bajas}</th><th>${STR.muertes}</th><th>${STR.asistencias}</th><th>${STR.dano}</th></tr></thead><tbody>${rows(1)}</tbody></table>
        </div>
        <button class="menu-btn primary" id="res-menu">${STR.volverMenu}</button>
      </div>`;
    s.querySelector('#res-menu')!.addEventListener('click', () => this.showMenu());
  }

  // ===== Ajustes y créditos =====

  private showSettings(): void {
    const s = this.screen('settings');
    const panel = document.createElement('div');
    panel.className = 'panel wide scroll';
    s.appendChild(panel);
    const h = document.createElement('h2');
    h.textContent = STR.ajustes;
    panel.appendChild(h);
    buildSettingsPanel(panel, () => {
      audio.applyVolumes();
      this.showMenu();
    });
  }

  private showCredits(): void {
    const s = this.screen('credits');
    s.innerHTML = `
      <div class="panel scroll">
        <h2>${STR.creditos}</h2>
        <p><b>${STR.titulo}</b> es un fan game sin ánimo de lucro creado con fines educativos y de entretenimiento.
        No es un producto oficial y no está afiliado, patrocinado ni aprobado por Nintendo, Game Freak,
        Creatures Inc. ni The Pokémon Company. Pokémon y los nombres de sus criaturas son marcas de sus
        respectivos titulares.</p>
        <p>Todo el código, los modelos 3D procedurales, el mapa «Estación Aurora» y los sonidos sintetizados
        se crearon específicamente para este proyecto (ver ASSET_SOURCES.md).</p>
        <p>Tecnología: TypeScript, Three.js, Vite, Node.js y WebSocket (ws), Vitest.</p>
        <button class="menu-btn primary" id="cr-back">${STR.volver}</button>
      </div>`;
    s.querySelector('#cr-back')!.addEventListener('click', () => this.showMenu());
  }

  // ===== Carga =====

  private showLoading(): { step: (txt: string, p: number) => void; done: () => void; fail: (txt: string, retry: () => void) => void } {
    const s = this.screen('loading');
    s.innerHTML = `<div class="panel"><h2>${STR.cargando}</h2><div class="bar load"><div class="bar-fill" id="ld-fill"></div></div><p id="ld-txt"></p></div>`;
    return {
      step: (txt, p) => {
        const fill = s.querySelector('#ld-fill') as HTMLElement | null;
        const t = s.querySelector('#ld-txt') as HTMLElement | null;
        if (fill) fill.style.width = `${p * 100}%`;
        if (t) t.textContent = txt;
      },
      done: () => { /* la pantalla ya fue reemplazada por el juego */ },
      fail: (txt, retry) => {
        s.innerHTML = `<div class="panel"><h2>${STR.errorCarga}</h2><p>${txt}</p>
          <button class="menu-btn primary" id="ld-retry">${STR.reintentar}</button>
          <button class="menu-btn" id="ld-back">${STR.volverMenu}</button></div>`;
        s.querySelector('#ld-retry')!.addEventListener('click', retry);
        s.querySelector('#ld-back')!.addEventListener('click', () => this.showMenu());
      },
    };
  }
}
