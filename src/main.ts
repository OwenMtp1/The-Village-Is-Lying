/**
 * Point d'entrée : construit le village (écran de chargement), puis ouvre le menu : créer ou rejoindre une
 * partie en ligne (composition des rôles, salon), exploration solo, ou inspection de la map.
 */
import { buildVillage } from './village/village';
import { VillageView, type Quality, type RoofMode } from './village/view';
import { Input } from './input';
import { Game } from './characters/game';
import { VARIANTS, cardUrl, type Sex } from './characters/catalog';
import { loadCharacter } from './characters/assets';
import { GameUi } from './client/ui';
import { OnlineGame } from './client/online';
import { net } from './client/net';

const app = document.getElementById('app')!;
const loading = document.createElement('div');
loading.className = 'loading';
loading.innerHTML = `<div><h1>MINUIT AU VILLAGE</h1><div class="bar"><i></i></div><div class="label">Le village s'endort…</div></div>`;
document.body.appendChild(loading);
const bar = loading.querySelector('.bar i') as HTMLElement;
const label = loading.querySelector('.label') as HTMLElement;

const village = await buildVillage((f, text) => {
  bar.style.width = `${Math.round(f * 100)}%`;
  label.textContent = text;
});
bar.style.width = '100%';
const input = new Input(app);
const view = new VillageView(app, village, input);
const game = new Game(village, view.scene, view.camera, input);

// ── interface d'inspection ──
const ui = document.createElement('div');
ui.innerHTML = `
  <div class="hud hud-top">
    <div><div class="title">Minuit au village</div><div class="place"></div></div>
    <div class="stats"></div>
  </div>
  <button class="toggle">Points de vue</button>
  <div class="panel">
    <button class="hide-btn" title="Masquer">×</button>
    <h2>Caméra</h2>
    <div class="seg" data-k="mode"><button data-v="orbite">Orbite</button><button data-v="vol">Vol libre</button></div>
    <h2>Toits</h2>
    <div class="seg" data-k="roof"><button data-v="auto">Auto</button><button data-v="visible">Visibles</button><button data-v="masque">Masqués</button></div>
    <h2>Qualité</h2>
    <div class="seg" data-k="q"><button data-v="0">Haute</button><button data-v="1">Moyenne</button><button data-v="2">Basse</button></div>
    <h2>Extérieurs</h2><div class="ext"></div>
    <h2>Intérieurs</h2><div class="int"></div>
    <h2>Partie</h2><button class="to-game">▶ Jouer un personnage</button>
    <div class="help">
      <kbd>F</kbd> orbite / vol libre · <kbd>R</kbd> toits<br>
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
    const cur = seg.dataset.k === 'mode' ? view.mode : seg.dataset.k === 'roof' ? view.roofMode : String(view.quality);
    for (const b of seg.querySelectorAll<HTMLButtonElement>('button')) b.classList.toggle('on', b.dataset.v === cur);
  }
};
ui.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
  const seg = b?.parentElement as HTMLElement | null;
  if (!b || !seg?.dataset.k) return;
  if (seg.dataset.k === 'mode') view.setMode(b.dataset.v as 'orbite' | 'vol');
  if (seg.dataset.k === 'roof') view.setRoofMode(b.dataset.v as RoofMode);
  if (seg.dataset.k === 'q') view.setQuality(Number(b.dataset.v) as Quality);
  refresh();
});
ui.querySelector('.hide-btn')!.addEventListener('click', () => document.body.classList.add('collapsed'));
ui.querySelector('.toggle')!.addEventListener('click', () => document.body.classList.remove('collapsed'));
window.addEventListener('keyup', () => refresh());
refresh();
let showStats = true;
window.addEventListener('keydown', (e) => {
  if (e.code === 'F3') {
    showStats = !showStats;
    e.preventDefault();
  }
});
view.onInfo = (i) => {
  place.textContent = i.place;
  stats.textContent = showStats ? `${i.fps.toFixed(0)} img/s\n${i.calls} appels · ${(i.tris / 1e6).toFixed(2)} M tri.\n${i.lights} lumières actives` : '';
};
requestAnimationFrame(() => loading.classList.add('done'));

// ── jeu : menu (créer / rejoindre une partie, exploration solo), salon, partie en ligne ──
const hud = document.createElement('div');
hud.className = 'game-hud';
hud.innerHTML = `<div class="who"><img alt=""><div><div class="who-name"></div><div class="who-sub"></div></div></div>
  <div class="game-help">Cliquez pour diriger la caméra · <kbd>Z Q S D</kbd> se déplacer · <kbd>Maj</kbd> courir · <kbd>Espace</kbd> sauter · <kbd>V</kbd> vue subjective · molette : distance · <kbd>Échap</kbd> libérer la souris</div>
  <div class="game-buttons"><button class="to-menu">Menu</button><button class="to-inspect">Inspecter la map</button></div>`;
document.body.appendChild(hud);

const online = new OnlineGame(village, view.scene, view.camera, input);
let onlineKey = '';

function enterSolo() {
  view.driver = { update: (dt) => game.update(dt) };
  document.body.classList.add('playing');
  document.body.classList.remove('online');
  input.flush();
}
function enterInspection() {
  view.driver = null;
  document.body.classList.remove('playing', 'online');
  input.unlock();
}
const gameUi = new GameUi({
  async solo(sex: Sex) {
    const info = await game.start(sex);
    (hud.querySelector('.who img') as HTMLImageElement).src = cardUrl(info.player.variant);
    hud.querySelector('.who-name')!.textContent = info.player.firstName;
    hud.querySelector('.who-sub')!.textContent = `${sex === 'F' ? 'Personnage féminin' : 'Personnage masculin'} · modèle ${info.player.variant}`;
    enterSolo();
  },
  enterOnline() {
    // nouvelle partie (ou relance) : personnages recréés avec les apparences tirées par le serveur
    const key = JSON.stringify(net.game?.appearances ?? {});
    if (key !== onlineKey) {
      onlineKey = key;
      game.end();
      online.dispose();
      void online.ensure();
    }
    if (view.driver?.update !== onlineUpdate) {
      view.driver = { update: onlineUpdate };
      document.body.classList.add('playing', 'online');
      input.flush();
    }
  },
  leaveOnline() {
    online.dispose();
    onlineKey = '';
    enterInspection();
    if (net.lobby) {
      // retour au salon après les résultats : l'hôte peut relancer une partie
      net.game = null;
      net.secret = null;
      gameUi.render();
    } else gameUi.showMenu(true);
  },
  inspect: () => enterInspection(),
});
const onlineUpdate = (dt: number) => online.update(dt);
gameUi.attach(online);
// compte à rebours des votes, actions possibles : rafraîchis quatre fois par seconde
setInterval(() => net.game && gameUi.render(), 250);

hud.querySelector('.to-menu')!.addEventListener('click', () => {
  enterInspection();
  gameUi.showMenu(true);
});
hud.querySelector('.to-inspect')!.addEventListener('click', () => enterInspection());
ui.querySelector('.to-game')!.addEventListener('click', () => {
  if (net.game && net.lobby?.phase === 'partie') gameUi.render();
  else if (game.player) enterSolo();
  else gameUi.showMenu(true);
});
app.addEventListener('click', () => {
  if (view.driver && net.game?.phase !== 'reunion') input.lock();
});

// accroche de contrôle (captures automatiques, inspection en console)
(window as unknown as { __village: unknown }).__village = {
  view,
  village,
  game,
  online,
  net,
  input,
  gameUi,
  enterGame: enterSolo,
  enterInspection,
  /** contrôle : charge les 40 personnages et renvoie les anomalies de squelette ou d'animation */
  checkAll: () => Promise.all(VARIANTS.map((v) => loadCharacter(v.id).then((b) => ({ id: v.id, clips: b.clips.size, warnings: b.warnings, height: b.height }), (e) => ({ id: v.id, error: String(e) })))),
};
