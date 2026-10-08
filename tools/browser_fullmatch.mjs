// Partida en solitario completa desde el menú hasta la pantalla de resultados.
// El humano queda pasivo tras morir; los bots juegan el objetivo. Duración real: 10–30 min.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:8080';
const OUT = new URL('../docs/capturas/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(BASE + '/?entrada-simulada');
await page.click('text=Jugar con bots');
await page.waitForSelector('#cs-play');
await page.click('#cs-play');
await page.waitForSelector('.hud', { timeout: 20000 });
console.log('Partida iniciada, esperando el final…');

const t0 = Date.now();
let lastLog = '';
for (;;) {
  if (Date.now() - t0 > 45 * 60 * 1000) {
    console.log('LÍMITE DE TIEMPO');
    break;
  }
  const res = await page.evaluate(() => ({
    results: !!document.querySelector('.results, .screen.results'),
    score: window.__pta?.debugState?.()?.score,
    phase: window.__pta?.debugState?.()?.phase,
  })).catch(() => null);
  if (!res) break;
  const log = JSON.stringify(res.score) + ' ' + res.phase;
  if (log !== lastLog) {
    console.log(`t=${((Date.now() - t0) / 60000).toFixed(1)}min score=${JSON.stringify(res.score)} fase=${res.phase}`);
    lastLog = log;
  }
  if (res.results) break;
  await page.waitForTimeout(5000);
}
await page.waitForTimeout(1000);
await page.screenshot({ path: OUT + '10-resultados.png' });
const title = await page.evaluate(() => document.querySelector('.results h1, .screen h1')?.textContent);
const score = await page.evaluate(() => document.querySelector('.results h2, .screen h2')?.textContent);
console.log('FINAL:', title, '|', score);
console.log('Errores de página:', errors.length, errors.slice(0, 5));
await browser.close();
