/**
 * Point d'entrée : construit le village (avec écran de chargement), puis ouvre la visionneuse d'inspection.
 * Le gameplay n'est pas encore branché : cette page sert à parcourir et vérifier la map.
 */
import { buildVillage } from './village/village';
import { VillageView, type Quality, type RoofMode } from './village/view';
import { Input } from './input';
import { Game } from './characters/game';
import { VARIANTS, cardUrl, type Sex } from './characters/catalog';
import { loadCharacter } from './characters/assets';

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

// ── jeu : choix du sexe, apparence tirée au sort, contrôle du personnage ──
const choose = document.createElement('div');
choose.className = 'choose';
choose.innerHTML = `<div class="choose-box">
  <h1>Nouvelle partie</h1>
  <p>Choisissez votre personnage. Son apparence sera tirée au sort parmi les villageois disponibles.</p>
  <div class="choose-row"><button data-sex="M">Masculin</button><button data-sex="F">Féminin</button></div>
  <button class="link inspect">Explorer la map sans personnage</button>
  <div class="choose-status"></div>
</div>`;
document.body.appendChild(choose);
const hud = document.createElement('div');
hud.className = 'game-hud';
hud.innerHTML = `<div class="who"><img alt=""><div><div class="who-name"></div><div class="who-sub"></div></div></div>
  <div class="game-help">Cliquez pour diriger la caméra · <kbd>Z Q S D</kbd> se déplacer · <kbd>Maj</kbd> courir · <kbd>Espace</kbd> sauter · <kbd>V</kbd> vue subjective · molette : distance · <kbd>Échap</kbd> libérer la souris</div>
  <div class="game-buttons"><button class="new-game">Nouvelle partie</button><button class="to-inspect">Inspecter la map</button></div>`;
document.body.appendChild(hud);
const status = choose.querySelector('.choose-status') as HTMLElement;

function showChoice(on: boolean) {
  choose.classList.toggle('open', on);
  game.frozen = on;
  if (on) input.unlock();
}
function enterGame() {
  view.driver = { update: (dt) => game.update(dt) };
  document.body.classList.add('playing');
  input.flush();
}
function enterInspection() {
  view.driver = null;
  document.body.classList.remove('playing');
  input.unlock();
  showChoice(false);
}
for (const b of choose.querySelectorAll<HTMLButtonElement>('[data-sex]'))
  b.onclick = async () => {
    status.textContent = 'Le village prépare votre personnage…';
    for (const x of choose.querySelectorAll('button')) (x as HTMLButtonElement).disabled = true;
    try {
      const info = await game.start(b.dataset.sex as Sex);
      (hud.querySelector('.who img') as HTMLImageElement).src = cardUrl(info.player.variant);
      hud.querySelector('.who-name')!.textContent = info.player.firstName;
      hud.querySelector('.who-sub')!.textContent = `${b.dataset.sex === 'F' ? 'Personnage féminin' : 'Personnage masculin'} · modèle ${info.player.variant}`;
      status.textContent = '';
      showChoice(false);
      enterGame();
    } catch (e) {
      status.textContent = `Impossible de charger le personnage : ${(e as Error).message}`;
    } finally {
      for (const x of choose.querySelectorAll('button')) (x as HTMLButtonElement).disabled = false;
    }
  };
choose.querySelector('.inspect')!.addEventListener('click', () => enterInspection());
hud.querySelector('.new-game')!.addEventListener('click', () => showChoice(true));
hud.querySelector('.to-inspect')!.addEventListener('click', () => enterInspection());
ui.querySelector('.to-game')!.addEventListener('click', () => {
  if (game.player) enterGame();
  else showChoice(true);
});
app.addEventListener('click', () => {
  if (view.driver && !game.frozen) input.lock();
});
showChoice(true);

// accroche de contrôle (captures automatiques, inspection en console)
(window as unknown as { __village: unknown }).__village = {
  view,
  village,
  game,
  input,
  enterGame,
  enterInspection,
  /** contrôle : charge les 40 personnages et renvoie les anomalies de squelette ou d'animation */
  checkAll: () => Promise.all(VARIANTS.map((v) => loadCharacter(v.id).then((b) => ({ id: v.id, clips: b.clips.size, warnings: b.warnings, height: b.height }), (e) => ({ id: v.id, error: String(e) })))),
};
