/**
 * Iconos SVG propios del juego (sin emojis ni glifos de fuente): trazos
 * geométricos sencillos dibujados a mano, en `currentColor` para heredar el
 * color del texto. Se insertan como innerHTML (contenido estático, sin datos
 * del usuario).
 */

export type IconoNombre =
  | 'pausa' | 'compra' | 'marcador' | 'giro'
  | 'disparo' | 'salto' | 'agachar' | 'recarga' | 'habilidad' | 'granada' | 'usar' | 'soltar'
  | 'bot' | 'escudo' | 'evolucion' | 'pokeball' | 'diana' | 'flecha' | 'corona';

const S = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

const CONTENIDO: Record<IconoNombre, string> = {
  // Píldoras superiores
  pausa: '<rect x="6.6" y="5" width="3.6" height="14" rx="1.3" fill="currentColor"/><rect x="13.8" y="5" width="3.6" height="14" rx="1.3" fill="currentColor"/>',
  compra: `<path d="M8 9.5V7.5a4 4 0 0 1 8 0v2" ${S}/><path d="M5.5 9.5h13l-1.1 9.7a2 2 0 0 1-2 1.8H8.6a2 2 0 0 1-2-1.8Z" fill="currentColor"/>`,
  marcador: '<rect x="4" y="5" width="16" height="2.6" rx="1.3" fill="currentColor"/><rect x="4" y="10.7" width="16" height="2.6" rx="1.3" fill="currentColor"/><rect x="4" y="16.4" width="10.5" height="2.6" rx="1.3" fill="currentColor"/>',
  giro: `<circle cx="12" cy="12" r="8.6" ${S}/><path d="M15.8 8.2l-2.2 5.4-5.4 2.2 2.2-5.4Z" fill="currentColor"/>`,
  // Botones de acción táctiles
  disparo: `<circle cx="12" cy="12" r="6.4" ${S}/><circle cx="12" cy="12" r="1.9" fill="currentColor"/><path d="M12 2.6v3M12 18.4v3M2.6 12h3M18.4 12h3" ${S}/>`,
  salto: `<path d="M12 18.2V6.8M7 11.4 12 6.4l5 5" ${S}/><path d="M6.2 20.8h11.6" ${S}/>`,
  agachar: `<path d="M12 5.8v11.4M7 12.6l5 5 5-5" ${S}/><path d="M6.2 3.2h11.6" ${S}/>`,
  recarga: `<path d="M18.9 12a6.9 6.9 0 1 1-2-4.87" ${S}/><path d="M19.4 3.8v4.4H15" ${S}/>`,
  habilidad: '<path d="M12 2.8l2 6.3 6.4 2.9-6.4 2.1L12 21.2l-2-7.1-6.4-2.1 6.4-2.9Z" fill="currentColor"/>',
  granada: '<path d="M7.2 17.6a4.1 4.1 0 1 1 .5-8.16A5.6 5.6 0 0 1 18.3 10a3.7 3.7 0 0 1-.9 7.6Z" fill="currentColor"/>',
  usar: `<path d="M12 3.4v6.2M8.8 6.6 12 9.8l3.2-3.2" ${S}/><path d="M12 11.6l4.4 4.4-4.4 4.4-4.4-4.4Z" fill="currentColor"/>`,
  soltar: `<path d="M12 2.8l4.4 4.4L12 11.6 7.6 7.2Z" fill="currentColor"/><path d="M12 13.6v6.2M8.8 17 12 20.2 15.2 17" ${S}/>`,
  // HUD y marcadores
  bot: `<rect x="5.4" y="9" width="13.2" height="9.2" rx="2.2" ${S}/><path d="M12 9V5.6" ${S}/><circle cx="12" cy="4.4" r="1.5" fill="currentColor"/><circle cx="9.4" cy="13.6" r="1.4" fill="currentColor"/><circle cx="14.6" cy="13.6" r="1.4" fill="currentColor"/>`,
  escudo: '<path d="M12 2.8l7.2 2.6v5.8c0 4.7-3 7.9-7.2 9.8-4.2-1.9-7.2-5.1-7.2-9.8V5.4Z" fill="currentColor"/>',
  evolucion: '<path d="M11 4.2l1.6 5 5.2 2.3-5.2 1.7L11 19.4l-1.6-6.2-5.2-1.7 5.2-2.3Z" fill="currentColor"/><circle cx="18.6" cy="5.4" r="1.5" fill="currentColor"/><circle cx="19.4" cy="17.6" r="1.1" fill="currentColor"/>',
  pokeball: `<circle cx="12" cy="12" r="8.4" ${S}/><path d="M3.6 12h16.8" ${S}/><circle cx="12" cy="12" r="2.6" fill="currentColor"/>`,
  diana: `<circle cx="12" cy="12" r="7.6" ${S}/><circle cx="12" cy="12" r="2.9" fill="currentColor"/>`,
  flecha: '<path d="M9 6.2l7.6 5.8L9 17.8Z" fill="currentColor"/>',
  corona: '<path d="M4 17.5h16M4.6 15.5 3.4 7.6l4.8 3.2L12 5l3.8 5.8 4.8-3.2-1.2 7.9Z" fill="currentColor"/>',
};

export function iconoSvg(nombre: IconoNombre, size = 20): string {
  return `<svg class="icono" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${CONTENIDO[nombre]}</svg>`;
}
