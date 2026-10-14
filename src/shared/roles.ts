/**
 * Rôles et composition d'une partie — règles partagées par le serveur (qui fait foi) et le navigateur
 * (qui affiche les mêmes messages, immédiatement). Aucune donnée secrète ici.
 */

export type Role = 'tueur' | 'sherif' | 'detective' | 'villageois';
export type Camp = 'tueurs' | 'innocents';

export const ROLES: Role[] = ['tueur', 'sherif', 'detective', 'villageois'];

export const ROLE_INFO: Record<Role, { nom: string; pluriel: string; camp: Camp; description: string }> = {
  tueur: { nom: 'Tueur', pluriel: 'Tueurs', camp: 'tueurs', description: 'Élimine les villageois au couteau sans te faire démasquer : une lame sortie se voit. Tu connais les autres tueurs.' },
  sherif: { nom: 'Shérif', pluriel: 'Shérifs', camp: 'innocents', description: 'Tu as un pistolet et 4 balles. Abats les tueurs… mais si tu tues un innocent, tu le paies de ta vie.' },
  detective: { nom: 'Détective', pluriel: 'Détectives', camp: 'innocents', description: 'Une fois par partie, enquête sur un villageois proche pour savoir s’il est un tueur.' },
  villageois: { nom: 'Villageois', pluriel: 'Villageois', camp: 'innocents', description: 'Aucun pouvoir : observe, discute et vote pour démasquer les tueurs.' },
};

export const campOf = (r: Role): Camp => ROLE_INFO[r].camp;

/** Nombre de joueurs par rôle. */
export type Composition = Record<Role, number>;

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 10;

export const totalOf = (c: Composition) => ROLES.reduce((s, r) => s + c[r], 0);

export interface Preset {
  id: string;
  nom: string;
  composition: Composition;
}

export const PRESETS: Preset[] = [
  { id: 'classique-6', nom: 'Partie classique — 6 joueurs', composition: { tueur: 1, sherif: 1, detective: 1, villageois: 3 } },
  { id: 'classique-8', nom: 'Partie classique — 8 joueurs', composition: { tueur: 1, sherif: 1, detective: 1, villageois: 5 } },
  { id: 'tueurs-8', nom: 'Partie à plusieurs tueurs — 8 joueurs', composition: { tueur: 2, sherif: 1, detective: 1, villageois: 4 } },
  { id: 'paranoia-10', nom: 'Partie paranoïa — 10 joueurs', composition: { tueur: 2, sherif: 2, detective: 1, villageois: 5 } },
];

export const DEFAULT_COMPOSITION: Composition = { ...PRESETS[0].composition };

/** Préréglage correspondant exactement à une composition (ou null : composition personnalisée). */
export const presetOf = (c: Composition) => PRESETS.find((p) => ROLES.every((r) => p.composition[r] === c[r])) ?? null;

/**
 * Problèmes d'une composition, en clair (liste vide = valide). Rien n'est corrigé : le créateur voit
 * pourquoi sa composition est refusée. Valeurs entières, au moins un tueur, au moins un innocent,
 * entre 4 et 10 joueurs.
 */
export function compositionErrors(c: unknown): string[] {
  const errors: string[] = [];
  if (!c || typeof c !== 'object') return ['Composition manquante.'];
  const comp = c as Record<string, unknown>;
  for (const r of ROLES) {
    const v = comp[r];
    if (typeof v !== 'number' || !Number.isInteger(v)) errors.push(`Nombre de ${ROLE_INFO[r].pluriel.toLowerCase()} manquant ou invalide.`);
    else if (v < 0) errors.push(`Le nombre de ${ROLE_INFO[r].pluriel.toLowerCase()} ne peut pas être négatif.`);
    else if (v > MAX_PLAYERS) errors.push(`Trop de ${ROLE_INFO[r].pluriel.toLowerCase()} (${MAX_PLAYERS} au maximum).`);
  }
  if (Object.keys(comp).some((k) => !(ROLES as string[]).includes(k))) errors.push('Rôle inconnu dans la composition.');
  if (errors.length) return errors;
  const k = comp as Composition;
  const total = totalOf(k);
  const innocents = total - k.tueur;
  if (k.tueur < 1) errors.push('Il faut au moins un tueur.');
  if (innocents < 1) errors.push('Il faut au moins un innocent (shérif, détective ou villageois) : tous les joueurs ne peuvent pas être tueurs.');
  if (total < MIN_PLAYERS) errors.push(`La partie compte ${total} joueur${total > 1 ? 's' : ''} : il en faut au moins ${MIN_PLAYERS}.`);
  if (total > MAX_PLAYERS) errors.push(`La partie compte ${total} joueurs : ${MAX_PLAYERS} au maximum.`);
  if (k.tueur >= 1 && innocents >= 1 && k.tueur >= innocents) errors.push(`Avec ${k.tueur} tueur${k.tueur > 1 ? 's' : ''} pour ${innocents} innocent${innocents > 1 ? 's' : ''}, les tueurs gagneraient dès le début : il faut plus d’innocents que de tueurs.`);
  return errors;
}

export const isValidComposition = (c: unknown): c is Composition => compositionErrors(c).length === 0;

/**
 * Conditions de départ d'un salon : composition valide et nombre exact de joueurs connectés.
 * Renvoie la raison du blocage, ou null si la partie peut commencer.
 */
export function startBlocker(c: Composition, connected: number): string | null {
  const errs = compositionErrors(c);
  if (errs.length) return errs[0];
  const total = totalOf(c);
  if (connected < total) {
    const n = total - connected;
    return `Il manque ${n} joueur${n > 1 ? 's' : ''} pour commencer.`;
  }
  if (connected > total) {
    const n = connected - total;
    return `${n} joueur${n > 1 ? 's' : ''} de trop : la composition prévoit ${total} places.`;
  }
  return null;
}
