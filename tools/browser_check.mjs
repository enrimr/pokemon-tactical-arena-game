// Comprobación de navegador real con Playwright: recorre menú → selección →
// partida en solitario → compra, y captura pantallas en docs/capturas/.
// Requiere el servidor en marcha (npm start) sirviendo la build.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:8080';
const OUT = new URL('../docs/capturas/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const errors = [];
const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
});

console.log('→ Menú principal');
await page.goto(BASE + '/?entrada-simulada');
await page.waitForSelector('.menu-nav button');
await page.waitForTimeout(1200);
await page.screenshot({ path: OUT + '01-menu.png' });

console.log('→ Selección de personaje');
await page.click('text=Jugar con bots');
await page.waitForSelector('#cs-play');
await page.click('.cs-list button[data-c="charmander"]');
await page.waitForTimeout(800);
await page.screenshot({ path: OUT + '02-seleccion.png' });

console.log('→ Partida en solitario');
await page.click('#cs-play');
await page.waitForSelector('.hud', { timeout: 15000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: OUT + '03-preparacion.png' });

console.log('→ Menú de compra');
await page.keyboard.press('KeyB');
await page.waitForTimeout(600);
const buyVisible = await page.isVisible('.buymenu:not(.hidden)');
console.log('   compra visible:', buyVisible);
await page.screenshot({ path: OUT + '04-compra.png' });
if (buyVisible) {
  await page.click('.buy-item[data-item="escudo"]');
  await page.waitForTimeout(400);
  await page.keyboard.press('KeyB');
}

console.log('→ Ronda activa: avanzar hacia la zona A');
// Esperar al final de la preparación y navegar con waypoints (entrada simulada)
await page.waitForFunction(
  () => !(document.querySelector('.round-label')?.textContent ?? '').includes('Preparación'),
  { timeout: 40000 },
).catch(() => {});

const waypoints = [[-7.5, -13.2], [-13, -12.9], [-19.5, -13], [-24, -10], [-23.6, -2], [-24.5, 4], [-21, 7], [-21, 9.6]];
let turning = null;
for (let step = 0; step < 300 && waypoints.length > 0; step++) {
  const st = await page.evaluate(() => window.__pta.debugState());
  const [wx, wz] = waypoints[0];
  const dx = wx - st.pos.x;
  const dz = wz - st.pos.z;
  if (Math.hypot(dx, dz) < 1.2) { waypoints.shift(); continue; }
  const want = Math.atan2(-dx, -dz);
  let d = want - st.yaw;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  const dir = Math.abs(d) < 0.12 ? null : d > 0 ? 'ArrowLeft' : 'ArrowRight';
  if (turning !== dir) {
    if (turning) await page.keyboard.up(turning);
    if (dir) await page.keyboard.down(dir);
    turning = dir;
  }
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(90);
}
if (turning) await page.keyboard.up(turning);
await page.keyboard.up('KeyW');
console.log('   posición final:', JSON.stringify((await page.evaluate(() => window.__pta.debugState())).pos));
// Disparar unas ráfagas hacia la zona
await page.mouse.down();
await page.waitForTimeout(700);
await page.mouse.up();
await page.waitForTimeout(400);
await page.screenshot({ path: OUT + '05-combate.png' });

console.log('→ Instalación del núcleo (si seguimos vivos en la zona)');
await page.keyboard.down('KeyE');
await page.waitForTimeout(1500);
await page.screenshot({ path: OUT + '07-instalacion.png' });
await page.waitForTimeout(2200);
await page.keyboard.up('KeyE');
await page.waitForTimeout(800);
const estado = await page.evaluate(() => ({
  fase: window.__pta.debugState().phase,
  msg: document.querySelector('.center-msg')?.textContent,
}));
console.log('   tras E:', JSON.stringify(estado));

console.log('→ Marcador');
await page.keyboard.down('Tab');
await page.waitForTimeout(400);
await page.screenshot({ path: OUT + '06-marcador.png' });
await page.keyboard.up('Tab');

const hudInfo = await page.evaluate(() => ({
  timer: document.querySelector('.timer')?.textContent,
  ammo: document.querySelector('.ammo')?.textContent,
  weapon: document.querySelector('.weapon')?.textContent,
  round: document.querySelector('.round-label')?.textContent,
}));
console.log('   HUD:', JSON.stringify(hudInfo));

console.log('Errores de consola:', errors.length);
for (const e of errors.slice(0, 12)) console.log('  !', e);
await browser.close();
process.exit(errors.length > 0 ? 2 : 0);
