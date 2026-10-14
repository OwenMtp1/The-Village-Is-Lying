/**
 * Règles d'une manche, partagées : distribution des rôles, conditions de victoire, réglages des capacités.
 * Le serveur les applique (source de vérité) ; le navigateur s'en sert seulement pour l'affichage.
 */
import { ROLES, campOf, totalOf, type Composition, type Role } from './roles';

export const RULES = {
  /** portée d'une élimination, d'un tir, d'une enquête, d'un signalement de corps (m) */
  killRange: 2.2,
  shootRange: 25,
  /** angle maximal entre le regard et la victime (rad) : on poignarde devant soi, on tire où l'on vise */
  stabAngle: 1.0,
  aimAngle: 0.4,
  /** distance à laquelle on voit un coup de couteau, un tir (animation de l'arme chez les autres) */
  stabSeenRange: 30,
  shotSeenRange: 90,
  investigateRange: 3,
  reportRange: 3.5,
  /** délai de recharge propre à chaque tueur (s) ; le premier meurtre est possible après `firstKillDelay` */
  killCooldown: 25,
  firstKillDelay: 15,
  /** balles par shérif, enquêtes par détective (individuelles) */
  sheriffAmmo: 4,
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

// ───────────────────────── cycle du jour et de la nuit ─────────────────────────

/**
 * La partie commence à la tombée de la nuit : 5 minutes de nuit, puis 5 minutes de jour, et ainsi de suite
 * jusqu'à la victoire d'un camp (aucune limite de durée). L'aube et le crépuscule sont progressifs.
 */
export const DAY_CYCLE = { nightSeconds: 300, daySeconds: 300, twilightSeconds: 25 };

const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

/** Où en est la journée, `elapsed` secondes après le début de la partie. */
export function dayState(elapsed: number): { day: boolean; light: number; remaining: number; index: number } {
  const { nightSeconds: N, daySeconds: D, twilightSeconds: T } = DAY_CYCLE;
  const period = N + D;
  const e = Math.max(0, elapsed);
  const t = e % period;
  const index = Math.floor(e / period);
  if (t < N) {
    // nuit ; l'aube commence pendant ses dernières secondes
    const light = smooth((t - (N - T)) / T);
    return { day: false, light, remaining: N - t, index };
  }
  // jour ; le crépuscule commence pendant ses dernières secondes
  const light = 1 - smooth((t - N - (D - T)) / T);
  return { day: true, light, remaining: period - t, index };
}
