/** Petits outils DOM partagés par les écrans (aucune bibliothèque d'interface). */
export const h = <T extends HTMLElement = HTMLElement>(html: string) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as T;
};

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Délégation de clic : appelle `fn` avec le bouton le plus proche portant `selector`. */
export function onClick(root: HTMLElement, selector: string, fn: (el: HTMLElement, e: MouseEvent) => void) {
  root.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest(selector) as HTMLElement | null;
    if (el && root.contains(el) && !(el as HTMLButtonElement).disabled) fn(el, e);
  });
}

/**
 * Navigation au clavier dans une liste de boutons verticale : flèches haut / bas, début / fin.
 * Entrée et Espace activent déjà un bouton nativement.
 */
export function arrowNav(root: HTMLElement, selector = 'button:not([disabled])') {
  root.addEventListener('keydown', (e) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const items = [...root.querySelectorAll<HTMLElement>(selector)].filter((b) => b.offsetParent !== null);
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next].focus();
    e.preventDefault();
    e.stopPropagation();
  });
}
