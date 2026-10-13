/**
 * Menu principal, posé sur la scène 3D du village (caméra cinématique au-dessus des toits) :
 * Jouer (partie en ligne avec composition des rôles, ou exploration solo), Rejoindre une partie,
 * Paramètres, Crédits. Navigation à la souris et au clavier (flèches, Entrée, Échap pour revenir).
 *
 * Pas de bouton « Quitter » : une page web ne peut pas fermer son propre onglet ; on quitte en fermant
 * l'onglet. En partie, « Quitter la partie » se trouve dans le menu de pause.
 */
import type { Sex } from '../characters/catalog';
import type { Composition } from '../shared/roles';
import { OFFLINE_MESSAGE, STATIC, net } from '../client/net';
import { sfx } from '../audio/sfx';
import { CompositionEditor } from './composition';
import { arrowNav, esc, h } from './dom';
import { GAME_KICKER, GAME_TAGLINE, GAME_TITLE_LINES } from './brand';
import { profile } from './profile';
import { settingsPanel } from './settingsPanel';

export interface MenuHooks {
  create(name: string, sex: Sex, composition: Composition): Promise<unknown>;
  join(code: string, name: string, sex: Sex): Promise<unknown>;
  solo(sex: Sex): Promise<void>;
  inspect(): void;
}

type Screen = 'accueil' | 'jouer' | 'rejoindre' | 'parametres' | 'credits';

const CREDITS = `
  <h3>Conception et développement</h3>
  <p>The Village Is Lying — village, intérieurs, règles, réseau et interface réalisés pour ce projet (Three.js, TypeScript).</p>
  <h3>Personnages</h3>
  <p><b>Microsoft Rocketbox</b> — 40 personnages et animations capturées, licence MIT (<code>public/characters/LICENSE-ROCKETBOX.txt</code>).</p>
  <h3>Décor</h3>
  <p>Bâtiments, mobilier, végétation et textures générés par code. Textures photo d’herbe, de parquet et d’eau : exemples de
  Three.js (licence MIT). Ciel HDR « Moonless Golf » : Poly Haven (CC0).</p>
  <h3>Son</h3>
  <p>Tous les sons (vent, grillons, oiseaux, pas, cloche, coup de feu, musique) sont synthétisés en direct par le navigateur :
  aucun fichier sonore tiers.</p>
  <h3>Logiciels libres</h3>
  <p>Three.js, Socket.IO, Express, Vite, TypeScript (licences MIT / Apache 2.0). Polices : Cinzel et Alegreya (SIL Open Font
  License), avec repli sur les polices du système.</p>`;

export class MainMenu {
  readonly el: HTMLElement;
  private editor = new CompositionEditor();
  private current: Screen = 'accueil';

  constructor(private hooks: MenuHooks) {
    this.el = h(`<div class="mm" role="dialog" aria-label="Menu principal">
      <div class="mm-shade"></div>
      <section class="mm-screen mm-home active" data-screen="accueil">
        <header class="mm-brand">
          <div class="mm-kicker">${esc(GAME_KICKER)}</div>
          <h1 class="mm-title"><span>${esc(GAME_TITLE_LINES[0])}</span><span>${esc(GAME_TITLE_LINES[1])}</span></h1>
          <p class="mm-tag">${esc(GAME_TAGLINE)}</p>
        </header>
        <nav class="mm-nav" aria-label="Menu principal">
          <button type="button" data-go="jouer">Jouer</button>
          <button type="button" data-go="rejoindre" ${STATIC ? 'disabled aria-describedby="mm-offline"' : ''}>Rejoindre une partie</button>
          <button type="button" data-go="parametres">Paramètres</button>
          <button type="button" data-go="credits">Crédits</button>
        </nav>
        <footer class="mm-foot">
          <span class="net-state" role="status"></span>
          ${STATIC ? `<span id="mm-offline" class="mm-offline">${esc(OFFLINE_MESSAGE)}</span>` : ''}
          <button type="button" class="link inspect">Explorer la carte librement (sans personnage)</button>
        </footer>
      </section>
      <section class="mm-screen mm-panel" data-screen="jouer" aria-label="Jouer">
        <header><button type="button" class="back" aria-label="Retour au menu">←</button><h2>Jouer</h2></header>
        <div class="mm-body">
          <div class="slot-profile"></div>
          <div class="tabs" role="tablist"><button type="button" role="tab" data-tab="enligne" class="on">Partie en ligne</button><button type="button" role="tab" data-tab="solo">Exploration solo</button></div>
          <div class="tab" data-tab="enligne">
            ${STATIC ? `<p class="offline">${esc(OFFLINE_MESSAGE)}</p>` : ''}
            <div class="slot-editor"></div>
            <button type="button" class="primary create" ${STATIC ? 'disabled' : ''}>Créer le salon</button>
          </div>
          <div class="tab" data-tab="solo" hidden>
            <p class="sub">Parcourez le village avec votre personnage, au milieu de quelques villageois, sans partie en ligne. Idéal pour découvrir la carte et les commandes.</p>
            <button type="button" class="primary solo">Explorer le village</button>
          </div>
          <div class="status" role="status" aria-live="polite"></div>
        </div>
      </section>
      <section class="mm-screen mm-panel" data-screen="rejoindre" aria-label="Rejoindre une partie">
        <header><button type="button" class="back" aria-label="Retour au menu">←</button><h2>Rejoindre une partie</h2></header>
        <div class="mm-body">
          <div class="slot-profile"></div>
          <label class="field">Code du salon <input class="code" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCD" /></label>
          <small class="hint">L’hôte du salon vous donne ce code de 4 lettres.</small>
          <button type="button" class="primary join" disabled>Rejoindre le salon</button>
          <div class="status" role="status" aria-live="polite"></div>
        </div>
      </section>
      <section class="mm-screen mm-panel" data-screen="parametres" aria-label="Paramètres">
        <header><button type="button" class="back" aria-label="Retour au menu">←</button><h2>Paramètres</h2></header>
        <div class="mm-body slot-settings"></div>
      </section>
      <section class="mm-screen mm-panel" data-screen="credits" aria-label="Crédits">
        <header><button type="button" class="back" aria-label="Retour au menu">←</button><h2>Crédits</h2></header>
        <div class="mm-body credits">${CREDITS}</div>
      </section>
    </div>`);
    for (const slot of this.el.querySelectorAll('.slot-profile')) slot.appendChild(profile.fieldsEl());
    this.el.querySelector('.slot-editor')!.appendChild(this.editor.el);
    this.el.querySelector('.slot-settings')!.appendChild(settingsPanel());
    this.bind();
    net.subscribe(() => this.renderNet());
    this.renderNet();
  }

  get open() {
    return this.el.classList.contains('open');
  }

  show(on: boolean, screen: Screen = 'accueil') {
    this.el.classList.toggle('open', on);
    if (on) this.go(screen, false);
  }

  go(screen: Screen, sound = true) {
    if (sound) (screen === 'accueil' ? sfx.back : sfx.click)();
    this.current = screen;
    for (const s of this.el.querySelectorAll<HTMLElement>('.mm-screen')) s.classList.toggle('active', s.dataset.screen === screen);
    const active = this.el.querySelector<HTMLElement>(`.mm-screen[data-screen="${screen}"]`)!;
    // le focus suit l'écran affiché (clavier, lecteurs d'écran)
    requestAnimationFrame(() => (active.querySelector<HTMLElement>('.mm-nav button:not([disabled]), input.name, input.code, .back') ?? active).focus({ preventScroll: true }));
  }

  private status(screen: Screen, text: string, bad = true) {
    const st = this.el.querySelector<HTMLElement>(`.mm-screen[data-screen="${screen}"] .status`);
    if (!st) return;
    st.textContent = text;
    st.classList.toggle('bad', bad && !!text);
    if (bad && text) sfx.error();
  }

  private renderNet() {
    const el = this.el.querySelector('.net-state') as HTMLElement;
    if (STATIC) {
      el.textContent = '';
      return;
    }
    // état réel du socket : jamais « connecté » sans connexion établie
    const s = net.connected ? 'connecte' : net.failed ? 'hors-ligne' : 'connexion';
    el.dataset.state = s;
    el.textContent = s === 'connecte' ? 'Serveur de parties : connecté' : s === 'connexion' ? 'Serveur de parties : connexion…' : 'Serveur de parties : injoignable (nouvel essai automatique)';
  }

  private needName(screen: Screen) {
    if (profile.name) return false;
    this.status(screen, 'Indiquez votre nom.');
    (this.el.querySelector(`.mm-screen[data-screen="${screen}"] input.name`) as HTMLInputElement)?.focus();
    return true;
  }

  private bind() {
    const m = this.el;
    arrowNav(m.querySelector('.mm-nav') as HTMLElement);
    m.addEventListener('pointerover', (e) => {
      const b = (e.target as HTMLElement).closest('button:not([disabled])');
      if (b && b !== (e.relatedTarget as HTMLElement | null)?.closest('button')) sfx.hover();
    });
    m.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.current !== 'accueil') {
        this.go('accueil');
        e.stopPropagation();
      }
    });
    m.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
      if (!b || b.disabled) return;
      if (b.dataset.go) this.go(b.dataset.go as Screen);
      else if (b.classList.contains('back')) this.go('accueil');
      else if (b.dataset.tab) {
        sfx.click();
        const panel = b.closest('.mm-screen')!;
        for (const x of panel.querySelectorAll<HTMLElement>('[role=tab]')) {
          x.classList.toggle('on', x === b);
          x.setAttribute('aria-selected', String(x === b));
        }
        for (const t of panel.querySelectorAll<HTMLElement>('.tab')) t.hidden = t.dataset.tab !== b.dataset.tab;
      }
    });
    const create = m.querySelector('.create') as HTMLButtonElement;
    this.editor.onChange = (_c, valid) => (create.disabled = STATIC || !valid);
    create.addEventListener('click', async () => {
      if (this.needName('jouer')) return;
      sfx.click();
      create.disabled = true;
      this.status('jouer', 'Création du salon…', false);
      try {
        await this.hooks.create(profile.name, profile.sex, this.editor.value);
        this.status('jouer', '', false);
      } catch (e) {
        this.status('jouer', (e as Error).message);
      } finally {
        create.disabled = STATIC || this.editor.errors.length > 0;
      }
    });
    const code = m.querySelector('.code') as HTMLInputElement;
    const join = m.querySelector('.join') as HTMLButtonElement;
    code.addEventListener('input', () => {
      code.value = code.value.toUpperCase().replace(/[^A-Z]/g, '');
      join.disabled = STATIC || code.value.length !== 4;
    });
    code.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !join.disabled) join.click();
    });
    join.addEventListener('click', async () => {
      if (this.needName('rejoindre')) return;
      sfx.click();
      join.disabled = true;
      this.status('rejoindre', 'Connexion au salon…', false);
      try {
        await this.hooks.join(code.value, profile.name, profile.sex);
        this.status('rejoindre', '', false);
      } catch (e) {
        this.status('rejoindre', (e as Error).message);
      } finally {
        join.disabled = STATIC || code.value.length !== 4;
      }
    });
    const solo = m.querySelector('.solo') as HTMLButtonElement;
    solo.addEventListener('click', async () => {
      sfx.click();
      solo.disabled = true;
      this.status('jouer', 'Le village prépare votre personnage…', false);
      try {
        await this.hooks.solo(profile.sex);
        this.status('jouer', '', false);
      } catch (e) {
        this.status('jouer', `Impossible de charger le personnage : ${(e as Error).message}`);
      } finally {
        solo.disabled = false;
      }
    });
    m.querySelector('.inspect')!.addEventListener('click', () => {
      sfx.click();
      this.hooks.inspect();
    });
  }
}
