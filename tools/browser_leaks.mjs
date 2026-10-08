import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://localhost:8080/?entrada-simulada');
for (let i = 1; i <= 3; i++) {
  await page.click('text=Jugar con bots');
  await page.waitForSelector('#cs-play');
  await page.click('#cs-play');
  await page.waitForSelector('.hud', { timeout: 20000 });
  await page.waitForTimeout(4000);
  const counts = await page.evaluate(() => ({
    canvases: document.querySelectorAll('canvas').length,
    huds: document.querySelectorAll('.hud').length,
    overlays: document.querySelectorAll('.pause-overlay').length,
  }));
  console.log(`partida ${i}:`, JSON.stringify(counts));
  await page.evaluate(() => window.__pta.debugExit());
  await page.waitForSelector('.menu-nav button');
  const after = await page.evaluate(() => ({
    canvases: document.querySelectorAll('canvas').length,
    huds: document.querySelectorAll('.hud').length,
  }));
  console.log(`  tras salir:`, JSON.stringify(after));
  if (after.huds !== 0) errors.push('HUD residual tras salir');
  if (after.canvases > 2) errors.push('canvases acumulados: ' + after.canvases);
}
console.log('Errores:', errors.length, errors.slice(0,5));
await browser.close();
process.exit(errors.length ? 2 : 0);
