/**
 * Icônes vectorielles (dessinées pour le jeu, couleur du texte) : chaque information de rôle ou d'état est
 * donnée par une forme ET un mot, jamais par la couleur seule.
 */
const svg = (body: string, vb = '0 0 24 24') => `<svg class="ic" viewBox="${vb}" aria-hidden="true" focusable="false">${body}</svg>`;

export const ICON = {
  dague: svg('<path d="M12 2l2 3v9h-4V5z" fill="currentColor"/><path d="M7 14h10v2H7z" fill="currentColor"/><path d="M11 16h2v4l-1 2-1-2z" fill="currentColor"/>'),
  etoile: svg('<path d="M12 2l2.6 6.3 6.8.5-5.2 4.4 1.6 6.6L12 16.3 6.2 19.8l1.6-6.6L2.6 8.8l6.8-.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="11.5" r="2" fill="currentColor"/>'),
  loupe: svg('<circle cx="10" cy="10" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M14.5 14.5L21 21" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>'),
  maison: svg('<path d="M3 11l9-7 9 7v10h-6v-6H9v6H3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>'),
  crane: svg('<path d="M12 3c-4.4 0-8 3.1-8 7.5 0 2.4 1.1 4 2.5 5V19h3v-2h1v2h3v-2h1v2h3v-3.5c1.4-1 2.5-2.6 2.5-5C20 6.1 16.4 3 12 3z" fill="currentColor"/><circle cx="8.8" cy="11" r="1.9" fill="#000"/><circle cx="15.2" cy="11" r="1.9" fill="#000"/>'),
  cloche: svg('<path d="M12 3a1.5 1.5 0 0 1 1.5 1.5v.6A6 6 0 0 1 18 11v4l2 2v1H4v-1l2-2v-4a6 6 0 0 1 4.5-5.9v-.6A1.5 1.5 0 0 1 12 3z" fill="currentColor"/><path d="M10 20a2 2 0 0 0 4 0z" fill="currentColor"/>'),
  info: svg('<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 10.5v6M12 7.2v.1" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'),
  couronne: svg('<path d="M3 18h18l-1.5-10-4.5 4-3-6-3 6-4.5-4z" fill="currentColor"/>'),
  coche: svg('<path d="M4 12.5l5 5L20 6.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>'),
  sablier: svg('<path d="M6 3h12M6 21h12M7 3c0 5 5 6 5 9s-5 4-5 9M17 3c0 5-5 6-5 9s5 4 5 9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'),
  livre: svg('<path d="M4 4h6a3 3 0 0 1 2 1 3 3 0 0 1 2-1h6v15h-6a2 2 0 0 0-2 1 2 2 0 0 0-2-1H4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 5v15" stroke="currentColor" stroke-width="1.5"/>'),
  balle: svg('<rect x="9" y="8" width="6" height="13" rx="1" fill="currentColor"/><path d="M9 8c0-3 1.5-5 3-6 1.5 1 3 3 3 6z" fill="currentColor"/>'),
  deconnecte: svg('<path d="M4 4l16 16M8.5 16.5a5 5 0 0 1 7-1M5 12.5a10 10 0 0 1 4-2.4M15 10.1a10 10 0 0 1 4 2.4M12 20h.01" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
  menu: svg('<path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
};

export const ROLE_ICON = { tueur: ICON.dague, sherif: ICON.etoile, detective: ICON.loupe, villageois: ICON.maison } as const;
