// Campo de entrenamiento: muñecos, compra libre y práctica de instalación.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:8080';
const OUT = new URL('../docs/capturas/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(BASE + '/?entrada-simulada');
await page.click('text=Entrenamiento');
await page.waitForSelector('#cs-play');
await page.click('#cs-play');
await page.waitForSelector('.hud', { timeout: 20000 });
await page.waitForTimeout(4000); // prep de entrenamiento = 3 s

// Compra libre (créditos al máximo en entrenamiento)
await page.keyboard.press('KeyB');
await page.waitForTimeout(400);
const canBuy = await page.evaluate(() => !!document.querySelector('.buymenu:not(.hidden)'));
console.log('compra en prep de entrenamiento (ya en activa):', canBuy);
await page.keyboard.press('KeyB');

// Navegar hasta el muñeco de la zona A y disparar
const waypoints = [[-7.5, -13.2], [-13, -12.9], [-19.5, -13], [-24, -10], [-23.6, -2], [-24.5, 4], [-21.5, 8]];
let turning = null;
for (let step = 0; step < 320 && waypoints.length > 0; step++) {
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

// Disparar al muñeco de la zona A
await page.mouse.down();
await page.waitForTimeout(2500);
await page.mouse.up();
await page.waitForTimeout(500);
const kills = await page.evaluate(() => document.querySelectorAll('.kill-row').length);
console.log('bajas en el killfeed tras disparar al muñeco:', kills);
await page.screenshot({ path: OUT + '11-entrenamiento.png' });

// Práctica de instalación
const st = await page.evaluate(() => window.__pta.debugState());
console.log('pos:', JSON.stringify(st.pos), 'fase:', st.phase);
await page.keyboard.down('KeyE');
await page.waitForTimeout(3600);
await page.keyboard.up('KeyE');
await page.waitForTimeout(500);
const fase = await page.evaluate(() => window.__pta.debugState().phase);
console.log('fase tras instalar (planted esperado si estaba en zona):', fase);

console.log('Errores:', errors.length, errors.slice(0, 5));
await browser.close();
process.exit(errors.length > 0 ? 2 : 0);
