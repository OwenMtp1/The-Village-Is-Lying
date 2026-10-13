/**
 * Parcours réel dans le navigateur (serveur de jeu lancé : `npm run build && npm start`) :
 * menu → composition des rôles (préréglage, − / +, composition invalide expliquée) → salon → arrivée de
 * 7 autres joueurs → lancement → carte de rôle. Captures dans screenshots/roles/.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { io } from 'socket.io-client';

const BASE = process.env.BASE ?? 'http://localhost:3001';
const OUT = 'screenshots/roles';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 1100, height: 900 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(BASE);
await page.waitForFunction(() => (window as any).__village, null, { timeout: 240_000 });
await page.evaluate(`window.__village.view.paused = true`);
const text = (sel: string) => page.evaluate(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? ''`) as Promise<string>;
const click = (sel: string) => page.evaluate(`document.querySelector(${JSON.stringify(sel)}).click()`);
const shot = async (name: string) => writeFileSync(`${OUT}/${name}.png`, await page.screenshot({ timeout: 120_000 }));

await page.fill('.menu .name', 'Owen');
await click('.menu .sex [data-sex="F"]');
console.log('défaut :', await text('.menu .compo-total'));
await click('.menu [data-preset="tueurs-8"]');
console.log('préréglage « plusieurs tueurs » :', await text('.menu .compo-total'), '| bouton désactivé :', await page.evaluate(`document.querySelector('.menu .create').disabled`));
// composition invalide : aucun tueur → message clair, création impossible
await click('.menu [data-role="tueur"] [data-d="-1"]');
await click('.menu [data-role="tueur"] [data-d="-1"]');
console.log('0 tueur :', await text('.menu .compo-total'), '|', await text('.menu .compo-errors'), '| bouton désactivé :', await page.evaluate(`document.querySelector('.menu .create').disabled`));
await shot('1-composition-invalide');
// on remonte à 2 tueurs (composition « 2 / 1 / 1 / 4 »)
await click('.menu [data-role="tueur"] [data-d="1"]');
await click('.menu [data-role="tueur"] [data-d="1"]');
console.log('2 tueurs :', await text('.menu .compo-total'), '| erreurs :', JSON.stringify(await text('.menu .compo-errors')));
await shot('2-composition-8');
await click('.menu .create');
await page.waitForFunction(`document.querySelector('.lobby.open .lcode')?.textContent.length === 4`, null, { timeout: 20_000 });
const code = await text('.lobby .lcode');
console.log(`salon ${code} :`, await text('.lobby .lcount'), '|', await text('.lobby .lmissing'), '| lancer désactivé :', await page.evaluate(`document.querySelector('.lobby .start').disabled`));
// 5 joueurs arrivent
const bots = Array.from({ length: 7 }, () => io(BASE, { transports: ['websocket'], forceNew: true }));
const roles: string[] = [];
bots.forEach((b) => b.on('jeu:secret', (s: { role: string }) => roles.push(s.role)));
const join = (i: number) => new Promise((r) => bots[i].emit('salon:rejoindre', { code, name: `Villageois ${i + 1}`, sex: i % 2 ? 'F' : 'M' }, r));
for (let i = 0; i < 5; i++) await join(i);
await page.waitForTimeout(400);
console.log('6 joueurs :', await text('.lobby .lcount'), '|', await text('.lobby .lmissing'), '| lancer désactivé :', await page.evaluate(`document.querySelector('.lobby .start').disabled`));
await shot('3-salon-6-sur-8');
// l'hôte essaie une composition trop petite pour les présents : refus du serveur expliqué
await click('.lobby [data-preset="classique-6"]');
await page.waitForTimeout(400);
console.log('préréglage 6 joueurs avec 6 présents :', await text('.lobby .lcount'), '|', await text('.lobby .lmissing'));
await click('.lobby [data-preset="tueurs-8"]');
await page.waitForTimeout(400);
for (let i = 5; i < 7; i++) await join(i);
await page.waitForTimeout(400);
console.log('8 joueurs :', await text('.lobby .lcount'), '|', await text('.lobby .lmissing'), '| lancer désactivé :', await page.evaluate(`document.querySelector('.lobby .start').disabled`));
await shot('4-salon-complet');
await click('.lobby .start');
await page.waitForFunction(`document.querySelector('.online-hud.open .rc-role')`, null, { timeout: 60_000 });
await page.waitForTimeout(500);
const myRole = await text('.rc-role');
const all = [...roles, myRole.toLowerCase().replace('é', 'e').replace('shérif', 'sherif')];
console.log('rôle de l’hôte :', myRole, '| rôles reçus par les 7 autres :', roles.sort().join(', '));
console.log('verrouillage :', await new Promise((r) => bots[0].emit('salon:composition', { composition: { tueur: 1, sherif: 1, detective: 1, villageois: 5 } }, r)).then((x) => JSON.stringify(x)));
await page.evaluate(`window.__village.view.renderFrame()`);
await shot('5-carte-de-role');
void all;
console.log(errors.length ? `erreurs : ${errors.join(' | ')}` : 'aucune erreur de page');
for (const b of bots) b.close();
await browser.close();
