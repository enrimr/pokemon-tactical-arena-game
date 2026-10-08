import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto('http://localhost:8080/?entrada-simulada');
await page.click('text=Jugar con bots');
await page.waitForSelector('#cs-play');
for (const c of ['pikachu', 'charmander', 'squirtle', 'bulbasaur']) {
  await page.click(`.cs-list button[data-c="${c}"]`);
  await page.waitForTimeout(4500);
  await page.locator('#cs-model').screenshot({ path: `docs/capturas/modelo-${c}.png` });
}
await browser.close();
