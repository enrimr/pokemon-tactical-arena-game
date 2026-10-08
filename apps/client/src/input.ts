import { BTN } from '@pta/shared';
import { settings } from './settings.js';

export interface InputSample {
  moveX: number;
  moveZ: number;
  yaw: number;
  pitch: number;
  buttons: number;
}

/** Entrada de ratón/teclado con pointer lock y controles reasignables. */
export class InputManager {
  yaw = 0;
  pitch = 0;
  private keys = new Set<string>();
  private mouseButtons = 0;
  private element: HTMLElement;
  locked = false;
  onLockChange: ((locked: boolean) => void) | null = null;
  onKeyPress: ((code: string) => void) | null = null;
  enabled = true;

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.locked || !this.enabled) return;
    const k = 0.0022 * settings.sensibilidad;
    this.yaw -= e.movementX * k;
    const inv = settings.invertirY ? -1 : 1;
    this.pitch -= e.movementY * k * inv;
    const lim = Math.PI / 2 - 0.02;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Tab') e.preventDefault();
    this.keys.add(e.code);
    this.onKeyPress?.(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (!this.locked) return;
    e.preventDefault();
    this.mouseButtons |= 1 << e.button;
  };

  private onMouseUp = (e: MouseEvent): void => {
    this.mouseButtons &= ~(1 << e.button);
  };

  private onPointerLockChange = (): void => {
    if (this.simulated) return;
    this.locked = document.pointerLockElement === this.element;
    if (!this.locked) this.clear();
    this.onLockChange?.(this.locked);
  };

  private onBlur = (): void => {
    // La pérdida de foco limpia entradas (sin disparos ni movimiento atascados)
    this.clear();
  };

  /** Modo de prueba automatizada: sin pointer lock (p. ej. navegador headless). */
  private readonly simulated = typeof location !== 'undefined' && location.search.includes('entrada-simulada');

  constructor(element: HTMLElement) {
    this.element = element;
    if (this.simulated) this.locked = true;
  }

  attach(): void {
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('mousedown', this.onMouseDown);
    document.addEventListener('mouseup', this.onMouseUp);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    window.addEventListener('blur', this.onBlur);
    this.element.addEventListener('contextmenu', this.onContext);
  }

  private onContext = (e: Event): void => e.preventDefault();

  detach(): void {
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('mousedown', this.onMouseDown);
    document.removeEventListener('mouseup', this.onMouseUp);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    window.removeEventListener('blur', this.onBlur);
    this.element.removeEventListener('contextmenu', this.onContext);
    if (this.locked) document.exitPointerLock();
  }

  requestLock(): void {
    try {
      const r = this.element.requestPointerLock?.() as unknown as Promise<void> | undefined;
      if (r && typeof r.catch === 'function') r.catch(() => { /* denegado: sin ratón capturado */ });
    } catch {
      // algunos navegadores lanzan de forma síncrona; el juego sigue sin captura
    }
  }

  clear(): void {
    this.keys.clear();
    this.mouseButtons = 0;
  }

  held(code: string): boolean {
    return this.keys.has(code);
  }

  sample(): InputSample {
    const b = settings.binds;
    let buttons = 0;
    let moveX = 0;
    let moveZ = 0;
    if (this.enabled && this.locked) {
      // Giro con flechas (apoyo de accesibilidad y pruebas)
      const turn = 0.045;
      if (this.keys.has('ArrowLeft')) this.yaw += turn;
      if (this.keys.has('ArrowRight')) this.yaw -= turn;
      if (this.keys.has('ArrowUp')) this.pitch = Math.min(1.5, this.pitch + turn * 0.7);
      if (this.keys.has('ArrowDown')) this.pitch = Math.max(-1.5, this.pitch - turn * 0.7);
      if (this.keys.has(b.adelante)) moveZ += 1;
      if (this.keys.has(b.atras)) moveZ -= 1;
      if (this.keys.has(b.derecha)) moveX += 1;
      if (this.keys.has(b.izquierda)) moveX -= 1;
      if (this.mouseButtons & 1) buttons |= BTN.FIRE;
      if (this.mouseButtons & 4) buttons |= BTN.AIM;
      if (this.keys.has(b.caminar)) buttons |= BTN.WALK;
      if (this.keys.has(b.agacharse)) buttons |= BTN.CROUCH;
      if (this.keys.has(b.saltar)) buttons |= BTN.JUMP;
      if (this.keys.has(b.recargar)) buttons |= BTN.RELOAD;
      if (this.keys.has(b.habilidad)) buttons |= BTN.ABILITY;
      if (this.keys.has(b.granada)) buttons |= BTN.GRENADE;
      if (this.keys.has(b.interactuar)) buttons |= BTN.USE;
      if (this.keys.has(b.soltar)) buttons |= BTN.DROP;
    }
    return { moveX, moveZ, yaw: this.yaw, pitch: this.pitch, buttons };
  }
}
