/**
 * Armes dans le navigateur, rôle de l'hôte imposé (tirage à graine fixée, serveur de test lancé par ce script) :
 *  - shérif : sortir le pistolet (touche 2), viseur, tir sur le tueur → victoire des innocents ;
 *  - tueur : sortir le couteau, poignarder un villageois (corps qui tombe), puis être abattu par le robot shérif.
 * Nécessite `npm run build` (pages servies depuis dist/). Captures dans screenshots/ui/.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { io, type Socket } from 'socket.io-client';
import { createGameServer } from '../src/server/app';
import { Room } from '../src/server/room';

const OUT = 'screenshots/ui';
mkdirSync(OUT, { recursive: true });
const COMP = { tueur: 1, sherif: 1, detective: 0, villageois: 2 };
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
/** graine pour laquelle le premier joueur (l'hôte) reçoit `role` */
function seedFor(role: string) {
  for (let seed = 1; ; seed++) {
    const out = { lobby() {}, game() {}, secret() {}, event() {}, gesture() {} };
    const r = new Room('T', COMP, out, Date.now, seeded(seed));
    const ids = [0, 1, 2, 3].map((i) => r.join(`J${i}`, 'M').id);
    r.start(ids[0]);
    if (r.roleOf(ids[0]) === role) return seed;
  }
}

for (const role of ['sherif', 'tueur'] as const) {
  const server = createGameServer({ staticDir: join(process.cwd(), 'dist'), random: seeded(seedFor(role)) });
  await new Promise<void>((r) => server.http.listen(3101, r));
  const BASE = 'http://localhost:3101';
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/fonts\.g/.test(m.text()) && errors.push(m.text()));
  await page.goto(BASE);
  await page.waitForFunction(() => (window as any).__village, null, { timeout: 240_000 });
  const ev = <T = unknown>(code: string) => page.evaluate(code) as Promise<T>;
  const wait = (ms: number) => page.waitForTimeout(ms);
  const shot = async (name: string) => {
    await ev(`window.__village.view.paused = true; window.__village.view.renderFrame(); window.__village.view.renderFrame()`);
    writeFileSync(`${OUT}/${name}.png`, await page.screenshot({ timeout: 120_000 }));
    await ev(`window.__village.view.paused = false`);
  };
  await ev(`window.__village.settings.set({ quality: 'basse' })`);
  // le changement de qualité recompile les matériaux : on laisse passer quelques images
  await ev(`new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)))`);
  await wait(2000);
  const r = await ev<{ code: string }>(`window.__village.net.create('Owen', 'M', ${JSON.stringify(COMP)})`);
  const bots: Socket[] = [];
  const secrets = new Map<Socket, { role: string }>();
  const ids = new Map<Socket, string>();
  for (const name of ['Margot', 'Hugo', 'Lise']) {
    const b = io(BASE, { transports: ['websocket'], forceNew: true });
    b.on('jeu:secret', (s: { role: string }) => secrets.set(b, s));
    const res = (await new Promise((ok) => b.emit('salon:rejoindre', { code: r.code, name, sex: 'F' }, ok))) as { data: { playerId: string } };
    ids.set(b, res.data.playerId);
    bots.push(b);
  }
  await ev(`window.__village.net.start()`);
  await page.waitForFunction(`window.__village.online.player && window.__village.net.secret`, null, { timeout: 120_000 });
  const hostId = await ev<string>(`window.__village.net.me`);
  console.log(`— hôte ${await ev(`window.__village.net.secret.role`)} (attendu : ${role})`);
  const pose = (b: Socket, x: number, z: number, yaw = 0, item: string | null = null) => b.emit('jeu:pose', { x, y: 0, z, yaw, speed: 0, grounded: true, vy: 0, dir: 1, torch: false, pitch: 0, item });
  const host = await ev<{ x: number; z: number }>(`(({ x, z }) => ({ x, z }))(window.__village.online.player.controller)`);
  const look = (x: number, z: number) => ev(`(() => { const o = window.__village.online; const c = o.player.controller; o.cam.yaw = Math.atan2(${x} - c.x, ${z} - c.z); o.cam.pitch = -0.05; })()`);
  const botWith = (role: string) => [...secrets].find(([, s]) => s.role === role)![0];
  // le personnage devant lequel on se place : sur la place, vers le sud-est du puits
  const dir = Math.atan2(-2 - host.x, 0.5 - host.z) + Math.PI; // dos au puits
  if (role === 'sherif') {
    const killer = botWith('tueur');
    const tx = host.x + Math.sin(dir) * 6;
    const tz = host.z + Math.cos(dir) * 6;
    await wait(2000);
    pose(killer, tx, tz);
    await wait(1200);
    await look(tx, tz);
    await page.keyboard.press('Digit2');
    await wait(2500);
    console.log('pistolet :', await ev(`window.__village.online.item`), '| viseur :', await ev(`document.body.classList.contains('aiming')`), '| cible visée :', await ev(`window.__village.online.prompts.map(p => p.label).join(' / ')`));
    await shot('16-pistolet-vise');
    await ev(`window.__village.online.attack()`);
    await page.waitForFunction(`document.querySelector('.results.open')`, null, { timeout: 20_000 });
    console.log('résultat :', await ev(`document.querySelector('.res-box h2').textContent.trim()`), '| balles restantes :', await ev(`window.__village.net.secret.ammo`));
  } else {
    const victim = botWith('villageois');
    const vx = host.x + Math.sin(dir) * 1.3;
    const vz = host.z + Math.cos(dir) * 1.3;
    await wait(2000);
    pose(victim, vx, vz);
    await look(vx, vz);
    await page.keyboard.press('Digit2');
    await page.waitForFunction(`window.__village.net.secret.killReadyAt <= Date.now() + window.__village.net.clockOffset`, null, { timeout: 40_000 });
    await wait(1500);
    console.log('couteau :', await ev(`window.__village.online.item`), '| actions :', await ev(`window.__village.online.prompts.map(p => p.label).join(' / ')`));
    await shot('17-couteau');
    await ev(`window.__village.online.attack()`);
    await page.waitForFunction(`window.__village.net.game.bodies.length === 1`, null, { timeout: 20_000 });
    await wait(1200);
    console.log('victime :', await ev(`window.__village.net.game.alive[${JSON.stringify(ids.get(victim))}] === false`), '| geste vu par la victime : oui (serveur)');
    await shot('18-corps');
    const sheriff = botWith('sherif');
    const sp = (await ev<Record<string, { x: number; z: number }>>(`window.__village.net.poses`))[ids.get(sheriff)!];
    pose(sheriff, sp.x, sp.z, Math.atan2(host.x - sp.x, host.z - sp.z), 'pistolet');
    await wait(400);
    console.log('le robot shérif tire sur l’hôte :', JSON.stringify(await new Promise((ok) => sheriff.emit('jeu:tirer', { target: hostId }, ok))));
    await page.waitForFunction(`document.querySelector('.results.open')`, null, { timeout: 20_000 });
    console.log('résultat :', await ev(`document.querySelector('.res-box h2').textContent.trim()`));
  }
  console.log(errors.length ? `erreurs : ${errors.join(' | ')}` : 'aucune erreur de page');
  for (const b of bots) b.close();
  await browser.close();
  await server.close();
  await new Promise((ok) => server.http.close(() => ok(null)));
}
process.exit(0);
