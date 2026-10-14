/**
 * Interface de la partie en ligne : carte du rôle secret et état des pouvoirs, actions possibles,
 * aide des commandes, journal d'enquête (touche J), réunion et vote, écran d'élimination, résultats.
 * Toutes les informations viennent du serveur (vue publique + secret du joueur) : rien n'est deviné.
 */
import { ROLE_INFO, campOf, type Role } from '../shared/roles';
import type { GameView, PrivateInfo } from '../shared/protocol';
import { RULES } from '../shared/rules';
import { cardUrl } from '../characters/catalog';
import { net } from '../client/net';
import type { Prompt } from '../client/online';
import { sfx } from '../audio/sfx';
import { esc, h, onClick } from './dom';
import { ICON, ROLE_ICON } from './icons';

/** Nom lisible d'une touche (KeyE → E, Digit2 → 2, Mouse0 → Clic). */
export const keyName = (code: string) => (code === 'Mouse0' ? 'Clic' : code.replace(/^Key|^Digit/, ''));

const portrait = (appearance: string | undefined) => (appearance ? `<img class="portrait" src="${cardUrl(appearance)}" alt="" loading="lazy">` : '<span class="portrait none"></span>');

export class OnlineHud {
  readonly el: HTMLElement;
  private journalOpen = false;
  private wasAlive = true;
  private deathTimer = 0;
  onVote: (target: string | null) => void = () => {};
  onPause: () => void = () => {};

  constructor() {
    this.el = h(`<div class="online-hud">
      <aside class="role-panel" aria-label="Votre rôle"></aside>
      <button type="button" class="hud-btn pause-btn" title="Menu (Échap)" aria-label="Menu de pause">${ICON.menu}</button>
      <button type="button" class="hud-btn journal-btn" title="Journal d'enquête (J)">${ICON.livre}<span>Journal</span><kbd>J</kbd></button>
      <div class="prompts" aria-live="polite"></div>
      <div class="controls-help">
        <span><kbd>Z Q S D</kbd> marcher</span><span><kbd>Maj</kbd> courir</span><span><kbd>Espace</kbd> sauter</span><span><kbd>V</kbd> vue subjective</span><span><kbd>L</kbd> lampe</span><span><kbd>2</kbd> arme</span><span><kbd>J</kbd> journal</span><span><kbd>Échap</kbd> menu</span>
      </div>
      <section class="journal" aria-label="Journal d'enquête" hidden></section>
      <section class="meeting" role="dialog" aria-label="Réunion du village"></section>
      <div class="death" aria-live="assertive"><div><div class="death-icon">${ICON.crane}</div><h2>Vous avez été éliminé</h2><p>Vous suivez désormais la partie en spectateur : vous ne pouvez plus voter ni agir. Votre rôle reste secret jusqu’à la fin.</p></div></div>
    </div>`);
    onClick(this.el, '[data-vote]', (b) => {
      sfx.vote();
      this.onVote(b.dataset.vote === '' ? null : b.dataset.vote!);
    });
    onClick(this.el, '.journal-btn', () => this.toggleJournal());
    onClick(this.el, '.pause-btn', () => this.onPause());
    onClick(this.el, '.journal-close', () => this.toggleJournal(false));
  }

  toggleJournal(on = !this.journalOpen) {
    this.journalOpen = on;
    (this.el.querySelector('.journal') as HTMLElement).hidden = !on;
    sfx.click();
  }

  render(G: GameView, S: PrivateInfo | null, prompts: Prompt[]) {
    const now = net.serverNow();
    const alive = !!G.alive[net.me];
    if (this.wasAlive && !alive && G.phase !== 'fin') {
      // élimination du joueur : écran dédié quelques secondes
      sfx.death();
      this.el.querySelector('.death')!.classList.add('open');
      clearTimeout(this.deathTimer);
      this.deathTimer = window.setTimeout(() => this.el.querySelector('.death')!.classList.remove('open'), 5500);
    }
    this.wasAlive = alive;
    this.el.classList.toggle('dead', !alive);
    this.renderRole(G, S, now, alive);
    this.renderPrompts(prompts);
    if (this.journalOpen) this.renderJournal(G, S);
    this.renderMeeting(G, now, alive);
  }

  /**
   * Actions possibles : une ligne par touche, mise à jour sur place (texte, état) — aucune ligne n'est recréée
   * tant que l'action reste disponible, donc pas de clignotement quand le compte à rebours change.
   */
  private renderPrompts(prompts: Prompt[]) {
    const pr = this.el.querySelector('.prompts') as HTMLElement;
    const keep = new Set(prompts.map((p) => p.key));
    for (const el of [...pr.children] as HTMLElement[]) if (!keep.has(el.dataset.key!)) el.remove();
    prompts.forEach((p, i) => {
      let el = pr.querySelector<HTMLElement>(`[data-key="${p.key}"]`);
      if (!el) {
        el = h(`<div class="prompt" data-key="${p.key}"><kbd></kbd><span></span></div>`);
        el.querySelector('kbd')!.textContent = keyName(p.key);
      }
      if (pr.children[i] !== el) pr.insertBefore(el, pr.children[i] ?? null);
      const span = el.querySelector('span')!;
      if (span.textContent !== p.label) span.textContent = p.label;
      el.classList.toggle('waiting', !!p.waiting);
    });
  }

  private renderRole(G: GameView, S: PrivateInfo | null, now: number, alive: boolean) {
    const panel = this.el.querySelector('.role-panel') as HTMLElement;
    if (!S) {
      panel.innerHTML = `<div class="rp-wait">Rôle en cours de distribution…</div>`;
      return;
    }
    const info = ROLE_INFO[S.role];
    const lines: string[] = [];
    if (S.role === 'tueur') {
      const wait = Math.ceil((S.killReadyAt - now) / 1000);
      lines.push(wait > 0 ? `${ICON.sablier}<span>Couteau : prêt dans <b>${wait} s</b></span>` : `${ICON.dague}<span>Couteau <b>prêt</b> — <kbd>2</kbd> le sortir, clic pour frapper</span>`);
      lines.push(`${ICON.info}<span>${S.allies.length ? `Complices : ${S.allies.map((a) => esc(net.nameOf(a))).join(', ')}` : 'Vous êtes le seul tueur.'}</span>`);
    }
    if (S.role === 'sherif') lines.push(`${ICON.balle}<span>${S.ammo > 0 ? `Pistolet : <b>${S.ammo}</b> balle${S.ammo > 1 ? 's' : ''} — <kbd>2</kbd> le sortir, clic pour tirer` : 'Plus aucune balle'}</span>`);
    if (S.role === 'detective') lines.push(`${ICON.loupe}<span>${S.investigations > 0 ? `Enquête : <b>${S.investigations}</b> restante` : 'Enquête utilisée'}</span>`);
    lines.push(`${ICON.cloche}<span>${S.emergencyLeft > 0 ? 'Réunion d’urgence disponible' : 'Réunion d’urgence utilisée'}</span>`);
    panel.className = `role-panel role-${S.role}`;
    panel.innerHTML = `${portrait(G.appearances[net.me])}
      <div class="rp-body">
        <div class="rp-role">${ROLE_ICON[S.role]}<span>${info.nom}</span></div>
        <div class="rp-camp">${info.camp === 'tueurs' ? 'Camp des tueurs' : 'Camp des innocents'}${alive ? '' : ' · <b class="rp-dead">éliminé</b>'}</div>
        <p class="rp-desc">${esc(info.description)}</p>
        <ul class="rp-lines">${lines.map((l) => `<li>${l}</li>`).join('')}</ul>
      </div>`;
  }

  /** Carte du rôle (HTML), pour l'écran de pause. */
  roleCardHtml() {
    return (this.el.querySelector('.role-panel') as HTMLElement).outerHTML;
  }

  private renderJournal(G: GameView, S: PrivateInfo | null) {
    const j = this.el.querySelector('.journal') as HTMLElement;
    j.innerHTML = `<header><h2>${ICON.livre} Journal d’enquête</h2><button type="button" class="journal-close" aria-label="Fermer le journal">×</button></header>${journalHtml(G, S)}`;
  }

  private renderMeeting(G: GameView, now: number, alive: boolean) {
    const meet = this.el.querySelector('.meeting') as HTMLElement;
    const open = G.phase === 'reunion' && !!G.meeting;
    meet.classList.toggle('open', open);
    if (!open) {
      meet.dataset.key = '';
      return;
    }
    const m = G.meeting!;
    const total = RULES.meetingSeconds * 1000;
    const left = Math.max(0, m.endsAt - now);
    const voters = Object.keys(G.alive).filter((id) => G.alive[id]);
    const mine = m.voted.includes(net.me);
    const canVote = alive && !mine;
    const key = `${m.endsAt}|${m.voted.join(',')}|${canVote}`;
    // la grille n'est reconstruite qu'au changement (le focus clavier reste en place) ; le compte à rebours, à chaque image
    if (meet.dataset.key !== key) {
      meet.dataset.key = key;
      meet.innerHTML = `<div class="meet-box">
        <div class="meet-head">${ICON.cloche}<div><div class="mm-kicker">${m.reason === 'corps' ? 'Un corps a été découvert' : 'Réunion d’urgence'}</div>
          <h2>${m.reason === 'corps' ? `Le corps de ${esc(net.nameOf(m.body!))}` : `${esc(net.nameOf(m.by))} convoque le village`}</h2></div></div>
        <div class="meet-timer"><i></i><span class="meet-left"></span></div>
        <p class="meet-state">${alive ? (mine ? `${ICON.coche} Vote enregistré. En attente des autres…` : 'Qui ment ? Désignez un suspect, ou personne.') : 'Les joueurs éliminés ne votent pas.'} · <b>${m.voted.length} / ${voters.length}</b> votes</p>
        <div class="votes">${voters
          .map(
            (id) => `<button type="button" class="vote-card" data-vote="${id}" ${canVote && id !== net.me ? '' : 'disabled'}>
              ${portrait(G.appearances[id])}<span class="vc-name">${esc(net.nameOf(id))}${id === net.me ? ' (vous)' : ''}</span>
              <span class="vc-state">${m.voted.includes(id) ? `${ICON.coche} a voté` : `${ICON.sablier} réfléchit`}</span></button>`,
          )
          .join('')}</div>
        <button type="button" class="ghost skip" data-vote="" ${canVote ? '' : 'disabled'}>Ne désigner personne</button>
        <ul class="mlog">${G.log.slice(-3).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      </div>`;
    }
    (meet.querySelector('.meet-timer i') as HTMLElement).style.transform = `scaleX(${Math.min(1, left / total)})`;
    meet.querySelector('.meet-left')!.textContent = `${Math.ceil(left / 1000)} s`;
  }
}

/** Contenu du journal d'enquête : enquêtes du joueur, habitants vivants ou morts, événements publics. */
export function journalHtml(G: GameView, S: PrivateInfo | null) {
    const findings = S ? Object.entries(S.findings) : [];
    const people = Object.keys(G.appearances);
    return `<div class="j-cols">
        <section><h3>Vos enquêtes</h3>${
          findings.length
            ? `<ul>${findings.map(([id, k]) => `<li class="${k ? 'k-bad' : 'k-ok'}">${k ? ICON.dague : ICON.coche}<span><b>${esc(net.nameOf(id))}</b> ${k ? 'est un tueur.' : 'n’est pas un tueur.'}</span></li>`).join('')}</ul>`
            : `<p class="muted">${S?.role === 'detective' ? 'Approchez quelqu’un et appuyez sur R pour enquêter.' : 'Aucune enquête : seuls les détectives peuvent enquêter.'}</p>`
        }
        <h3>Habitants</h3><ul class="j-people">${people
          .map((id) => `<li class="${G.alive[id] ? '' : 'gone'}">${portrait(G.appearances[id])}<span>${esc(net.nameOf(id))}${id === net.me ? ' <em>(vous)</em>' : ''}</span><small>${G.alive[id] ? 'en vie' : `${ICON.crane} mort`}</small></li>`)
          .join('')}</ul></section>
        <section><h3>Événements publics</h3><ol class="j-log">${G.log.length ? G.log.map((x) => `<li>${esc(x)}</li>`).join('') : '<li class="muted">Rien à signaler pour le moment.</li>'}</ol></section>
      </div>`;
  }

/** Instantané des résultats : reste lisible même si un autre joueur ramène déjà la salle au salon. */
export interface ResultSnapshot {
  key: number;
  winner: 'tueurs' | 'innocents';
  reason: string;
  roles: Record<string, Role>;
  survivors: string[];
  names: Record<string, string>;
  appearances: Record<string, string>;
  log: string[];
  me: string;
}

export function snapshotResult(G: GameView): ResultSnapshot | null {
  if (!G.result) return null;
  const names: Record<string, string> = {};
  for (const id of Object.keys(G.result.roles)) names[id] = net.nameOf(id);
  return { key: G.startedAt, ...G.result, names, appearances: { ...G.appearances }, log: [...G.log], me: net.me };
}

export class ResultsScreen {
  readonly el = h(`<div class="results" role="dialog" aria-label="Fin de la partie"></div>`);
  onBack: () => void = () => {};
  onQuit: () => void = () => {};
  shown: number | null = null;

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

  show(r: ResultSnapshot) {
    this.shown = r.key;
    const myRole = r.roles[r.me];
    const won = myRole ? (campOf(myRole) === 'tueurs') === (r.winner === 'tueurs') : null;
    (won ? sfx.victory : sfx.defeat)();
    const ids = Object.keys(r.roles).sort((a, b) => Number(r.roles[a] !== 'tueur') - Number(r.roles[b] !== 'tueur'));
    this.el.className = `results open ${r.winner === 'tueurs' ? 'w-tueurs' : 'w-innocents'}`;
    this.el.innerHTML = `<div class="res-box">
      <div class="mm-kicker">${won === null ? 'Fin de la partie' : won ? 'Victoire' : 'Défaite'}</div>
      <h2>${r.winner === 'tueurs' ? `${ICON.dague} Les tueurs ont gagné` : `${ICON.maison} Les innocents ont gagné`}</h2>
      <p class="res-reason">${esc(r.reason)}</p>
      ${myRole ? `<p class="res-me">Vous étiez <b>${ROLE_INFO[myRole].nom.toLowerCase()}</b>, ${r.survivors.includes(r.me) ? 'et vous avez survécu.' : 'et vous avez été éliminé.'}</p>` : ''}
      <ul class="res-players">${ids
        .map(
          (id) => `<li class="role-${r.roles[id]}${r.survivors.includes(id) ? '' : ' gone'}">${portrait(r.appearances[id])}
          <span class="rp-n">${esc(r.names[id] ?? '?')}${id === r.me ? ' <em>(vous)</em>' : ''}</span>
          <span class="rp-r">${ROLE_ICON[r.roles[id]]}${ROLE_INFO[r.roles[id]].nom}</span>
          <span class="rp-s">${r.survivors.includes(id) ? `${ICON.coche} survivant` : `${ICON.crane} éliminé`}</span></li>`,
        )
        .join('')}</ul>
      <details><summary>Déroulé de la partie</summary><ol class="j-log">${r.log.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></details>
      <div class="res-actions"><button type="button" class="ghost quit">Quitter le salon</button><button type="button" class="primary back">Retour au salon</button></div>
    </div>`;
    requestAnimationFrame(() => (this.el.querySelector('.back') as HTMLElement)?.focus());
  }
}
