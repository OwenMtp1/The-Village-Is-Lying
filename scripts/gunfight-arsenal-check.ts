/**
 * Arsenal du Gunfight : gros plans des armes tenues (nouvelles armes), panneau d'équipement, grenade (explosion),
 * fumigène, aveuglante, robots lanceurs. Captures dans screenshots/gunfight/.
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
const snap = async (n: string) => writeFileSync(`${OUT}/${n}.png`, await page.screenshot({ timeout: 120_000 }));
await ev(`window.__village.settings.set({ quality: 'basse' })`);
await page.waitForTimeout(1500);
await ev(`window.__village.gfCtl.solo('Owen', 'M', { settings: { mode: 'ffa', map: 'place', maxPlayers: 4, scoreLimit: 50, minutes: 10 }, bots: 3, difficulty: 'normal', team: 'rouge' })`);
await ev(`document.querySelector('.mm')?.classList.remove('open')`);
await page.waitForFunction(`window.__village.mode() === 'gunfight' && window.__village.gfGame.player`, null, { timeout: 120_000 });
await ev(`window.__village.view.paused = true`);
const shield = `for (const s of window.__village.gfCtl.client.room['state'].values()) s.shieldUntil = Date.now() + 600000;`;
for (const [primary, secondary] of [['mitraillette', 'revolver'], ['assaut', 'pm'], ['tactique', 'pistolet'], ['mitrailleuse', 'pistolet']]) {
  for (const w of [primary, ...(secondary !== 'pistolet' ? [secondary] : [])]) {
    await ev(`(() => {
      const V = window.__village; const G = V.gfGame; const c = V.gfCtl.client;
      ${shield}
      c.room.setLoadout(c.me, { primary: '${primary}', secondary: '${secondary}' });
      G.item = '${w}'; G.cam.pitch = 0;
      for (let i = 0; i < 12; i++) G.update(1 / 30);
      const p = G.player.root.position; const yaw = G.player.yaw; const cam = G.cam.camera;
      const keep = V.view.driver; V.view.driver = { update() {} };
      const a = yaw - 1.1;
      cam.position.set(p.x + Math.sin(a) * 1.6, p.y + 1.45, p.z + Math.cos(a) * 1.6);
      cam.lookAt(p.x + Math.sin(yaw) * 0.35, p.y + 1.25, p.z + Math.cos(yaw) * 0.35);
      G.player.root.visible = true; V.view.renderFrame(); V.view.driver = keep;
    })()`);
    await snap(`40-arme-${w}`);
  }
}
// panneau d'équipement
await ev(`(() => { const V = window.__village; V.gfGame.onLoadout(); V.gfCtl.render(); V.view.renderFrame(); })()`);
await snap('41-equipement');
console.log('panneau ouvert :', await ev(`window.__village.gfCtl.hud.kitOpen`));
await ev(`document.querySelector('.gf-kit-w[data-w="pompe"]').click()`);
await page.waitForTimeout(300);
console.log('équipement après clic :', await ev(`JSON.stringify(window.__village.gfCtl.client.game.players[window.__village.gfCtl.client.me].loadout)`), '| armes', await ev(`window.__village.gfCtl.client.game.players[window.__village.gfCtl.client.me].weapons.join(',')`));
await ev(`window.__village.gfCtl.hud.onKitClose()`);
// grenade et fumigène lancés devant soi
await ev(`(() => { const G = window.__village.gfGame; G.cam.pitch = 0.1; G.update(1 / 30); G['nextThrow'] = 0; G['throwGrenade']('frag'); })()`);
for (let i = 0; i < 70; i++) await ev(`(() => { const V = window.__village; V.gfGame.update(1 / 30); })()`);
await ev(`(() => { const V = window.__village; const t0 = performance.now(); while (V.gfCtl.client.serverNow() < [...V.gfGame['flying'].values()][0]?.g.explodeAt) {} V.gfCtl.client.room.tick(); V.gfGame.update(1 / 60); V.gfGame.update(1 / 60); V.gfCtl.frame(); V.gfCtl.render(); V.view.renderFrame(); })()`);
await snap('42-explosion');
await ev(`(() => { const G = window.__village.gfGame; G['nextThrow'] = 0; G['throwGrenade']('fumee'); })()`);
await page.waitForTimeout(3500);
await ev(`(() => { const V = window.__village; V.gfCtl.client.room.tick(); for (let i = 0; i < 40; i++) V.gfGame.update(1 / 30); V.gfCtl.frame(); V.gfCtl.render(); V.view.renderFrame(); })()`);
await snap('43-fumigene');
console.log('fumées :', await ev(`window.__village.gfCtl.client.game.smokes.length`), '| grenades restantes', await ev(`JSON.stringify(window.__village.gfCtl.client.game.players[window.__village.gfCtl.client.me].grenades)`));
// les robots jouent 30 s (armes au hasard, grenades)
await ev(`window.__tick = setInterval(() => { const V = window.__village; V.gfGame.update(1 / 30); }, 33)`);
await page.waitForTimeout(30_000);
console.log('robots :', await ev(`(() => { const c = window.__village.gfCtl.client; const g = c.game; return Object.entries(g.players).map(([id, p]) => c.nameOf(id) + ' ' + p.weapons[0] + ' ' + p.kills + ' élim. grenades ' + p.grenades.frag).join(' | ') + ' | fil : ' + g.feed.map((k) => k.weapon).join(','); })()`));
console.log(errors.length ? `erreurs : ${errors.join(' | ')}` : 'aucune erreur de page');
await browser.close();
