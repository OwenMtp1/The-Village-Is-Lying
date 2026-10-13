/**
 * Règles d'une manche, partagées : distribution des rôles, conditions de victoire, réglages des capacités.
 * Le serveur les applique (source de vérité) ; le navigateur s'en sert seulement pour l'affichage.
 */
import { ROLES, campOf, totalOf, type Composition, type Role } from './roles';

export const RULES = {
  /** portée d'une élimination, d'un tir, d'une enquête, d'un signalement de corps (m) */
  killRange: 2.2,
  shootRange: 14,
  investigateRange: 3,
  reportRange: 3.5,
  /** délai de recharge propre à chaque tueur (s) ; le premier meurtre est possible après `firstKillDelay` */
  killCooldown: 25,
  firstKillDelay: 15,
  /** balles par shérif, enquêtes par détective (individuelles) */
  sheriffAmmo: 1,
  detectiveUses: 1,
  /** un shérif qui abat un innocent est éliminé à son tour */
  sheriffDiesOnMistake: true,
  /** réunions : durée du vote (s), réunions d'urgence par joueur */
  meetingSeconds: 60,
  emergencyMeetings: 1,
  /** vitesse maximale admise entre deux positions envoyées (m/s, avec marge) */
  maxSpeed: 9,
};

/** Mélange de Fisher-Yates avec un générateur fourni (crypto côté serveur). */
export function shuffle<T>(list: T[], random: () => number): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Distribue exactement les quantités de la composition entre les joueurs (mélangés au préalable). */
export function assignRoles(playerIds: string[], comp: Composition, random: () => number): Record<string, Role> {
  if (playerIds.length !== totalOf(comp)) throw new Error(`composition de ${totalOf(comp)} joueurs pour ${playerIds.length} joueurs`);
  const deck: Role[] = ROLES.flatMap((r) => Array.from({ length: comp[r] }, () => r));
  const order = shuffle(playerIds, random);
  const out: Record<string, Role> = {};
  order.forEach((id, i) => (out[id] = deck[i]));
  return out;
}

export type Winner = 'tueurs' | 'innocents';

/**
 * Victoire, sur les seuls joueurs vivants : les innocents gagnent quand tous les tueurs sont éliminés ; les
 * tueurs gagnent quand ils sont au moins aussi nombreux que les innocents vivants. Sinon la partie continue.
 */
export function winnerOf(alive: Role[]): Winner | null {
  const tueurs = alive.filter((r) => campOf(r) === 'tueurs').length;
  const innocents = alive.length - tueurs;
  if (tueurs === 0) return 'innocents';
  if (tueurs >= innocents) return 'tueurs';
  return null;
}
