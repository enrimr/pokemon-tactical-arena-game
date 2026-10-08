/** Ajustes persistidos en localStorage (sin cuentas). */

export interface KeyBinds {
  adelante: string;
  atras: string;
  izquierda: string;
  derecha: string;
  caminar: string;
  agacharse: string;
  saltar: string;
  recargar: string;
  habilidad: string;
  granada: string;
  interactuar: string;
  soltar: string;
  comprar: string;
  marcador: string;
  ataque1: string;
}

export interface Settings {
  sensibilidad: number;      // 0.2 – 3
  invertirY: boolean;
  fov: number;               // 75 – 105 (horizontal)
  volGeneral: number;        // 0 – 1
  volMusica: number;
  volEfectos: number;
  calidad: 'baja' | 'media' | 'alta';
  movimientoReducido: boolean;
  destelloAccesible: boolean;
  resolucionInterna: 1 | 0.75;
  binds: KeyBinds;
  alias: string;
}

export const DEFAULT_BINDS: KeyBinds = {
  adelante: 'KeyW',
  atras: 'KeyS',
  izquierda: 'KeyA',
  derecha: 'KeyD',
  caminar: 'ShiftLeft',
  agacharse: 'ControlLeft',
  saltar: 'Space',
  recargar: 'KeyR',
  habilidad: 'KeyQ',
  granada: 'KeyG',
  interactuar: 'KeyE',
  soltar: 'KeyF',
  comprar: 'KeyB',
  marcador: 'Tab',
  ataque1: 'Digit1',
};

const DEFAULTS: Settings = {
  sensibilidad: 1,
  invertirY: false,
  fov: 90,
  volGeneral: 0.8,
  volMusica: 0.5,
  volEfectos: 0.9,
  calidad: 'media',
  movimientoReducido: false,
  destelloAccesible: false,
  resolucionInterna: 1,
  binds: { ...DEFAULT_BINDS },
  alias: '',
};

const KEY = 'pta-ajustes-v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      ...structuredClone(DEFAULTS),
      ...parsed,
      binds: { ...DEFAULT_BINDS, ...(parsed.binds ?? {}) },
    };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // almacenamiento no disponible: seguir sin persistir
  }
}

export const settings: Settings = loadSettings();

export function persist(): void {
  saveSettings(settings);
}
