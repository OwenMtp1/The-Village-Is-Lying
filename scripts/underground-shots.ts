/** Captures des souterrains, et de leurs entrées (serveur lancé sur BASE). */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
const BASE = process.env.BASE ?? 'http://localhost:3001';
mkdirSync('screenshots/souterrains', { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(BASE);
await page.waitForFunction(() => (window as any).__village, null, { timeout: 240_000 });
await page.evaluate(`window.__village.enterInspection(); window.__village.view.paused = true; window.__village.gameUi.menu.show(false)`);
const ids = (process.env.VUES ?? 'u-conseil,u-geoles,u-citerne,u-crypte,u-galerie,u-chapelle,e-mausolee,e-verger').split(',');
for (const id of ids) {
  await page.evaluate(`(() => { const v = window.__village.view; v.paused = true; window.__village.enterInspection(); v.paused = true; v.goTo(v.views.find(x => x.id === '${id}'), true); for (let i = 0; i < 3; i++) v.renderFrame(); })()`);
  writeFileSync(`screenshots/souterrains/${id}.png`, await page.screenshot({ timeout: 120_000 }));
  console.log(id, await page.evaluate(`window.__village.view.placeName()`));
}
console.log(errors.length ? errors.join(' | ') : 'aucune erreur');
await browser.close();
