/**
 * Gunfight de nuit : lampe et laser sur l'arme du joueur (fil visible pour lui seul), points rouges des lasers des
 * robots, extinction (L, O). Captures dans screenshots/gunfight/.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE ?? 'http://localhost:3001';
const OUT = 'screenshots/gunfight';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(BASE);
await page.waitForFunction(() => (window as any).__village, null, { timeout: 240_000 });
const ev = <T = unknown>(c: string) => page.evaluate(c) as Promise<T>;
await ev(`window.__village.settings.set({ quality: 'basse' })`);
await page.waitForTimeout(1500);
await ev(`window.__village.gfCtl.solo('Owen', 'M', { settings: { mode: 'ffa', night: true, map: 'place', maxPlayers: 4, scoreLimit: 50, minutes: 10, arsenal: 'libre', weapons: ['pistolet', 'fusil', 'pompe', 'precision', 'couteau'] }, bots: 3, difficulty: 'facile', team: 'rouge' })`);
await ev(`document.querySelector('.mm')?.classList.remove('open')`);
await page.waitForFunction(`window.__village.mode() === 'gunfight' && window.__village.gfGame.player`, null, { timeout: 120_000 });
await ev(`window.__village.view.paused = true`);
// un robot en face, à 10 m sur la place, qui vise le joueur
const frame = (n: string) => ev(`(() => { const V = window.__village; const G = V.gfGame; for (let i = 0; i < 4; i++) { G.update(1 / 30); V.gfCtl.frame(); } V.gfCtl.render(); V.view.renderFrame(); })()`).then(async () => writeFileSync(`${OUT}/${n}.png`, await page.screenshot({ timeout: 120_000 })));
await ev(`(() => {
  const V = window.__village; const G = V.gfGame; const c = V.gfCtl.client; const room = c.room;
  for (const s of room['state'].values()) s.shieldUntil = Date.now() + 60000;
  G.item = 'fusil';
  const me = G.player; me.controller.x = 0; me.controller.z = 2; me.controller.y = V.village.collision.groundAt(0, 2, 5);
  G.cam.yaw = 0; G.cam.pitch = -0.05;
  const bid = c.bots[0]; const b = G['bots'].get(bid);
  b.ch.controller.x = 1.5; b.ch.controller.z = 12; b.ch.controller.y = V.village.collision.groundAt(1.5, 12, 5); b.ch.yaw = Math.PI;
  for (const [id, o] of G['bots']) if (id !== bid) { o.ch.controller.x = 60; o.ch.controller.z = 60; }
})()`);
await frame('30-nuit-lampe-laser');
console.log('lumières :', await ev(`(() => { const t = window.__village.torches; return 'locale ' + t.local.intensity.toFixed(0) + ' | autres ' + t['remotes'].map((l) => l.intensity.toFixed(0)).join('/'); })()`), '| points laser visibles :', await ev(`window.__village.gfGame['dots'].filter((d) => d.visible).length`), '| fil :', await ev(`window.__village.gfGame['laserLine'].visible`));
await page.keyboard.press('KeyL');
await page.keyboard.press('KeyO');
await ev(`(() => { const G = window.__village.gfGame; G.paused = false; })()`);
await frame('31-nuit-eteint');
console.log('après L et O :', await ev(`window.__village.gfGame.torchOn + ' / ' + window.__village.gfGame.laserOn`));
console.log(errors.length ? `erreurs : ${errors.join(' | ')}` : 'aucune erreur de page');
await browser.close();
