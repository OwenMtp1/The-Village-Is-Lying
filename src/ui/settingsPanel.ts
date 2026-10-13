/**
 * Écran des paramètres (menu principal et menu de pause) : chaque réglage s'applique immédiatement et reste
 * enregistré dans le navigateur.
 */
import { esc, h } from './dom';
import { settings, type Settings } from './settings';

const SLIDERS: { key: keyof Settings; label: string; min: number; max: number; step: number; fmt: (v: number) => string }[] = [
  { key: 'sensitivity', label: 'Sensibilité de la souris', min: 0.2, max: 3, step: 0.05, fmt: (v) => `× ${v.toFixed(2)}` },
  { key: 'master', label: 'Volume général', min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)} %` },
  { key: 'music', label: 'Musique', min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)} %` },
  { key: 'sfx', label: 'Effets sonores', min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)} %` },
  { key: 'ambience', label: 'Ambiance (vent, grillons, oiseaux)', min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)} %` },
];

const TOGGLES: { key: keyof Settings; label: string; hint: string }[] = [
  { key: 'invertY', label: 'Inverser l’axe vertical', hint: 'Souris vers le haut : regarder vers le bas.' },
  { key: 'showControls', label: 'Afficher l’aide des commandes', hint: 'Rappel des touches en bas de l’écran pendant la partie.' },
  { key: 'reduceMotion', label: 'Réduire les animations', hint: 'Caméra du menu fixe, transitions d’interface supprimées, végétation plus calme.' },
];

export function settingsPanel(): HTMLElement {
  const el = h(`<div class="settings">
    <fieldset><legend>Contrôles et son</legend>
      ${SLIDERS.map(
        (s) => `<label class="range"><span>${esc(s.label)}</span><input type="range" data-k="${s.key}" min="${s.min}" max="${s.max}" step="${s.step}" /><output data-o="${s.key}"></output></label>`,
      ).join('')}
    </fieldset>
    <fieldset><legend>Graphismes</legend>
      <div class="seg quality" role="radiogroup" aria-label="Qualité graphique">
        <button type="button" role="radio" data-q="haute">Haute</button><button type="button" role="radio" data-q="moyenne">Moyenne</button><button type="button" role="radio" data-q="basse">Basse</button>
      </div>
      <p class="hint q-hint"></p>
    </fieldset>
    <fieldset><legend>Confort</legend>
      ${TOGGLES.map((t) => `<label class="check"><input type="checkbox" data-k="${t.key}" /><span><b>${esc(t.label)}</b><small>${esc(t.hint)}</small></span></label>`).join('')}
    </fieldset>
    <button type="button" class="link reset">Rétablir les réglages par défaut</button>
  </div>`);
  const Q_HINT = {
    haute: 'Occlusion ambiante, ombres fines, halo des lumières. Pour une carte graphique récente.',
    moyenne: 'Ombres et halo des lumières. Recommandé pour la plupart des ordinateurs.',
    basse: 'Rendu direct sans ombres ni halo, résolution réduite. Pour les machines modestes.',
  };
  const render = (s: Settings) => {
    for (const i of el.querySelectorAll<HTMLInputElement>('input[type=range]')) {
      const k = i.dataset.k as keyof Settings;
      if (document.activeElement !== i) i.value = String(s[k]);
      el.querySelector(`[data-o="${k}"]`)!.textContent = SLIDERS.find((x) => x.key === k)!.fmt(s[k] as number);
    }
    for (const i of el.querySelectorAll<HTMLInputElement>('input[type=checkbox]')) i.checked = !!s[i.dataset.k as keyof Settings];
    for (const b of el.querySelectorAll<HTMLButtonElement>('[data-q]')) {
      b.classList.toggle('on', b.dataset.q === s.quality);
      b.setAttribute('aria-checked', String(b.dataset.q === s.quality));
    }
    el.querySelector('.q-hint')!.textContent = Q_HINT[s.quality];
  };
  el.addEventListener('input', (e) => {
    const i = e.target as HTMLInputElement;
    if (i.type === 'range') settings.set({ [i.dataset.k!]: Number(i.value) });
    if (i.type === 'checkbox') settings.set({ [i.dataset.k!]: i.checked });
  });
  el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (b?.dataset.q) settings.set({ quality: b.dataset.q as Settings['quality'] });
    if (b?.classList.contains('reset')) settings.reset();
  });
  settings.subscribe(render);
  return el;
}
