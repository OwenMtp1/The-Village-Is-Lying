/**
 * Attribution des apparences : le joueur choisit seulement son sexe, le jeu tire un personnage compatible
 * parmi les variantes réellement disponibles. Données pures, déterministes à graine égale :
 *  - un serveur (ou l'hôte) peut tirer les apparences de toute la partie et les diffuser ; chaque client
 *    affiche alors exactement les mêmes personnages, qui ne changent plus jusqu'à la fin de la partie ;
 *  - pas deux fois le même modèle dans une partie tant qu'il reste des variantes libres du bon sexe ;
 *    sinon un doublon est accepté plutôt que de bloquer la partie.
 */
import { VARIANTS, variantsOf, type Sex } from './catalog';

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
export function seededRandom(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tire une variante du sexe demandé, en évitant celles déjà prises (si possible). */
export function pickVariant(sex: Sex, random: () => number, taken: Iterable<string> = []): string {
  const pool = variantsOf(sex);
  if (pool.length === 0) throw new Error(`aucun personnage de sexe ${sex}`);
  const used = new Set(taken);
  const free = pool.filter((v) => !used.has(v.id));
  const list = free.length > 0 ? free : pool;
  return list[Math.floor(random() * list.length) % list.length].id;
}

export interface PlayerChoice {
  playerId: string;
  sex: Sex;
}

/**
 * Apparences de tous les joueurs d'une partie. Les joueurs déjà dotés (`keep`) conservent leur personnage :
 * un joueur qui rejoint en cours de partie ne fait changer l'apparence de personne.
 * L'ordre de traitement suit les identifiants (stable quel que soit l'ordre d'arrivée des messages).
 */
export function assignAppearances(players: PlayerChoice[], seed: number, keep: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  const taken: string[] = [];
  for (const [pid, vid] of Object.entries(keep)) {
    if (players.some((p) => p.playerId === pid) && VARIANTS.some((v) => v.id === vid)) {
      out[pid] = vid;
      taken.push(vid);
    }
  }
  const random = seededRandom(seed);
  for (const p of [...players].sort((a, b) => (a.playerId < b.playerId ? -1 : 1))) {
    if (out[p.playerId]) continue;
    const vid = pickVariant(p.sex, random, taken);
    out[p.playerId] = vid;
    taken.push(vid);
  }
  return out;
}

/** Graine de partie (nouvelle à chaque partie). */
export const newGameSeed = () => (crypto.getRandomValues(new Uint32Array(1))[0] >>> 0) || 1;
