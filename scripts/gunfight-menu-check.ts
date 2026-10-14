/**
 * Contrôle du Gunfight : formulaire de création (aperçus des cartes, armes au choix, progression), partie solo en
 * progression (couteau au départ, robots au couteau), invincibilité d'apparition, animation de fin de partie.
 * Captures dans screenshots/gunfight/.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE ?? 'http://localhost:3001';
const OUT = 'screenshots/gunfight';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(BASE);
await page.waitForFunction(() => (window as any).__village, null, { timeout: 240_000 });
const ev = <T = unknown>(c: string) => page.evaluate(c) as Promise<T>;
const snap = async (n: string) => writeFileSync(`${OUT}/${n}.png`, await page.screenshot({ timeout: 120_000 }));
await ev(`window.__village.settings.set({ quality: 'basse' })`);
await page.waitForTimeout(1500);
await ev(`document.querySelector('[data-go="gunfight"]').click()`);
await page.fill('[data-screen="gunfight"] input.name', 'Owen');
await page.waitForTimeout(800);
await ev(`document.querySelector('[data-screen="gunfight"] [data-map="souterrains"]')?.click()`);
await page.waitForTimeout(300);
await snap('20-creation-cartes');
await ev(`document.querySelector('[data-screen="gunfight"] [data-arsenal="progression"]').click()`);
await page.waitForTimeout(300);
await ev(`document.querySelector('[data-screen="gunfight"] .gf-arsenal').scrollIntoView()`);
await snap('21-creation-progression');
// solo en progression sur la Place du Marché
await ev(`document.querySelector('[data-gtab="solo"][role=tab]').click()`);
await page.waitForTimeout(300);
await ev(`(() => { const t = document.querySelector('.gtab[data-gtab="solo"]'); t.querySelector('[data-map="place"]').click(); t.querySelector('[data-arsenal="progression"]').click(); t.querySelector('.gf-solo').click(); })()`);
await page.waitForFunction(`window.__village.mode() === 'gunfight' && window.__village.gfGame.player`, null, { timeout: 120_000 });
await ev(`window.__village.view.paused = true; window.__tick = setInterval(() => { window.__village.gfGame.update(1 / 30); window.__village.gfCtl.frame(); }, 33)`);
await page.waitForTimeout(600);
const st = await ev<string>(`(() => { const c = window.__village.gfCtl.client; const g = c.game; const me = g.players[c.me]; return 'carte ' + g.settings.map + ' | armes permises ' + me.weapons.join(',') + ' | en main ' + window.__village.gfGame.item + ' | protégé encore ' + ((me.shieldUntil - c.serverNow()) / 1000).toFixed(1) + ' s'; })()`);
console.log(st);
await ev(`window.__village.gfCtl.render(); window.__village.view.renderFrame()`);
await snap('22-progression-depart');
await page.waitForTimeout(25_000);
console.log('après 25 s :', await ev(`(() => { const c = window.__village.gfCtl.client; const g = c.game; return Object.entries(g.players).map(([id, p]) => c.nameOf(id) + ' ' + p.kills + ' élim. (' + p.weapons[0] + ')').join(' | ') + ' | fil : ' + g.feed.map((k) => k.weapon).join(','); })()`));
// fin de partie : le joueur gagne
await ev(`(() => { const c = window.__village.gfCtl.client; c.room['finish'](c.me, 'Owen atteint 20 éliminations.'); })()`);
// animations figées à des instants précis (la capture est lente sous swiftshader)
const at = (ms: number) => ev(`document.getAnimations().forEach((a) => { a.pause(); a.currentTime = ${ms}; })`);
await at(1500);
await snap('23-fin-banniere');
await at(4200);
await snap('24-fin-scores');
await ev(`clearInterval(window.__tick)`);
console.log(errors.length ? `erreurs : ${errors.join(' | ')}` : 'aucune erreur de page');
await browser.close();
