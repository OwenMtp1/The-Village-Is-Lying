/**
 * Mode Gunfight dans le navigateur :
 *  1. solo contre 3 robots (chacun pour soi) : la partie démarre, les robots (armés au hasard) se déplacent et
 *     tirent, le joueur vise la tête d'un robot puis son corps, interface de combat et tableau des scores ;
 *     gros plans du personnage tenant chaque arme (prise à deux mains, canon dans l'axe du viseur) ;
 *  2. en ligne, match à mort par équipe : salle créée par la page, 3 robots Socket.IO rejoignent, choix des
 *     équipes, lancement, un adversaire tire sur l'hôte (dégâts), un allié ne peut pas.
 * Captures dans screenshots/gunfight/.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { io, type Socket } from 'socket.io-client';

const BASE = process.env.BASE ?? 'http://localhost:3001';
const OUT = 'screenshots/gunfight';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/fonts\.g/.test(m.text()) && errors.push(m.text()));
await page.goto(BASE);
await page.waitForFunction(() => (window as any).__village, null, { timeout: 240_000 });
const ev = <T = unknown>(c: string) => page.evaluate(c) as Promise<T>;
const wait = (ms: number) => page.waitForTimeout(ms);
const shot = async (name: string) => {
  await ev(`window.__village.view.paused = true; window.__village.view.renderFrame(); window.__village.view.renderFrame()`);
  writeFileSync(`${OUT}/${name}.png`, await page.screenshot({ timeout: 120_000 }));
  await ev(`window.__village.view.paused = false`);
};
await ev(`window.__village.settings.set({ quality: 'basse' })`);
await wait(2500);

// ── 1. menu et solo ──
await ev(`document.querySelector('[data-go="gunfight"]').click()`);
await wait(700);
await page.fill('[data-screen="gunfight"] input.name', 'Owen');
await shot('01-menu-gunfight');
await ev(`document.querySelector('[data-gtab="solo"][role=tab]').click()`);
await ev(`document.querySelector('[data-b="-1"]').click(); document.querySelector('[data-b="-1"]').click()`);
await ev(`document.querySelector('.gf-solo').click()`);
await page.waitForFunction(`window.__village.mode() === 'gunfight' && window.__village.gfGame.player`, null, { timeout: 120_000 });
console.log('solo lancé :', await ev(`Object.keys(window.__village.gfCtl.client.game.players).length`), 'joueurs | robots :', await ev(`window.__village.gfCtl.client.bots.length`));
// la partie vit 40 s en temps réel (rendu suspendu : la logique tourne à 30 images/s, robots compris)
await ev(`window.__village.view.paused = true; window.__tick = setInterval(() => window.__village.gfGame.update(1 / 30), 33)`);
await wait(40_000);
const g1 = await ev<{ kills: number; deaths: number; feed: number }>(`(() => { const g = window.__village.gfCtl.client.game; const ps = Object.values(g.players); return { kills: ps.reduce((s, p) => s + p.kills, 0), deaths: ps.reduce((s, p) => s + p.deaths, 0), feed: g.feed.length, hp: Object.values(g.players).map(p => p.hp).join('/') }; })()`);
console.log('après 40 s de jeu :', JSON.stringify(g1));
// un robot surgit à 9 m devant le joueur : il doit le repérer et lui tirer dessus ; le joueur vise et riposte
const res = await ev<string>(`(async () => {
  const V = window.__village; const G = V.gfGame; const c = V.gfCtl.client; const room = c.room; const me = G.player.controller;
  const bid = c.bots[0];
  const bot = G['bots'].get(bid);
  // sur la Grand-Rue, rue droite et dégagée : le joueur en (28 ; 2,5), le robot 9 m plus loin vers l'est
  const w = V.village.collision;
  const put = (id, ch, x, z, yaw) => {
    const y = w.groundAt(x, z, 5);
    ch.controller.x = x; ch.controller.z = z; ch.controller.y = y; ch.controller.vy = 0;
    room['poses'].set(id, { x, y, z, yaw, speed: 0, grounded: true, vy: 0, dir: 1, torch: false, pitch: 0, item: 'pistolet', t: Date.now() });
  };
  const place = () => {
    put(c.me, G.player, 28, 2.5, Math.PI / 2);
    put(bid, bot.ch, 37, 2.5, -Math.PI / 2);
    for (const s of room['state'].values()) s.shieldUntil = 0;
  };
  place();
  const hp0 = c.game.players[c.me].hp;
  await new Promise((r) => setTimeout(r, 4000));
  const hpAfter = c.game.players[c.me].hp;
  const out = ['vie du joueur ' + hp0 + '→' + hpAfter + ' (le robot a tiré)'];
  // viser la tête puis la poitrine du robot depuis la caméra (épaule) : quelques itérations, la caméra dépend du regard
  const aimAt = async (dy) => {
    place();
    for (let it = 0; it < 5; it++) {
      G.update(1 / 60);
      const cam = G.cam.camera.position; const t = bot.ch.root.position;
      G.cam.yaw = Math.atan2(t.x - cam.x, t.z - cam.z);
      G.cam.pitch = Math.atan2(t.y + dy - cam.y, Math.hypot(t.x - cam.x, t.z - cam.z));
    }
    G.update(1 / 60);
    G.cam.update(0, G.player, w);
    G.spread = 0;
    const before = c.game.players[bid].hp;
    G['nextFire'] = 0;
    G['attack'](performance.now() / 1000);
    await new Promise((r) => setTimeout(r, 450));
    return before + '→' + c.game.players[bid].hp + (c.game.feed.at(-1)?.head ? ' (tête)' : '');
  };
  out.push('tête : ' + await aimAt(bot.ch.height - 0.13));
  for (let k = 0; k < 3; k++) {
    if (!c.game.players[bid].alive) { out.push('robot abattu'); break; }
    out.push('corps : ' + await aimAt(1.15));
  }
  return out.join(' | ');
})()`);
console.log('tirs du joueur sur un robot (vie) :', res);
await ev(`clearInterval(window.__tick)`);
await ev(`window.__village.gfCtl.render()`);
await shot('02-solo-combat');
// gros plans : le joueur tient chaque arme, vu de côté et de trois quarts avant
for (const w of ['pistolet', 'fusil', 'pompe', 'precision']) {
  await ev(`(() => {
    const V = window.__village; const G = V.gfGame; const c = V.gfCtl.client;
    c.room['state'].get(c.me).alive = true;
    G.item = '${w}';
    G.cam.pitch = 0.05;
    for (let i = 0; i < 10; i++) G.update(1 / 30);
    const p = G.player.root.position; const yaw = G.player.yaw;
    const cam = G.cam.camera;
    // trois quarts avant droit, à hauteur d'épaule
    const a = yaw - 1.0;
    cam.position.set(p.x + Math.sin(a) * 1.7, p.y + 1.45, p.z + Math.cos(a) * 1.7);
    cam.lookAt(p.x + Math.sin(yaw) * 0.35, p.y + 1.3, p.z + Math.cos(yaw) * 0.35);
    G.player.root.visible = true;
    V.view.paused = true; V.view.renderFrame();
  })()`);
  writeFileSync(`${OUT}/06-prise-${w}.png`, await page.screenshot({ timeout: 120_000 }));
}
// vue de jeu, visée épaulée au fusil
await ev(`(() => { const G = window.__village.gfGame; G.item = 'fusil'; for (let i = 0; i < 10; i++) G.update(1 / 30); })()`);
await shot('07-vue-fusil');
await page.keyboard.down('Tab');
await ev(`window.__village.gfCtl.render()`);
await shot('03-solo-scores');
await page.keyboard.up('Tab');
await ev(`window.__village.gfCtl.quit()`);
await wait(500);
console.log('quitter : mode', await ev(`window.__village.mode()`), '| menu', await ev(`document.querySelector('.mm').classList.contains('open')`));

// ── 2. en ligne, équipes ──
await ev(`document.querySelector('[data-go="gunfight"]').click(); document.querySelector('[data-gtab="creer"][role=tab]').click()`);
await wait(500);
await ev(`document.querySelector('.gf-mode [data-mode="equipes"]').click(); document.querySelector('.gf-create').click()`);
await page.waitForFunction(`document.querySelector('.gf-lobby.open .lcode')?.textContent.length === 4`, null, { timeout: 20_000 });
const code = await ev<string>(`document.querySelector('.gf-lobby .lcode').textContent`);
const bots: Socket[] = [];
const ids: string[] = [];
for (const name of ['Margot', 'Hugo', 'Lise']) {
  const b = io(BASE, { transports: ['websocket'], forceNew: true });
  const r = (await new Promise((ok) => b.emit('gf:rejoindre', { code, name, sex: 'F' }, ok))) as { data: { playerId: string } };
  ids.push(r.data.playerId);
  bots.push(b);
}
const call = (b: Socket, e: string, p: unknown) => new Promise((ok) => b.emit(e, p, ok));
await call(bots[0], 'gf:equipe', { team: 'rouge' });
await call(bots[1], 'gf:equipe', { team: 'bleu' });
await call(bots[2], 'gf:equipe', { team: 'bleu' });
await ev(`window.__village.gfCtl.client.setTeam('rouge')`);
await wait(600);
console.log(`salle ${code} :`, (await ev<string>(`document.querySelector('.gf-lobby .lcount').textContent`)).replace(/\s+/g, ' '), '|', await ev(`document.querySelector('.gf-lobby .lmissing').textContent.trim()`));
await shot('04-salle-equipes');
await ev(`document.querySelector('.gf-lobby .start').click()`);
await page.waitForFunction(`window.__village.mode() === 'gunfight' && window.__village.gfGame.player`, null, { timeout: 120_000 });
await wait(1500);
const me = await ev<string>(`window.__village.gfCtl.client.me`);
const spawns = await ev<Record<string, { x: number; z: number }>>(`(() => { const g = window.__village.gfCtl.client.game; const o = {}; for (const [k, v] of Object.entries(g.players)) o[k] = v.spawn; return o; })()`);
// l'hôte reste à son point d'apparition ; un adversaire (bleu) vient à 6 m et tire, puis un allié (rouge)
const H = spawns[me];
const groundY = await ev<number>(`window.__village.gfGame.player.controller.y`);
const walkTo = async (b: Socket, id: string, x: number, z: number, yaw: number) => {
  const s = spawns[id];
  // 5 m/s au plus : le serveur refuse les déplacements impossibles
  const steps = Math.max(4, Math.ceil(Math.hypot(x - s.x, z - s.z) / 3.5));
  for (let i = 1; i <= steps; i++) {
    b.emit('gf:pose', { x: s.x + ((x - s.x) * i) / steps, y: groundY, z: s.z + ((z - s.z) * i) / steps, yaw, speed: 3, grounded: true, vy: 0, dir: 1, torch: false, pitch: 0, item: 'pistolet' });
    await new Promise((r) => setTimeout(r, 700));
  }
};
await Promise.all([walkTo(bots[1], ids[1], H.x, H.z + 6, Math.PI), walkTo(bots[0], ids[0], H.x + 1.5, H.z - 6, 0)]);
await wait(1600);
const shootAt = (b: number, from: { x: number; z: number }) => {
  const d = [H.x - from.x, groundY + 1.1 - (groundY + 1.5), H.z - from.z];
  const l = Math.hypot(d[0], d[1], d[2]);
  return call(bots[b], 'gf:tir', { weapon: 'pistolet', origin: [from.x, groundY + 1.5, from.z], dirs: [d.map((v) => v / l)] });
};
console.log('tir adverse :', JSON.stringify(await shootAt(1, { x: H.x, z: H.z + 6 })));
console.log('tir allié :', JSON.stringify(await shootAt(0, { x: H.x + 1.5, z: H.z - 6 })));
await wait(800);
console.log('vie de l’hôte :', await ev(`window.__village.gfCtl.client.game.players[window.__village.gfCtl.client.me].hp`));
await ev(`window.__village.gfCtl.render()`);
await shot('05-equipes-combat');
console.log(errors.length ? `erreurs : ${errors.join(' | ')}` : 'aucune erreur de page');
for (const b of bots) b.close();
await browser.close();
