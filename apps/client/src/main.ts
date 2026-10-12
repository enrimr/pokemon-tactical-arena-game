import './styles.css';
import { App } from './screens.js';
import { audio } from './audio.js';
import { settings } from './settings.js';
import { preloadOfficialModels } from './officialModels.js';

// Si el usuario activó los modelos oficiales, cargarlos cuanto antes
if (settings.modelosOficiales) void preloadOfficialModels();

const root = document.getElementById('app');
if (!root) throw new Error('Falta #app');

// El audio solo puede arrancar tras un gesto del usuario
const unlock = (): void => audio.unlock();
document.addEventListener('pointerdown', unlock);
document.addEventListener('keydown', unlock);

const app = new App(root);
app.start();
