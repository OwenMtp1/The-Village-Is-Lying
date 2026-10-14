/**
 * Contrôle visuel du Gunfight : gros plans de la prise de chaque arme (de face, de côté), rechargement,
 * marche de côté, puis vue de jeu avec mini-carte sur deux cartes (Place du Marché, Souterrains).
 * Captures dans screenshots/gunfight/. Nécessite le serveur (npm run build puis PORT=3001 npm start).
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
await page.waitForTimeout(2000);

async function solo(map: string) {
  await ev(`window.__village.gfCtl.solo('Owen', 'M', { settings: { mode: 'ffa', map: '${map}', maxPlayers: 4, scoreLimit: 50, minutes: 10 }, bots: 2, difficulty: 'facile', team: 'rouge' })`);
  await ev(`document.querySelector('.mm')?.classList.remove('open')`);
  await page.waitForFunction(`window.__village.mode() === 'gunfight' && window.__village.gfGame.player`, null, { timeout: 120_000 });
  await ev(`window.__village.view.paused = true`);
  await ev(`(() => { const G = window.__village.gfGame; for (let i = 0; i < 20; i++) G.update(1 / 30); })()`);
}
/** gros plan : caméra posée à la main (le jeu ne la déplace pas pendant le rendu) */
async function close(name: string, setup: string, angle: number, dist = 1.6) {
  await ev(`(() => {
    const V = window.__village; const G = V.gfGame;
    ${setup}
    const p = G.player.root.position; const yaw = G.player.yaw; const cam = G.cam.camera;
    const a = yaw + ${angle};
    const keep = V.view.driver;
    V.view.driver = { update() {} };
    cam.position.set(p.x + Math.sin(a) * ${dist}, p.y + 1.45, p.z + Math.cos(a) * ${dist});
    cam.lookAt(p.x + Math.sin(yaw) * 0.3, p.y + 1.25, p.z + Math.cos(yaw) * 0.3);
    G.player.root.visible = true;
    V.view.renderFrame();
    V.view.driver = keep;
  })()`);
  writeFileSync(`${OUT}/${name}.png`, await page.screenshot({ timeout: 120_000 }));
}

await solo('place');
for (const w of ['pistolet', 'fusil', 'pompe', 'precision']) {
  const setup = `G.item = '${w}'; G.cam.pitch = 0.0; for (let i = 0; i < 12; i++) G.update(1 / 30);`;
  await close(`10-prise-${w}-face`, setup, -0.9);
  await close(`11-prise-${w}-cote`, setup, -1.57, 1.4);
}
// rechargement (à mi-course) et marche de côté
await close('12-rechargement-fusil', `G.item = 'fusil'; for (let i = 0; i < 6; i++) G.update(1 / 30); G.player.animator.reloading = 0.45; G.player.animator.update(1/60, { speed: 0, direction: 1, turnRate: 0, grounded: true, vy: 0 });`, -0.9);
await close('13-marche-cote', `G.item = 'fusil'; const c = G.player.controller; for (let i = 0; i < 25; i++) { c.vx = Math.cos(G.player.yaw) * -3; c.vz = Math.sin(G.player.yaw) * 3; G.player.aimYaw = G.cam.yaw; G.player.update(1 / 30, { x: -Math.cos(G.cam.yaw), z: Math.sin(G.cam.yaw), run: false, jump: false }, G.cam.yaw); }`, -0.6, 2.4);
// vue de jeu + mini-carte
await ev(`(() => { const G = window.__village.gfGame; G.item = 'fusil'; for (let i = 0; i < 10; i++) G.update(1 / 30); window.__village.gfCtl.frame(); window.__village.gfCtl.render(); window.__village.view.renderFrame(); })()`);
writeFileSync(`${OUT}/14-place-jeu.png`, await page.screenshot({ timeout: 120_000 }));
await ev(`window.__village.gfCtl.quit()`);
await page.waitForTimeout(500);
await solo('souterrains');
console.log('souterrains : y joueur', await ev(`window.__village.gfGame.player.controller.y.toFixed(2)`));
await ev(`(() => { const G = window.__village.gfGame; G.item = 'pistolet'; for (let i = 0; i < 10; i++) G.update(1 / 30); window.__village.gfCtl.frame(); window.__village.gfCtl.render(); window.__village.view.renderFrame(); })()`);
writeFileSync(`${OUT}/15-souterrains-jeu.png`, await page.screenshot({ timeout: 120_000 }));
console.log(errors.length ? `erreurs : ${errors.join(' | ')}` : 'aucune erreur de page');
await browser.close();
console.log('FIN');
