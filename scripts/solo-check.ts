/**
 * Exploration solo et cas d'erreur dans le navigateur : lancement, déplacement, sons sans erreur, pause →
 * menu, inspection de la carte, puis modèle de personnage introuvable (requête bloquée) : message clair.
 * Captures dans screenshots/ui/.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE ?? 'http://localhost:3001';
const OUT = 'screenshots/ui';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/fonts\.g|404|Failed to load resource/.test(m.text()) && errors.push(m.text()));
await page.goto(BASE);
await page.waitForFunction(() => (window as any).__village, null, { timeout: 240_000 });
const ev = <T = unknown>(code: string) => page.evaluate(code) as Promise<T>;
const shot = async (name: string) => {
  await ev(`window.__village.view.paused = true; window.__village.view.renderFrame(); window.__village.view.renderFrame()`);
  writeFileSync(`${OUT}/${name}.png`, await page.screenshot({ timeout: 120_000 }));
  await ev(`window.__village.view.paused = false`);
};
await page.mouse.click(900, 400); // geste : débloque l'audio
await ev(`document.querySelector('[data-go="jouer"]').click()`);
await ev(`document.querySelector('[data-tab="solo"]').click()`);
await ev(`document.querySelector('.solo').click()`);
await page.waitForFunction(`window.__village.mode() === 'solo'`, null, { timeout: 120_000 });
console.log('audio :', await ev(`(() => { try { return 'contexte ' + (window.__village && 'ok'); } catch (e) { return String(e); } })()`));
// rendu logiciel (swiftshader, ~3 images/s, aucune valeur de performance) : la logique du jeu est avancée
// directement, touche réellement enfoncée, 4 s à 60 images/s
await ev(`window.__village.view.paused = true`);
await page.keyboard.down('KeyW');
await ev(`for (let i = 0; i < 240; i++) window.__village.game.update(1 / 60)`);
await page.keyboard.up('KeyW');
const p = await ev<{ x: number; z: number }>(`(() => { const c = window.__village.game.player.controller; return { x: c.x, z: c.z }; })()`);
console.log('déplacement solo :', p.x.toFixed(2), p.z.toFixed(2), '(départ 3, 10.5)');
await ev(`window.__village.game.toggleTorch()`);
await shot('13-solo-nuit');
await ev(`window.__village.gameUi.setPause(true)`);
await page.waitForTimeout(600);
console.log('pause ouverte :', await ev(`document.querySelector('.pause').classList.contains('open')`), '| commandes gelées :', await ev(`window.__village.game.frozen`));
await ev(`document.querySelector('[data-p="quit"]').click()`);
await ev(`document.querySelector('[data-p="confirm"]').click()`);
await page.waitForTimeout(500);
console.log('après « quitter » :', await ev(`window.__village.mode()`), '| menu ouvert :', await ev(`document.querySelector('.mm').classList.contains('open')`), '| personnage retiré :', await ev(`window.__village.game.player === null`));
await ev(`document.querySelector('.inspect').click()`);
await page.waitForTimeout(500);
await shot('14-inspection');
await ev(`document.querySelector('.back-menu').click()`);
// ressource manquante : tous les modèles de personnages renvoient une erreur
await page.route(/\/characters\/[mf]\d+\.glb/, (r) => r.fulfill({ status: 404, body: 'absent' }));
await ev(`document.querySelector('[data-go="jouer"]').click()`);
await ev(`document.querySelector('[data-tab="solo"]').click()`);
await ev(`document.querySelector('.solo').click()`);
await page.waitForFunction(`/Impossible/.test(document.querySelector('[data-screen="jouer"] .status').textContent)`, null, { timeout: 30_000 });
console.log('modèle manquant :', await ev(`document.querySelector('[data-screen="jouer"] .status').textContent`), '| mode :', await ev(`window.__village.mode()`));
await shot('15-ressource-manquante');
console.log(errors.length ? `erreurs : ${errors.join(' | ')}` : 'aucune erreur de page');
await browser.close();
