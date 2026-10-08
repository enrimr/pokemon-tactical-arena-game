// Dos sesiones de navegador independientes se unen a la misma sala,
// juegan y ven el mismo estado. Requiere npm start en marcha.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:8080';
const OUT = new URL('../docs/capturas/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
const errors = [];
const mkPage = async (name) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name} console: ${m.text()}`); });
  return page;
};

const a = await mkPage('A');
const b = await mkPage('B');

console.log('→ A crea la sala');
await a.goto(BASE + '/?entrada-simulada');
await a.click('text=Crear sala');
await a.fill('#mf-alias', 'Anfitriona');
await a.click('#mf-go');
await a.waitForSelector('#lb-code');
await a.waitForFunction(() => (document.querySelector('#lb-code')?.textContent ?? '').length === 6);
const code = await a.evaluate(() => document.querySelector('#lb-code').textContent);
console.log('   código:', code);

console.log('→ B se une');
await b.goto(BASE + '/?entrada-simulada');
await b.click('text=Unirse a sala');
await b.fill('#mf-alias', 'Invitado');
await b.fill('#mf-code', code);
await b.click('#mf-go');
await b.waitForSelector('#lb-code');
await a.waitForFunction(() => document.querySelectorAll('.lobby-teams li').length === 2);
await a.screenshot({ path: OUT + '08-lobby.png' });

console.log('→ A inicia la partida');
await a.click('#lb-start');
await a.waitForSelector('.hud', { timeout: 15000 });
await b.waitForSelector('.hud', { timeout: 15000 });
await a.waitForTimeout(3000);

const stA = await a.evaluate(() => window.__pta.debugState());
const stB = await b.evaluate(() => window.__pta.debugState());
console.log('   A:', JSON.stringify({ id: stA.myId, fase: stA.phase, vivos: stA.vivos }));
console.log('   B:', JSON.stringify({ id: stB.myId, fase: stB.phase, vivos: stB.vivos }));
if (stA.phase !== stB.phase) errors.push('fases distintas entre clientes');
if (JSON.stringify(stA.vivos) !== JSON.stringify(stB.vivos)) errors.push('recuento de vivos distinto');
if (stA.myId === stB.myId) errors.push('ids duplicados');

console.log('→ Jugar 30 s y comparar marcador');
await a.keyboard.down('KeyW');
await b.keyboard.down('KeyW');
await a.waitForTimeout(30000);
await a.keyboard.up('KeyW');
await b.keyboard.up('KeyW');
const sA = await a.evaluate(() => window.__pta.debugState());
const sB = await b.evaluate(() => window.__pta.debugState());
console.log('   A score:', JSON.stringify(sA.score), 'tick', sA.tick);
console.log('   B score:', JSON.stringify(sB.score), 'tick', sB.tick);
if (JSON.stringify(sA.score) !== JSON.stringify(sB.score)) errors.push('marcadores distintos');
await a.screenshot({ path: OUT + '09-multijugador.png' });

console.log('→ B se desconecta bruscamente; A sigue');
await b.context().close();
await a.waitForTimeout(3000);
const after = await a.evaluate(() => window.__pta.debugState());
console.log('   A sigue en fase', after.phase, 'tick', after.tick);
if (!after.phase) errors.push('A perdió la partida al caer B');

console.log('Errores:', errors.length);
for (const e of errors) console.log('  !', e);
await browser.close();
process.exit(errors.length > 0 ? 2 : 0);
