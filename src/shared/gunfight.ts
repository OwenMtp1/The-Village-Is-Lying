/**
 * Mode Gunfight : règles, réglages et messages, partagés par le serveur, le navigateur et le mode solo
 * (qui fait tourner la même salle en local contre des robots).
 *
 *  - « Chacun pour soi » : chaque élimination rapporte un point ; le premier au score visé gagne.
 *  - « Match à mort par équipe » : deux équipes (Rouge, Bleue) que les joueurs choisissent eux-mêmes au salon ;
 *    les éliminations s'additionnent pour l'équipe ; pas de tir allié.
 * Tout le monde apparaît armé (pistolet et couteau) ; après une mort, on réapparaît au bout de quelques secondes,
 * loin des adversaires. La partie s'arrête au score visé ou à la fin du temps.
 */
import type { Sex } from '../characters/catalog';
import { PATHS, PLAZA, inPolygon, isFree } from '../village/layout';

export type GFMode = 'ffa' | 'equipes';
export type Team = 'rouge' | 'bleu';

export interface GFSettings {
  mode: GFMode;
  /** places dans la salle */
  maxPlayers: number;
  /** éliminations pour gagner (joueur ou équipe) */
  scoreLimit: number;
  /** durée maximale (min) */
  minutes: number;
}

export const GF_RULES = {
  health: 100,
  /** pistolet : dégâts, cadence (s entre deux tirs), chargeur, rechargement (s), portée, tolérance de visée */
  pistolDamage: 34,
  fireDelay: 0.32,
  magazine: 8,
  reloadSeconds: 1.6,
  range: 45,
  aimAngle: 0.4,
  /** couteau : dégâts, portée, cadence */
  knifeDamage: 60,
  knifeRange: 2.3,
  knifeDelay: 0.6,
  knifeAngle: 1.0,
  respawnSeconds: 3,
  /** protection à la réapparition (s) : ni touché ni tireur */
  spawnShield: 1.5,
  maxSpeed: 9,
  limits: { players: [2, 16], score: [5, 100], minutes: [2, 30] } as const,
};

export const GF_DEFAULT: GFSettings = { mode: 'ffa', maxPlayers: 8, scoreLimit: 20, minutes: 8 };

export const GF_MODE_NAMES: Record<GFMode, string> = { ffa: 'Chacun pour soi', equipes: 'Match à mort par équipe' };
export const TEAM_NAMES: Record<Team, string> = { rouge: 'Équipe Rouge', bleu: 'Équipe Bleue' };

/** Réglages bornés (jamais refusés en silence : le salon affiche ce qui est appliqué). */
export function cleanSettings(s: Partial<GFSettings> | undefined): GFSettings {
  const L = GF_RULES.limits;
  const n = (v: unknown, [a, b]: readonly [number, number], d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(a, Math.min(b, Math.round(v))) : d);
  return {
    mode: s?.mode === 'equipes' ? 'equipes' : 'ffa',
    maxPlayers: n(s?.maxPlayers, L.players, GF_DEFAULT.maxPlayers),
    scoreLimit: n(s?.scoreLimit, L.score, GF_DEFAULT.scoreLimit),
    minutes: n(s?.minutes, L.minutes, GF_DEFAULT.minutes),
  };
}

/** Points d'apparition : le long des rues et sur la place, au cœur du village (pas dans les champs). */
export const SPAWNS: [number, number][] = (() => {
  const out: [number, number][] = [];
  for (const p of PATHS) {
    if (p.road.kind === 'path') continue;
    for (let s = 0; s < p.length; s += 14) {
      const k = Math.min(p.pts.length - 1, Math.floor((s / p.length) * (p.pts.length - 1)));
      const [x, z] = p.pts[k];
      if (Math.hypot(x - 5, z + 10) > 95) continue;
      if (out.some(([a, b]) => Math.hypot(a - x, b - z) < 9)) continue;
      out.push([x, z]);
    }
  }
  for (const [x, z] of [[-8, 6], [10, 6], [-10, -8], [12, -8]] as [number, number][]) if (inPolygon(x, z, PLAZA)) out.push([x, z]);
  void isFree;
  return out;
})();

// ───────────────────────── vues échangées ─────────────────────────

export interface GFLobbyPlayer {
  id: string;
  name: string;
  sex: Sex;
  team: Team | null;
  connected: boolean;
  host: boolean;
  bot: boolean;
}

export interface GFLobbyView {
  code: string;
  settings: GFSettings;
  players: GFLobbyPlayer[];
  phase: 'salon' | 'partie' | 'fin';
  /** ce qui empêche de lancer (null : prêt) */
  blocker: string | null;
}

export interface GFPlayerState {
  hp: number;
  alive: boolean;
  kills: number;
  deaths: number;
  ammo: number;
  /** fin du rechargement (horodatage serveur, 0 = pas de rechargement) */
  reloadUntil: number;
  /** réapparition prévue (horodatage serveur) */
  respawnAt: number;
  /** dernière apparition : position et numéro (le client se place quand le numéro change) */
  spawn: { x: number; z: number; yaw: number; n: number };
  /** invulnérable jusqu'à (horodatage serveur) */
  shieldUntil: number;
}

export interface GFKill {
  killer: string;
  victim: string;
  weapon: 'pistolet' | 'couteau';
  t: number;
}

export interface GFGameView {
  phase: 'jeu' | 'fin';
  settings: GFSettings;
  startedAt: number;
  endsAt: number;
  serverNow: number;
  appearances: Record<string, string>;
  teams: Record<string, Team | null>;
  players: Record<string, GFPlayerState>;
  teamScores: Record<Team, number>;
  feed: GFKill[];
  /** vainqueur : identifiant du joueur, équipe, ou null (égalité) */
  result: null | { winner: string | Team | null; reason: string };
}

/** Tir vu par tous (animation, son, traçante) : d'où, vers où, touché ou non. */
export interface GFShot {
  by: string;
  from: [number, number, number];
  to: [number, number, number];
  hit: string | null;
  weapon: 'pistolet' | 'couteau';
}

export type GFEvent = { text: string; kind: 'info' | 'mort' | 'fin'; to?: string };
