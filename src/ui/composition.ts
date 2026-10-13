/**
 * Éditeur de composition des rôles (création de partie et salon) : − / + pour chaque rôle, préréglages,
 * total en temps réel et validation expliquée.
 */
import { MAX_PLAYERS, MIN_PLAYERS, PRESETS, ROLES, ROLE_INFO, compositionErrors, presetOf, totalOf, DEFAULT_COMPOSITION, type Composition } from '../shared/roles';
import { esc, h } from './dom';
import { ROLE_ICON } from './icons';

/**
 * Sélecteurs − / + pour chaque rôle, préréglages, total en temps réel et validation expliquée.
 * Les valeurs saisies ne sont jamais corrigées : une composition invalide est signalée, pas modifiée.
 */
export class CompositionEditor {
  readonly el: HTMLElement;
  value: Composition;
  onChange: (c: Composition, valid: boolean) => void = () => {};
  private locked = false;

  constructor(initial: Composition = DEFAULT_COMPOSITION) {
    this.value = { ...initial };
    this.el = h(`<section class="compo">
      <h3>Composition des rôles</h3>
      <div class="presets">${PRESETS.map((p) => `<button type="button" data-preset="${p.id}">${esc(p.nom)}</button>`).join('')}</div>
      <div class="compo-rows">${ROLES.map(
        (r) => `<div class="compo-row" data-role="${r}">
          <div class="compo-name role-${r}">${ROLE_ICON[r]}<b>${ROLE_INFO[r].pluriel}</b><small>${ROLE_INFO[r].camp === 'tueurs' ? 'camp des tueurs' : 'camp des innocents'}</small></div>
          <button type="button" class="step" data-d="-1" aria-label="Retirer un ${ROLE_INFO[r].nom.toLowerCase()}">−</button>
          <output class="compo-n">0</output>
          <button type="button" class="step" data-d="1" aria-label="Ajouter un ${ROLE_INFO[r].nom.toLowerCase()}">+</button>
        </div>`,
      ).join('')}</div>
      <div class="compo-total"></div>
      <ul class="compo-errors"></ul>
    </section>`);
    this.el.addEventListener('click', (e) => {
      if (this.locked) return;
      const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
      if (!b) return;
      if (b.dataset.preset) this.set({ ...PRESETS.find((p) => p.id === b.dataset.preset)!.composition });
      else if (b.dataset.d) {
        const role = (b.closest('.compo-row') as HTMLElement).dataset.role as keyof Composition;
        this.set({ ...this.value, [role]: Math.max(0, Math.min(MAX_PLAYERS, this.value[role] + Number(b.dataset.d))) });
      }
    });
    this.render();
  }

  get errors() {
    return compositionErrors(this.value);
  }

  set(c: Composition, silent = false) {
    this.value = { ...c };
    this.render();
    if (!silent) this.onChange(this.value, this.errors.length === 0);
  }

  setLocked(on: boolean) {
    this.locked = on;
    this.el.classList.toggle('locked', on);
    for (const b of this.el.querySelectorAll('button')) (b as HTMLButtonElement).disabled = on;
  }

  private render() {
    for (const r of ROLES) {
      const row = this.el.querySelector(`[data-role="${r}"]`)!;
      row.querySelector('output')!.textContent = String(this.value[r]);
      (row.querySelector('[data-d="-1"]') as HTMLButtonElement).disabled = this.locked || this.value[r] <= 0;
      (row.querySelector('[data-d="1"]') as HTMLButtonElement).disabled = this.locked || this.value[r] >= MAX_PLAYERS;
    }
    const total = totalOf(this.value);
    const errs = this.errors;
    const t = this.el.querySelector('.compo-total') as HTMLElement;
    t.textContent = `Composition : ${total} joueur${total > 1 ? 's' : ''} (de ${MIN_PLAYERS} à ${MAX_PLAYERS})`;
    t.classList.toggle('bad', errs.length > 0);
    this.el.querySelector('.compo-errors')!.innerHTML = errs.map((e) => `<li>${esc(e)}</li>`).join('');
    const preset = presetOf(this.value);
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('[data-preset]')) b.classList.toggle('on', b.dataset.preset === preset?.id);
  }
}
