/**
 * Interface : menu (créer / rejoindre / exploration solo), éditeur de composition des rôles (création et salon),
 * salon, carte de rôle, actions, réunions et votes, résultats. Tout se met à jour immédiatement, sans recharger.
 */
import { MAX_PLAYERS, MIN_PLAYERS, PRESETS, ROLES, ROLE_INFO, compositionErrors, presetOf, totalOf, DEFAULT_COMPOSITION, type Composition } from '../shared/roles';
import { cardUrl, type Sex } from '../characters/catalog';
import { OFFLINE_MESSAGE, STATIC, net } from './net';
import type { OnlineGame } from './online';

const h = (html: string) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

// ───────────────────────── éditeur de composition ─────────────────────────

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
          <div class="compo-name"><b>${ROLE_INFO[r].pluriel}</b><small>${ROLE_INFO[r].camp === 'tueurs' ? 'camp des tueurs' : 'camp des innocents'}</small></div>
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

// ───────────────────────── menu, salon, partie ─────────────────────────

export interface UiHooks {
  /** exploration solo (village, personnages non joueurs) */
  solo(sex: Sex): Promise<void>;
  /** la partie en ligne commence (ou reprend après reconnexion) */
  enterOnline(): void;
  /** retour au menu (fin de la partie en ligne côté affichage) */
  leaveOnline(): void;
  inspect(): void;
}

export class GameUi {
  private menu: HTMLElement;
  private lobbyEl: HTMLElement;
  private hud: HTMLElement;
  private toasts: HTMLElement;
  private createEditor = new CompositionEditor();
  private lobbyEditor = new CompositionEditor();
  private sex: Sex = 'M';
  private online: OnlineGame | null = null;
  private lobbyDraftError = '';

  constructor(private hooks: UiHooks) {
    this.menu = h(`<div class="ov menu open"><div class="ov-box">
      <h1>The Village Is Lying</h1>
      <p class="sub">Minuit au village · jeu d'enquête multijoueur</p>
      <label class="field">Votre nom <input class="name" maxlength="20" placeholder="Votre nom" /></label>
      <div class="field">Votre personnage
        <div class="seg sex"><button type="button" data-sex="M" class="on">Masculin</button><button type="button" data-sex="F">Féminin</button></div>
        <small>L'apparence est tirée au sort parmi les villageois de ce sexe au lancement de la partie.</small>
      </div>
      <div class="tabs"><button type="button" data-tab="creer" class="on">Créer une partie</button><button type="button" data-tab="rejoindre">Rejoindre</button><button type="button" data-tab="solo">Exploration solo</button></div>
      <div class="tab" data-tab="creer"><div class="editor"></div><button type="button" class="primary create">Créer le salon</button></div>
      <div class="tab" data-tab="rejoindre" hidden><label class="field">Code du salon <input class="code" maxlength="4" placeholder="ABCD" /></label><button type="button" class="primary join">Rejoindre le salon</button></div>
      <div class="tab" data-tab="solo" hidden><p class="sub">Parcourez le village avec votre personnage, au milieu de quelques villageois, sans partie en ligne.</p><button type="button" class="primary solo">Explorer le village</button><button type="button" class="link inspect">Inspecter la map sans personnage</button></div>
      <div class="status"></div>
    </div></div>`);
    this.menu.querySelector('.editor')!.appendChild(this.createEditor.el);
    this.lobbyEl = h(`<div class="ov lobby"><div class="ov-box">
      <h1>Salon <span class="lcode"></span></h1>
      <p class="sub share">Donnez ce code aux autres joueurs pour qu'ils rejoignent la partie.</p>
      <div class="lcount"></div><div class="lmissing"></div>
      <ul class="lplayers"></ul>
      <div class="field">Votre personnage <div class="seg sex2"><button type="button" data-sex="M">Masculin</button><button type="button" data-sex="F">Féminin</button></div></div>
      <div class="leditor"></div>
      <div class="lnote"></div>
      <div class="lactions"><button type="button" class="primary start">Lancer la partie</button><button type="button" class="link quit">Quitter le salon</button></div>
      <div class="status"></div>
    </div></div>`);
    this.lobbyEl.querySelector('.leditor')!.appendChild(this.lobbyEditor.el);
    this.hud = h(`<div class="online-hud">
      <div class="rolecard"></div>
      <div class="prompts"></div>
      <div class="meeting"></div>
      <div class="results"></div>
      <div class="online-help">Clic : diriger la caméra · <kbd>Z Q S D</kbd> · <kbd>Maj</kbd> courir · <kbd>Espace</kbd> sauter · <kbd>V</kbd> vue subjective</div>
    </div>`);
    this.toasts = h(`<div class="toasts"></div>`);
    document.body.append(this.menu, this.lobbyEl, this.hud, this.toasts);
    this.bind();
    net.subscribe(() => this.render());
    net.onEvent = (e) => this.toast(e.text, e.kind === 'mort' || e.kind === 'fin');
    try {
      const saved = JSON.parse(localStorage.getItem('village.profil') ?? 'null');
      if (saved?.name) (this.menu.querySelector('.name') as HTMLInputElement).value = saved.name;
      if (saved?.sex) this.pickSex(saved.sex);
    } catch {
      /* rien */
    }
    net.connect();
    if (STATIC) {
      // démonstration sans serveur : l'exploration solo est ouverte d'emblée, les parties en ligne expliquées
      (this.menu.querySelector('[data-tab="solo"]') as HTMLElement).click();
      for (const t of this.menu.querySelectorAll<HTMLElement>('.tab[data-tab="creer"], .tab[data-tab="rejoindre"]')) t.prepend(h(`<p class="offline">${esc(OFFLINE_MESSAGE)}</p>`));
    }
  }

  attach(online: OnlineGame) {
    this.online = online;
    online.onFeedback = (t, bad) => this.toast(t, bad);
  }

  showMenu(on: boolean) {
    this.menu.classList.toggle('open', on);
  }

  private name() {
    return (this.menu.querySelector('.name') as HTMLInputElement).value.trim();
  }
  private status(el: HTMLElement, text: string) {
    (el.querySelector('.status') as HTMLElement).textContent = text;
  }
  private pickSex(sex: Sex) {
    this.sex = sex;
    for (const b of this.menu.querySelectorAll<HTMLButtonElement>('.sex [data-sex]')) b.classList.toggle('on', b.dataset.sex === sex);
  }
  private saveProfile() {
    try {
      localStorage.setItem('village.profil', JSON.stringify({ name: this.name(), sex: this.sex }));
    } catch {
      /* rien */
    }
  }

  private bind() {
    const m = this.menu;
    m.querySelector('.sex')!.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-sex]') as HTMLElement | null;
      if (b) this.pickSex(b.dataset.sex as Sex);
    });
    m.querySelector('.tabs')!.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-tab]') as HTMLElement | null;
      if (!b) return;
      for (const x of m.querySelectorAll<HTMLElement>('.tabs [data-tab]')) x.classList.toggle('on', x === b);
      for (const t of m.querySelectorAll<HTMLElement>('.tab')) t.hidden = t.dataset.tab !== b.dataset.tab;
    });
    const create = m.querySelector('.create') as HTMLButtonElement;
    this.createEditor.onChange = (_c, valid) => (create.disabled = !valid);
    create.addEventListener('click', async () => {
      if (!this.name()) return this.status(m, 'Indiquez votre nom.');
      this.saveProfile();
      create.disabled = true;
      try {
        await net.create(this.name(), this.sex, this.createEditor.value);
        this.status(m, '');
      } catch (e) {
        this.status(m, (e as Error).message);
      } finally {
        create.disabled = this.createEditor.errors.length > 0;
      }
    });
    m.querySelector('.join')!.addEventListener('click', async () => {
      if (!this.name()) return this.status(m, 'Indiquez votre nom.');
      const code = (m.querySelector('.code') as HTMLInputElement).value.trim().toUpperCase();
      if (code.length !== 4) return this.status(m, 'Le code du salon compte 4 lettres.');
      this.saveProfile();
      try {
        await net.join(code, this.name(), this.sex);
        this.status(m, '');
      } catch (e) {
        this.status(m, (e as Error).message);
      }
    });
    m.querySelector('.solo')!.addEventListener('click', async () => {
      this.status(m, 'Le village prépare votre personnage…');
      try {
        await this.hooks.solo(this.sex);
        this.status(m, '');
        this.showMenu(false);
      } catch (e) {
        this.status(m, `Impossible de charger le personnage : ${(e as Error).message}`);
      }
    });
    m.querySelector('.inspect')!.addEventListener('click', () => {
      this.showMenu(false);
      this.hooks.inspect();
    });

    const l = this.lobbyEl;
    // l'hôte modifie la composition : envoyée au serveur dès qu'elle est valide ; sinon le motif est affiché
    this.lobbyEditor.onChange = async (c, valid) => {
      if (!valid) {
        this.lobbyDraftError = 'Composition non appliquée : corrigez-la pour qu’elle soit enregistrée.';
        this.render();
        return;
      }
      try {
        await net.setComposition(c);
        this.lobbyDraftError = '';
      } catch (e) {
        this.lobbyDraftError = `Composition refusée par le serveur : ${(e as Error).message}`;
      }
      this.render();
    };
    l.querySelector('.sex2')!.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-sex]') as HTMLElement | null;
      if (b) net.setSex(b.dataset.sex as Sex).catch((er: Error) => this.status(l, er.message));
    });
    l.querySelector('.start')!.addEventListener('click', () => net.start().catch((e: Error) => this.status(l, e.message)));
    l.querySelector('.quit')!.addEventListener('click', () => {
      net.leave();
      this.hooks.leaveOnline();
    });
    this.hud.querySelector('.meeting')!.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-vote]') as HTMLElement | null;
      if (b) net.vote(b.dataset.vote === '' ? null : b.dataset.vote!).catch((er: Error) => this.toast(er.message, true));
    });
    this.hud.querySelector('.results')!.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.back')) this.hooks.leaveOnline();
    });
  }

  toast(text: string, bad = false) {
    const t = h(`<div class="toast${bad ? ' bad' : ''}">${esc(text)}</div>`);
    this.toasts.appendChild(t);
    setTimeout(() => t.remove(), 6000);
  }

  /** Rafraîchit menu, salon et partie à partir de l'état reçu du serveur. */
  render() {
    const L = net.lobby;
    const G = net.game;
    const inLobby = !!L && (L.phase === 'salon' || (L.phase === 'fin' && !G));
    this.lobbyEl.classList.toggle('open', inLobby);
    if (L) this.menu.classList.remove('open');
    if (L && inLobby) this.renderLobby();
    const playing = !!L && !!G && L.phase !== 'salon';
    this.hud.classList.toggle('open', playing);
    if (playing) {
      this.hooks.enterOnline();
      this.renderHud();
    }
  }

  private renderLobby() {
    const L = net.lobby!;
    const l = this.lobbyEl;
    const me = L.players.find((p) => p.id === net.me);
    const host = !!me?.host;
    l.querySelector('.lcode')!.textContent = L.code;
    const connected = L.players.filter((p) => p.connected).length;
    l.querySelector('.lcount')!.textContent = `${connected} / ${L.seats} joueurs connectés`;
    l.querySelector('.lmissing')!.textContent = L.blocker ?? 'Tout le monde est là : la partie peut commencer.';
    l.querySelector('.lmissing')!.classList.toggle('ok', !L.blocker);
    l.querySelector('.lplayers')!.innerHTML = L.players
      .map((p) => `<li>${p.host ? '<span class="crown" title="Hôte">♛</span>' : ''}${esc(p.name)}${p.id === net.me ? ' <em>(vous)</em>' : ''} <small>${p.sex === 'F' ? 'féminin' : 'masculin'}${p.connected ? '' : ' · déconnecté'}</small></li>`)
      .join('');
    for (const b of l.querySelectorAll<HTMLButtonElement>('.sex2 [data-sex]')) b.classList.toggle('on', b.dataset.sex === me?.sex);
    // l'éditeur montre la composition du serveur, sauf pendant que l'hôte saisit une composition invalide
    if (!host || !this.lobbyDraftError) this.lobbyEditor.set(L.composition, true);
    this.lobbyEditor.setLocked(!host || L.phase === 'partie');
    l.querySelector('.lnote')!.textContent = host ? this.lobbyDraftError || 'Vous êtes l’hôte : vous pouvez ajuster la composition jusqu’au lancement.' : 'Seul l’hôte peut modifier la composition et lancer la partie.';
    const start = l.querySelector('.start') as HTMLButtonElement;
    start.hidden = !host;
    start.disabled = !!L.blocker || !!this.lobbyDraftError;
    start.textContent = L.phase === 'fin' ? 'Relancer une partie' : 'Lancer la partie';
  }

  private renderHud() {
    const G = net.game!;
    const S = net.secret;
    const card = this.hud.querySelector('.rolecard') as HTMLElement;
    if (S) {
      const info = ROLE_INFO[S.role];
      const extra: string[] = [];
      if (S.role === 'tueur') extra.push(S.allies.length ? `Vos complices : ${S.allies.map((a) => esc(net.nameOf(a))).join(', ')}` : 'Vous êtes le seul tueur.');
      if (S.role === 'sherif') extra.push(`Balle : ${S.ammo}`);
      if (S.role === 'detective') extra.push(`Enquête restante : ${S.investigations}`);
      for (const [id, k] of Object.entries(S.findings)) extra.push(`${esc(net.nameOf(id))} : ${k ? 'tueur !' : 'innocent'}`);
      const app = G.appearances[net.me];
      card.innerHTML = `${app ? `<img src="${cardUrl(app)}" alt="">` : ''}<div><div class="rc-role rc-${S.role}">${info.nom}</div><div class="rc-desc">${esc(info.description)}</div>${extra.map((x) => `<div class="rc-x">${x}</div>`).join('')}${G.alive[net.me] ? '' : '<div class="rc-dead">Vous êtes éliminé.</div>'}</div>`;
    }
    const prompts = this.hud.querySelector('.prompts') as HTMLElement;
    prompts.innerHTML = (this.online?.prompts ?? []).map((p) => `<div><kbd>${p.key.replace('Key', '')}</kbd> ${esc(p.label)}</div>`).join('');
    const meet = this.hud.querySelector('.meeting') as HTMLElement;
    meet.classList.toggle('open', G.phase === 'reunion');
    if (G.phase === 'reunion' && G.meeting) {
      const left = Math.max(0, Math.ceil((G.meeting.endsAt - Date.now()) / 1000));
      const mine = G.meeting.voted.includes(net.me);
      const canVote = G.alive[net.me] && !mine;
      const alive = Object.keys(G.alive).filter((id) => G.alive[id]);
      meet.innerHTML = `<h2>Réunion — ${G.meeting.reason === 'corps' ? `corps de ${esc(net.nameOf(G.meeting.body!))}` : 'urgence'}</h2>
        <p>Vote : ${left} s · ${G.meeting.voted.length} / ${alive.length} votes${G.alive[net.me] ? '' : ' · les joueurs éliminés ne votent pas'}</p>
        <div class="votes">${alive.map((id) => `<button type="button" data-vote="${id}" ${canVote ? '' : 'disabled'}>${esc(net.nameOf(id))}${id === net.me ? ' (vous)' : ''}${G.meeting!.voted.includes(id) ? ' ✓' : ''}</button>`).join('')}
        <button type="button" data-vote="" ${canVote ? '' : 'disabled'}>Ne désigner personne</button></div>
        <ul class="mlog">${G.log.slice(-5).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
    }
    const res = this.hud.querySelector('.results') as HTMLElement;
    res.classList.toggle('open', !!G.result);
    if (G.result) {
      res.innerHTML = `<h2>${G.result.winner === 'tueurs' ? 'Les tueurs ont gagné' : 'Les innocents ont gagné'}</h2>
        <ul>${Object.entries(G.result.roles).map(([id, r]) => `<li><b>${esc(net.nameOf(id))}</b> — ${ROLE_INFO[r].nom}${G.alive[id] ? '' : ' <small>(éliminé)</small>'}</li>`).join('')}</ul>
        <ul class="mlog">${G.log.slice(-6).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
        <button type="button" class="primary back">Retour au salon</button>`;
    }
  }
}
