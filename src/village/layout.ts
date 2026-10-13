/**
 * Plan du village « Minuit au village » : relief, rues, places, quartiers et implantation de chaque bâtiment.
 * Données pures (aucune dépendance à Three.js) : partagées par le rendu, les tests et plus tard le serveur de jeu.
 *
 * Repère : x vers l'est, z vers le sud, y vers le haut, en mètres. La place centrale est en (0, 0).
 * Un bâtiment a sa façade principale (porte d'entrée) du côté de son +z local ; `rot` est l'angle de rotation
 * autour de y (même convention que Three.js) : la façade regarde la direction (sin rot, cos rot).
 */

// ───────────────────────── outils ─────────────────────────

export type P2 = [number, number];

export const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function hash2(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
/** Bruit de valeur 2D lissé, déterministe, dans [0, 1]. */
export function noise2(x: number, y: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
const gauss = (dx: number, dz: number, r: number) => Math.exp(-(dx * dx + dz * dz) / (r * r));

/** Générateur pseudo-aléatoire déterministe. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ───────────────────────── relief ─────────────────────────

/** Taille du terrain (carré centré sur la place). */
export const WORLD_HALF = 320;

/**
 * Relief naturel avant aplanissement : la place dans un léger creux, l'église sur une butte au nord, une pente
 * douce vers les champs à l'est, puis des collines boisées qui ferment l'horizon tout autour du village.
 */
export function naturalHeight(x: number, z: number): number {
  let h = 0;
  h += 3.2 * gauss(x + 8, z + 95, 45); // butte de l'église
  h += 1.1 * Math.sin(x * 0.021 + 0.7) * Math.cos(z * 0.017 - 0.4);
  h += 0.45 * Math.sin(x * 0.047 + z * 0.031);
  h += 1.4 * (noise2(x * 0.012, z * 0.012) - 0.5);
  h -= 0.012 * x; // l'est descend doucement vers les champs
  const r = Math.hypot(x * 0.92, z);
  const edge = smoothstep(150, 270, r);
  h += edge * edge * 26 + edge * 10 * noise2(x * 0.025 + 3, z * 0.025);
  return h;
}

// ───────────────────────── rues ─────────────────────────

export type RoadKind = 'street' | 'lane' | 'dirt' | 'path';
export interface Road {
  id: string;
  name: string;
  kind: RoadKind;
  width: number;
  pts: P2[];
}

/** Rues et chemins (lignes médianes, lissées en courbes). */
export const ROADS: Road[] = [
  { id: 'grand-rue', name: 'Grand-Rue (quartier commerçant)', kind: 'street', width: 6, pts: [[15, -1], [34, 3], [52, -1], [70, 4], [86, 1], [104, 6]] },
  { id: 'rue-eglise', name: "Rue de l'Église", kind: 'street', width: 5, pts: [[-3, -12], [-5, -28], [-2, -44], [-7, -60], [-10, -71]] },
  { id: 'rue-tisserands', name: 'Rue des Tisserands', kind: 'street', width: 4.5, pts: [[-16, 2], [-32, 6], [-46, 4], [-60, 12], [-72, 24], [-80, 40]] },
  { id: 'rue-puits', name: 'Rue du Puits', kind: 'lane', width: 4, pts: [[2, 12], [5, 28], [1, 44], [-6, 58], [-8, 72]] },
  { id: 'ruelle-jardins', name: 'Ruelle des Jardins', kind: 'lane', width: 3.4, pts: [[-46, 6], [-44, 24], [-50, 40], [-42, 56], [-28, 62], [-8, 60]] },
  { id: 'chemin-lavoir', name: 'Chemin du Lavoir', kind: 'dirt', width: 3, pts: [[-30, 5], [-31.5, -12], [-44, -27], [-60, -37], [-76, -50], [-92, -61]] },
  { id: 'chemin-fermes', name: 'Chemin des Fermes', kind: 'dirt', width: 3.6, pts: [[104, 6], [110, 24], [114, 44], [124, 62], [150, 86], [200, 116], [250, 130]] },
  { id: 'chemin-sud', name: 'Chemin du Moulin', kind: 'dirt', width: 3.2, pts: [[-8, 72], [-4, 100], [2, 140], [8, 200], [14, 260]] },
  { id: 'chemin-ouest', name: 'Chemin de la Forêt', kind: 'path', width: 2.6, pts: [[-80, 40], [-110, 48], [-150, 46], [-205, 40], [-260, 30]] },
  { id: 'chemin-nord', name: 'Sentier du Calvaire', kind: 'path', width: 2.4, pts: [[-20, -78], [-38, -98], [-50, -130], [-58, -190], [-62, -250]] },
  { id: 'allee-cimetiere', name: 'Allée du Cimetière', kind: 'path', width: 2.2, pts: [[-2, -73], [6, -77], [16, -84]] },
];

/** Polyligne échantillonnée (Catmull-Rom) avec abscisse curviligne. */
export interface RoadPath {
  road: Road;
  pts: P2[];
  s: number[];
  length: number;
}

function catmull(p0: P2, p1: P2, p2: P2, p3: P2, t: number): P2 {
  const t2 = t * t;
  const t3 = t2 * t;
  const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return [f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])];
}

function samplePath(road: Road): RoadPath {
  const c = road.pts;
  const pts: P2[] = [];
  for (let i = 0; i < c.length - 1; i++) {
    const p0 = c[Math.max(0, i - 1)];
    const p3 = c[Math.min(c.length - 1, i + 2)];
    const n = Math.max(4, Math.ceil(Math.hypot(c[i + 1][0] - c[i][0], c[i + 1][1] - c[i][1])));
    for (let k = 0; k < n; k++) pts.push(catmull(p0, c[i], c[i + 1], p3, k / n));
  }
  pts.push(c[c.length - 1]);
  const s = [0];
  for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { road, pts, s, length: s[s.length - 1] };
}

export const PATHS: RoadPath[] = ROADS.map(samplePath);
export const pathOf = (id: string) => PATHS.find((p) => p.road.id === id)!;

/** Point et tangente unitaire à l'abscisse `s` d'une rue. */
export function pointAt(p: RoadPath, s: number): { p: P2; t: P2 } {
  const ss = Math.min(p.length, Math.max(0, s));
  let i = 1;
  while (i < p.s.length - 1 && p.s[i] < ss) i++;
  const a = p.pts[i - 1];
  const b = p.pts[i];
  const seg = p.s[i] - p.s[i - 1] || 1;
  const k = (ss - p.s[i - 1]) / seg;
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l = Math.hypot(dx, dz) || 1;
  return { p: [a[0] + dx * k, a[1] + dz * k], t: [dx / l, dz / l] };
}

/** Distance d'un point au segment [a, b]. */
export function distSeg(x: number, z: number, a: P2, b: P2): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
  return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
}

/** Distance au bord le plus proche d'une rue (négative sur la chaussée), et la rue concernée. */
export function roadDistance(x: number, z: number, kinds?: RoadKind[]): { d: number; road: Road | null } {
  let best = Infinity;
  let road: Road | null = null;
  for (const p of PATHS) {
    if (kinds && !kinds.includes(p.road.kind)) continue;
    for (let i = 1; i < p.pts.length; i++) {
      const d = distSeg(x, z, p.pts[i - 1], p.pts[i]) - p.road.width / 2;
      if (d < best) {
        best = d;
        road = p.road;
      }
    }
  }
  return { d: best, road };
}

// ───────────────────────── places ─────────────────────────

/** Place centrale (contour irrégulier) et parvis de l'église. */
export const PLAZA: P2[] = [[-17, -11], [-7, -14], [6, -14.5], [16, -9], [18, 5], [9, 12.5], [-4, 13], [-16, 9]];
export const CHURCH_SQUARE: P2[] = [[-24, -80], [2, -81], [4, -68], [-6, -64], [-22, -66]];
export const PLAZA_Y = 0;

export function inPolygon(x: number, z: number, poly: P2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance signée au bord d'un polygone (négative à l'intérieur). */
export function polygonDistance(x: number, z: number, poly: P2[]): number {
  let d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) d = Math.min(d, distSeg(x, z, poly[j], poly[i]));
  return inPolygon(x, z, poly) ? -d : d;
}

// ───────────────────────── bâtiments ─────────────────────────

export type Kind = 'house' | 'tavern' | 'forge' | 'apothecary' | 'shop' | 'bakery' | 'church' | 'sheriff' | 'stable' | 'barn' | 'abandoned';
export type District = 'place' | 'commerce' | 'residentiel' | 'eglise' | 'abords';
export type GroundMat = 'stone' | 'stoneDark' | 'plaster' | 'planks';
export type UpperMat = 'timber' | 'plaster' | 'planks' | 'stone';
export type RoofMat = 'tiles' | 'slate' | 'thatch' | 'shingles';

export interface BuildingSpec {
  id: string;
  name: string;
  kind: Kind;
  district: District;
  x: number;
  z: number;
  rot: number;
  /** largeur de façade (x local) */
  w: number;
  /** profondeur (z local) */
  d: number;
  /** nombre de niveaux habitables hors cave et combles */
  floors: number;
  ground: GroundMat;
  upper: UpperMat;
  roof: RoofMat;
  /** indices de teinte (enduit, tuiles) */
  tint: number;
  roofTint: number;
  /** encorbellement des étages sur la façade (m) */
  jetty: number;
  cellar: boolean;
  /** part des fenêtres éclairées (0 à 1) */
  lit: number;
  /** jardin clos derrière la maison */
  garden: boolean;
  seed: number;
}

type Opt = Partial<Omit<BuildingSpec, 'id' | 'name' | 'kind' | 'district' | 'x' | 'z' | 'rot' | 'w' | 'd'>>;

let seedCounter = 1;
function make(id: string, name: string, kind: Kind, district: District, x: number, z: number, rot: number, w: number, d: number, o: Opt = {}): BuildingSpec {
  const seed = o.seed ?? seedCounter++ * 7919;
  const r = rng(seed);
  return {
    id,
    name,
    kind,
    district,
    x,
    z,
    rot,
    w,
    d,
    floors: o.floors ?? 2,
    ground: o.ground ?? (r() < 0.6 ? 'stone' : 'plaster'),
    upper: o.upper ?? (r() < 0.65 ? 'timber' : 'plaster'),
    roof: o.roof ?? (r() < 0.55 ? 'tiles' : r() < 0.6 ? 'slate' : 'shingles'),
    tint: o.tint ?? Math.floor(r() * 6),
    roofTint: o.roofTint ?? Math.floor(r() * 4),
    jetty: o.jetty ?? 0,
    cellar: o.cellar ?? false,
    lit: o.lit ?? 0.45,
    garden: o.garden ?? false,
    seed,
  };
}

/** Rotation pour que la façade regarde la direction (dx, dz). */
export const facing = (dx: number, dz: number) => Math.atan2(dx, dz);

/**
 * Bâtiment aligné sur une rue : à l'abscisse `s`, du côté `side` (+1 : à gauche de la rue dans son sens de
 * parcours, -1 : à droite), en retrait de `gap` mètres du bord, façade tournée vers la chaussée.
 * `skew` ajoute un léger désaxement (les rues anciennes ne sont pas tirées au cordeau).
 */
function along(roadId: string, s: number, side: 1 | -1, w: number, d: number, gap: number, skew = 0) {
  const p = pathOf(roadId);
  const { p: c, t } = pointAt(p, s);
  const n: P2 = [-t[1], t[0]];
  const off = p.road.width / 2 + gap + d / 2;
  const x = c[0] + n[0] * side * off;
  const z = c[1] + n[1] * side * off;
  return { x, z, rot: facing(-n[0] * side, -n[1] * side) + skew };
}

function onRoad(id: string, name: string, kind: Kind, district: District, roadId: string, s: number, side: 1 | -1, w: number, d: number, gap: number, o: Opt & { skew?: number } = {}) {
  const a = along(roadId, s, side, w, d, gap, o.skew ?? 0);
  return make(id, name, kind, district, a.x, a.z, a.rot, w, d, o);
}

export const BUILDINGS: BuildingSpec[] = [
  // ── A. Place centrale ──
  make('taverne', 'Taverne du Corbeau Borgne', 'tavern', 'place', 7.5, -21.2, 0, 15, 11, { floors: 2, ground: 'stone', upper: 'timber', roof: 'tiles', cellar: true, lit: 0.95, jetty: 0.5, tint: 1 }),
  make('drapier', 'Maison du Drapier', 'house', 'place', -23.2, -4.5, facing(1, 0.08), 8, 8, { floors: 3, ground: 'stone', upper: 'timber', roof: 'slate', jetty: 0.45, lit: 0.6 }),
  make('notaire', 'Maison du Notaire', 'house', 'place', -21.5, -21.5, facing(0.7, 0.72), 7.5, 7, { floors: 3, ground: 'stone', upper: 'plaster', roof: 'slate', tint: 3 }),
  make('changeur', 'Maison du Changeur', 'shop', 'place', 24.5, -14.5, facing(-0.62, 0.78), 8, 8, { floors: 2, ground: 'stone', upper: 'timber', roof: 'tiles', jetty: 0.4, lit: 0.7 }),
  make('mercier', 'Échoppe du Mercier', 'shop', 'place', 23.5, 12.5, facing(-0.95, -0.3), 7.5, 7, { floors: 2, ground: 'plaster', upper: 'timber', roof: 'tiles', tint: 4, lit: 0.6 }),
  make('maison-pignon', 'Maison à Pignon', 'house', 'place', -16, 21.5, facing(0.72, -0.7), 8, 7, { floors: 2, ground: 'stone', upper: 'timber', roof: 'tiles', jetty: 0.4 }),
  onRoad('maison-cour', 'Maison de la Cour', 'house', 'place', 'rue-puits', 10, 1, 7.5, 7, 1.2, { floors: 2, ground: 'plaster', upper: 'timber', roof: 'shingles', tint: 2 }),
  onRoad('tisserande', 'Maison de la Tisserande', 'house', 'place', 'rue-puits', 15, -1, 7, 8, 1.6, { floors: 2, roof: 'tiles' }),

  // ── B. Quartier commerçant (Grand-Rue) ──
  onRoad('apothicaire', "Apothicairerie de l'Herboriste", 'apothecary', 'commerce', 'grand-rue', 15.5, -1, 8, 8, 1.4, { floors: 2, ground: 'stone', upper: 'timber', roof: 'slate', jetty: 0.45, lit: 0.8, skew: 0.04 }),
  onRoad('marchand-vin', 'Maison du Marchand de Vin', 'house', 'commerce', 'grand-rue', 30, -1, 7, 8.5, 1.0, { floors: 3, ground: 'stone', upper: 'plaster', roof: 'tiles', tint: 1, cellar: false, skew: -0.03 }),
  onRoad('maison-etroite', 'Maison Étroite', 'house', 'commerce', 'grand-rue', 38.6, -1, 6.5, 9, 1.8, { floors: 3, ground: 'plaster', upper: 'timber', roof: 'slate', jetty: 0.5, tint: 5 }),
  onRoad('forge', 'Forge du Maréchal', 'forge', 'commerce', 'grand-rue', 50.5, -1, 12, 10, 2.4, { floors: 2, ground: 'stoneDark', upper: 'planks', roof: 'slate', lit: 0.9 }),
  onRoad('sellier', 'Maison du Sellier', 'house', 'commerce', 'grand-rue', 70, -1, 7.5, 7.5, 1.4, { floors: 2, roof: 'shingles', skew: 0.05 }),
  onRoad('maison-chaume-est', 'Chaumière du Vannier', 'house', 'commerce', 'grand-rue', 81.5, -1, 8, 7, 2.2, { floors: 1, ground: 'plaster', upper: 'plaster', roof: 'thatch', tint: 4, garden: true }),
  onRoad('boulangerie', 'Boulangerie', 'bakery', 'commerce', 'grand-rue', 19.5, 1, 8, 8, 1.2, { floors: 2, ground: 'stone', upper: 'timber', roof: 'tiles', lit: 0.85, tint: 1 }),
  onRoad('tailleur', 'Échoppe du Tailleur', 'shop', 'commerce', 'grand-rue', 29.5, 1, 7.5, 8, 1.0, { floors: 2, ground: 'plaster', upper: 'timber', roof: 'tiles', jetty: 0.4, tint: 2 }),
  onRoad('cordonnier', 'Échoppe du Cordonnier', 'shop', 'commerce', 'grand-rue', 47.5, 1, 7.5, 7.5, 1.6, { floors: 2, ground: 'stone', upper: 'planks', roof: 'shingles', skew: -0.04 }),
  onRoad('maison-marchand', 'Maison du Marchand', 'house', 'commerce', 'grand-rue', 57.5, 1, 8.5, 8, 1.2, { floors: 3, ground: 'stone', upper: 'timber', roof: 'slate', jetty: 0.45 }),
  onRoad('maison-tonnelier', 'Maison du Tonnelier', 'house', 'commerce', 'grand-rue', 70.5, 1, 7.5, 7.5, 1.8, { floors: 2, roof: 'tiles', garden: true }),
  onRoad('maison-bout', 'Maison du Bout de la Rue', 'house', 'commerce', 'grand-rue', 83, 1, 7, 7, 1.5, { floors: 1, ground: 'stone', upper: 'stone', roof: 'thatch', garden: true }),

  // ── C. Quartier résidentiel ──
  onRoad('maison-t1', 'Maison des Tisserands', 'house', 'residentiel', 'rue-tisserands', 24, 1, 7, 7, 1.0, { floors: 2, jetty: 0.35 }),
  onRoad('maison-t2', 'Maison Mitoyenne', 'house', 'residentiel', 'rue-tisserands', 31.1, 1, 7, 7.5, 1.0, { floors: 3, ground: 'plaster', upper: 'timber', roof: 'slate', tint: 3 }),
  onRoad('maison-t3', 'Maison du Teinturier', 'house', 'residentiel', 'rue-tisserands', 38.8, 1, 7.5, 7, 1.0, { floors: 2, roof: 'tiles' }),
  onRoad('maison-t4', 'Maison au Puits', 'house', 'residentiel', 'rue-tisserands', 48, 1, 8, 7, 2.0, { floors: 2, ground: 'stone', upper: 'stone', roof: 'slate', garden: true }),
  onRoad('maison-t5', 'Maison du Charpentier', 'house', 'residentiel', 'rue-tisserands', 60, 1, 7, 8, 1.6, { floors: 2, ground: 'planks', upper: 'planks', roof: 'shingles', garden: true }),
  onRoad('maison-t6', 'Maison de la Veuve', 'house', 'residentiel', 'rue-tisserands', 13, -1, 7.5, 7.5, 1.4, { floors: 2, roof: 'tiles' }),
  onRoad('maison-t7', 'Maison Basse', 'house', 'residentiel', 'rue-tisserands', 19.5, -1, 7, 7, 1.4, { floors: 1, ground: 'plaster', upper: 'plaster', roof: 'thatch', tint: 0, garden: true }),
  onRoad('maison-t8', 'Maison du Fileur', 'house', 'residentiel', 'rue-tisserands', 42.5, -1, 7, 7.5, 1.8, { floors: 2, upper: 'timber', roof: 'tiles', garden: true }),
  onRoad('maison-t9', 'Maison du Berger', 'house', 'residentiel', 'rue-tisserands', 54, -1, 8, 7, 2.2, { floors: 1, ground: 'stone', upper: 'stone', roof: 'thatch', garden: true }),
  onRoad('maison-t10', 'Maison de la Sage-Femme', 'house', 'residentiel', 'rue-tisserands', 67, -1, 7.5, 7.5, 1.8, { floors: 2, roof: 'slate', garden: true }),
  onRoad('maison-j1', 'Maison du Jardinier', 'house', 'residentiel', 'ruelle-jardins', 17, -1, 7, 7, 1.4, { floors: 2, roof: 'tiles', garden: true }),
  onRoad('maison-j2', 'Maison aux Volets Bleus', 'house', 'residentiel', 'ruelle-jardins', 24.5, 1, 7.5, 7, 1.6, { floors: 2, ground: 'plaster', upper: 'timber', roof: 'shingles', tint: 5, garden: true }),
  onRoad('maison-j3', 'Maison du Charron', 'house', 'residentiel', 'ruelle-jardins', 33, -1, 7, 7.5, 1.8, { floors: 2, roof: 'slate' }),
  onRoad('maison-j4', 'Chaumière des Saules', 'house', 'residentiel', 'ruelle-jardins', 38, 1, 8, 7, 2.0, { floors: 1, ground: 'plaster', upper: 'plaster', roof: 'thatch', tint: 2, garden: true }),
  onRoad('maison-j5', "Maison de l'Ancien", 'house', 'residentiel', 'ruelle-jardins', 54, -1, 7.5, 7, 1.6, { floors: 2, roof: 'tiles', garden: true }),
  onRoad('maison-j6', 'Maison du Puisatier', 'house', 'residentiel', 'ruelle-jardins', 64, 1, 7, 7, 1.8, { floors: 2, roof: 'shingles', garden: true }),
  onRoad('maison-j7', 'Maison du Potier', 'house', 'residentiel', 'ruelle-jardins', 78, -1, 7.5, 7.5, 1.6, { floors: 2, roof: 'tiles' }),
  onRoad('maison-p1', 'Maison du Puits', 'house', 'residentiel', 'rue-puits', 31, -1, 7, 7.5, 1.6, { floors: 2, roof: 'slate', garden: true }),
  onRoad('maison-p2', 'Maison du Sonneur', 'house', 'residentiel', 'rue-puits', 33, 1, 7.5, 7, 1.6, { floors: 2, roof: 'tiles' }),
  onRoad('maison-p3', 'Chaumière du Bas', 'house', 'residentiel', 'rue-puits', 50, -1, 8, 7, 2.0, { floors: 1, ground: 'stone', upper: 'stone', roof: 'thatch', garden: true }),

  // ── D. Quartier administratif et religieux ──
  make('eglise', 'Église Saint-Aubin', 'church', 'eglise', -11, -103, 0, 11, 24, { floors: 1, ground: 'stone', upper: 'stone', roof: 'slate', lit: 0.6 }),
  make('sherif', 'Poste du Shérif', 'sheriff', 'eglise', -31, -73.5, facing(1, 0), 10, 9, { floors: 2, ground: 'stoneDark', upper: 'stone', roof: 'slate', lit: 0.8 }),
  make('presbytere', 'Presbytère', 'house', 'eglise', 12.5, -70, facing(-1, 0.1), 7.5, 7.5, { floors: 2, ground: 'stone', upper: 'stone', roof: 'slate', lit: 0.5 }),
  onRoad('maison-e1', 'Maison du Bedeau', 'house', 'eglise', 'rue-eglise', 16, -1, 7, 7.5, 1.2, { floors: 2, roof: 'tiles' }),
  onRoad('maison-e2', 'Maison du Greffier', 'house', 'eglise', 'rue-eglise', 31, 1, 7, 7, 1.4, { floors: 2, ground: 'stone', upper: 'timber', roof: 'slate' }),
  onRoad('maison-e3', 'Maison du Chantre', 'house', 'eglise', 'rue-eglise', 31, -1, 7.5, 7, 1.4, { floors: 2, roof: 'tiles' }),
  onRoad('maison-e4', 'Maison du Maître d’École', 'house', 'eglise', 'rue-eglise', 46, -1, 8, 7.5, 1.6, { floors: 2, ground: 'stone', upper: 'plaster', roof: 'slate', tint: 3 }),
  onRoad('maison-e5', 'Maison du Fossoyeur', 'house', 'eglise', 'rue-eglise', 45, 1, 7, 7, 1.6, { floors: 1, ground: 'stone', upper: 'stone', roof: 'shingles', lit: 0.2 }),

  // ── E. Abords du village ──
  onRoad('ecuries', 'Écuries du Relais', 'stable', 'abords', 'chemin-fermes', 21, 1, 16, 8, 2.5, { floors: 1, ground: 'planks', upper: 'planks', roof: 'shingles', lit: 0.4 }),
  onRoad('grange', 'Grange aux Dîmes', 'barn', 'abords', 'chemin-fermes', 46, -1, 12, 15, 3, { floors: 1, ground: 'stone', upper: 'planks', roof: 'thatch', lit: 0 }),
  onRoad('ferme', 'Ferme des Brumes', 'house', 'abords', 'chemin-fermes', 64, 1, 9, 7.5, 3, { floors: 2, ground: 'stone', upper: 'stone', roof: 'thatch', garden: true, lit: 0.35 }),
  make('abandonnee', 'Maison Abandonnée', 'abandoned', 'abords', -101, -66.5, facing(1, 0.45), 9, 8, { floors: 2, ground: 'stone', upper: 'timber', roof: 'shingles', cellar: true, lit: 0, tint: 3 }),
];

// ───────────────────────── géométrie des emprises ─────────────────────────

/** Coins (monde) d'un rectangle local [x0,x1]×[z0,z1] d'un bâtiment. */
export function localToWorld(b: { x: number; z: number; rot: number }, lx: number, lz: number): P2 {
  const c = Math.cos(b.rot);
  const s = Math.sin(b.rot);
  return [b.x + lx * c + lz * s, b.z - lx * s + lz * c];
}
export function worldToLocal(b: { x: number; z: number; rot: number }, x: number, z: number): P2 {
  const c = Math.cos(b.rot);
  const s = Math.sin(b.rot);
  const dx = x - b.x;
  const dz = z - b.z;
  return [dx * c - dz * s, dx * s + dz * c];
}

/** Emprise au sol (rectangle orienté) avec marge. */
export function footprint(b: BuildingSpec, margin = 0): P2[] {
  const hw = b.w / 2 + margin;
  const hd = b.d / 2 + margin;
  const extra = b.kind === 'church' ? CHURCH_TOWER_DEPTH : b.jetty;
  return [localToWorld(b, -hw, -hd), localToWorld(b, hw, -hd), localToWorld(b, hw, hd + extra), localToWorld(b, -hw, hd + extra)];
}
/** Le clocher dépasse de la façade de l'église. */
export const CHURCH_TOWER_DEPTH = 5;

/** Un point est-il dans l'emprise (locale) d'un bâtiment, marge comprise ? */
export function insideBuilding(b: BuildingSpec, x: number, z: number, margin = 0): boolean {
  const [lx, lz] = worldToLocal(b, x, z);
  const extra = b.kind === 'church' ? CHURCH_TOWER_DEPTH : b.jetty;
  return Math.abs(lx) <= b.w / 2 + margin && lz >= -b.d / 2 - margin && lz <= b.d / 2 + extra + margin;
}

/** Test de recouvrement de deux polygones convexes (axes séparateurs). */
export function convexOverlap(a: P2[], b: P2[]): boolean {
  for (const poly of [a, b])
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const nx = q[1] - p[1];
      const nz = p[0] - q[0];
      let amin = Infinity;
      let amax = -Infinity;
      let bmin = Infinity;
      let bmax = -Infinity;
      for (const v of a) {
        const d = v[0] * nx + v[1] * nz;
        amin = Math.min(amin, d);
        amax = Math.max(amax, d);
      }
      for (const v of b) {
        const d = v[0] * nx + v[1] * nz;
        bmin = Math.min(bmin, d);
        bmax = Math.max(bmax, d);
      }
      if (amax <= bmin || bmax <= amin) return false;
    }
  return true;
}

// ───────────────────────── terrain aplani ─────────────────────────

/** Hauteur du sol au pied d'un bâtiment (niveau du terrain aplani sous son emprise). */
export function baseOf(b: BuildingSpec): number {
  if (b.district === 'place' && polygonDistance(b.x, b.z, PLAZA) < 14) return PLAZA_Y + naturalHeight(b.x, b.z) * 0.15;
  return naturalHeight(b.x, b.z);
}
/** Hauteur du sol fini (dessus du plancher du rez-de-chaussée), au-dessus du socle. */
export const PLINTH = 0.3;

interface Pad {
  b: BuildingSpec;
  y: number;
}
const PADS: Pad[] = BUILDINGS.map((b) => ({ b, y: baseOf(b) }));

/**
 * Hauteur finale du terrain : relief naturel, aplani sous les bâtiments (avec une transition douce de 5 m),
 * sous la place et le parvis, et adouci le long des rues (pas de dévers marqué sur la chaussée).
 */
export function heightAt(x: number, z: number): number {
  let h = naturalHeight(x, z);
  // place centrale : presque plane
  const dp = polygonDistance(x, z, PLAZA);
  if (dp < 12) h += (PLAZA_Y + naturalHeight(x, z) * 0.15 - h) * (1 - smoothstep(0, 12, dp));
  for (const pad of PADS) {
    const b = pad.b;
    const [lx, lz] = worldToLocal(b, x, z);
    const extra = b.kind === 'church' ? CHURCH_TOWER_DEPTH : b.jetty;
    const ex = Math.max(0, Math.abs(lx) - b.w / 2);
    const ez = Math.max(0, lz < 0 ? -lz - b.d / 2 : lz - b.d / 2 - extra);
    const d = Math.hypot(ex, ez);
    if (d > 6) continue;
    // la marche du seuil (0,3 m) reste visible : le sol arrive au pied du socle
    const w = 1 - smoothstep(0.8, 6, d);
    h += (pad.y - h) * w;
  }
  return h;
}

/** Niveau de sol fini (plancher du rez-de-chaussée) d'un bâtiment. */
export const floorOf = (b: BuildingSpec) => baseOf(b) + PLINTH;

// ───────────────────────── abords, clôtures, jardins ─────────────────────────

export interface Garden {
  building: string;
  /** rectangle dans le repère local du bâtiment (derrière la maison) */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** Jardins clos derrière les maisons qui en ont un, seulement s'ils ne mordent ni rue ni autre bâtiment. */
export const GARDENS: Garden[] = BUILDINGS.filter((b) => b.garden).flatMap((b) => {
  for (const depth of [7, 5.5, 4]) {
    const g: Garden = { building: b.id, x0: -b.w / 2 - 0.5, x1: b.w / 2 + 0.5, z0: -b.d / 2 - depth, z1: -b.d / 2 - 0.4 };
    const poly: P2[] = [localToWorld(b, g.x0, g.z0), localToWorld(b, g.x1, g.z0), localToWorld(b, g.x1, g.z1), localToWorld(b, g.x0, g.z1)];
    const hitsBuilding = BUILDINGS.some((o) => o !== b && convexOverlap(poly, footprint(o, 0.6)));
    const hitsRoad = poly.some(([x, z]) => roadDistance(x, z).d < 0.5) || roadDistance(...localToWorld(b, 0, (g.z0 + g.z1) / 2)).d < 0.5;
    const hitsPlaza = poly.some(([x, z]) => polygonDistance(x, z, PLAZA) < 0.5 || polygonDistance(x, z, CHURCH_SQUARE) < 0.5);
    if (!hitsBuilding && !hitsRoad && !hitsPlaza) return [g];
  }
  return [];
});

/** Cimetière (clos de murets) à l'est de l'église. */
export const CEMETERY = { x0: 4, x1: 28, z0: -114, z1: -88, gateX: 16 };

/** Points de vue de l'inspection : position caméra et cible. */
export interface Viewpoint {
  id: string;
  label: string;
  pos: [number, number, number];
  target: [number, number, number];
}

/** Zone libre (pas de bâtiment, pas de rue, pas de place) pour y poser décor ou végétation. */
export function isFree(x: number, z: number, margin = 1): boolean {
  if (BUILDINGS.some((b) => insideBuilding(b, x, z, margin))) return false;
  if (roadDistance(x, z).d < margin) return false;
  if (polygonDistance(x, z, PLAZA) < margin || polygonDistance(x, z, CHURCH_SQUARE) < margin) return false;
  if (x > CEMETERY.x0 - margin && x < CEMETERY.x1 + margin && z > CEMETERY.z0 - margin && z < CEMETERY.z1 + margin) return false;
  return true;
}

/**
 * Lisière de la forêt : distance au centre du village au-delà de laquelle les arbres deviennent denses,
 * variable selon la direction (le village s'étire vers l'est et vers le sud-ouest).
 */
export function forestEdge(x: number, z: number): number {
  const a = Math.atan2(z + 10, x - 5);
  return 128 + 22 * Math.cos(a) * Math.cos(a) + 18 * Math.sin(a * 3 + 1) + 12 * (noise2(Math.cos(a) * 2 + 5, Math.sin(a) * 2) - 0.5);
}
export const VILLAGE_CENTER: P2 = [5, -10];
