/**
 * Parcours complet de l'interface dans le navigateur (serveur lancé : `npm run build && npm start`) :
 * menu principal → paramètres → crédits → création d'un salon → arrivées / départ de joueurs (robots
 * Socket.IO) → lancement → interface de partie → pause → réunion d'urgence et vote sans majorité →
 * coup de feu du shérif et fin de partie → résultats → retour au salon → nouvelle manche.
 * Captures dans screenshots/ui/. Affiche les erreurs de page.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { io, type Socket } from 'socket.io-client';

const BASE = process.env.BASE ?? 'http://localhost:3001';
const OUT = 'screenshots/ui';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 1280, height: 800 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/fonts\.g/.test(m.text()) && errors.push(m.text()));
const t0 = Date.now();
await page.goto(BASE);
await page.waitForFunction(() => (window as any).__village, null, { timeout: 240_000 });
console.log(`village chargé en ${((Date.now() - t0) / 1000).toFixed(1)} s (swiftshader)`);
// rendu logiciel très lent : qualité basse (sauf QUALITE=moyenne) pour que la boucle du jeu avance pendant le test
if (process.env.QUALITE !== 'moyenne') await page.evaluate(`window.__village.settings.set({ quality: 'basse' })`);
const ev = <T = unknown>(code: string) => page.evaluate(code) as Promise<T>;
const text = (sel: string) => ev<string>(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? ''`);
const click = (sel: string) => ev(`document.querySelector(${JSON.stringify(sel)}).click()`);
const shot = async (name: string, frames = 2) => {
  await ev(`window.__village.view.paused = true`);
  for (let i = 0; i < frames; i++) await ev(`window.__village.view.renderFrame()`);
  writeFileSync(`${OUT}/${name}.png`, await page.screenshot({ timeout: 120_000 }));
  await ev(`window.__village.view.paused = false`);
};
const wait = (ms: number) => page.waitForTimeout(ms);

// mesure grossière (rendu logiciel : n'a aucune valeur pour une vraie carte graphique)
await wait(3000);
const info = await ev<{ calls: number; tris: number }>(`(() => { const r = window.__village.view.renderer.info.render; return { calls: r.calls, tris: r.triangles }; })()`);
console.log(`menu : ${info.calls} appels de dessin, ${(info.tris / 1e6).toFixed(2)} M triangles`);
console.log('mode :', await ev(`window.__village.mode()`), '| état réseau :', await text('.net-state'));
await shot('01-menu', 3);
// navigation clavier
await page.focus('.mm-nav [data-go="jouer"]');
await page.keyboard.press('ArrowDown');
console.log('focus après ↓ :', await ev(`document.activeElement.textContent`));
await click('[data-go="parametres"]');
await wait(700);
await shot('02-parametres');
await page.keyboard.press('Escape');
await click('[data-go="credits"]');
await wait(700);
await shot('03-credits');
await click('[data-screen="credits"] .back');
await page.setViewportSize({ width: 390, height: 800 });
await wait(500);
await shot('04-menu-mobile');
await page.setViewportSize({ width: 1280, height: 800 });
await click('[data-go="jouer"]');
await wait(600);
await page.fill('[data-screen="jouer"] input.name', 'Owen');
await click('[data-screen="jouer"] [data-preset="classique-6"]');
await click('[data-screen="jouer"] [data-role="detective"] [data-d="-1"]');
await click('[data-screen="jouer"] [data-role="villageois"] [data-d="-1"]');
console.log('composition :', await text('[data-screen="jouer"] .compo-total'));
await shot('05-jouer');
await click('.create');
await page.waitForFunction(`document.querySelector('.lobby-screen.open .lcode')?.textContent.length === 4`, null, { timeout: 20_000 });
const code = await text('.lcode');
console.log(`salon ${code} :`, (await text('.lcount')).replace(/\s+/g, ' '), '|', await text('.lmissing'));

// robots : 3 joueurs, dont un qui part puis un qui revient
const bots: Socket[] = [];
const secrets = new Map<Socket, { role: string }>();
const ids = new Map<Socket, string>();
const join = async (name: string) => {
  const b = io(BASE, { transports: ['websocket'], forceNew: true });
  b.on('jeu:secret', (s: { role: string }) => secrets.set(b, s));
  const r = (await new Promise((res) => b.emit('salon:rejoindre', { code, name, sex: 'F' }, res))) as { data: { playerId: string } };
  ids.set(b, r.data.playerId);
  bots.push(b);
  return b;
};
await join('Margot');
const leaver = await join('Bastien');
await wait(400);
leaver.emit('salon:quitter');
leaver.close();
bots.splice(bots.indexOf(leaver), 1);
await wait(400);
console.log('après départ :', (await text('.lcount')).replace(/\s+/g, ' '), '| notifications :', await ev(`[...document.querySelectorAll('.toast')].map(t => t.textContent).join(' / ')`));
await join('Hugo');
await join('Lise');
await new Promise((r) => bots[0].emit('salon:pret', { ready: true }, r));
await wait(500);
console.log('complet :', (await text('.lcount')).replace(/\s+/g, ' '), '|', await text('.lmissing'), '| bouton :', await text('.lactions .start'));
await shot('06-salon');

await click('.lactions .start');
await page.waitForFunction(`document.querySelector('.online-hud.open .rp-role')`, null, { timeout: 90_000 });
await wait(2500);
const hostId = await ev<string>(`window.__village.net.me`);
const hostRole = await ev<string>(`window.__village.net.secret.role`);
console.log('rôle de l’hôte :', hostRole, '| rôles des robots :', [...secrets.values()].map((s) => s.role).join(', '));
await shot('07-partie', 4);
await ev(`window.__village.gameUi.hud.toggleJournal(true); window.__village.gameUi.render()`);
await shot('08-journal');
await ev(`window.__village.gameUi.hud.toggleJournal(false)`);
await ev(`window.__village.gameUi.setPause(true)`);
// onglet Carte : plan du village et rôle
await wait(800);
await shot('09-pause');
await ev(`window.__village.gameUi.setPause(false)`);

// réunion d'urgence, personne n'obtient la majorité
await new Promise((r) => bots[0].emit('jeu:urgence', {}, r));
await page.waitForFunction(`document.querySelector('.meeting.open .vote-card')`, null, { timeout: 10_000 });
await new Promise((r) => bots[1].emit('jeu:voter', { target: null }, r));
await wait(600);
await shot('10-reunion');
await click('.meeting .skip');
for (const b of [bots[0], bots[2]]) await new Promise((r) => b.emit('jeu:voter', { target: null }, r));
await wait(800);
console.log('après le vote :', await ev(`window.__village.net.game.phase`), '|', await ev(`window.__village.net.game.log.slice(-1)[0]`));

// armes : selon le rôle tiré au sort pour l'hôte, il poignarde (tueur) ou tire (shérif) ; sinon un robot shérif tire
const roleOf = (r: string) => [...secrets].find(([, s]) => s.role === r)?.[0];
const killerBot = roleOf('tueur');
const sheriffBot = roleOf('sherif');
const killerId = killerBot ? ids.get(killerBot)! : hostId;
const poses = () => ev<Record<string, { x: number; y: number; z: number }>>(`window.__village.net.poses`);
const botPose = (b: Socket, x: number, z: number, yaw = 0, item: string | null = null) => b.emit('jeu:pose', { x, y: 0, z, yaw, speed: 0, grounded: true, vy: 0, dir: 1, torch: false, pitch: 0, item });
/** l'hôte regarde le point (x, z) : caméra et corps */
const look = (x: number, z: number) => ev(`(() => { const o = window.__village.online; const c = o.player.controller; o.cam.yaw = Math.atan2(${x} - c.x, ${z} - c.z); o.cam.pitch = -0.08; })()`);
const host = (await poses())[hostId];
const ahead = (d: number) => [host.x + Math.sin(0) * d, host.z + d] as const;
if (hostRole === 'sherif') {
  const [tx, tz] = ahead(5);
  await wait(2000);
  botPose(killerBot!, tx, tz);
  await wait(1500);
  await look(tx, tz);
  await page.keyboard.press('Digit2');
  await wait(2500);
  console.log('pistolet en main :', await ev(`window.__village.online.item`), '| viseur :', await ev(`document.body.classList.contains('aiming')`), '| inventaire :', (await text('.slot.weapon')).replace(/\s+/g, ' '));
  await shot('11a-pistolet');
  await ev(`window.__village.online.attack()`);
  console.log('tir de l’hôte (shérif) sur le tueur');
} else if (hostRole === 'tueur') {
  const victimBot = [...secrets].find(([, s]) => s.role === 'villageois')![0];
  const [vx, vz] = ahead(1.3);
  await wait(2000);
  botPose(victimBot, vx, vz);
  await page.keyboard.press('Digit2');
  await look(vx, vz);
  // délai du tueur après la réunion
  await page.waitForFunction(`window.__village.net.secret.killReadyAt <= Date.now() + window.__village.net.clockOffset`, null, { timeout: 40_000 });
  await wait(1500);
  console.log('couteau en main :', await ev(`window.__village.online.item`), '| actions :', await text('.prompts'));
  await shot('11a-couteau');
  await ev(`window.__village.online.attack()`);
  await wait(2500);
  console.log('victime au couteau :', await ev(`window.__village.net.game.alive[${JSON.stringify(ids.get(victimBot))}] === false`), '| corps :', await ev(`window.__village.net.game.bodies.length`));
  await shot('11b-corps');
  // fin : le robot shérif abat l'hôte
  const sb = sheriffBot!;
  const sp = (await poses())[ids.get(sb)!];
  botPose(sb, sp.x, sp.z, Math.atan2(host.x - sp.x, host.z - sp.z), 'pistolet');
  await wait(300);
  console.log('tir du robot :', JSON.stringify(await new Promise((r) => sb.emit('jeu:tirer', { target: hostId }, r))));
} else {
  const sb = sheriffBot!;
  const sp = (await poses())[ids.get(sb)!];
  const kp = (await poses())[killerId];
  botPose(sb, sp.x, sp.z, Math.atan2(kp.x - sp.x, kp.z - sp.z), 'pistolet');
  await wait(300);
  console.log('tir du robot shérif :', JSON.stringify(await new Promise((r) => sb.emit('jeu:tirer', { target: killerId }, r))));
}
await page.waitForFunction(`document.querySelector('.results.open')`, null, { timeout: 10_000 });
await wait(800);
console.log('résultats :', (await text('.res-box h2')).trim(), '|', await text('.res-reason'), '|', await text('.res-me'));
await shot('11-resultats');
await click('.results .back');
await page.waitForFunction(`document.querySelector('.lobby-screen.open')`, null, { timeout: 10_000 });
await wait(500);
console.log('retour au salon :', await ev(`window.__village.net.lobby.phase`), '|', await text('.lmissing'), '| mode :', await ev(`window.__village.mode()`));
await shot('12-retour-salon');
// nouvelle manche : aucun reste de la précédente
await click('.lactions .start');
await page.waitForFunction(`window.__village.net.game && !window.__village.net.game.result && Object.values(window.__village.net.game.alive).every(Boolean)`, null, { timeout: 30_000 });
console.log('nouvelle manche : tous vivants, corps :', await ev(`window.__village.net.game.bodies.length`), '| journal :', await ev(`window.__village.net.game.log.length`));
// redimensionnement
await page.setViewportSize({ width: 800, height: 600 });
await wait(400);
console.log('après redimensionnement, canvas :', await ev(`(() => { const c = document.querySelector('#app canvas'); return c.width + 'x' + c.height; })()`));
console.log(errors.length ? `erreurs : ${errors.join(' | ')}` : 'aucune erreur de page');
for (const b of bots) b.close();
await browser.close();
