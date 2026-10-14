/**
 * Déplacement du Gunfight : vitesse au trot, au sprint, en visée et à reculons (touches simulées), sprint arme
 * abaissée ; Souterrains en plein jour avec lampe et laser. Captures dans screenshots/gunfight/.
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
async function solo(map: string) {
  await ev(`window.__village.gfCtl.solo('Owen', 'M', { settings: { mode: 'ffa', map: '${map}', night: false, maxPlayers: 2, scoreLimit: 50, minutes: 10 }, bots: 1, difficulty: 'facile', team: 'rouge' })`);
  await ev(`document.querySelector('.mm')?.classList.remove('open')`);
  await page.waitForFunction(`window.__village.mode() === 'gunfight' && window.__village.gfGame.player`, null, { timeout: 120_000 });
  await ev(`window.__village.view.paused = true`);
}
await solo('village');
// vitesse mesurée sur 1 s de simulation pour chaque combinaison de touches
const speed = (keys: string[], hold: string[] = []) =>
  ev<string>(`(() => {
    const V = window.__village; const G = V.gfGame; const inp = V.input;
    for (const s of V.gfCtl.client.room['state'].values()) s.shieldUntil = Date.now() + 600000;
    const c = G.player.controller; c.x = 28; c.z = 2.5; c.y = V.village.collision.groundAt(28, 2.5, 5); c.vx = c.vz = 0;
    G.cam.yaw = Math.PI / 2; G.cam.pitch = 0;
    for (const k of ${JSON.stringify([...keys, ...hold])}) inp['down'].add(k);
    for (let i = 0; i < 6; i++) G.update(1 / 60);
    const x0 = c.x, z0 = c.z;
    for (let i = 0; i < 60; i++) { G.update(1 / 60); for (const k of ${JSON.stringify([...keys, ...hold])}) inp['down'].add(k); }
    const v = Math.hypot(c.x - x0, c.z - z0);
    const r = v.toFixed(2) + ' m/s' + (G.sprinting ? ' (sprint)' : '');
    for (const k of ${JSON.stringify([...keys, ...hold])}) inp['down'].delete(k);
    for (let i = 0; i < 30; i++) G.update(1 / 60);
    return r;
  })()`);
console.log('trot avant :', await speed(['KeyW']));
console.log('sprint :', await speed(['KeyW', 'ShiftLeft']));
console.log('en visée :', await speed(['KeyW'], ['Mouse2']));
console.log('de côté :', await speed(['KeyD']));
console.log('à reculons :', await speed(['KeyS']));
console.log('arrêt (distance de freinage depuis le trot) :', await ev(`(() => {
  const V = window.__village; const G = V.gfGame; const inp = V.input; const c = G.player.controller;
  inp['down'].add('KeyW'); for (let i = 0; i < 40; i++) G.update(1 / 60); inp['down'].delete('KeyW');
  const x0 = c.x, z0 = c.z; for (let i = 0; i < 60; i++) G.update(1 / 60);
  return Math.hypot(c.x - x0, c.z - z0).toFixed(2) + ' m';
})()`));
// sprint : capture de côté
await ev(`(() => {
  const V = window.__village; const G = V.gfGame; const inp = V.input;
  G.item = 'fusil';
  inp['down'].add('KeyW'); inp['down'].add('ShiftLeft');
  for (let i = 0; i < 30; i++) G.update(1 / 30);
  const p = G.player.root.position; const yaw = G.player.yaw; const cam = G.cam.camera;
  const keep = V.view.driver; V.view.driver = { update() {} };
  cam.position.set(p.x + Math.sin(yaw - 1.4) * 3, p.y + 1.5, p.z + Math.cos(yaw - 1.4) * 3); cam.lookAt(p.x, p.y + 1.1, p.z);
  V.view.renderFrame(); V.view.driver = keep;
  inp['down'].delete('KeyW'); inp['down'].delete('ShiftLeft');
})()`);
writeFileSync(`${OUT}/60-sprint.png`, await page.screenshot({ timeout: 120_000 }));
await ev(`window.__village.gfCtl.quit()`);
await page.waitForTimeout(500);
await solo('souterrains');
await ev(`(() => { const V = window.__village; const G = V.gfGame; G.item = 'fusil'; for (let i = 0; i < 20; i++) G.update(1 / 30); V.gfCtl.frame(); V.gfCtl.render(); V.view.renderFrame(); })()`);
console.log('souterrains de jour : lampe', await ev(`window.__village.torches.local.intensity > 0`), '| laser', await ev(`window.__village.gfGame['laserLine'].visible`));
writeFileSync(`${OUT}/61-souterrains-jour-lampe.png`, await page.screenshot({ timeout: 120_000 }));
console.log(errors.length ? `erreurs : ${errors.join(' | ')}` : 'aucune erreur de page');
await browser.close();
