import './styles.css';
import { App } from './screens.js';
import { audio } from './audio.js';
import { settings } from './settings.js';
import { preloadOfficialModels } from './officialModels.js';
import { esDispositivoTactil } from './touch.js';

// Si el usuario activó los modelos oficiales, cargarlos cuanto antes
if (settings.modelosOficiales) void preloadOfficialModels();

// Dispositivos táctiles: la hoja de estilos adapta HUD y menús
if (esDispositivoTactil()) document.documentElement.classList.add('tactil');

// PWA: service worker (red primero con reserva en caché) para poder instalar
// el juego en el móvil. Solo en despliegues seguros o en local.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* sin SW: el juego funciona igual */ });
  });
}

const root = document.getElementById('app');
if (!root) throw new Error('Falta #app');

// El audio solo puede arrancar tras un gesto del usuario
const unlock = (): void => audio.unlock();
document.addEventListener('pointerdown', unlock);
document.addEventListener('keydown', unlock);

const app = new App(root);
app.start();
