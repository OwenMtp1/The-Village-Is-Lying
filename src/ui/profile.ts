/** Profil du joueur (nom, sexe du personnage) : partagé par les écrans « Jouer » et « Rejoindre », gardé dans le navigateur. */
import type { Sex } from '../characters/catalog';
import { h } from './dom';

const KEY = 'village.profil';

class Profile {
  name = '';
  sex: Sex = 'M';
  private fields = new Set<HTMLElement>();

  constructor() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) ?? 'null');
      if (typeof s?.name === 'string') this.name = s.name.slice(0, 20);
      if (s?.sex === 'F' || s?.sex === 'M') this.sex = s.sex;
    } catch {
      /* rien */
    }
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ name: this.name, sex: this.sex }));
    } catch {
      /* rien */
    }
  }

  /** Champs nom + sexe, synchronisés entre toutes leurs copies. */
  fieldsEl(): HTMLElement {
    const el = h(`<div class="profile">
      <label class="field">Votre nom <input class="name" maxlength="20" autocomplete="nickname" placeholder="Votre nom" /></label>
      <div class="field" role="group" aria-label="Votre personnage">Votre personnage
        <div class="seg sex"><button type="button" data-sex="M">Masculin</button><button type="button" data-sex="F">Féminin</button></div>
        <small>L’apparence est tirée au sort parmi les villageois de ce sexe au lancement.</small>
      </div>
    </div>`);
    const input = el.querySelector('.name') as HTMLInputElement;
    input.addEventListener('input', () => {
      this.name = input.value.trim();
      this.save();
      this.sync(el);
    });
    el.querySelector('.sex')!.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-sex]') as HTMLElement | null;
      if (!b) return;
      this.sex = b.dataset.sex as Sex;
      this.save();
      this.sync();
    });
    this.fields.add(el);
    this.sync();
    return el;
  }

  private sync(except?: HTMLElement) {
    for (const el of this.fields) {
      const input = el.querySelector('.name') as HTMLInputElement;
      if (el !== except && input.value !== this.name) input.value = this.name;
      for (const b of el.querySelectorAll<HTMLButtonElement>('[data-sex]')) {
        b.classList.toggle('on', b.dataset.sex === this.sex);
        b.setAttribute('aria-pressed', String(b.dataset.sex === this.sex));
      }
    }
  }
}

export const profile = new Profile();
