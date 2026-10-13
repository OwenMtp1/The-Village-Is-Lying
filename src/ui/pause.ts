/**
 * Menu de pause (Échap ou bouton ☰ pendant une partie) : reprendre, paramètres, rappel des commandes,
 * quitter la partie. En ligne, la partie continue pendant que ce menu est ouvert (les autres jouent).
 */
import { sfx } from '../audio/sfx';
import { arrowNav, h, onClick } from './dom';
import { settingsPanel } from './settingsPanel';

export class PauseMenu {
  readonly el: HTMLElement;
  onResume: () => void = () => {};
  onQuit: () => void = () => {};
  private online = false;

  constructor() {
    this.el = h(`<div class="pause" role="dialog" aria-label="Pause">
      <div class="pause-box">
        <div class="pause-main">
          <div class="mm-kicker pause-kicker"></div>
          <h2>Pause</h2>
          <nav class="mm-nav small">
            <button type="button" data-p="resume">Reprendre</button>
            <button type="button" data-p="settings">Paramètres</button>
            <button type="button" data-p="controls">Commandes</button>
            <button type="button" data-p="quit" class="danger">Quitter la partie</button>
          </nav>
          <div class="confirm" hidden>
            <p class="confirm-text"></p>
            <div class="res-actions"><button type="button" class="ghost" data-p="cancel">Annuler</button><button type="button" class="primary" data-p="confirm">Quitter</button></div>
          </div>
        </div>
        <div class="pause-side" data-side="settings" hidden></div>
        <div class="pause-side" data-side="controls" hidden>
          <h3>Commandes</h3>
          <dl class="keys">
            <dt><kbd>Z Q S D</kbd> / <kbd>W A S D</kbd> / flèches</dt><dd>se déplacer</dd>
            <dt><kbd>Maj</kbd></dt><dd>courir</dd>
            <dt><kbd>Espace</kbd></dt><dd>sauter</dd>
            <dt>Souris (clic dans la scène)</dt><dd>diriger la caméra · molette : distance</dd>
            <dt><kbd>V</kbd></dt><dd>vue subjective / derrière l’épaule</dd>
            <dt><kbd>L</kbd></dt><dd>allumer ou éteindre la lampe de poche</dd>
            <dt><kbd>E</kbd></dt><dd>tueur : éliminer la personne proche</dd>
            <dt><kbd>F</kbd></dt><dd>shérif : tirer sur la personne visée</dd>
            <dt><kbd>R</kbd></dt><dd>détective : enquêter sur la personne proche</dd>
            <dt><kbd>T</kbd></dt><dd>signaler un corps</dd>
            <dt><kbd>U</kbd></dt><dd>réunion d’urgence (une par joueur)</dd>
            <dt><kbd>J</kbd></dt><dd>journal d’enquête</dd>
            <dt><kbd>Échap</kbd></dt><dd>libérer la souris, puis ce menu</dd>
          </dl>
        </div>
      </div>
    </div>`);
    this.el.querySelector('[data-side="settings"]')!.appendChild(settingsPanel());
    arrowNav(this.el.querySelector('.mm-nav') as HTMLElement);
    onClick(this.el, '[data-p]', (b) => {
      const p = b.dataset.p;
      sfx.click();
      if (p === 'resume') this.onResume();
      if (p === 'settings' || p === 'controls') this.side(p);
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

  private side(which: string | null) {
    for (const s of this.el.querySelectorAll<HTMLElement>('.pause-side')) s.hidden = s.dataset.side !== which;
    for (const b of this.el.querySelectorAll<HTMLElement>('[data-p="settings"], [data-p="controls"]')) b.classList.toggle('on', b.dataset.p === which);
  }

  show(on: boolean, online = this.online) {
    this.online = online;
    this.el.classList.toggle('open', on);
    if (!on) return;
    this.side(null);
    (this.el.querySelector('.confirm') as HTMLElement).hidden = true;
    this.el.querySelector('.pause-kicker')!.textContent = online ? 'La partie continue pendant la pause' : 'Exploration solo';
    this.el.querySelector('.confirm-text')!.textContent = online
      ? 'Quitter la partie en cours ? Votre personnage restera immobile dans le village et vous ne pourrez plus y revenir.'
      : 'Revenir au menu principal ?';
    requestAnimationFrame(() => (this.el.querySelector('[data-p="resume"]') as HTMLElement).focus());
  }
}
