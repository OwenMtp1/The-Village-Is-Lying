/** Notifications (salon et partie) : une icône et un texte par message, annoncés aux lecteurs d'écran. */
import { esc, h } from './dom';
import { ICON } from './icons';

export type ToastKind = 'info' | 'ok' | 'bad' | 'mort' | 'reunion' | 'indice' | 'tir';

const KIND_ICON: Record<ToastKind, string> = {
  info: ICON.info,
  ok: ICON.coche,
  bad: ICON.info,
  mort: ICON.crane,
  reunion: ICON.cloche,
  indice: ICON.loupe,
  tir: ICON.balle,
};

export class Toasts {
  readonly el = h(`<div class="toasts" role="log" aria-live="polite" aria-label="Notifications"></div>`);

  constructor() {
    document.body.appendChild(this.el);
  }

  push(text: string, kind: ToastKind = 'info', seconds = 6) {
    const t = h(`<div class="toast k-${kind}">${KIND_ICON[kind]}<span>${esc(text)}</span></div>`);
    this.el.appendChild(t);
    // au plus 5 messages à l'écran
    while (this.el.children.length > 5) this.el.firstElementChild!.remove();
    setTimeout(() => {
      t.classList.add('out');
      setTimeout(() => t.remove(), 400);
    }, seconds * 1000);
  }
}
