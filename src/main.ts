/**
 * Point d'entrée : construit le village (écran de chargement), puis ouvre le menu principal sur une vue
 * cinématique du village. Quatre modes : menu (et salon), exploration solo, partie en ligne, inspection
 * libre de la carte. Réglages, sons et vie du décor sont branchés ici.
 */
import * as THREE from 'three';
import { buildVillage, type Village } from './village/village';
import { heightAt } from './village/layout';
import { UNDER } from './village/underground';
import { VillageView, type RoofMode } from './village/view';
import { CinematicCamera } from './village/cinematic';
import { VillageLife } from './village/life';
import { Input } from './input';
import { Game } from './characters/game';
import { VARIANTS, cardUrl, type Sex } from './characters/catalog';
import { loadCharacter } from './characters/assets';
import { GameUi, type AppMode } from './client/ui';
import { OnlineGame } from './client/online';
import { GunfightGame } from './client/gunfight';
import { GunfightController } from './client/gunfightCtl';
import { JUMP, MOVE } from './characters/config';
import { Flashlights } from './characters/flashlight';
import { dayState } from './shared/rules';
import { net } from './client/net';
import { QUALITY_INDEX, settings } from './ui/settings';
import { GAME_TITLE } from './ui/brand';
import { esc } from './ui/dom';
import { ICON } from './ui/icons';
import { unlockOnGesture } from './audio/engine';
import { Ambience } from './audio/ambience';
import { Footsteps } from './audio/footsteps';
import { sfx } from './audio/sfx';

document.title = GAME_TITLE;
const app = document.getElementById('app')!;
const loading = document.createElement('div');
loading.className = 'loading';
loading.innerHTML = `<div class="loading-box"><div class="mm-kicker">Chargement</div><h1>${esc(GAME_TITLE)}</h1><div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><i></i></div><div class="label" aria-live="polite">Le village s'endort…</div></div>`;
document.body.appendChild(loading);
const bar = loading.querySelector('.bar i') as HTMLElement;
const label = loading.querySelector('.label') as HTMLElement;

/** Échec du chargement (WebGL absent, ressource manquante…) : message clair au lieu d'un écran figé. */
function fatal(e: unknown) {
  console.error(e);
  const msg = e instanceof Error ? e.message : String(e);
  loading.classList.add('failed');
  loading.querySelector('.loading-box')!.innerHTML = `<div class="mm-kicker">Erreur</div><h1>Le village n’a pas pu se charger</h1>
    <p class="label">${esc(msg)}</p><p class="hint">Vérifiez que votre navigateur prend en charge WebGL 2 (Chrome, Firefox, Edge ou Safari récents), puis rechargez la page.</p>
    <button type="button" class="primary" onclick="location.reload()">Recharger</button>`;
}

let village: Village;
let view: VillageView;
try {
  village = await buildVillage((f, text) => {
    bar.style.width = `${Math.round(f * 100)}%`;
    label.textContent = text;
  });
  bar.style.width = '100%';
} catch (e) {
  fatal(e);
  throw e;
}
const input = new Input(app);
try {
  view = new VillageView(app, village, input);
} catch (e) {
  fatal(new Error(`Rendu 3D indisponible : ${(e as Error).message}`));
  throw e;
}
const torches = new Flashlights(view.scene);
const game = new Game(village, view.scene, view.camera, input, torches);
const online = new OnlineGame(village, view.scene, view.camera, input, torches);
const cinematic = new CinematicCamera(view.camera);
const life = new VillageLife(village.root, view.scene);
unlockOnGesture();
const ambience = new Ambience();
const footsteps = new Footsteps();

// ── modes ──
let mode: AppMode = 'menu';
const setBodyMode = () => {
  for (const m of ['menu', 'solo', 'online', 'inspection', 'gunfight'] as const) document.body.classList.toggle(`mode-${m}`, mode === m);
  document.body.classList.toggle('playing', mode === 'solo' || mode === 'online');
};
const soloUpdate = (dt: number) => game.update(dt);
const onlineUpdate = (dt: number) => online.update(dt);
const gunfightUpdate = (dt: number) => {
  gfGame.update(dt);
  gfCtl.frame();
};
const cinematicUpdate = (dt: number) => cinematic.update(dt);
let inspectRoof: RoofMode = 'auto';

function setMode(m: AppMode) {
  if (m === mode && view.driver) return;
  if (mode === 'inspection') inspectRoof = view.roofMode;
  mode = m;
  input.flush();
  if (m === 'menu') {
    view.driver = { update: cinematicUpdate };
    // au-dessus des toits : toujours visibles (le mode « auto » les masquerait au survol)
    view.setRoofMode('visible');
    input.unlock();
  } else if (m === 'inspection') {
    view.driver = null;
    view.setRoofMode(inspectRoof);
    view.camera.fov = 58;
    view.camera.updateProjectionMatrix();
    view.goTo(view.views[0], true);
    input.unlock();
  } else {
    view.setRoofMode('auto');
    view.driver = { update: m === 'solo' ? soloUpdate : m === 'gunfight' ? gunfightUpdate : onlineUpdate };
  }
  setBodyMode();
}

// ── interface d'inspection (outil de la carte) ──
const ui = document.createElement('div');
ui.className = 'inspect-ui';
ui.innerHTML = `
  <div class="hud hud-top">
    <div><div class="title">${esc(GAME_TITLE)} — inspection de la carte</div><div class="place"></div></div>
    <div class="stats"></div>
  </div>
  <button class="toggle">Points de vue</button>
  <div class="panel">
    <button class="hide-btn" title="Masquer">×</button>
    <button class="back-menu">← Menu principal</button>
    <button class="open-map">🗺 Carte du village (M)</button>
    <h2>Caméra</h2>
    <div class="seg" data-k="mode"><button data-v="orbite">Orbite</button><button data-v="vol">Vol libre</button></div>
    <h2>Toits</h2>
    <div class="seg" data-k="roof"><button data-v="auto">Auto</button><button data-v="visible">Visibles</button><button data-v="masque">Masqués</button></div>
    <h2>Extérieurs</h2><div class="ext"></div>
    <h2>Intérieurs</h2><div class="int"></div>
    <div class="help">
      <kbd>M</kbd> carte (clic : s'y rendre) · <kbd>F</kbd> orbite / vol libre · <kbd>R</kbd> toits · <kbd>F3</kbd> mesures<br>
      Orbite : glisser pour tourner, clic droit pour déplacer, molette pour zoomer.<br>
      Vol : <kbd>Z Q S D</kbd> ou <kbd>W A S D</kbd>, glisser pour regarder, <kbd>Espace</kbd>/<kbd>C</kbd> monter/descendre, <kbd>Maj</kbd> plus vite, molette : vitesse.
    </div>
  </div>`;
document.body.appendChild(ui);
const place = ui.querySelector('.place') as HTMLElement;
const stats = ui.querySelector('.stats') as HTMLElement;
for (const v of view.views) {
  const b = document.createElement('button');
  b.textContent = v.label;
  b.onclick = () => view.goTo(v);
  ui.querySelector(v.group === 'Extérieurs' ? '.ext' : '.int')!.appendChild(b);
}
const refresh = () => {
  for (const seg of ui.querySelectorAll<HTMLElement>('.seg')) {
    const cur = seg.dataset.k === 'mode' ? view.mode : view.roofMode;
    for (const b of seg.querySelectorAll<HTMLButtonElement>('button')) b.classList.toggle('on', b.dataset.v === cur);
  }
};
ui.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
  const seg = b?.parentElement as HTMLElement | null;
  if (!b || !seg?.dataset.k) return;
  if (seg.dataset.k === 'mode') view.setMode(b.dataset.v as 'orbite' | 'vol');
  if (seg.dataset.k === 'roof') view.setRoofMode(b.dataset.v as RoofMode);
  refresh();
});
ui.querySelector('.hide-btn')!.addEventListener('click', () => document.body.classList.add('collapsed'));
ui.querySelector('.toggle')!.addEventListener('click', () => document.body.classList.remove('collapsed'));
window.addEventListener('keyup', () => refresh());
refresh();
let showStats = false;
window.addEventListener('keydown', (e) => {
  if (e.code === 'F3') {
    showStats = !showStats;
    document.body.classList.toggle('show-stats', showStats);
    e.preventDefault();
  }
});
view.onInfo = (i) => {
  place.textContent = i.place;
  perf.textContent = `${i.fps.toFixed(0)} img/s · ${i.calls} appels · ${(i.tris / 1e6).toFixed(2)} M triangles · ${i.lights} lumières`;
  stats.textContent = perf.textContent;
};
const perf = document.createElement('div');
perf.className = 'perf';
perf.setAttribute('aria-hidden', 'true');
document.body.appendChild(perf);

// ── exploration solo : carte du personnage, pause ──
const soloHud = document.createElement('div');
soloHud.className = 'solo-hud';
soloHud.innerHTML = `<div class="who"><img alt=""><div><div class="mm-kicker">Exploration solo</div><div class="who-name"></div><div class="who-sub"></div></div></div>
  <button type="button" class="hud-btn pause-btn" title="Menu (Échap)" aria-label="Menu de pause">${ICON.menu}</button>
  <div class="controls-help"><span>Cliquez pour diriger la caméra</span><span><kbd>Z Q S D</kbd> marcher</span><span><kbd>Maj</kbd> courir</span><span><kbd>Espace</kbd> sauter</span><span><kbd>V</kbd> vue subjective</span><span><kbd>L</kbd> lampe</span><span><kbd>N</kbd> vol libre</span><span><kbd>M</kbd> carte</span><span><kbd>Échap</kbd> menu</span></div>
  <div class="noclip-badge" role="status">Vol libre — traverse les murs · <kbd>Espace</kbd> / <kbd>C</kbd> monter / descendre · <kbd>Maj</kbd> plus vite · <kbd>N</kbd> pour atterrir</div>`;
document.body.appendChild(soloHud);

// ── mode Gunfight ──
const gfGame = new GunfightGame(village, view.scene, view.camera, input, torches);
let gfCtl: GunfightController;
const gameUi = new GameUi({
  gunfight: {
    create: (n, sx, st) => gfCtl.create(n, sx, st),
    join: (code, n, sx) => gfCtl.join(code, n, sx),
    solo: (n, sx, o) => gfCtl.solo(n, sx, o),
  },
  gfActive: () => !!gfCtl?.active,
  gfPauseCard: () => gfCtl.pauseCard(),
  quitGunfight: () => gfCtl.quit(),
  mode: () => mode,
  async solo(sex: Sex) {
    const info = await game.start(sex);
    (soloHud.querySelector('.who img') as HTMLImageElement).src = cardUrl(info.player.variant);
    soloHud.querySelector('.who-name')!.textContent = info.player.firstName;
    soloHud.querySelector('.who-sub')!.textContent = sex === 'F' ? 'Personnage féminin' : 'Personnage masculin';
    setMode('solo');
  },
  enterOnline() {
    // nouvelle partie (ou relance) : personnages recréés avec les apparences tirées par le serveur
    const key = `${net.game?.startedAt}|${JSON.stringify(net.game?.appearances ?? {})}`;
    if (key !== onlineKey) {
      onlineKey = key;
      game.end();
      online.dispose();
      online.ensure().catch((e: Error) => gameUi.toast(`Personnages non chargés : ${e.message}`, 'bad'));
    }
    if (mode !== 'online') setMode('online');
  },
  exitOnline() {
    online.dispose();
    onlineKey = '';
    if (mode === 'online') setMode('menu');
  },
  toMenu() {
    game.end();
    setMode('menu');
  },
  inspect: () => setMode('inspection'),
  setPaused(on) {
    game.frozen = on;
    online.paused = on;
    gfGame.paused = on;
    // exploration libre : la caméra ne bouge plus pendant qu'on consulte la carte
    if (mode === 'inspection') {
      view.paused = on;
      input.flush();
    }
  },
  playerPose() {
    if (mode === 'inspection') {
      // exploration libre : la position de la caméra
      const d = view.camera.getWorldDirection(new THREE.Vector3());
      return { x: view.camera.position.x, z: view.camera.position.z, yaw: Math.atan2(d.x, d.z) };
    }
    const p = mode === 'online' ? online.player : mode === 'solo' ? game.player : mode === 'gunfight' ? gfGame.player : null;
    if (!p) return null;
    const cam = mode === 'online' ? online.cam : mode === 'gunfight' ? gfGame.cam : game.cam;
    return { x: p.controller.x, z: p.controller.z, yaw: cam.yaw };
  },
  soloCard() {
    if (mode === 'inspection')
      return `<div class="role-panel solo-card"><div class="rp-body"><div class="rp-role"><span>Exploration libre</span></div>
        <div class="rp-camp">Caméra sans personnage</div>
        <p class="rp-desc">Cliquez n'importe où sur la carte pour y placer la caméra, au niveau du sol. Cochez « Souterrains » pour voir les galeries et vous y rendre.</p>
        <ul class="rp-lines"><li><kbd>Z Q S D</kbd><span>voler</span></li><li><kbd>Espace</kbd> / <kbd>C</kbd><span>monter / descendre</span></li><li><kbd>M</kbd><span>carte</span></li></ul></div></div>`;
    const info = game.info;
    if (!info) return '';
    return `<div class="role-panel solo-card"><img class="portrait" src="${cardUrl(info.player.variant)}" alt=""><div class="rp-body"><div class="rp-role"><span>${esc(info.player.firstName)}</span></div>
      <div class="rp-camp">Exploration solo</div>
      <p class="rp-desc">Cliquez n'importe où sur la carte pour vous y rendre. Cochez « Souterrains » pour voir les galeries et vous y téléporter.</p>
      <ul class="rp-lines"><li><kbd>N</kbd><span>vol libre à travers les murs</span></li><li><kbd>L</kbd><span>lampe de poche</span></li><li><kbd>V</kbd><span>vue subjective</span></li></ul></div></div>`;
  },
  teleport(x, z, underground) {
    if (mode === 'inspection') {
      // la caméra se pose à hauteur d'homme au point choisi, regard inchangé (vers le nord par défaut)
      const ground = underground ? UNDER.floor : village.collision.groundAt(x, z, heightAt(x, z) + 0.6);
      const y = (Number.isFinite(ground) ? ground : heightAt(x, z)) + 1.7;
      const d = view.camera.getWorldDirection(new THREE.Vector3()).setY(0);
      if (d.lengthSq() < 1e-4) d.set(0, 0, -1);
      d.normalize();
      view.goTo({ id: 'carte', label: 'Carte', group: 'Extérieurs', mode: 'vol', pos: new THREE.Vector3(x, y, z), target: new THREE.Vector3(x + d.x * 10, y, z + d.z * 10) }, true);
      return;
    }
    game.teleport(x, z, underground);
  },
});
let onlineKey = '';
gameUi.attach(online);
soloHud.querySelector('.pause-btn')!.addEventListener('click', () => gameUi.setPause(true));
ui.querySelector('.back-menu')!.addEventListener('click', () => gameUi.backToMenu());
ui.querySelector('.open-map')!.addEventListener('click', () => {
  gameUi.pause.setTab('carte');
  gameUi.setPause(true);
});

// ── réglages appliqués en direct ──
settings.subscribe((s) => {
  if (QUALITY_INDEX[s.quality] !== view.quality) view.setQuality(QUALITY_INDEX[s.quality]);
  cinematic.still = s.reduceMotion;
  life.reduceMotion = s.reduceMotion;
});

// ── cycle du jour, inventaire (lampe de poche), sons et vie du décor ──
const elapsed = () => (mode === 'online' ? online.elapsed : mode === 'solo' ? game.elapsed : 0);
// Gunfight : en plein jour (on voit ses adversaires)
view.daylightSource = () => (mode === 'gunfight' ? (gfGame.night ? 0 : 1) : mode === 'online' || mode === 'solo' ? dayState(elapsed()).light : 0);
view.afterAtmosphere = (dt, daylight) => {
  life.update(dt, daylight, view.renderer.domElement.height);
  ambience.set(daylight, mode !== 'inspection');
  const meeting = mode === 'online' && net.game?.phase === 'reunion';
  ambience.setMusic(mode === 'menu' ? 'menu' : meeting ? 'reunion' : 'jeu');
  if (mode === 'solo') footsteps.update(dt, game.characters.map((c, i) => ({ id: c.id, x: c.controller.x, y: c.controller.y, z: c.controller.z, grounded: c.controller.grounded, local: i === 0 })), view.camera);
  else if (mode === 'online') footsteps.update(dt, online.walkers(), view.camera);
  else if (mode === 'gunfight') footsteps.update(dt, gfGame.walkers(), view.camera);
};
const inv = document.createElement('div');
inv.className = 'inventory';
inv.innerHTML = `<div class="clock" role="timer"><span class="clock-icon" aria-hidden="true"></span><span class="clock-text"></span></div><button type="button" class="slot" title="Allumer ou éteindre (L)" aria-pressed="false"><span class="slot-key">L</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9h9l3-3h4v12h-4l-3-3H3z" fill="currentColor"/><path d="M20 8l3-2M20 12h3M20 16l3 2" stroke="currentColor" stroke-width="1.5" fill="none"/></svg><span class="slot-name">Lampe de poche</span><span class="slot-state"></span></button>
  <button type="button" class="slot weapon" title="Sortir ou ranger (2)" aria-pressed="false" hidden><span class="slot-key">2</span><span class="weapon-ic" aria-hidden="true"></span><span class="slot-name"></span><span class="slot-state"></span></button>
  <div class="crosshair" aria-hidden="true"></div>`;
document.body.appendChild(inv);
inv.querySelector('.slot')!.addEventListener('click', () => (mode === 'online' ? online.toggleTorch() : game.toggleTorch()));
inv.querySelector('.slot.weapon')!.addEventListener('click', () => online.toggleWeapon());
const KNIFE_SVG = '<svg viewBox="0 0 24 24"><path d="M3 21l9-9 2 2-9 9z" fill="currentColor"/><path d="M12 12l8-9 1 1-7 10z" fill="currentColor" opacity=".75"/></svg>';
const GUN_SVG = '<svg viewBox="0 0 24 24"><path d="M2 8h17v4h-6l-1 2h-3l-1 6H4l2-8H2z" fill="currentColor"/><rect x="19" y="9" width="3" height="2" fill="currentColor"/></svg>';
// nom du lieu où se trouve le personnage (rue, place, bâtiment), mis en avant quand il change
const placeEl = document.createElement('div');
placeEl.className = 'place-label';
placeEl.setAttribute('aria-live', 'polite');
document.body.appendChild(placeEl);
let lastPlace = '';
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
let lastTorch = false;
setInterval(() => {
  if (mode !== 'solo' && mode !== 'online') return;
  const on = mode === 'online' ? online.torch : game.torch;
  if (on !== lastTorch) sfx.torch();
  lastTorch = on;
  inv.classList.toggle('on', on);
  inv.querySelector('.slot')!.setAttribute('aria-pressed', String(on));
  inv.querySelector('.slot-state')!.textContent = on ? 'allumée' : 'éteinte';
  // arme du rôle (partie en ligne) : couteau du tueur, pistolet du shérif et ses balles
  const wslot = inv.querySelector('.slot.weapon') as HTMLButtonElement;
  const weapon = mode === 'online' && net.game?.alive[net.me] ? online.weapon : null;
  wslot.hidden = !weapon;
  if (weapon) {
    const out = online.item === weapon;
    wslot.classList.toggle('on', out);
    wslot.setAttribute('aria-pressed', String(out));
    if (wslot.dataset.w !== weapon) {
      wslot.dataset.w = weapon;
      wslot.querySelector('.weapon-ic')!.innerHTML = weapon === 'couteau' ? KNIFE_SVG : GUN_SVG;
      wslot.querySelector('.slot-name')!.textContent = weapon === 'couteau' ? 'Couteau' : 'Pistolet';
    }
    const ammo = net.secret?.ammo ?? 0;
    wslot.querySelector('.slot-state')!.textContent = `${out ? 'en main' : 'rangé'}${weapon === 'pistolet' ? ` · ${ammo} balle${ammo > 1 ? 's' : ''}` : ''}`;
  }
  soloHud.classList.toggle('noclip', mode === 'solo' && game.noclip);
  const me = mode === 'online' ? online.player : game.player;
  if (me) {
    const name = view.placeAt(me.root.position);
    if (name !== lastPlace) {
      lastPlace = name;
      placeEl.textContent = name;
      placeEl.classList.remove('changed');
      void placeEl.offsetWidth;
      placeEl.classList.add('changed');
    }
  }
  const d = dayState(elapsed());
  inv.querySelector('.clock-icon')!.textContent = d.day ? '☀' : '☾';
  inv.querySelector('.clock-text')!.textContent = d.day ? `Jour · la nuit tombe dans ${fmt(d.remaining)}` : `Nuit · le jour se lève dans ${fmt(d.remaining)}`;
}, 250);
// comptes à rebours (votes, délais), actions possibles : rafraîchis quatre fois par seconde
setInterval(() => net.game && gameUi.render(), 250);

app.addEventListener('click', () => {
  if ((mode === 'solo' || mode === 'online' || (mode === 'gunfight' && !gfCtl.results.open)) && !gameUi.pause.open && net.game?.phase !== 'reunion') input.lock();
});

gfCtl = new GunfightController(gfGame, gameUi.toasts, {
  enter: () => {
    game.end();
    setMode('gunfight');
    gameUi.menu.show(false);
  },
  exit: () => setMode('menu'),
  toMenu: () => {
    setMode('menu');
    gameUi.backToMenu();
  },
  sight: (a, b) => village.collision.lineClear(a.x, a.y, a.z, b.x, b.y, b.z),
});

setMode('menu');
gameUi.showMenu(true);
requestAnimationFrame(() => loading.classList.add('done'));

// accroche de contrôle (captures automatiques, inspection en console)
(window as unknown as { __village: unknown }).__village = {
  view,
  village,
  game,
  gfGame,
  get gfCtl() {
    return gfCtl;
  },
  online,
  net,
  input,
  gameUi,
  settings,
  cinematic,
  /** réglages (contrôles automatiques : essais de vitesses) */
  config: { MOVE, JUMP },
  torches,
  mode: () => mode,
  enterGame: () => setMode('solo'),
  enterInspection: () => setMode('inspection'),
  /** contrôle : charge les 40 personnages et renvoie les anomalies de squelette ou d'animation */
  checkAll: () => Promise.all(VARIANTS.map((v) => loadCharacter(v.id).then((b) => ({ id: v.id, clips: b.clips.size, warnings: b.warnings, height: b.height }), (e) => ({ id: v.id, error: String(e) })))),
};
