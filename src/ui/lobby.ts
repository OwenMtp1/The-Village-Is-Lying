/**
 * Salon : code à partager, places (occupées, libres), hôte, joueurs prêts ou déconnectés (icône + texte),
 * composition des rôles (modifiable par l'hôte jusqu'au lancement), arrivées et départs annoncés.
 */
import type { Sex } from '../characters/catalog';
import type { LobbyView } from '../shared/protocol';
import { net } from '../client/net';
import { sfx } from '../audio/sfx';
import { CompositionEditor } from './composition';
import { esc, h } from './dom';
import { ICON } from './icons';

export interface LobbyHooks {
  quit(): void;
  toast(text: string, kind?: 'info' | 'bad' | 'ok'): void;
}

export class LobbyScreen {
  readonly el: HTMLElement;
  private editor = new CompositionEditor();
  private draftError = '';
  private known = new Map<string, { name: string; connected: boolean }>();
  private code = '';

  constructor(private hooks: LobbyHooks) {
    this.el = h(`<div class="lobby-screen" role="dialog" aria-label="Salon">
      <div class="mm-shade"></div>
      <div class="lobby-card">
        <header class="lobby-head">
          <div><div class="mm-kicker">Salon de la partie</div><h2>Code <button type="button" class="lcode" title="Copier le code"></button></h2>
          <p class="sub">Donnez ce code aux autres joueurs : ils le saisissent dans « Rejoindre une partie ».</p></div>
          <div class="lcount" aria-live="polite"></div>
        </header>
        <div class="lobby-grid">
          <section aria-label="Joueurs">
            <ul class="seats"></ul>
            <div class="lmissing" role="status" aria-live="polite"></div>
            <div class="field">Votre personnage <div class="seg sex2"><button type="button" data-sex="M">Masculin</button><button type="button" data-sex="F">Féminin</button></div></div>
            <button type="button" class="ready-btn" aria-pressed="false"></button>
          </section>
          <section aria-label="Composition des rôles">
            <div class="leditor"></div>
            <div class="lnote"></div>
          </section>
        </div>
        <footer class="lactions">
          <button type="button" class="ghost quit">Quitter le salon</button>
          <button type="button" class="primary start">Lancer la partie</button>
        </footer>
        <div class="status" role="status" aria-live="polite"></div>
      </div>
    </div>`);
    this.el.querySelector('.leditor')!.appendChild(this.editor.el);
    this.bind();
  }

  private status(text: string) {
    this.el.querySelector('.status')!.textContent = text;
    if (text) sfx.error();
  }

  private bind() {
    const l = this.el;
    this.editor.onChange = async (c, valid) => {
      if (!valid) {
        this.draftError = 'Composition non appliquée : corrigez-la pour qu’elle soit enregistrée.';
        if (net.lobby) this.render(net.lobby);
        return;
      }
      try {
        await net.setComposition(c);
        this.draftError = '';
      } catch (e) {
        this.draftError = `Composition refusée par le serveur : ${(e as Error).message}`;
      }
      if (net.lobby) this.render(net.lobby);
    };
    l.querySelector('.sex2')!.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-sex]') as HTMLElement | null;
      if (b) {
        sfx.click();
        net.setSex(b.dataset.sex as Sex).catch((er: Error) => this.status(er.message));
      }
    });
    l.querySelector('.ready-btn')!.addEventListener('click', () => {
      const me = net.lobby?.players.find((p) => p.id === net.me);
      sfx.click();
      net.setReady(!me?.ready).catch((er: Error) => this.status(er.message));
    });
    l.querySelector('.start')!.addEventListener('click', () => {
      sfx.click();
      net.start().catch((e: Error) => this.status(e.message));
    });
    l.querySelector('.quit')!.addEventListener('click', () => {
      sfx.back();
      this.hooks.quit();
    });
    l.querySelector('.lcode')!.addEventListener('click', () => {
      void navigator.clipboard?.writeText(this.code).then(
        () => this.hooks.toast(`Code ${this.code} copié.`, 'ok'),
        () => {},
      );
    });
  }

  /** Arrivées, départs, déconnexions et reconnexions annoncés (le joueur lui-même exclu). */
  private announce(L: LobbyView) {
    if (L.code !== this.code) {
      this.code = L.code;
      this.known = new Map(L.players.map((p) => [p.id, { name: p.name, connected: p.connected }]));
      return;
    }
    const now = new Map(L.players.map((p) => [p.id, p]));
    for (const p of L.players) {
      if (p.id === net.me) continue;
      const before = this.known.get(p.id);
      if (!before) {
        this.hooks.toast(`${p.name} a rejoint le salon.`, 'ok');
        sfx.notify();
      } else if (before.connected && !p.connected) {
        this.hooks.toast(`${p.name} s’est déconnecté.`, 'bad');
        sfx.leave();
      } else if (!before.connected && p.connected) {
        this.hooks.toast(`${p.name} est de retour.`, 'ok');
        sfx.notify();
      }
    }
    for (const [id, p] of this.known)
      if (!now.has(id) && id !== net.me) {
        this.hooks.toast(`${p.name} a quitté le salon.`, 'bad');
        sfx.leave();
      }
    this.known = new Map(L.players.map((p) => [p.id, { name: p.name, connected: p.connected }]));
  }

  render(L: LobbyView) {
    this.announce(L);
    const l = this.el;
    const me = L.players.find((p) => p.id === net.me);
    const host = !!me?.host;
    l.querySelector('.lcode')!.textContent = L.code;
    const connected = L.players.filter((p) => p.connected).length;
    l.querySelector('.lcount')!.innerHTML = `<b>${connected}</b> / ${L.seats}<small>joueurs connectés</small>`;
    const missing = l.querySelector('.lmissing') as HTMLElement;
    missing.innerHTML = L.blocker ? `${ICON.sablier} ${esc(L.blocker)}` : `${ICON.coche} Tout le monde est là : la partie peut commencer.`;
    missing.classList.toggle('ok', !L.blocker);
    const seats: string[] = [];
    for (const p of L.players) {
      const state = !p.connected ? `${ICON.deconnecte}<span>déconnecté</span>` : p.host ? `${ICON.couronne}<span>hôte</span>` : p.ready ? `${ICON.coche}<span>prêt</span>` : `${ICON.sablier}<span>pas encore prêt</span>`;
      seats.push(`<li class="seat${p.connected ? '' : ' off'}${p.ready || p.host ? ' ready' : ''}${p.id === net.me ? ' me' : ''}">
        <span class="avatar" aria-hidden="true">${esc(p.name.slice(0, 1).toUpperCase())}</span>
        <span class="seat-name">${esc(p.name)}${p.id === net.me ? ' <em>(vous)</em>' : ''}<small>${p.sex === 'F' ? 'personnage féminin' : 'personnage masculin'}</small></span>
        <span class="seat-state">${state}</span></li>`);
    }
    for (let i = L.players.length; i < L.seats; i++) seats.push(`<li class="seat empty"><span class="avatar" aria-hidden="true">·</span><span class="seat-name">Place libre</span></li>`);
    l.querySelector('.seats')!.innerHTML = seats.join('');
    for (const b of l.querySelectorAll<HTMLButtonElement>('.sex2 [data-sex]')) {
      b.classList.toggle('on', b.dataset.sex === me?.sex);
      b.setAttribute('aria-pressed', String(b.dataset.sex === me?.sex));
    }
    const ready = l.querySelector('.ready-btn') as HTMLButtonElement;
    ready.hidden = host;
    ready.classList.toggle('on', !!me?.ready);
    ready.setAttribute('aria-pressed', String(!!me?.ready));
    ready.innerHTML = me?.ready ? `${ICON.coche} Prêt — cliquer pour annuler` : 'Je suis prêt';
    if (!host || !this.draftError) this.editor.set(L.composition, true);
    this.editor.setLocked(!host || L.phase !== 'salon');
    l.querySelector('.lnote')!.textContent = host
      ? this.draftError || 'Vous êtes l’hôte : ajustez la composition jusqu’au lancement. Les joueurs signalent quand ils sont prêts.'
      : 'Seul l’hôte peut modifier la composition et lancer la partie.';
    const start = l.querySelector('.start') as HTMLButtonElement;
    start.hidden = !host;
    start.disabled = !!L.blocker || !!this.draftError;
    const notReady = L.players.filter((p) => !p.host && p.connected && !p.ready).length;
    start.textContent = !L.blocker && notReady ? `Lancer (${notReady} pas encore prêt${notReady > 1 ? 's' : ''})` : 'Lancer la partie';
  }
}
