/**
 * Captures d'écran de contrôle : ouvre la page (serveur Vite déjà lancé), attend la construction du village,
 * puis photographie chaque point de vue (extérieurs et intérieurs). Remonte les erreurs de la console.
 *
 *   npm run dev &   puis   npm run shots
 * Variables : BASE (défaut http://localhost:5173), OUT (défaut screenshots), ONLY=place,ensemble (filtre),
 *             WIDTH / HEIGHT, QUALITY (0, 1, 2), CHROMIUM_PATH.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE ?? 'http://localhost:5173';
const OUT = process.env.OUT ?? 'screenshots';
mkdirSync(OUT, { recursive: true });
const only = process.env.ONLY?.split(',');

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: Number(process.env.WIDTH ?? 1280), height: Number(process.env.HEIGHT ?? 720) } });
const errors: string[] = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[exception] ${e.message}`));
const t0 = Date.now();
await page.goto(BASE);
await page.waitForFunction(() => (window as unknown as { __village?: unknown }).__village, null, { timeout: 240_000 });
console.log(`village construit en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
const info = await page.evaluate(() => {
  const w = window as unknown as { __village: { village: { stats: unknown }; view: { views: { id: string; label: string }[] } } };
  return { stats: w.__village.village.stats, views: w.__village.view.views.map((v) => ({ id: v.id, label: v.label })) };
});
console.log('statistiques', info.stats);
if (process.env.QUALITY) await page.evaluate((q) => (window as unknown as { __village: { view: { setQuality(q: number): void } } }).__village.view.setQuality(q), Number(process.env.QUALITY));
await page.evaluate(() => {
  document.body.classList.add('collapsed');
  (window as unknown as { __village: { view: { paused: boolean } } }).__village.view.paused = true;
});
for (const v of info.views) {
  if (only && !only.some((o) => v.id.includes(o))) continue;
  await page.evaluate((id) => {
    const w = window as unknown as { __village: { view: { views: { id: string }[]; goTo(v: unknown, i: boolean): void } } };
    const view = w.__village.view;
    view.goTo(view.views.find((x) => x.id === id), true);
  }, v.id);
  // quelques images pour stabiliser lumières et ombres, puis lecture directe du canevas
  const t1 = Date.now();
  const png = await page.evaluate(() => {
    const w = window as unknown as { __village: { view: { renderFrame(): void; renderer: { domElement: HTMLCanvasElement } } } };
    for (let i = 0; i < 3; i++) w.__village.view.renderFrame();
    return w.__village.view.renderer.domElement.toDataURL('image/png');
  });
  const file = `${OUT}/${v.id.replace(/[^a-z0-9-]+/gi, '_').slice(0, 60)}.png`;
  writeFileSync(file, Buffer.from(png.split(',')[1], 'base64'));
  console.log(`  (${((Date.now() - t1) / 1000).toFixed(1)} s)`);
  const hud = await page.evaluate(() => document.querySelector('.stats')?.textContent ?? '');
  console.log(`${v.label.padEnd(36)} → ${file}  ${hud.replace(/\n/g, ' | ')}`);
}
console.log(errors.length ? `\n${errors.length} message(s) de console :\n${[...new Set(errors)].slice(0, 30).join('\n')}` : '\naucune erreur de console');
await browser.close();
