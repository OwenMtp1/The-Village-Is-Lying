/**
 * Point d'entrée : construit le village (avec écran de chargement), puis ouvre la visionneuse d'inspection.
 * Le gameplay n'est pas encore branché : cette page sert à parcourir et vérifier la map.
 */
import { buildVillage } from './village/village';
import { VillageView, type Quality, type RoofMode } from './village/view';

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
const view = new VillageView(app, village);

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

// accroche de contrôle (captures automatiques, inspection en console)
(window as unknown as { __village: unknown }).__village = { view, village };
