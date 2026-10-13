/**
 * Point d'entrée : construit le village (écran de chargement), puis ouvre le menu principal sur une vue
 * cinématique du village. Quatre modes : menu (et salon), exploration solo, partie en ligne, inspection
 * libre de la carte. Réglages, sons et vie du décor sont branchés ici.
 */
import { buildVillage, type Village } from './village/village';
import { VillageView, type RoofMode } from './village/view';
import { CinematicCamera } from './village/cinematic';
import { VillageLife } from './village/life';
import { Input } from './input';
import { Game } from './characters/game';
import { VARIANTS, cardUrl, type Sex } from './characters/catalog';
import { loadCharacter } from './characters/assets';
import { GameUi, type AppMode } from './client/ui';
import { OnlineGame } from './client/online';
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
  for (const m of ['menu', 'solo', 'online', 'inspection'] as const) document.body.classList.toggle(`mode-${m}`, mode === m);
  document.body.classList.toggle('playing', mode === 'solo' || mode === 'online');
};
const soloUpdate = (dt: number) => game.update(dt);
const onlineUpdate = (dt: number) => online.update(dt);
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
    view.driver = { update: m === 'solo' ? soloUpdate : onlineUpdate };
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
    <h2>Caméra</h2>
    <div class="seg" data-k="mode"><button data-v="orbite">Orbite</button><button data-v="vol">Vol libre</button></div>
    <h2>Toits</h2>
    <div class="seg" data-k="roof"><button data-v="auto">Auto</button><button data-v="visible">Visibles</button><button data-v="masque">Masqués</button></div>
    <h2>Extérieurs</h2><div class="ext"></div>
    <h2>Intérieurs</h2><div class="int"></div>
    <div class="help">
      <kbd>F</kbd> orbite / vol libre · <kbd>R</kbd> toits · <kbd>F3</kbd> mesures<br>
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
  <div class="controls-help"><span>Cliquez pour diriger la caméra</span><span><kbd>Z Q S D</kbd> marcher</span><span><kbd>Maj</kbd> courir</span><span><kbd>Espace</kbd> sauter</span><span><kbd>V</kbd> vue subjective</span><span><kbd>L</kbd> lampe</span><span><kbd>Échap</kbd> menu</span></div>`;
document.body.appendChild(soloHud);

const gameUi = new GameUi({
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
  },
});
let onlineKey = '';
gameUi.attach(online);
soloHud.querySelector('.pause-btn')!.addEventListener('click', () => gameUi.setPause(true));
ui.querySelector('.back-menu')!.addEventListener('click', () => gameUi.backToMenu());

// ── réglages appliqués en direct ──
settings.subscribe((s) => {
  if (QUALITY_INDEX[s.quality] !== view.quality) view.setQuality(QUALITY_INDEX[s.quality]);
  cinematic.still = s.reduceMotion;
  life.reduceMotion = s.reduceMotion;
});

// ── cycle du jour, inventaire (lampe de poche), sons et vie du décor ──
const elapsed = () => (mode === 'online' ? online.elapsed : mode === 'solo' ? game.elapsed : 0);
view.daylightSource = () => (mode === 'online' || mode === 'solo' ? dayState(elapsed()).light : 0);
view.afterAtmosphere = (dt, daylight) => {
  life.update(dt, daylight, view.renderer.domElement.height);
  ambience.set(daylight, mode !== 'inspection');
  const meeting = mode === 'online' && net.game?.phase === 'reunion';
  ambience.setMusic(mode === 'menu' ? 'menu' : meeting ? 'reunion' : 'jeu');
  if (mode === 'solo') footsteps.update(dt, game.characters.map((c, i) => ({ id: c.id, x: c.controller.x, y: c.controller.y, z: c.controller.z, grounded: c.controller.grounded, local: i === 0 })), view.camera);
  else if (mode === 'online') footsteps.update(dt, online.walkers(), view.camera);
};
const inv = document.createElement('div');
inv.className = 'inventory';
inv.innerHTML = `<div class="clock" role="timer"><span class="clock-icon" aria-hidden="true"></span><span class="clock-text"></span></div><button type="button" class="slot" title="Allumer ou éteindre (L)" aria-pressed="false"><span class="slot-key">L</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9h9l3-3h4v12h-4l-3-3H3z" fill="currentColor"/><path d="M20 8l3-2M20 12h3M20 16l3 2" stroke="currentColor" stroke-width="1.5" fill="none"/></svg><span class="slot-name">Lampe de poche</span><span class="slot-state"></span></button>`;
document.body.appendChild(inv);
inv.querySelector('.slot')!.addEventListener('click', () => (mode === 'online' ? online.toggleTorch() : game.toggleTorch()));
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
  const d = dayState(elapsed());
  inv.querySelector('.clock-icon')!.textContent = d.day ? '☀' : '☾';
  inv.querySelector('.clock-text')!.textContent = d.day ? `Jour · la nuit tombe dans ${fmt(d.remaining)}` : `Nuit · le jour se lève dans ${fmt(d.remaining)}`;
}, 250);
// comptes à rebours (votes, délais), actions possibles : rafraîchis quatre fois par seconde
setInterval(() => net.game && gameUi.render(), 250);

app.addEventListener('click', () => {
  if ((mode === 'solo' || mode === 'online') && !gameUi.pause.open && net.game?.phase !== 'reunion') input.lock();
});

setMode('menu');
gameUi.showMenu(true);
requestAnimationFrame(() => loading.classList.add('done'));

// accroche de contrôle (captures automatiques, inspection en console)
(window as unknown as { __village: unknown }).__village = {
  view,
  village,
  game,
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
