/**
 * Cartes du Gunfight vues d'en haut (couverts, camps) et à hauteur d'homme. Captures dans screenshots/gunfight/.
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
await ev(`window.__village.view.paused = true; document.querySelector('.gf-hud').style.display = 'none'`);
for (const id of ['place', 'quartier', 'eglise', 'ferme', 'foret', 'village', 'souterrains']) {
  const info = await ev<string>(`(() => {
    const V = window.__village; const G = V.gfGame;
    G['setProps']('${id}');
    const props = G['propMeshes'].get('${id}');
    const pts = props.children.map((c) => c.position);
    const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
    const cz = pts.reduce((a, p) => a + p.z, 0) / pts.length;
    const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
    const cam = G.cam.camera;
    const keep = V.view.driver; V.view.driver = { update() {} };
    if ('${id}' === 'souterrains') { cam.position.set(-9, -6.2, -31); cam.lookAt(1, -7.5, -39); }
    else { cam.position.set(cx - 28, cy + 32, cz + 28); cam.lookAt(cx, cy, cz); }
    V.view.renderFrame(); V.view.driver = keep;
    return pts.length + ' couverts';
  })()`);
  writeFileSync(`${OUT}/50-carte-${id}.png`, await page.screenshot({ timeout: 120_000 }));
  console.log(id, info);
}
console.log(errors.length ? `erreurs : ${errors.join(' | ')}` : 'aucune erreur de page');
await browser.close();
