import { BTN } from '@pta/shared';
import { persist, settings } from './settings.js';
import type { InputManager } from './input.js';

/**
 * Controles táctiles para móvil/tableta: joystick virtual en la mitad izquierda
 * (aparece donde se apoya el pulgar), arrastre para mirar en el resto de la
 * pantalla y botones de acción. Alimenta el mismo InputManager que el teclado
 * (movimiento analógico, bitmask BTN y giro de cámara), así que la simulación
 * y la red no cambian.
 */

/** Dispositivo con puntero principal grueso (dedo). `?tactil` lo fuerza en pruebas. */
export function esDispositivoTactil(): boolean {
  if (location.search.includes('no-tactil')) return false;
  if (location.search.includes('tactil')) return true;
  return typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
}

export interface TouchCallbacks {
  onPausa(): void;
  onComprar(): void;
}

const JOY_RADIO = 56; // px de recorrido máximo del stick

export class TouchControls {
  private root: HTMLElement;
  private joyBase: HTMLElement;
  private joyStick: HTMLElement;
  private soltarBtn: HTMLButtonElement;
  private input: InputManager;

  private joyId: number | null = null;
  private joyOrigin = { x: 0, y: 0 };
  private lookId: number | null = null;
  private lookLast = { x: 0, y: 0 };
  private marcadorActivo = false;

  constructor(container: HTMLElement, input: InputManager, cb: TouchCallbacks) {
    this.input = input;
    input.touch = true;

    this.root = document.createElement('div');
    this.root.className = 'touch-ui';
    container.appendChild(this.root);

    // Zona de joystick (izquierda) + mirar (resto); los botones van encima
    const zona = document.createElement('div');
    zona.className = 'touch-zona';
    this.root.appendChild(zona);
    zona.addEventListener('pointerdown', this.onZonaDown);
    zona.addEventListener('pointermove', this.onZonaMove);
    zona.addEventListener('pointerup', this.onZonaUp);
    zona.addEventListener('pointercancel', this.onZonaUp);

    this.joyBase = document.createElement('div');
    this.joyBase.className = 'touch-joy hidden';
    this.joyStick = document.createElement('div');
    this.joyStick.className = 'touch-joy-stick';
    this.joyBase.appendChild(this.joyStick);
    this.root.appendChild(this.joyBase);

    // Botones de acción (mantener = botón pulsado del bitmask)
    const bitBtn = (cls: string, label: string, bit: number, toggle = false): HTMLButtonElement => {
      const b = this.boton(cls, label);
      if (toggle) {
        b.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          const activo = (this.input.touchButtons & bit) !== 0;
          if (activo) this.input.touchButtons &= ~bit;
          else this.input.touchButtons |= bit;
          b.classList.toggle('activo', !activo);
        });
      } else {
        const soltar = (): void => { this.input.touchButtons &= ~bit; };
        b.addEventListener('pointerdown', (e) => { e.preventDefault(); this.input.touchButtons |= bit; });
        b.addEventListener('pointerup', soltar);
        b.addEventListener('pointercancel', soltar);
        b.addEventListener('pointerleave', soltar);
      }
      return b;
    };

    bitBtn('disparo', '◉', BTN.FIRE);
    bitBtn('salto', '⤒', BTN.JUMP);
    bitBtn('agachar', '⤓', BTN.CROUCH, true);
    bitBtn('recarga', 'R', BTN.RELOAD);
    bitBtn('habilidad', '✦', BTN.ABILITY);
    bitBtn('granada', '◌', BTN.GRENADE);
    bitBtn('usar', 'E', BTN.USE);
    this.soltarBtn = bitBtn('soltar', '⬡', BTN.DROP);
    this.soltarBtn.classList.add('hidden');

    // Fila superior de píldoras (contenedor flexible: nunca se montan entre sí)
    const pills = document.createElement('div');
    pills.className = 'touch-pills';
    this.root.appendChild(pills);
    const pill = (cls: string, label: string, title: string): HTMLButtonElement => {
      const b = document.createElement('button');
      b.className = `touch-btn pill ${cls}`;
      b.textContent = label;
      b.title = title;
      pills.appendChild(b);
      return b;
    };
    const giro = pill('giro', '🧭', 'Apuntado con giroscopio');
    giro.classList.toggle('activo', settings.giroscopio);
    giro.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      void this.toggleGyro(giro);
    });
    const marcador = pill('marcador', '▤', 'Marcador');
    marcador.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.marcadorActivo = !this.marcadorActivo;
      this.input.setHeld(settings.binds.marcador, this.marcadorActivo);
      marcador.classList.toggle('activo', this.marcadorActivo);
    });
    const compra = pill('compra', '🛒', 'Compra');
    compra.addEventListener('pointerdown', (e) => { e.preventDefault(); cb.onComprar(); });
    const pausa = pill('pausa', '☰', 'Pausa');
    pausa.addEventListener('pointerdown', (e) => { e.preventDefault(); cb.onPausa(); });

    if (settings.giroscopio) this.startGyro();

    // Aviso para jugar en horizontal (solo visible en vertical, vía CSS)
    const girar = document.createElement('div');
    girar.className = 'touch-girar';
    girar.textContent = 'Gira el dispositivo: el juego está pensado para horizontal';
    this.root.appendChild(girar);
  }

  // ===== Giroscopio: apuntado fino sumado al arrastre (estilo Splatoon) =====

  /** iOS pide permiso explícito (debe solicitarse en un gesto del usuario). */
  private async toggleGyro(btn: HTMLButtonElement): Promise<void> {
    if (settings.giroscopio) {
      settings.giroscopio = false;
      this.stopGyro();
    } else {
      // iOS exige permiso explícito (y responde 'granted'/'denied'); Chromium
      // también expone el método pero contesta 'prompt': solo bloquea el 'denied'.
      const DME = DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> };
      if (typeof DME.requestPermission === 'function') {
        try {
          if (await DME.requestPermission() === 'denied') return;
        } catch {
          return; // denegado o no disponible
        }
      }
      settings.giroscopio = true;
      this.startGyro();
    }
    persist();
    btn.classList.toggle('activo', settings.giroscopio);
  }

  private startGyro(): void {
    window.addEventListener('devicemotion', this.onMotion);
  }

  private stopGyro(): void {
    window.removeEventListener('devicemotion', this.onMotion);
  }

  private onMotion = (e: DeviceMotionEvent): void => {
    if (!settings.giroscopio || this.input.touchSuspended) return;
    const r = e.rotationRate;
    if (!r || (r.beta === null && r.gamma === null)) return;
    // e.interval es ms según la especificación, pero algún navegador da segundos
    const raw = e.interval || 16;
    const dt = Math.min(0.05, raw > 1 ? raw / 1000 : raw);
    // En horizontal, el eje vertical del mundo ≈ eje X del dispositivo (beta) y
    // el cabeceo gira sobre el eje largo (gamma). El signo depende del lado.
    const ang = (screen.orientation?.angle ?? 0);
    const s = ang === 270 || ang === -90 ? -1 : 1;
    const DEG = Math.PI / 180;
    const dyaw = (r.beta ?? 0) * s * DEG * dt;
    const dpitch = (r.gamma ?? 0) * s * DEG * dt;
    this.input.applyLookRad(dyaw, dpitch);
  };

  private boton(cls: string, label: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = `touch-btn ${cls}`;
    b.textContent = label;
    this.root.appendChild(b);
    return b;
  }

  /** El botón de soltar el núcleo solo aparece cuando se lleva. */
  setCore(lleva: boolean): void {
    this.soltarBtn.classList.toggle('hidden', !lleva);
  }

  private onZonaDown = (e: PointerEvent): void => {
    e.preventDefault();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // punteros sintéticos (pruebas) o navegadores sin captura: seguir sin ella
    }
    if (e.clientX < innerWidth * 0.45 && this.joyId === null) {
      this.joyId = e.pointerId;
      this.joyOrigin = { x: e.clientX, y: e.clientY };
      this.joyBase.classList.remove('hidden');
      this.joyBase.style.left = `${e.clientX}px`;
      this.joyBase.style.top = `${e.clientY}px`;
      this.moveStick(0, 0);
    } else if (this.lookId === null) {
      this.lookId = e.pointerId;
      this.lookLast = { x: e.clientX, y: e.clientY };
    }
  };

  private onZonaMove = (e: PointerEvent): void => {
    if (e.pointerId === this.joyId) {
      const dx = e.clientX - this.joyOrigin.x;
      const dy = e.clientY - this.joyOrigin.y;
      const d = Math.hypot(dx, dy);
      const f = d > JOY_RADIO ? JOY_RADIO / d : 1;
      this.moveStick(dx * f, dy * f);
      const nx = (dx * f) / JOY_RADIO;
      const ny = (dy * f) / JOY_RADIO;
      const mag = Math.hypot(nx, ny);
      if (mag < 0.12) {
        this.input.touchMove.x = 0;
        this.input.touchMove.z = 0;
        this.input.touchButtons &= ~BTN.WALK;
      } else {
        this.input.touchMove.x = nx;
        this.input.touchMove.z = -ny;
        // Medio recorrido = andar sigiloso, como la tecla de caminar
        if (mag < 0.55) this.input.touchButtons |= BTN.WALK;
        else this.input.touchButtons &= ~BTN.WALK;
      }
    } else if (e.pointerId === this.lookId) {
      // Arrastre de cámara: misma sensibilidad que el ratón, con ganancia táctil
      this.input.applyLook((e.clientX - this.lookLast.x) * 1.6, (e.clientY - this.lookLast.y) * 1.6);
      this.lookLast = { x: e.clientX, y: e.clientY };
    }
  };

  private onZonaUp = (e: PointerEvent): void => {
    if (e.pointerId === this.joyId) {
      this.joyId = null;
      this.joyBase.classList.add('hidden');
      this.input.touchMove.x = 0;
      this.input.touchMove.z = 0;
      this.input.touchButtons &= ~BTN.WALK;
    } else if (e.pointerId === this.lookId) {
      this.lookId = null;
    }
  };

  private moveStick(dx: number, dy: number): void {
    this.joyStick.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  dispose(): void {
    this.stopGyro();
    this.input.touch = false;
    this.input.touchMove.x = 0;
    this.input.touchMove.z = 0;
    this.input.touchButtons = 0;
    this.input.setHeld(settings.binds.marcador, false);
    this.root.remove();
  }
}
