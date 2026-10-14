/**
 * Mode Gunfight : règles, réglages et messages, partagés par le serveur, le navigateur et le mode solo
 * (qui fait tourner la même salle en local contre des robots).
 *
 *  - « Chacun pour soi » : chaque élimination rapporte un point ; le premier au score visé gagne.
 *  - « Match à mort par équipe » : deux équipes (Rouge, Bleue) que les joueurs choisissent eux-mêmes au salon ;
 *    les éliminations s'additionnent pour l'équipe ; pas de tir allié.
 * Tout le monde apparaît avec cinq armes (pistolet, carabine, fusil à pompe, fusil de précision, couteau), chacune
 * avec son chargeur ; une balle dans la tête fait bien plus mal (le fusil de précision tue net). Après une mort, on
 * réapparaît au bout de quelques secondes, loin des adversaires. La partie s'arrête au score visé ou à la fin du temps.
 */
import type { Sex } from '../characters/catalog';
import { GF_MAP_IDS, type GFMapId } from './gunfightMaps';

export type GFMode = 'ffa' | 'equipes';
export type Team = 'rouge' | 'bleu';

export type GFArsenal = 'libre' | 'progression';

export interface GFSettings {
  mode: GFMode;
  /** armes : au choix parmi `weapons` (libre), ou imposées par le nombre d'éliminations (progression) */
  arsenal: GFArsenal;
  weapons: GFWeapon[];
  /** grenades et équipement tactique */
  grenades: boolean;
  /** partie de nuit : lampes et lasers montés sur les armes */
  night: boolean;
  /** carte (partie du village) */
  map: GFMapId;
  /** places dans la salle */
  maxPlayers: number;
  /** éliminations pour gagner (joueur ou équipe) */
  scoreLimit: number;
  /** durée maximale (min) */
  minutes: number;
}

/** armes à feu : secondaires (pistolet, revolver, pistolet-mitrailleur) et principales */
export type GFGun = 'pistolet' | 'revolver' | 'pm' | 'mitraillette' | 'fusil' | 'assaut' | 'tactique' | 'mitrailleuse' | 'pompe' | 'precision';
export type GFWeapon = GFGun | 'couteau';
export const SECONDARIES: GFGun[] = ['pistolet', 'revolver', 'pm'];
export const PRIMARIES: GFGun[] = ['mitraillette', 'fusil', 'assaut', 'tactique', 'mitrailleuse', 'pompe', 'precision'];
export const GUNS: GFGun[] = [...SECONDARIES, ...PRIMARIES];
/** toutes les armes, dans l'ordre des listes (réglages, inventaire) */
export const SLOTS: GFWeapon[] = [...PRIMARIES, ...SECONDARIES, 'couteau'];
export const isPrimary = (w: unknown): w is GFGun => PRIMARIES.includes(w as GFGun);
export const isSecondary = (w: unknown): w is GFGun => SECONDARIES.includes(w as GFGun);

/** Équipement choisi par le joueur (« classe ») : une arme principale, une secondaire, le couteau en plus. */
export interface GFLoadout {
  primary: GFGun | null;
  secondary: GFGun | null;
}

/** Équipement tactique : grenade à fragmentation (G), grenade aveuglante (F), fumigène (C). */
export type GFGrenade = 'frag' | 'flash' | 'fumee';
export const GRENADES = {
  frag: { name: 'Grenade', key: 'G', count: 2, fuse: 2.2, radius: 7, damage: 150 },
  flash: { name: 'Aveuglante', key: 'F', count: 1, fuse: 1.6, radius: 26, blind: 4 },
  fumee: { name: 'Fumigène', key: 'C', count: 1, fuse: 1.4, radius: 5.5, seconds: 15 },
  /** vitesse de lancer maximale (m/s), gravité, rebonds */
  maxSpeed: 22,
  gravity: 9.8,
  bounce: 0.35,
} as const;
export const GRENADE_KINDS: GFGrenade[] = ['frag', 'flash', 'fumee'];

export interface GunSpec {
  name: string;
  /** dégâts d'une balle (ou d'un plomb) au corps, à courte distance ; à la tête : × head */
  damage: number;
  head: number;
  /** perte de dégâts avec la distance : pleins jusqu'à `falloff[0]` m, réduits à `falloff[2]` × à `falloff[1]` m et au-delà */
  falloff: [number, number, number];
  /** secondes entre deux tirs ; tir continu tant que le bouton est maintenu */
  fireDelay: number;
  auto: boolean;
  magazine: number;
  reload: number;
  /** portée maximale (m) : au-delà, la balle ne touche plus */
  range: number;
  /** plombs par cartouche */
  pellets: number;
  /** dispersion (rad) : à la hanche, en visée (clic droit) */
  spread: number;
  adsSpread: number;
  /** champ de vision en visée (fraction du champ normal) */
  zoom: number;
  /** relèvement du canon à chaque tir (rad) ; une partie revient d'elle-même */
  recoil: number;
}

/**
 * Équilibre : le pistolet tue en 4 balles au corps (2 à la tête de près) ; la carabine en 5 (3 têtes), mais perd
 * de sa force au loin ; le fusil à pompe tue d'une cartouche à bout portant et ne vaut plus rien à 20 m ; le fusil
 * de précision tue d'une balle (tête ou corps) à toute distance, mais il est lent, n'a que 5 balles et ne touche
 * rien sans la lunette.
 */
export const WEAPONS: Record<GFGun, GunSpec> = {
  revolver: { name: 'Revolver', damage: 55, head: 2, falloff: [20, 50, 0.7], fireDelay: 0.5, auto: false, magazine: 6, reload: 2.2, range: 70, pellets: 1, spread: 0.02, adsSpread: 0.003, zoom: 0.75, recoil: 0.09 },
  pm: { name: 'Pistolet-mitrailleur', damage: 16, head: 1.5, falloff: [10, 30, 0.55], fireDelay: 0.06, auto: true, magazine: 20, reload: 1.6, range: 40, pellets: 1, spread: 0.06, adsSpread: 0.02, zoom: 0.85, recoil: 0.012 },
  mitraillette: { name: 'Mitraillette', damage: 21, head: 1.6, falloff: [14, 40, 0.6], fireDelay: 0.075, auto: true, magazine: 32, reload: 2.0, range: 60, pellets: 1, spread: 0.04, adsSpread: 0.012, zoom: 0.75, recoil: 0.012 },
  assaut: { name: "Fusil d'assaut", damage: 30, head: 1.8, falloff: [35, 90, 0.7], fireDelay: 0.12, auto: true, magazine: 30, reload: 2.5, range: 120, pellets: 1, spread: 0.05, adsSpread: 0.008, zoom: 0.65, recoil: 0.024 },
  tactique: { name: 'Fusil tactique', damage: 48, head: 2, falloff: [60, 150, 0.8], fireDelay: 0.3, auto: false, magazine: 15, reload: 2.6, range: 200, pellets: 1, spread: 0.05, adsSpread: 0.002, zoom: 0.42, recoil: 0.045 },
  mitrailleuse: { name: 'Mitrailleuse', damage: 27, head: 1.6, falloff: [40, 100, 0.7], fireDelay: 0.09, auto: true, magazine: 100, reload: 5, range: 120, pellets: 1, spread: 0.07, adsSpread: 0.015, zoom: 0.7, recoil: 0.018 },
  pistolet: { name: 'Pistolet', damage: 28, head: 2, falloff: [18, 45, 0.6], fireDelay: 0.24, auto: false, magazine: 12, reload: 1.5, range: 60, pellets: 1, spread: 0.02, adsSpread: 0.004, zoom: 0.8, recoil: 0.03 },
  fusil: { name: 'Carabine', damage: 24, head: 1.75, falloff: [30, 80, 0.65], fireDelay: 0.1, auto: true, magazine: 30, reload: 2.3, range: 110, pellets: 1, spread: 0.045, adsSpread: 0.007, zoom: 0.65, recoil: 0.016 },
  pompe: { name: 'Fusil à pompe', damage: 13, head: 1.5, falloff: [7, 22, 0.25], fireDelay: 0.95, auto: false, magazine: 6, reload: 3.0, range: 30, pellets: 9, spread: 0.08, adsSpread: 0.065, zoom: 0.88, recoil: 0.085 },
  precision: { name: 'Fusil de précision', damage: 110, head: 2.5, falloff: [999, 999, 1], fireDelay: 1.45, auto: false, magazine: 5, reload: 3.2, range: 450, pellets: 1, spread: 0.11, adsSpread: 0, zoom: 0.22, recoil: 0.11 },
};

/** Dégâts d'une balle de cette arme à la distance d (m), au corps ou à la tête. */
export function damageAt(w: GunSpec, d: number, head: boolean): number {
  const [a, b, min] = w.falloff;
  const k = d <= a ? 1 : d >= b ? min : 1 - ((d - a) / (b - a)) * (1 - min);
  return w.damage * k * (head ? w.head : 1);
}

export const WEAPON_NAMES: Record<GFWeapon | 'grenade', string> = { ...Object.fromEntries(GUNS.map((g) => [g, WEAPONS[g].name])), couteau: 'Couteau', grenade: 'Grenade' } as Record<GFWeapon | 'grenade', string>;

export const isGun = (w: unknown): w is GFGun => typeof w === 'string' && (GUNS as string[]).includes(w);

export const GF_RULES = {
  health: 100,
  /** l'origine du rayon de visée (la caméra) doit être à moins de tant du tireur */
  aimOrigin: 7.5,
  /** le rayon doit partir dans la direction du corps (rad, tolérance des rotations rapides) */
  aimAngle: 0.9,
  /** compensation de la latence : on teste aussi les positions des cibles sur ce passé (ms) */
  lagMs: 350,
  /** couteau : dégâts, portée, cadence */
  knifeDamage: 60,
  knifeRange: 2.3,
  knifeDelay: 0.6,
  knifeAngle: 1.0,
  respawnSeconds: 3,
  /** protection à la réapparition (s) : ni touché ni tireur */
  spawnShield: 2,
  maxSpeed: 9,
  limits: { players: [2, 16], score: [5, 100], minutes: [2, 30] } as const,
};

export const GF_DEFAULT: GFSettings = { mode: 'ffa', night: false, arsenal: 'libre', grenades: true, weapons: ['mitraillette', 'fusil', 'assaut', 'tactique', 'mitrailleuse', 'pompe', 'precision', 'pistolet', 'revolver', 'pm', 'couteau'], map: 'village', maxPlayers: 8, scoreLimit: 20, minutes: 8 };

export const GF_MODE_NAMES: Record<GFMode, string> = { ffa: 'Chacun pour soi', equipes: 'Match à mort par équipe' };
export const TEAM_NAMES: Record<Team, string> = { rouge: 'Équipe Rouge', bleu: 'Équipe Bleue' };

/** Réglages bornés (jamais refusés en silence : le salon affiche ce qui est appliqué). */
export function cleanSettings(s: Partial<GFSettings> | undefined): GFSettings {
  const L = GF_RULES.limits;
  const n = (v: unknown, [a, b]: readonly [number, number], d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(a, Math.min(b, Math.round(v))) : d);
  return {
    mode: s?.mode === 'equipes' ? 'equipes' : 'ffa',
    arsenal: s?.arsenal === 'progression' ? 'progression' : 'libre',
    night: s?.night === true,
    grenades: s?.grenades !== false,
    weapons: (() => {
      const w = SLOTS.filter((x) => Array.isArray(s?.weapons) && s!.weapons.includes(x));
      return w.length ? w : [...SLOTS];
    })(),
    map: GF_MAP_IDS.includes(s?.map as GFMapId) ? (s!.map as GFMapId) : GF_DEFAULT.map,
    maxPlayers: n(s?.maxPlayers, L.players, GF_DEFAULT.maxPlayers),
    scoreLimit: n(s?.scoreLimit, L.score, GF_DEFAULT.scoreLimit),
    minutes: n(s?.minutes, L.minutes, GF_DEFAULT.minutes),
  };
}

export const ARSENAL_NAMES: Record<GFArsenal, string> = { libre: 'Armes au choix', progression: 'Progression' };

/** Progression (« gun game ») : on commence au couteau et chaque palier d'éliminations donne l'arme suivante. */
export const PROGRESSION: GFWeapon[] = ['couteau', 'pistolet', 'revolver', 'pm', 'pompe', 'mitraillette', 'fusil', 'assaut', 'tactique', 'mitrailleuse', 'precision'];
/** éliminations par palier : l'arme finale arrive au dernier palier avant le score visé */
export const progressionStep = (s: GFSettings) => Math.max(1, Math.floor(s.scoreLimit / PROGRESSION.length));
export const progressionTier = (s: GFSettings, kills: number) => Math.min(PROGRESSION.length - 1, Math.floor(kills / progressionStep(s)));

/** Équipement par défaut : les premières armes permises de chaque catégorie (carabine et pistolet si possible). */
export function defaultLoadout(s: GFSettings): GFLoadout {
  const pick = (list: GFGun[], pref: GFGun) => (s.weapons.includes(pref) ? pref : (list.find((w) => s.weapons.includes(w)) ?? null));
  return { primary: pick(PRIMARIES, 'fusil'), secondary: pick(SECONDARIES, 'pistolet') };
}

/** Équipement valable pour ces réglages (une arme interdite ou mal rangée est remplacée par celle par défaut). */
export function cleanLoadout(s: GFSettings, l: Partial<GFLoadout> | undefined): GFLoadout {
  const d = defaultLoadout(s);
  return {
    primary: isPrimary(l?.primary) && s.weapons.includes(l.primary) ? l.primary : d.primary,
    secondary: isSecondary(l?.secondary) && s.weapons.includes(l.secondary) ? l.secondary : d.secondary,
  };
}

/** Armes permises à un joueur (dans l'ordre des touches 1, 2, 3) ; la première est celle qu'il sort à l'apparition. */
export function allowedWeapons(s: GFSettings, kills: number, loadout: GFLoadout = defaultLoadout(s)): GFWeapon[] {
  if (s.arsenal === 'progression') {
    const w = PROGRESSION[progressionTier(s, kills)];
    return w === 'couteau' ? ['couteau'] : [w, 'couteau'];
  }
  const l = cleanLoadout(s, loadout);
  const out: GFWeapon[] = [l.primary, l.secondary].filter((w): w is GFGun => !!w);
  if (s.weapons.includes('couteau') || !out.length) out.push('couteau');
  return out;
}

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
  /** munitions dans le chargeur de chaque arme */
  ammo: Record<GFGun, number>;
  /** fin du rechargement (horodatage serveur, 0 = pas de rechargement) et arme rechargée */
  reloadUntil: number;
  reloading: GFGun | null;
  headshots: number;
  /** armes permises (la première : celle de l'apparition) */
  weapons: GFWeapon[];
  /** équipement choisi (appliqué à la prochaine apparition s'il change en cours de vie) */
  loadout: GFLoadout;
  /** grenades restantes */
  grenades: Record<GFGrenade, number>;
  /** aveuglé (grenade aveuglante) jusqu'à (horodatage serveur) et depuis */
  blindUntil: number;
  blindFrom: number;
  /** réapparition prévue (horodatage serveur) */
  respawnAt: number;
  /** dernière apparition : position et numéro (le client se place quand le numéro change) */
  spawn: { x: number; y: number | null; z: number; yaw: number; n: number };
  /** invulnérable jusqu'à (horodatage serveur) */
  shieldUntil: number;
}

export interface GFKill {
  killer: string;
  victim: string;
  weapon: GFWeapon | 'grenade';
  head: boolean;
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
  /** nuages de fumigène actifs */
  smokes: { x: number; y: number; z: number; r: number; from: number; until: number }[];
  /** vainqueur : identifiant du joueur, équipe, ou null (égalité) */
  result: null | { winner: string | Team | null; reason: string };
}

export type Vec3 = [number, number, number];

/** Grenade lancée, vue par tous : trajectoire calculée par la salle (un point tous les 1/20 s), explosion. */
export interface GFGrenadeThrow {
  id: number;
  by: string;
  kind: GFGrenade;
  path: Vec3[];
  /** départ et explosion (horodatages serveur) */
  t0: number;
  explodeAt: number;
}

/** Tir vu par tous (animation, son, traçantes) : d'où, vers où (un point par plomb), qui est touché, à la tête ou non. */
export interface GFShot {
  by: string;
  from: Vec3;
  to: Vec3[];
  hit: string | null;
  head: boolean;
  weapon: GFWeapon;
}

export interface GFShotResult {
  hit: boolean;
  killed: boolean;
  head: boolean;
}

// ───────────────────────── zones de touche ─────────────────────────

/**
 * Silhouette de tir d'un personnage de taille h posé en (x, y, z) : la tête est une sphère, le corps une capsule
 * verticale (du bassin au cou). Le serveur et le navigateur utilisent les mêmes mesures.
 */
export const HITBOX = { headRadius: 0.15, headBelowTop: 0.13, bodyRadius: 0.29, bodyBottom: 0.25, bodyTopBelowHead: 0.45 };

/** Distance le long du rayon (o + t·d, d unitaire) jusqu'à la sphère, ou null. */
function raySphere(o: Vec3, d: Vec3, c: Vec3, r: number): number | null {
  const ox = o[0] - c[0];
  const oy = o[1] - c[1];
  const oz = o[2] - c[2];
  const b = ox * d[0] + oy * d[1] + oz * d[2];
  const q = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - q;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : q <= 0 ? 0 : null;
}

/** Distance le long du rayon jusqu'à une capsule verticale (axe x, z, de y0 à y1, rayon r), ou null. */
function rayCapsule(o: Vec3, d: Vec3, x: number, z: number, y0: number, y1: number, r: number): number | null {
  let best: number | null = null;
  // cylindre infini (dans le plan horizontal)
  const ox = o[0] - x;
  const oz = o[2] - z;
  const a = d[0] * d[0] + d[2] * d[2];
  if (a > 1e-9) {
    const b = ox * d[0] + oz * d[2];
    const c = ox * ox + oz * oz - r * r;
    const disc = b * b - a * c;
    if (disc >= 0) {
      const t = (-b - Math.sqrt(disc)) / a;
      const y = o[1] + t * d[1];
      if (t >= 0 && y >= y0 && y <= y1) best = t;
    }
  }
  for (const cy of [y0, y1]) {
    const t = raySphere(o, d, [x, cy, z], r);
    if (t !== null && (best === null || t < best)) best = t;
  }
  return best;
}

/** Touche d'un rayon contre une silhouette : distance et zone (la tête l'emporte si le rayon la traverse). */
export function rayHitBody(o: Vec3, d: Vec3, p: { x: number; y: number; z: number }, h: number): { t: number; head: boolean } | null {
  const H = HITBOX;
  const headY = p.y + h - H.headBelowTop;
  const th = raySphere(o, d, [p.x, headY, p.z], H.headRadius);
  const tb = rayCapsule(o, d, p.x, p.z, p.y + H.bodyBottom, headY - H.bodyTopBelowHead + H.bodyRadius * 0.5, H.bodyRadius);
  if (th !== null && (tb === null || th <= tb + 0.35)) return { t: th, head: true };
  if (tb !== null) return { t: tb, head: false };
  return null;
}

export function normalize(v: Vec3): Vec3 | null {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 1e-6 && Number.isFinite(l) ? [v[0] / l, v[1] / l, v[2] / l] : null;
}

export type GFEvent = { text: string; kind: 'info' | 'mort' | 'fin'; to?: string };
