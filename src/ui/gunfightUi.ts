/**
 * Interface du mode Gunfight : écran du menu principal (créer une salle, rejoindre avec un code, solo contre des
 * robots), salle d'attente (réglages de l'hôte, équipes au choix des joueurs, code à partager), interface de
 * combat (vie, armes et munitions, score, temps, fil des éliminations, viseur qui s'ouvre avec la dispersion,
 * marqueur de touche et de tir à la tête, lunette, écran de mort, tableau des scores sur Tab) et résultats.
 */
import type { Sex } from '../characters/catalog';
import { ARSENAL_NAMES, GF_DEFAULT, GF_MODE_NAMES, GF_RULES, PROGRESSION, SLOTS, progressionStep, progressionTier, type GFArsenal, TEAM_NAMES, WEAPONS, WEAPON_NAMES, isGun, type GFWeapon, type GFGameView, type GFLobbyView, type GFMode, type GFSettings, type Team } from '../shared/gunfight';
import { STATIC, OFFLINE_MESSAGE } from '../client/net';
import { sfx } from '../audio/sfx';
import { esc, h, onClick } from './dom';
import { ICON } from './icons';
import { GFMinimap, mapPreview } from './gfMinimap';
import { GF_MAPS, mapOf, type GFMapId } from '../shared/gunfightMaps';
import { profile } from './profile';

const wsvg = (d: string) => `<svg class="ic gf-wic" viewBox="0 0 48 16" aria-hidden="true"><path d="${d}" fill="currentColor"/></svg>`;
/** silhouettes des armes (fil des éliminations, barre d'armes) */
export const WEAPON_ICON: Record<GFWeapon, string> = {
  pistolet: wsvg('M14 3h20v4H22l-1 2h-3l-1 6h-5l2-8h0z'),
  fusil: wsvg('M2 6l8-1h28v3H24l-2 5h-4l1-4h-3l-1 4h-3l1-4H8L4 11H2z'),
  pompe: wsvg('M2 6l9-1h35v2H12v2h20v2H14l-2 3H8l2-4H6l-3 3H2z'),
  precision: wsvg('M2 6l8-1h8V2h12v3h18v2H20v2l-3 4h-3l2-4H8l-4 3H2z'),
  couteau: wsvg('M4 7h12l2-2h26l-6 4H18l-2 2H4z'),
};

export interface GFMenuHooks {
  create(name: string, sex: Sex, settings: GFSettings): Promise<unknown>;
  join(code: string, name: string, sex: Sex): Promise<unknown>;
  solo(name: string, sex: Sex, opts: { settings: GFSettings; bots: number; difficulty: 'facile' | 'normal' | 'difficile'; team: Team }): Promise<unknown>;
}

const stepper = (key: string, label: string, value: number, min: number, max: number, unit = '') =>
  `<div class="gf-step" data-k="${key}" data-min="${min}" data-max="${max}"><span>${esc(label)}</span><button type="button" data-d="-1" aria-label="Moins">−</button><output>${value}${unit}</output><button type="button" data-d="1" aria-label="Plus">+</button></div>`;

/** Réglages d'une partie (création, salle de l'hôte, solo) : mode, places, score visé, durée. */
export class GFSettingsForm {
  readonly el: HTMLElement;
  value: GFSettings;
  onChange: (s: GFSettings) => void = () => {};
  private locked = false;

  constructor(initial: GFSettings = GF_DEFAULT, opts: { players?: boolean } = {}) {
    this.value = { ...initial };
    const L = GF_RULES.limits;
    this.el = h(`<div class="gf-form">
      <div class="seg gf-mode" role="radiogroup" aria-label="Mode de jeu">
        <button type="button" data-mode="ffa">${GF_MODE_NAMES.ffa}</button>
        <button type="button" data-mode="equipes">${GF_MODE_NAMES.equipes}</button>
      </div>
      <div class="seg gf-daynight" role="radiogroup" aria-label="Moment">
        <button type="button" data-night="0">☀ Jour</button>
        <button type="button" data-night="1">☾ Nuit (lampes et lasers)</button>
      </div>
      <div class="gf-maps" role="radiogroup" aria-label="Carte">
        ${GF_MAPS.map((m) => `<button type="button" class="gf-map" data-map="${m.id}" title="${esc(m.desc)}"><span class="gf-prev"></span><b>${esc(m.name)}</b><small>${esc(m.desc)}</small><em>${esc(m.size)} joueurs</em></button>`).join('')}
      </div>
      <div class="seg gf-arsenal" role="radiogroup" aria-label="Armes">
        ${(['libre', 'progression'] as GFArsenal[]).map((a) => `<button type="button" data-arsenal="${a}">${ARSENAL_NAMES[a]}</button>`).join('')}
      </div>
      <p class="gf-arsenal-help"></p>
      <div class="gf-weps" role="group" aria-label="Armes autorisées">
        ${SLOTS.map((w) => `<button type="button" class="gf-wep" data-wep="${w}">${WEAPON_ICON[w]}<span>${esc(WEAPON_NAMES[w])}</span></button>`).join('')}
      </div>
      ${opts.players === false ? '' : stepper('maxPlayers', 'Joueurs (places)', initial.maxPlayers, L.players[0], L.players[1])}
      ${stepper('scoreLimit', 'Éliminations pour gagner', initial.scoreLimit, L.score[0], L.score[1])}
      ${stepper('minutes', 'Durée maximale', initial.minutes, L.minutes[0], L.minutes[1], ' min')}
    </div>`);
    onClick(this.el, 'button', (b) => {
      if (this.locked) return;
      sfx.click();
      if (b.dataset.mode) this.value = { ...this.value, mode: b.dataset.mode as GFMode };
      if (b.dataset.map) this.value = { ...this.value, map: b.dataset.map as GFMapId };
      if (b.dataset.night) this.value = { ...this.value, night: b.dataset.night === '1' };
      if (b.dataset.arsenal) this.value = { ...this.value, arsenal: b.dataset.arsenal as GFArsenal };
      if (b.dataset.wep) {
        const w = b.dataset.wep as GFWeapon;
        const on = this.value.weapons.includes(w);
        // au moins une arme reste permise
        if (!(on && this.value.weapons.length === 1)) this.value = { ...this.value, weapons: SLOTS.filter((x) => (x === w ? !on : this.value.weapons.includes(x))) };
      }
      if (b.dataset.d) {
        const row = b.closest('.gf-step') as HTMLElement;
        const k = row.dataset.k as 'maxPlayers' | 'scoreLimit' | 'minutes';
        const step = k === 'scoreLimit' ? 5 : 1;
        this.value = { ...this.value, [k]: Math.max(Number(row.dataset.min), Math.min(Number(row.dataset.max), this.value[k] + Number(b.dataset.d) * step)) };
      }
      this.render();
      this.onChange(this.value);
    });
    this.render();
  }

  set(v: GFSettings) {
    this.value = { ...v };
    this.render();
  }
  setLocked(on: boolean) {
    this.locked = on;
    this.el.classList.toggle('locked', on);
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('button')) b.disabled = on;
  }
  private render() {
    for (const b of this.el.querySelectorAll<HTMLElement>('[data-mode]')) b.classList.toggle('on', b.dataset.mode === this.value.mode);
    for (const b of this.el.querySelectorAll<HTMLElement>('[data-map]')) {
      b.classList.toggle('on', b.dataset.map === this.value.map);
      const slot = b.querySelector('.gf-prev')!;
      if (!slot.firstChild) slot.append(mapPreview(mapOf(b.dataset.map)));
    }
    for (const b of this.el.querySelectorAll<HTMLElement>('[data-night]')) b.classList.toggle('on', (b.dataset.night === '1') === this.value.night);
    this.el.querySelector('.gf-maps')!.classList.toggle('night', this.value.night);
    for (const b of this.el.querySelectorAll<HTMLElement>('[data-arsenal]')) b.classList.toggle('on', b.dataset.arsenal === this.value.arsenal);
    const libre = this.value.arsenal === 'libre';
    (this.el.querySelector('.gf-weps') as HTMLElement).hidden = !libre;
    for (const b of this.el.querySelectorAll<HTMLElement>('[data-wep]')) b.classList.toggle('on', this.value.weapons.includes(b.dataset.wep as GFWeapon));
    this.el.querySelector('.gf-arsenal-help')!.textContent = libre
      ? 'Armes autorisées (cliquez pour en retirer ou en remettre) :'
      : `Tout le monde commence au couteau ; toutes les ${progressionStep(this.value)} éliminations, l’arme suivante : ${PROGRESSION.map((w) => WEAPON_NAMES[w]).join(' → ')}.`;
    for (const row of this.el.querySelectorAll<HTMLElement>('.gf-step')) {
      const k = row.dataset.k as 'maxPlayers' | 'scoreLimit' | 'minutes';
      row.querySelector('output')!.textContent = `${this.value[k]}${k === 'minutes' ? ' min' : ''}`;
    }
  }
}

/** Écran « Gunfight » du menu principal. */
export function gunfightMenuScreen(hooks: GFMenuHooks, status: (text: string, bad?: boolean) => void): HTMLElement {
  const create = new GFSettingsForm();
  const solo = new GFSettingsForm({ ...GF_DEFAULT, scoreLimit: 15 }, { players: false });
  let soloTeam: Team = 'rouge';
  let bots = 5;
  let difficulty: 'facile' | 'normal' | 'difficile' = 'normal';
  const el = h(`<section class="mm-screen mm-panel" data-screen="gunfight" aria-label="Gunfight">
    <header><button type="button" class="back" aria-label="Retour au menu">←</button><h2>Gunfight</h2></header>
    <div class="mm-body">
      <p class="sub">Pistolet, carabine, fusil à pompe, fusil de précision et couteau (<kbd>1</kbd> à <kbd>5</kbd>), ou progression du couteau au fusil de précision. Chaque élimination rapporte un point ; on réapparaît au bout de 3 s, invincible 2 s.</p>
      <div class="slot-profile"></div>
      <div class="tabs" role="tablist">
        <button type="button" role="tab" data-gtab="creer" class="on">Créer une salle</button>
        <button type="button" role="tab" data-gtab="rejoindre">Rejoindre</button>
        <button type="button" role="tab" data-gtab="solo">Solo (robots)</button>
      </div>
      <div class="gtab" data-gtab="creer">
        ${STATIC ? `<p class="offline">${esc(OFFLINE_MESSAGE)}</p>` : ''}
        <div class="slot-create"></div>
        <button type="button" class="primary gf-create" ${STATIC ? 'disabled' : ''}>Créer la salle</button>
      </div>
      <div class="gtab" data-gtab="rejoindre" hidden>
        <label class="field">Code de la salle <input class="code gf-code" maxlength="4" autocomplete="off" spellcheck="false" placeholder="ABCD" /></label>
        <button type="button" class="primary gf-join" disabled>Rejoindre la salle</button>
      </div>
      <div class="gtab" data-gtab="solo" hidden>
        <div class="slot-solo"></div>
        <div class="gf-step gf-bots"><span>Robots adverses / alliés</span><button type="button" data-b="-1">−</button><output>${bots}</output><button type="button" data-b="1">+</button></div>
        <div class="field">Difficulté des robots<div class="seg gf-diff"><button type="button" data-diff="facile">Facile</button><button type="button" data-diff="normal" class="on">Normale</button><button type="button" data-diff="difficile">Difficile</button></div></div>
        <div class="field gf-myteam" hidden>Votre équipe<div class="seg"><button type="button" data-team="rouge" class="on">Rouge</button><button type="button" data-team="bleu">Bleue</button></div></div>
        <button type="button" class="primary gf-solo">Lancer la partie solo</button>
      </div>
    </div>
  </section>`);
  el.querySelector('.slot-profile')!.appendChild(profile.fieldsEl());
  el.querySelector('.slot-create')!.appendChild(create.el);
  el.querySelector('.slot-solo')!.appendChild(solo.el);
  const myTeam = el.querySelector('.gf-myteam') as HTMLElement;
  solo.onChange = (s) => (myTeam.hidden = s.mode !== 'equipes');
  onClick(el, '[data-gtab]', (b) => {
    if (b.classList.contains('gtab')) return;
    sfx.click();
    for (const x of el.querySelectorAll<HTMLElement>('[role=tab]')) x.classList.toggle('on', x === b);
    for (const t of el.querySelectorAll<HTMLElement>('.gtab')) t.hidden = t.dataset.gtab !== b.dataset.gtab;
  });
  onClick(el, '[data-b]', (b) => {
    bots = Math.max(1, Math.min(11, bots + Number(b.dataset.b)));
    el.querySelector('.gf-bots output')!.textContent = String(bots);
    sfx.click();
  });
  onClick(el, '[data-diff]', (b) => {
    difficulty = b.dataset.diff as typeof difficulty;
    for (const x of el.querySelectorAll<HTMLElement>('[data-diff]')) x.classList.toggle('on', x === b);
    sfx.click();
  });
  onClick(el, '[data-team]', (b) => {
    soloTeam = b.dataset.team as Team;
    for (const x of el.querySelectorAll<HTMLElement>('[data-team]')) x.classList.toggle('on', x === b);
    sfx.click();
  });
  const needName = () => {
    if (profile.name) return false;
    status('Indiquez votre nom.');
    return true;
  };
  const run = async (btn: HTMLButtonElement, label: string, fn: () => Promise<unknown>) => {
    if (needName()) return;
    sfx.click();
    btn.disabled = true;
    status(label, false);
    try {
      await fn();
      status('', false);
    } catch (e) {
      status((e as Error).message);
    } finally {
      btn.disabled = false;
    }
  };
  const code = el.querySelector('.gf-code') as HTMLInputElement;
  const join = el.querySelector('.gf-join') as HTMLButtonElement;
  code.addEventListener('input', () => {
    code.value = code.value.toUpperCase().replace(/[^A-Z]/g, '');
    join.disabled = STATIC || code.value.length !== 4;
  });
  el.querySelector('.gf-create')!.addEventListener('click', (e) => run(e.currentTarget as HTMLButtonElement, 'Création de la salle…', () => hooks.create(profile.name, profile.sex, create.value)));
  join.addEventListener('click', () => run(join, 'Connexion à la salle…', () => hooks.join(code.value, profile.name, profile.sex)));
  el.querySelector('.gf-solo')!.addEventListener('click', (e) =>
    run(e.currentTarget as HTMLButtonElement, 'Préparation de la partie…', () => hooks.solo(profile.name, profile.sex, { settings: solo.value, bots, difficulty, team: soloTeam })),
  );
  return el;
}

// ───────────────────────── salle d'attente ─────────────────────────

export interface GFLobbyHooks {
  me(): string;
  setSettings(s: GFSettings): Promise<unknown>;
  setTeam(t: Team): Promise<unknown>;
  start(): Promise<unknown>;
  quit(): void;
  toast(text: string, kind?: 'info' | 'bad' | 'ok'): void;
}

export class GFLobbyScreen {
  readonly el: HTMLElement;
  private form = new GFSettingsForm();
  private known = new Set<string>();
  private code = '';

  constructor(private hooks: GFLobbyHooks) {
    this.el = h(`<div class="lobby-screen gf-lobby" role="dialog" aria-label="Salle Gunfight">
      <div class="mm-shade"></div>
      <div class="lobby-card">
        <header class="lobby-head">
          <div><div class="mm-kicker">Gunfight — salle d'attente</div><h2>Code <button type="button" class="lcode" title="Copier le code"></button></h2>
          <p class="sub">Partagez ce code : les autres le saisissent dans Gunfight → Rejoindre.</p></div>
          <div class="lcount" aria-live="polite"></div>
        </header>
        <div class="lobby-grid">
          <section class="gf-players" aria-label="Joueurs"></section>
          <section aria-label="Réglages"><h3 class="gf-h3">Réglages</h3><div class="gf-settings"></div><div class="lnote"></div></section>
        </div>
        <footer class="lactions">
          <button type="button" class="ghost quit">Quitter la salle</button>
          <button type="button" class="primary start">Lancer la partie</button>
        </footer>
        <div class="status" role="status" aria-live="polite"></div>
      </div>
    </div>`);
    this.el.querySelector('.gf-settings')!.appendChild(this.form.el);
    this.form.onChange = (s) => hooks.setSettings(s).catch((e: Error) => this.status(e.message));
    onClick(this.el, '.start', () => {
      sfx.click();
      hooks.start().catch((e: Error) => this.status(e.message));
    });
    onClick(this.el, '.quit', () => {
      sfx.back();
      hooks.quit();
    });
    onClick(this.el, '[data-join-team]', (b) => {
      sfx.click();
      hooks.setTeam(b.dataset.joinTeam as Team).catch((e: Error) => this.status(e.message));
    });
    onClick(this.el, '.lcode', () => void navigator.clipboard?.writeText(this.code).then(() => hooks.toast(`Code ${this.code} copié.`, 'ok'), () => {}));
  }

  private status(t: string) {
    this.el.querySelector('.status')!.textContent = t;
    if (t) sfx.error();
  }

  render(L: GFLobbyView) {
    const me = this.hooks.me();
    if (L.code !== this.code) {
      this.code = L.code;
      this.known = new Set(L.players.map((p) => p.id));
    } else {
      for (const p of L.players) if (!this.known.has(p.id) && p.id !== me) this.hooks.toast(`${p.name} a rejoint la salle.`, 'ok');
      for (const id of this.known) if (!L.players.some((p) => p.id === id)) this.hooks.toast('Un joueur a quitté la salle.', 'bad');
      this.known = new Set(L.players.map((p) => p.id));
    }
    const host = !!L.players.find((p) => p.id === me)?.host;
    this.el.querySelector('.lcode')!.textContent = L.code;
    this.el.querySelector('.lcount')!.innerHTML = `<b>${L.players.length}</b> / ${L.settings.maxPlayers}<small>${GF_MODE_NAMES[L.settings.mode]} · ${esc(mapOf(L.settings.map).name)}${L.settings.night ? ' de nuit' : ''} · ${ARSENAL_NAMES[L.settings.arsenal]}</small>`;
    const row = (p: GFLobbyView['players'][number]) =>
      `<li class="seat${p.id === me ? ' me' : ''}${p.connected ? '' : ' off'}"><span class="avatar">${esc(p.name.slice(0, 1).toUpperCase())}</span><span class="seat-name">${esc(p.name)}${p.id === me ? ' <em>(vous)</em>' : ''}<small>${p.host ? 'hôte' : p.connected ? 'prêt à combattre' : 'déconnecté'}</small></span><span class="seat-state">${p.host ? ICON.couronne : ''}</span></li>`;
    const playersEl = this.el.querySelector('.gf-players') as HTMLElement;
    if (L.settings.mode === 'equipes') {
      const myTeam = L.players.find((p) => p.id === me)?.team;
      playersEl.innerHTML = `<div class="gf-teams">${(['rouge', 'bleu'] as Team[])
        .map(
          (t) => `<div class="gf-team team-${t}"><h3>${TEAM_NAMES[t]} <small>${L.players.filter((p) => p.team === t).length}</small></h3>
          <ul class="seats">${L.players.filter((p) => p.team === t).map(row).join('') || '<li class="seat empty"><span class="seat-name">Personne pour l’instant</span></li>'}</ul>
          ${myTeam === t ? `<div class="gf-in">${ICON.coche} Vous êtes ici</div>` : `<button type="button" class="ghost" data-join-team="${t}">Rejoindre cette équipe</button>`}</div>`,
        )
        .join('')}</div>`;
    } else playersEl.innerHTML = `<h3 class="gf-h3">Joueurs</h3><ul class="seats">${L.players.map(row).join('')}</ul>`;
    playersEl.insertAdjacentHTML('beforeend', `<div class="lmissing ${L.blocker ? '' : 'ok'}">${L.blocker ? `${ICON.sablier} ${esc(L.blocker)}` : `${ICON.coche} Tout est prêt.`}</div>`);
    this.form.set(L.settings);
    this.form.setLocked(!host);
    this.el.querySelector('.lnote')!.textContent = host ? 'Vous êtes l’hôte : réglez la partie puis lancez-la.' : 'Seul l’hôte règle et lance la partie.';
    const start = this.el.querySelector('.start') as HTMLButtonElement;
    start.hidden = !host;
    start.disabled = !!L.blocker;
  }
}

// ───────────────────────── combat ─────────────────────────

export class GFHud {
  readonly el: HTMLElement;
  private board = false;
  private feedKey = '';
  readonly minimap = new GFMinimap();
  private hitTimer = 0;
  private dmgTimer = 0;
  names: (id: string) => string = () => '?';

  constructor() {
    this.el = h(`<div class="gf-hud">
      <div class="gf-top"><div class="gf-score"></div><div class="gf-time"></div></div>
      <ol class="gf-feed" aria-live="polite"></ol>
      <div class="gf-scope" aria-hidden="true"><i></i></div>
      <div class="gf-cross" aria-hidden="true"><span class="l"></span><span class="r"></span><span class="t"></span><span class="b"></span><i></i></div>
      <div class="gf-headshot" aria-hidden="true">Tête !</div>
      <div class="gf-out" role="status">Limite de la carte</div>
      <div class="gf-shield" role="status"></div>
      <div class="gf-dmg" aria-hidden="true"></div>
      <div class="gf-health"><span class="gf-hp-n"></span><div class="gf-hp"><i></i></div></div>
      <div class="gf-ammo"></div>
      <ol class="gf-slots"></ol>
      <div class="gf-dead"><div><h2>Éliminé</h2><p class="gf-by"></p><p class="gf-respawn"></p></div></div>
      <div class="gf-board" hidden></div>
      <div class="controls-help"><span><kbd>Clic</kbd> tirer / frapper</span><span><kbd>Clic droit</kbd> viser</span><span><kbd>R</kbd> recharger</span><span><kbd>1</kbd>…<kbd>5</kbd> / molette : armes</span><span class="gf-night-keys"><kbd>L</kbd> lampe <kbd>O</kbd> laser</span><span><kbd>Tab</kbd> scores</span><span><kbd>Échap</kbd> menu</span></div>
    </div>`);
    this.el.append(this.minimap.el);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab' && this.el.classList.contains('open')) {
        this.board = true;
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Tab') this.board = false;
    });
  }

  /** Avertissement : on bute sur la limite de la carte. */
  outOfMap(on: boolean) {
    this.el.querySelector('.gf-out')!.classList.toggle('on', on);
  }

  hitMarker(killed: boolean, head = false) {
    const c = this.el.querySelector('.gf-cross') as HTMLElement;
    c.classList.remove('hit', 'kill', 'head');
    void c.offsetWidth;
    c.classList.add(killed ? 'kill' : 'hit');
    if (head) c.classList.add('head');
    clearTimeout(this.hitTimer);
    this.hitTimer = window.setTimeout(() => c.classList.remove('hit', 'kill', 'head'), head ? 420 : 260);
    if (head) {
      const hs = this.el.querySelector('.gf-headshot') as HTMLElement;
      hs.textContent = killed ? 'Tête ! Éliminé' : 'Tête !';
      hs.classList.remove('on');
      void hs.offsetWidth;
      hs.classList.add('on');
    }
  }

  damaged() {
    const d = this.el.querySelector('.gf-dmg') as HTMLElement;
    d.classList.remove('on');
    void d.offsetWidth;
    d.classList.add('on');
    clearTimeout(this.dmgTimer);
    this.dmgTimer = window.setTimeout(() => d.classList.remove('on'), 500);
  }

  /** `spreadPx` : rayon du cône de dispersion à l'écran (le viseur s'ouvre d'autant) */
  render(G: GFGameView, me: string, now: number, item: GFWeapon, spreadPx = 8, scoped = false) {
    const st = G.players[me];
    const name = this.names;
    const teamOf = (id: string) => G.teams[id];
    // score
    const score = this.el.querySelector('.gf-score') as HTMLElement;
    if (G.settings.mode === 'equipes') {
      score.innerHTML = `<span class="team-rouge">Rouge <b>${G.teamScores.rouge}</b></span><small>/ ${G.settings.scoreLimit}</small><span class="team-bleu"><b>${G.teamScores.bleu}</b> Bleue</span>`;
    } else {
      const sorted = Object.entries(G.players).sort((a, b) => b[1].kills - a[1].kills);
      const rank = sorted.findIndex(([id]) => id === me) + 1;
      score.innerHTML = `<span>Vous <b>${st?.kills ?? 0}</b></span><small>${rank}<sup>${rank === 1 ? 'er' : 'e'}</sup> sur ${sorted.length} · objectif ${G.settings.scoreLimit}</small><span>1<sup>er</sup> : ${esc(name(sorted[0]?.[0] ?? ''))} <b>${sorted[0]?.[1].kills ?? 0}</b></span>`;
    }
    const left = Math.max(0, G.endsAt - now) / 1000;
    this.el.querySelector('.gf-time')!.textContent = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
    // fil des éliminations : fixe (réécrit seulement quand il change), chaque ligne reste 3 s
    const cls = (id: string) => (teamOf(id) ? `team-${teamOf(id)}` : id === me ? 'me' : '');
    const shown = G.feed.filter((k) => now - k.t < 3000).reverse();
    const key = shown.map((k) => `${k.t}:${k.killer}:${k.victim}`).join('|');
    if (key !== this.feedKey) this.feedKey = key;
    else return this.renderRest(G, me, now, item, spreadPx, scoped);
    this.el.querySelector('.gf-feed')!.innerHTML = shown
      .map((k) => `<li><b class="${cls(k.killer)}">${esc(name(k.killer))}</b> <span class="gf-w" title="${esc(WEAPON_NAMES[k.weapon] ?? '')}">${WEAPON_ICON[k.weapon] ?? ICON.balle}${k.head ? `<span class="gf-hs" title="Tir à la tête">${ICON.crane}</span>` : ''}</span> <b class="${cls(k.victim)}">${esc(name(k.victim))}</b></li>`)
      .join('');
    this.renderRest(G, me, now, item, spreadPx, scoped);
  }

  private renderRest(G: GFGameView, me: string, now: number, item: GFWeapon, spreadPx: number, scoped: boolean) {
    const st = G.players[me];
    const name = this.names;
    // vie, munitions
    const hp = st?.hp ?? 0;
    this.el.querySelector('.gf-hp-n')!.textContent = String(hp);
    const bar = this.el.querySelector('.gf-hp i') as HTMLElement;
    bar.style.transform = `scaleX(${hp / GF_RULES.health})`;
    this.el.querySelector('.gf-health')!.classList.toggle('low', hp <= 34);
    const reloading = !!st?.reloadUntil && st.reloadUntil > now;
    const ammo = this.el.querySelector('.gf-ammo')!;
    if (!isGun(item)) ammo.innerHTML = `${ICON.dague}<span>Couteau</span><small>Corps à corps</small>`;
    else {
      const n = st?.ammo[item] ?? 0;
      const busy = reloading && st?.reloading === item;
      ammo.innerHTML = `${ICON.balle}<span><b>${busy ? '…' : n}</b> / ${WEAPONS[item].magazine}</span><small>${busy ? 'Rechargement' : n === 0 ? 'R : recharger' : esc(WEAPONS[item].name)}</small>`;
    }
    const allowed = st?.weapons ?? SLOTS;
    // progression : palier atteint et éliminations avant l'arme suivante
    const prog =
      G.settings.arsenal === 'progression' && st
        ? (() => {
            const tier = progressionTier(G.settings, st.kills);
            const step = progressionStep(G.settings);
            const next = tier < PROGRESSION.length - 1 ? `${WEAPON_NAMES[PROGRESSION[tier + 1]]} dans ${step - (st.kills % step)} élim.` : 'Arme finale';
            return `<li class="gf-prog">Progression ${tier + 1} / ${PROGRESSION.length} · ${esc(next)}</li>`;
          })()
        : '';
    const slotsHtml =
      prog +
      SLOTS.map((w, i) =>
        allowed.includes(w)
          ? `<li class="${w === item ? 'on' : ''}${isGun(w) && st && st.ammo[w] === 0 ? ' empty' : ''}"><kbd>${i + 1}</kbd>${WEAPON_ICON[w]}<span>${esc(WEAPON_NAMES[w])}</span>${isGun(w) ? `<small>${st?.ammo[w] ?? 0}</small>` : ''}</li>`
          : '',
      ).join('');
    const slots = this.el.querySelector('.gf-slots')!;
    if (slots.innerHTML !== slotsHtml) slots.innerHTML = slotsHtml;
    // invincibilité à l'apparition
    const shield = this.el.querySelector('.gf-shield') as HTMLElement;
    const sh = st?.alive ? Math.max(0, (st.shieldUntil - now) / 1000) : 0;
    shield.classList.toggle('on', sh > 0);
    if (sh > 0) shield.textContent = `Protégé ${sh.toFixed(1)} s`;
    // viseur : s'ouvre avec la dispersion ; lunette du fusil de précision
    const cross = this.el.querySelector('.gf-cross') as HTMLElement;
    cross.style.setProperty('--gap', `${Math.round(Math.min(80, Math.max(3, spreadPx)))}px`);
    cross.classList.toggle('knife', !isGun(item));
    this.el.classList.toggle('scoped', scoped);
    this.el.classList.toggle('night', G.settings.night);
    // mort
    const dead = this.el.querySelector('.gf-dead') as HTMLElement;
    dead.classList.toggle('open', !!st && !st.alive && G.phase === 'jeu');
    if (st && !st.alive) {
      const k = [...G.feed].reverse().find((x) => x.victim === me);
      this.el.querySelector('.gf-by')!.textContent = k ? `par ${name(k.killer)} (${(WEAPON_NAMES[k.weapon] ?? k.weapon).toLowerCase()}${k.head ? ', tir à la tête' : ''})` : '';
      this.el.querySelector('.gf-respawn')!.textContent = `Réapparition dans ${Math.max(0, Math.ceil((st.respawnAt - now) / 1000))} s`;
    }
    // tableau des scores (Tab)
    const board = this.el.querySelector('.gf-board') as HTMLElement;
    board.hidden = !this.board;
    if (this.board) board.innerHTML = scoreboard(G, me, name);
  }
}

/** Tableau des scores : par équipe ou général, éliminations et morts. */
export function scoreboard(G: GFGameView, me: string, name: (id: string) => string): string {
  const rows = (ids: string[]) =>
    ids
      .sort((a, b) => G.players[b].kills - G.players[a].kills || G.players[a].deaths - G.players[b].deaths)
      .map((id) => `<tr class="${id === me ? 'me' : ''}"><td>${esc(name(id))}${id === me ? ' <em>(vous)</em>' : ''}</td><td>${G.players[id].kills}</td><td>${G.players[id].headshots ?? 0}</td><td>${G.players[id].deaths}</td></tr>`)
      .join('');
  const head = '<tr><th>Joueur</th><th>Élim.</th><th title="Éliminations par tir à la tête">Tête</th><th>Morts</th></tr>';
  const ids = Object.keys(G.players);
  if (G.settings.mode === 'equipes')
    return `<div class="gf-teams">${(['rouge', 'bleu'] as Team[])
      .map((t) => `<div class="gf-team team-${t}"><h3>${TEAM_NAMES[t]} <b>${G.teamScores[t]}</b></h3><table>${head}${rows(ids.filter((id) => G.teams[id] === t))}</table></div>`)
      .join('')}</div>`;
  return `<table>${head}${rows(ids)}</table>`;
}

/** Résultats d'une partie Gunfight. */
export class GFResults {
  readonly el = h(`<div class="results gf-results" role="dialog" aria-label="Fin de la partie"></div>`);
  onBack: () => void = () => {};
  onQuit: () => void = () => {};
  shown = 0;

  constructor() {
    onClick(this.el, '.back', () => this.onBack());
    onClick(this.el, '.quit', () => this.onQuit());
  }
  get open() {
    return this.el.classList.contains('open');
  }
  close() {
    this.el.classList.remove('open');
  }
  show(G: GFGameView, me: string, name: (id: string) => string, solo: boolean) {
    this.shown = G.startedAt;
    const r = G.result!;
    const myTeam = G.teams[me];
    const won = r.winner === null ? null : r.winner === me || (myTeam !== null && r.winner === myTeam);
    (won ? sfx.victory : sfx.defeat)();
    const title = r.winner === null ? 'Égalité' : r.winner === 'rouge' || r.winner === 'bleu' ? `${TEAM_NAMES[r.winner as Team]} gagne` : `${esc(name(r.winner))} gagne`;
    this.el.className = `results gf-results open ${won ? 'w-innocents' : 'w-tueurs'}`;
    // d'abord la bannière « Partie terminée » puis « Victoire / Défaite », ensuite les scores
    const verdict = won === null ? 'Égalité' : won ? 'Victoire !' : 'Défaite';
    this.el.innerHTML = `<div class="gf-end ${won === null ? 'nul' : won ? 'win' : 'lose'}" aria-live="assertive">
      <span class="gf-end-k">Partie terminée</span>
      <strong>${verdict}</strong>
      <span class="gf-end-s">${won === null ? 'Personne ne l’emporte' : won ? 'Vous avez gagné' : 'Vous avez perdu'}</span>
    </div>
    <div class="res-box gf-res-late">
      <div class="mm-kicker">${won === null ? 'Fin de la partie' : won ? 'Victoire' : 'Défaite'}</div>
      <h2>${title}</h2>
      <p class="res-reason">${esc(r.reason)}</p>
      <div class="gf-board-static">${scoreboard(G, me, name)}</div>
      <div class="res-actions"><button type="button" class="ghost quit">Quitter</button><button type="button" class="primary back">${solo ? 'Rejouer' : 'Retour à la salle'}</button></div>
    </div>`;
  }
}
