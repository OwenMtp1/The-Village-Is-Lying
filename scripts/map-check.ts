/**
 * Carte de l'écran de pause dans le navigateur : ouverture (Échap), captures, téléportation au clic en solo
 * (sur la carte, puis dans les souterrains), mur invisible au bout de la carte. Captures dans screenshots/ui/.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
const BASE = process.env.BASE ?? 'http://localhost:3001';
mkdirSync('screenshots/ui', { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(BASE);
await page.waitForFunction(() => (window as any).__village, null, { timeout: 240_000 });
const ev = <T = unknown>(c: string) => page.evaluate(c) as Promise<T>;
await ev(`window.__village.settings.set({ quality: 'basse' })`);
await page.waitForTimeout(2500);
await ev(`document.querySelector('[data-go="jouer"]').click(); document.querySelector('[data-tab="solo"]').click(); document.querySelector('.solo').click()`);
await page.waitForFunction(`window.__village.mode() === 'solo'`, null, { timeout: 120_000 });
await ev(`window.__village.view.paused = true`);
await page.keyboard.press('Escape');
await page.waitForTimeout(1500);
console.log('pause ouverte :', await ev(`document.querySelector('.pause').classList.contains('open')`));
writeFileSync('screenshots/ui/19-carte-solo.png', await page.screenshot());
// clic sur l'église (téléportation)
const box = await ev<{ x: number; y: number }>(`(() => { const m = window.__village.gameUi.pause.map; const [sx, sy] = m.toScreen(-11, -96); const r = m.canvas.getBoundingClientRect(); const d = m.canvas.width / r.width; return { x: r.left + sx / d, y: r.top + sy / d }; })()`);
await page.mouse.move(box.x, box.y);
await page.waitForTimeout(300);
console.log('survol :', await ev(`document.querySelector('.vmap-tip').textContent`));
writeFileSync('screenshots/ui/20-carte-survol.png', await page.screenshot());
await page.mouse.click(box.x, box.y);
await page.waitForTimeout(500);
console.log('après clic : pause', await ev(`document.querySelector('.pause').classList.contains('open')`), '| lieu', await ev(`window.__village.view.placeAt(window.__village.game.player.root.position)`), '| pos', await ev(`(({x,y,z}) => [x,y,z].map(n => n.toFixed(1)).join(', '))(window.__village.game.player.controller)`));
// souterrains : calque, clic dans la salle du conseil
await page.keyboard.press('Escape');
await page.waitForTimeout(1200);
await ev(`(() => { const i = document.querySelector('.vmap-under input'); i.checked = true; i.dispatchEvent(new Event('change')); })()`);
await page.waitForTimeout(300);
writeFileSync('screenshots/ui/21-carte-souterrains.png', await page.screenshot());
const b2 = await ev<{ x: number; y: number }>(`(() => { const m = window.__village.gameUi.pause.map; const [sx, sy] = m.toScreen(-4, -35); const r = m.canvas.getBoundingClientRect(); const d = m.canvas.width / r.width; return { x: r.left + sx / d, y: r.top + sy / d }; })()`);
await page.mouse.click(b2.x, b2.y);
await page.waitForTimeout(500);
console.log('téléporté sous terre :', await ev(`window.__village.view.placeAt(window.__village.game.player.root.position)`), '| y', await ev(`window.__village.game.player.controller.y.toFixed(2)`));
console.log(errors.length ? `erreurs : ${errors.join(' | ')}` : 'aucune erreur de page');
await browser.close();
