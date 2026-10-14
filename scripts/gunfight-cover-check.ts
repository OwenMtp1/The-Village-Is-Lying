/**
 * Accroupi (C) et mise à couvert (Q) : posture, vitesse, couvert bas derrière une caisse de la Place du Marché,
 * relevé en visant, glissement le long du couvert. Captures dans screenshots/gunfight/.
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
await ev(`window.__village.gfCtl.solo('Owen', 'M', { settings: { mode: 'ffa', map: 'place', maxPlayers: 2, scoreLimit: 50, minutes: 10 }, bots: 1, difficulty: 'facile', team: 'rouge' })`);
await ev(`document.querySelector('.mm')?.classList.remove('open')`);
await page.waitForFunction(`window.__village.mode() === 'gunfight' && window.__village.gfGame.player`, null, { timeout: 120_000 });
await ev(`window.__village.view.paused = true; for (const s of window.__village.gfCtl.client.room['state'].values()) s.shieldUntil = Date.now() + 600000;`);
const step = (n: number, keys: string[] = []) => ev(`(() => { const V = window.__village; for (let i = 0; i < ${n}; i++) { for (const k of ${JSON.stringify(keys)}) V.input['down'].add(k); V.gfGame.update(1 / 30); } for (const k of ${JSON.stringify(keys)}) V.input['down'].delete(k); V.gfCtl.frame(); V.gfCtl.render(); })()`);
const press = (code: string) => ev(`window.__village.input['pressed'].add('${code}')`);
const side = (name: string, ang = -1.4, dist = 2.6) =>
  ev(`(() => {
    const V = window.__village; const G = V.gfGame; const p = G.player.root.position; const yaw = G.player.yaw; const cam = G.cam.camera;
    const keep = V.view.driver; V.view.driver = { update() {} };
    const a = yaw + ${ang};
    cam.position.set(p.x + Math.sin(a) * ${dist}, p.y + 1.3, p.z + Math.cos(a) * ${dist}); cam.lookAt(p.x, p.y + 0.8, p.z);
    V.view.renderFrame(); V.view.driver = keep;
  })()`).then(async () => writeFileSync(`${OUT}/${name}.png`, await page.screenshot({ timeout: 120_000 })));
// accroupi sur place puis en marchant
await ev(`window.__village.gfGame.item = 'assaut'`);
await press('KeyC');
await step(20);
console.log('accroupi :', await ev(`window.__village.gfGame.crouched`), '| badge :', await ev(`document.querySelector('.gf-stance').textContent`));
await side('70-accroupi');
const v = await ev<string>(`(() => { const V = window.__village; const G = V.gfGame; const c = G.player.controller; const x0 = c.x, z0 = c.z; for (let i = 0; i < 60; i++) { V.input['down'].add('KeyW'); G.update(1 / 60); } V.input['down'].delete('KeyW'); return Math.hypot(c.x - x0, c.z - z0).toFixed(2); })()`);
console.log('vitesse accroupi :', v, 'm/s');
await press('KeyC');
await step(10);
// à couvert derrière la caisse la plus proche du joueur : on se place à 1 m devant elle
const info = await ev<string>(`(() => {
  const V = window.__village; const G = V.gfGame; const c = G.player.controller;
  const props = G['propMeshes'].get('place').children.map((m) => m.position);
  const kinds = window.__village.gfGame['propMeshes'].get('place').children.length;
  let best = props[0];
  for (const q of props) if (Math.hypot(q.x - c.x, q.z - c.z) < Math.hypot(best.x - c.x, best.z - c.z)) best = q;
  c.x = best.x + 1.6; c.z = best.z; c.y = V.village.collision.groundAt(c.x, c.z, best.y + 3);
  G.cam.yaw = -Math.PI / 2; G.cam.pitch = 0;
  return 'couverts ' + kinds + ', caisse en ' + best.x.toFixed(1) + ' ; ' + best.z.toFixed(1);
})()`);
console.log(info);
await step(4);
await press('KeyQ');
await step(15);
console.log('à couvert :', await ev(`JSON.stringify(window.__village.gfGame.cover)`), '| accroupi :', await ev(`window.__village.gfGame.crouched`), '| badge :', await ev(`document.querySelector('.gf-stance').textContent`));
await side('71-couvert', -1.0, 3.2);
// viser : on se relève au-dessus du couvert bas
await step(12, ['Mouse2']);
console.log('en visant :', await ev(`window.__village.gfGame.crouched ? 'accroupi' : 'relevé'`));
await ev(`window.__village.input['down'].add('Mouse2')`);
await side('72-couvert-vise', -1.0, 3.2);
await ev(`window.__village.input['down'].delete('Mouse2')`);
// glisser le long puis quitter (Q)
await step(30, ['KeyD']);
console.log('après glissement :', await ev(`window.__village.gfGame.cover ? 'toujours à couvert' : 'couvert quitté (bout de la caisse)'`));
await press('KeyQ');
await step(3);
console.log('Q :', await ev(`window.__village.gfGame.cover ? 'à couvert' : 'libre'`));
console.log(errors.length ? `erreurs : ${errors.join(' | ')}` : 'aucune erreur de page');
await browser.close();
