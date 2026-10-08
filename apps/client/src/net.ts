import type { C2S, S2C } from '@pta/shared';
import { encode } from '@pta/shared';

export interface Transport {
  send(msg: C2S): void;
  close(): void;
  onMessage: ((msg: S2C) => void) | null;
  onClose: (() => void) | null;
}

export class WSTransport implements Transport {
  private ws: WebSocket;
  onMessage: ((msg: S2C) => void) | null = null;
  onClose: (() => void) | null = null;
  onOpen: (() => void) | null = null;
  closedByUs = false;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as S2C;
        this.onMessage?.(msg);
      } catch {
        // mensaje corrupto: ignorar
      }
    };
    this.ws.onclose = () => this.onClose?.();
    this.ws.onerror = () => { /* onclose se dispara después */ };
    this.ws.onopen = () => this.onOpen?.();
  }

  get open(): boolean {
    return this.ws.readyState === WebSocket.OPEN;
  }

  send(msg: C2S): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(encode(msg));
  }

  close(): void {
    this.closedByUs = true;
    this.ws.close();
  }
}

/** Mensajes de configuración del worker local (fuera del protocolo C2S). */
export interface WorkerConfig {
  t: 'config';
  modo: 'solo' | 'entrenamiento';
  nombre: string;
  personaje: string;
  dificultad: 'facil' | 'normal' | 'dificil';
  seed: number;
}

export class WorkerTransport implements Transport {
  private worker: Worker;
  onMessage: ((msg: S2C) => void) | null = null;
  onClose: (() => void) | null = null;

  constructor(config: WorkerConfig) {
    this.worker = new Worker(new URL('./worker/localHost.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev) => this.onMessage?.(ev.data as S2C);
    this.worker.postMessage(config);
  }

  send(msg: C2S): void {
    this.worker.postMessage(msg);
  }

  close(): void {
    this.worker.terminate();
    this.onClose?.();
  }
}

export function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}
