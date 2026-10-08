import { STR } from '@pta/shared';
import { DEFAULT_BINDS, KeyBinds, persist, settings } from './settings.js';

const BIND_LABELS: Record<keyof KeyBinds, string> = {
  adelante: 'Avanzar',
  atras: 'Retroceder',
  izquierda: 'Izquierda',
  derecha: 'Derecha',
  caminar: 'Caminar (sigiloso)',
  agacharse: 'Agacharse',
  saltar: 'Saltar',
  recargar: 'Recargar',
  habilidad: 'Habilidad (Q)',
  granada: 'Granada de niebla',
  interactuar: 'Interactuar / instalar',
  soltar: 'Soltar núcleo',
  comprar: 'Compra',
  marcador: 'Marcador',
  ataque1: 'Ataque principal (1)',
};

function keyName(code: string): string {
  return code.replace('Key', '').replace('Digit', '').replace('Left', ' izq.').replace('Right', ' der.');
}

/** Panel de ajustes reutilizado por el menú principal y la pausa en partida. */
export function buildSettingsPanel(parent: HTMLElement, onClose: () => void): void {
  const wrap = document.createElement('div');
  wrap.className = 'settings-panel';
  parent.appendChild(wrap);

  const slider = (label: string, min: number, max: number, step: number, value: number, cb: (v: number) => void): void => {
    const row = document.createElement('label');
    row.className = 'set-row';
    row.innerHTML = `<span>${label}</span>`;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(value);
    const val = document.createElement('b');
    val.textContent = String(value);
    input.oninput = () => {
      val.textContent = input.value;
      cb(Number(input.value));
      persist();
    };
    row.append(input, val);
    wrap.appendChild(row);
  };

  const toggle = (label: string, value: boolean, cb: (v: boolean) => void): void => {
    const row = document.createElement('label');
    row.className = 'set-row';
    row.innerHTML = `<span>${label}</span>`;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = value;
    input.onchange = () => { cb(input.checked); persist(); };
    row.appendChild(input);
    wrap.appendChild(row);
  };

  slider(STR.sensibilidad, 0.2, 3, 0.05, settings.sensibilidad, (v) => { settings.sensibilidad = v; });
  toggle(STR.invertirY, settings.invertirY, (v) => { settings.invertirY = v; });
  slider(STR.fov, 75, 105, 1, settings.fov, (v) => { settings.fov = v; });
  slider(STR.volumenGeneral, 0, 1, 0.05, settings.volGeneral, (v) => { settings.volGeneral = v; });
  slider(STR.volumenMusica, 0, 1, 0.05, settings.volMusica, (v) => { settings.volMusica = v; });
  slider(STR.volumenEfectos, 0, 1, 0.05, settings.volEfectos, (v) => { settings.volEfectos = v; });

  const calRow = document.createElement('label');
  calRow.className = 'set-row';
  calRow.innerHTML = `<span>${STR.calidad}</span>`;
  const sel = document.createElement('select');
  for (const [v, n] of [['baja', STR.calidadBaja], ['media', STR.calidadMedia], ['alta', STR.calidadAlta]]) {
    const o = document.createElement('option');
    o.value = v; o.textContent = n; o.selected = settings.calidad === v;
    sel.appendChild(o);
  }
  sel.onchange = () => { settings.calidad = sel.value as typeof settings.calidad; persist(); };
  calRow.appendChild(sel);
  wrap.appendChild(calRow);

  const resRow = document.createElement('label');
  resRow.className = 'set-row';
  resRow.innerHTML = '<span>Resolución interna</span>';
  const sel2 = document.createElement('select');
  for (const [v, n] of [['1', '100 %'], ['0.75', '75 %']]) {
    const o = document.createElement('option');
    o.value = v; o.textContent = n; o.selected = String(settings.resolucionInterna) === v;
    sel2.appendChild(o);
  }
  sel2.onchange = () => { settings.resolucionInterna = Number(sel2.value) as 1 | 0.75; persist(); };
  resRow.appendChild(sel2);
  wrap.appendChild(resRow);

  toggle(STR.movimientoReducido, settings.movimientoReducido, (v) => { settings.movimientoReducido = v; });
  toggle(STR.destelloAccesible, settings.destelloAccesible, (v) => { settings.destelloAccesible = v; });

  // Controles reasignables
  const h = document.createElement('h3');
  h.textContent = STR.controles;
  wrap.appendChild(h);
  const bindList = document.createElement('div');
  bindList.className = 'bind-list';
  wrap.appendChild(bindList);

  const renderBinds = (): void => {
    bindList.innerHTML = '';
    (Object.keys(BIND_LABELS) as (keyof KeyBinds)[]).forEach((action) => {
      const row = document.createElement('div');
      row.className = 'set-row';
      row.innerHTML = `<span>${BIND_LABELS[action]}</span>`;
      const btn = document.createElement('button');
      btn.className = 'bind-btn';
      btn.textContent = keyName(settings.binds[action]);
      btn.onclick = () => {
        btn.textContent = STR.pulsaTecla;
        const handler = (e: KeyboardEvent): void => {
          e.preventDefault();
          if (e.code !== 'Escape') settings.binds[action] = e.code;
          persist();
          document.removeEventListener('keydown', handler, true);
          renderBinds();
        };
        document.addEventListener('keydown', handler, true);
      };
      row.appendChild(btn);
      bindList.appendChild(row);
    });
  };
  renderBinds();

  const reset = document.createElement('button');
  reset.className = 'menu-btn';
  reset.textContent = STR.restaurarControles;
  reset.onclick = () => {
    settings.binds = { ...DEFAULT_BINDS };
    persist();
    renderBinds();
  };
  wrap.appendChild(reset);

  const close = document.createElement('button');
  close.className = 'menu-btn primary';
  close.textContent = STR.volver;
  close.onclick = () => {
    wrap.remove();
    onClose();
  };
  wrap.appendChild(close);
}
