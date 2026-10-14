/**
 * Écran de pause, à la manière des grands jeux en monde ouvert (Échap ou ☰) : onglets Carte, Paramètres,
 * Commandes. L'onglet Carte montre le plan du village d'un côté et, de l'autre, votre rôle et votre journal
 * (partie en ligne) ou votre personnage (exploration solo, où un clic sur la carte vous y téléporte).
 * En ligne, la partie continue pendant que cet écran est ouvert.
 */
import { sfx } from '../audio/sfx';
import { h, onClick } from './dom';
import { settingsPanel } from './settingsPanel';
import { VillageMap, type MapPick } from './villageMap';

export type PauseTab = 'carte' | 'parametres' | 'commandes';

export class PauseMenu {
  readonly el: HTMLElement;
  readonly map = new VillageMap();
  onResume: () => void = () => {};
  onQuit: () => void = () => {};
  onTeleport: (p: MapPick) => void = () => {};
  private online = false;
  private tab: PauseTab = 'carte';

  constructor() {
    this.el = h(`<div class="pause" role="dialog" aria-label="Pause">
      <header class="pause-head">
        <div class="pause-title"><div class="mm-kicker pause-kicker"></div><h2>Pause</h2></div>
        <nav class="pause-tabs" role="tablist">
          <button type="button" role="tab" data-tab="carte">Carte</button>
          <button type="button" role="tab" data-tab="parametres">Paramètres</button>
          <button type="button" role="tab" data-tab="commandes">Commandes</button>
        </nav>
        <div class="pause-keys"><kbd>Échap</kbd> / <kbd>M</kbd> reprendre</div>
      </header>
      <section class="pause-page" data-page="carte">
        <div class="pause-map"></div>
        <aside class="pause-side">
          <div class="pause-card"></div>
          <div class="pause-actions">
            <button type="button" class="primary" data-p="resume">Reprendre</button>
            <button type="button" class="ghost" data-p="quit">Quitter la partie</button>
            <div class="confirm" hidden>
              <p class="confirm-text"></p>
              <div class="res-actions"><button type="button" class="ghost" data-p="cancel">Annuler</button><button type="button" class="primary" data-p="confirm">Quitter</button></div>
            </div>
          </div>
        </aside>
      </section>
      <section class="pause-page" data-page="parametres" hidden><div class="pause-scroll"></div></section>
      <section class="pause-page" data-page="commandes" hidden><div class="pause-scroll">
      </div></section>
    </div>`);
    this.el.querySelector('[data-page="commandes"] .pause-scroll')!.innerHTML = `<h3>Commandes</h3><dl class="keys">
            <dt><kbd>Z Q S D</kbd> / <kbd>W A S D</kbd> / flèches</dt><dd>se déplacer</dd>
            <dt><kbd>Maj</kbd></dt><dd>courir</dd>
            <dt><kbd>Espace</kbd></dt><dd>sauter</dd>
            <dt>Souris (clic dans la scène)</dt><dd>diriger la caméra · molette : distance</dd>
            <dt><kbd>V</kbd></dt><dd>vue subjective / derrière l’épaule</dd>
            <dt><kbd>1</kbd> / <kbd>L</kbd></dt><dd>lampe de poche</dd>
            <dt><kbd>2</kbd></dt><dd>sortir / ranger son arme (couteau du tueur, pistolet du shérif)</dd>
            <dt>Clic gauche</dt><dd>arme en main : frapper au couteau, ou tirer là où vise le viseur</dd>
            <dt><kbd>R</kbd></dt><dd>détective : enquêter sur la personne proche</dd>
            <dt><kbd>T</kbd></dt><dd>signaler un corps</dd>
            <dt><kbd>U</kbd></dt><dd>réunion d’urgence (une par joueur)</dd>
            <dt><kbd>J</kbd></dt><dd>journal d’enquête</dd>
            <dt><kbd>M</kbd> / <kbd>Échap</kbd></dt><dd>carte du village (et pause)</dd>
            <dt><kbd>N</kbd></dt><dd>exploration solo : vol libre à travers les murs</dd>
            <dt><kbd>Échap</kbd></dt><dd>libérer la souris, puis ce menu</dd>
          </dl>`;
    this.el.querySelector('[data-page="parametres"] .pause-scroll')!.appendChild(settingsPanel());
    this.el.querySelector('.pause-map')!.appendChild(this.map.el);
    this.map.onPick = (p) => this.onTeleport(p);
    onClick(this.el, '[data-tab]', (b) => {
      sfx.click();
      this.setTab(b.dataset.tab as PauseTab);
    });
    onClick(this.el, '[data-p]', (b) => {
      const p = b.dataset.p;
      sfx.click();
      if (p === 'resume') this.onResume();
      if (p === 'quit') {
        (this.el.querySelector('.confirm') as HTMLElement).hidden = false;
        (this.el.querySelector('[data-p="confirm"]') as HTMLElement).focus();
      }
      if (p === 'cancel') (this.el.querySelector('.confirm') as HTMLElement).hidden = true;
      if (p === 'confirm') this.onQuit();
    });
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.onResume();
        e.stopPropagation();
      }
    });
  }

  get open() {
    return this.el.classList.contains('open');
  }

  setTab(tab: PauseTab) {
    this.tab = tab;
    for (const b of this.el.querySelectorAll<HTMLElement>('[data-tab]')) {
      b.classList.toggle('on', b.dataset.tab === tab);
      b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    }
    for (const p of this.el.querySelectorAll<HTMLElement>('.pause-page')) p.hidden = p.dataset.page !== tab;
  }

  /** Panneau de droite : carte du rôle et journal (en ligne) ou fiche du personnage (solo). */
  setSide(html: string) {
    const card = this.el.querySelector('.pause-card') as HTMLElement;
    if (card.dataset.html !== html) {
      card.dataset.html = html;
      card.innerHTML = html;
    }
  }

  show(on: boolean, online = this.online, ctx: { player?: { x: number; z: number; yaw: number } | null; teleport?: boolean; inspection?: boolean } = {}) {
    this.online = online;
    this.el.classList.toggle('open', on);
    if (!on) return;
    this.setTab(this.tab);
    (this.el.querySelector('.confirm') as HTMLElement).hidden = true;
    this.el.querySelector('.pause-kicker')!.textContent = online ? 'La partie continue pendant la pause' : ctx.inspection ? 'Exploration libre de la carte' : 'Exploration solo';
    this.el.querySelector('[data-p="quit"]')!.textContent = online ? 'Quitter la partie' : 'Menu principal';
    this.el.querySelector('.pause-title h2')!.textContent = ctx.inspection ? 'Carte' : 'Pause';
    this.el.querySelector('.confirm-text')!.textContent = online
      ? 'Quitter la partie en cours ? Votre personnage restera immobile dans le village et vous ne pourrez plus y revenir.'
      : 'Revenir au menu principal ?';
    this.map.open({ teleport: !!ctx.teleport, player: ctx.player ?? null });
    requestAnimationFrame(() => (this.el.querySelector('[data-p="resume"]') as HTMLElement).focus());
  }
}
