/**
 * Plans intérieurs des bâtiments : niveaux, pièces, cloisons et portes, escaliers et trémies, fenêtres,
 * cheminée, mobilier. Données pures (repère local du bâtiment, y = 0 au plancher du rez-de-chaussée) :
 * le rendu les construit, les tests vérifient qu'aucun meuble ne traverse un mur, ne bloque une porte ou
 * un escalier, et que l'intérieur correspond à l'enveloppe extérieure.
 */
import { CHURCH_TOWER_DEPTH, rng, type BuildingSpec, type P2 } from './layout';

export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}
export const rect = (x0: number, x1: number, z0: number, z1: number): Rect => ({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1) });
export const overlaps = (a: Rect, b: Rect, m = 0) => a.x0 < b.x1 + m && a.x1 > b.x0 - m && a.z0 < b.z1 + m && a.z1 > b.z0 - m;
export const inside = (a: Rect, b: Rect, m = 0) => a.x0 >= b.x0 + m - 1e-6 && a.x1 <= b.x1 - m + 1e-6 && a.z0 >= b.z0 + m - 1e-6 && a.z1 <= b.z1 - m + 1e-6;

// ───────────────────────── mobilier : catalogue des emprises ─────────────────────────

/** Emprise (largeur x, profondeur z, hauteur) de chaque meuble ; le devant du meuble est son +z local. */
export const FURN = {
  table: [1.7, 0.85, 0.78],
  tableRound: [1.1, 1.1, 0.76],
  tableSmall: [0.8, 0.6, 0.74],
  chair: [0.46, 0.46, 0.95],
  stool: [0.38, 0.38, 0.48],
  bench: [1.5, 0.36, 0.46],
  bed: [1.0, 2.0, 0.9],
  bedDouble: [1.5, 2.05, 1.1],
  chest: [0.95, 0.5, 0.55],
  wardrobe: [1.1, 0.6, 1.95],
  cupboard: [1.3, 0.5, 1.8],
  shelf: [1.3, 0.36, 1.9],
  jarShelf: [1.4, 0.36, 2.0],
  barrel: [0.62, 0.62, 0.9],
  barrelRack: [2.1, 0.95, 1.25],
  wineRack: [1.8, 0.45, 1.9],
  crate: [0.7, 0.7, 0.62],
  crates: [1.3, 0.8, 1.15],
  sacks: [0.95, 0.65, 0.6],
  counter: [2.6, 0.7, 1.05],
  workbench: [1.8, 0.8, 0.88],
  anvil: [0.9, 0.45, 0.85],
  forgeHearth: [2.2, 1.4, 1.0],
  quench: [1.2, 0.6, 0.65],
  grindstone: [0.9, 0.6, 1.0],
  toolRack: [1.5, 0.25, 1.7],
  bellows: [0.6, 1.0, 0.7],
  coal: [1.1, 1.0, 0.5],
  pew: [3.0, 0.62, 0.95],
  altar: [2.2, 0.95, 1.05],
  lectern: [0.55, 0.55, 1.25],
  font: [1.0, 1.0, 1.0],
  candelabra: [0.45, 0.45, 1.6],
  desk: [1.5, 0.8, 0.8],
  weaponRack: [1.5, 0.3, 1.8],
  noticeBoard: [1.3, 0.08, 1.0],
  cot: [0.8, 1.9, 0.45],
  bucket: [0.36, 0.36, 0.35],
  hayBale: [1.2, 0.6, 0.5],
  hayPile: [2.0, 1.8, 1.0],
  trough: [1.6, 0.5, 0.5],
  saddleRack: [1.1, 0.45, 1.1],
  cart: [1.6, 3.0, 1.3],
  mortarTable: [1.0, 0.6, 0.85],
  herbRack: [1.3, 0.3, 0.8],
  rug: [2.0, 1.3, 0.02],
  spinningWheel: [0.9, 0.5, 1.0],
  oven: [1.6, 1.4, 1.9],
  breadRack: [1.4, 0.45, 1.6],
  tub: [1.0, 1.0, 0.55],
  debris: [1.3, 1.1, 0.25],
  stallDivider: [0.12, 2.4, 1.4],
  firewood: [1.2, 0.5, 0.8],
  bedroll: [0.8, 1.9, 0.15],
  pallet: [1.6, 1.0, 0.1],
} as const satisfies Record<string, readonly [number, number, number]>;
export type FurnType = keyof typeof FURN;

export interface Item {
  type: FurnType;
  x: number;
  z: number;
  /** rotation autour de y (multiples de 90° pour les meubles posés contre un mur) */
  rot: number;
  /** hauteur au-dessus du plancher (objets accrochés) */
  y?: number;
  /** renversé / de travers (maison abandonnée) */
  tilt?: number;
}

/** Emprise au sol (repère du bâtiment) d'un meuble placé. */
export function itemRect(it: Item): Rect {
  const [w, d] = FURN[it.type];
  const q = Math.round((it.rot / (Math.PI / 2)) % 4 + 4) % 4;
  const turned = q % 2 === 1 && Math.abs(it.rot - Math.round(it.rot / (Math.PI / 2)) * (Math.PI / 2)) < 0.01;
  const hw = (turned ? d : w) / 2;
  const hd = (turned ? w : d) / 2;
  return rect(it.x - hw, it.x + hw, it.z - hd, it.z + hd);
}

// ───────────────────────── structure ─────────────────────────

export type RoomType =
  | 'salle'
  | 'cuisine'
  | 'chambre'
  | 'reserve'
  | 'palier'
  | 'grenier'
  | 'cave'
  | 'salle-taverne'
  | 'cuisine-taverne'
  | 'chambre-auberge'
  | 'atelier-forge'
  | 'reserve-forge'
  | 'boutique-apothicaire'
  | 'boutique'
  | 'fournil'
  | 'nef'
  | 'choeur'
  | 'porche'
  | 'clocher'
  | 'bureau-sherif'
  | 'cellule'
  | 'archives'
  | 'ecurie'
  | 'sellerie'
  | 'grange'
  | 'fenil';

export interface Room {
  name: string;
  type: RoomType;
  rect: Rect;
  /** pièce éclairée (bougies, âtre) : ses fenêtres luisent la nuit */
  lit: boolean;
}

export interface DoorGap {
  /** distance depuis le point `a` de la cloison */
  at: number;
  w: number;
  h: number;
}
export interface Partition {
  a: P2;
  b: P2;
  doors: DoorGap[];
  /** mur plein, grille de cellule, ou muret de stalle */
  kind: 'wall' | 'bars' | 'low';
  /** hauteur (par défaut, celle du niveau) */
  h?: number;
}

export interface Stair {
  /** emprise au sol sur le niveau de départ */
  rect: Rect;
  /** sens de la montée (unitaire, axe x ou z) */
  dir: P2;
  /** niveau de départ (index dans `levels`) */
  from: number;
  rise: number;
  kind: 'stair' | 'ladder';
}

export type Side = 'front' | 'back' | 'left' | 'right';
export interface WallOpening {
  level: number;
  side: Side;
  /** position le long du côté : x pour front/back, z pour left/right */
  at: number;
  w: number;
  y0: number;
  y1: number;
  kind: 'door' | 'window' | 'big-door' | 'arch' | 'lancet' | 'belfry';
  /** fenêtre éclairée de l'intérieur */
  lit?: boolean;
  /** volets (fenêtres) / vantail (portes) */
  shutters?: boolean;
  /** fenêtre condamnée par des planches */
  boarded?: boolean;
}

export interface Level {
  index: number;
  name: string;
  /** dessus du plancher (relatif au rez-de-chaussée) */
  y: number;
  /** hauteur sous plafond (jusqu'au dessus du plancher suivant) */
  h: number;
  /** contour extérieur des murs */
  outer: Rect;
  /** intérieur (murs extérieurs déduits) */
  inner: Rect;
  /** épaisseur des murs extérieurs */
  t: number;
  rooms: Room[];
  partitions: Partition[];
  items: Item[];
  /** trémies percées dans le plancher de ce niveau */
  holes: Rect[];
  /** sous-sol (murs de cave enterrés) */
  underground?: boolean;
  /** murs extérieurs non construits (adossés à un autre volume) */
  skipWalls?: Side[];
  /** plancher partiel (fenil, tribune) : seules ces zones portent un plancher */
  partialFloor?: Rect[];
}

export interface Light {
  x: number;
  y: number;
  z: number;
  color: string;
  intensity: number;
  distance: number;
  /** flamme vacillante */
  flicker: boolean;
}

export interface Plan {
  levels: Level[];
  stairs: Stair[];
  openings: WallOpening[];
  /** souche de cheminée (rectangle au sol, côté gauche du bâtiment) */
  chimney: Rect | null;
  /** hauteur des murs extérieurs (jusqu'à la sablière, au-dessus du dernier niveau) */
  wallTop: number;
  /** grenier accessible (plancher de combles avec trappe) */
  atticHatch: Rect | null;
  lights: Light[];
  /** dégâts : toit percé, cheminée effondrée (maison abandonnée) */
  ruined: boolean;
}

// ───────────────────────── constantes ─────────────────────────

export const SLAB = 0.22;
export const INT_T = 0.14;
export const GROUND_H = 3.1;
export const UPPER_H = 2.8;
export const CELLAR_H = 2.5;
export const STEP_RISE = 0.2;
export const STEP_RUN = 0.25;
export const STAIR_W = 0.95;

export const wallT = (mat: string) => (mat === 'stone' || mat === 'stoneDark' ? 0.5 : 0.3);
export const stairRun = (rise: number) => Math.ceil(rise / STEP_RISE) * STEP_RUN;

// ───────────────────────── placement du mobilier ─────────────────────────

/**
 * Pose de mobilier dans un niveau : chaque meuble doit tenir entièrement dans sa pièce (murs déduits),
 * sans chevaucher un autre meuble, une trémie, un escalier, la cheminée ni le dégagement d'une porte.
 */
class Furnisher {
  blocked: Rect[] = [];
  constructor(
    readonly level: Level,
    private r: () => number,
  ) {}

  block(r: Rect) {
    this.blocked.push(r);
  }

  private free(rr: Rect, room: Room, m = 0.06) {
    if (!inside(rr, room.rect, 0.04)) return false;
    return !this.blocked.some((b) => overlaps(rr, b, m));
  }

  /** Essaie de poser un meuble ; renvoie l'élément posé ou null. */
  tryPut(room: Room, it: Item, m = 0.06): Item | null {
    const rr = itemRect(it);
    if (!this.free(rr, room, m)) return null;
    this.level.items.push(it);
    this.blocked.push(rr);
    return it;
  }

  /** Contre un mur de la pièce (dos au mur), en cherchant de la place du milieu vers les coins. */
  wall(room: Room, type: FurnType, sides: Side[] = ['back', 'left', 'right', 'front'], o: { y?: number; tilt?: number; gap?: number } = {}): Item | null {
    const [w, d] = FURN[type];
    const R = room.rect;
    const gap = o.gap ?? 0.04;
    for (const side of sides) {
      const along = side === 'back' || side === 'front' ? [R.x0, R.x1] : [R.z0, R.z1];
      const len = along[1] - along[0];
      if (len < w + 0.1) continue;
      const mid = (along[0] + along[1]) / 2;
      const steps = Math.floor((len - w) / 2 / 0.2);
      const order: number[] = [];
      const start = Math.floor(this.r() * 3) - 1;
      for (let k = 0; k <= steps; k++) order.push(start * 0.2 + k * 0.2, start * 0.2 - k * 0.2);
      for (const off of order) {
        const c = mid + off;
        if (c - w / 2 < along[0] + 0.05 || c + w / 2 > along[1] - 0.05) continue;
        let it: Item;
        if (side === 'back') it = { type, x: c, z: R.z0 + d / 2 + gap + 0.05, rot: 0 };
        else if (side === 'front') it = { type, x: c, z: R.z1 - d / 2 - gap - 0.05, rot: Math.PI };
        else if (side === 'left') it = { type, x: R.x0 + d / 2 + gap + 0.05, z: c, rot: Math.PI / 2 };
        else it = { type, x: R.x1 - d / 2 - gap - 0.05, z: c, rot: -Math.PI / 2 };
        if (o.y !== undefined) it.y = o.y;
        if (o.tilt !== undefined) it.tilt = o.tilt;
        // un objet accroché au mur ne gêne pas le passage : il ne réserve que sa propre emprise
        const placed = this.tryPut(room, it);
        if (placed) return placed;
      }
    }
    return null;
  }

  /** Comptoir parallèle au mur du fond, laissant un passage derrière ; à défaut, au centre. */
  counter(room: Room, type: FurnType = 'counter'): Item | null {
    const R = room.rect;
    const [w, d] = FURN[type];
    for (const z of [R.z0 + 0.4 + 1.0 + d / 2, R.z0 + 0.4 + 1.3 + d / 2])
      for (const off of [0, 0.4, -0.4, 0.8, -0.8]) {
        const x = (R.x0 + R.x1) / 2 + off;
        if (x - w / 2 < R.x0 + 0.05 || x + w / 2 > R.x1 - 0.05) continue;
        const p = this.tryPut(room, { type, x, z, rot: Math.PI }, 0.1);
        if (p) return p;
      }
    return this.center(room, type, { rot: 0, m: 0.2 });
  }

  /** Au centre de la pièce (ou décalé), orienté selon la plus grande dimension. */
  center(room: Room, type: FurnType, o: { dx?: number; dz?: number; rot?: number; m?: number; tilt?: number } = {}): Item | null {
    const R = room.rect;
    const cx = (R.x0 + R.x1) / 2 + (o.dx ?? 0);
    const cz = (R.z0 + R.z1) / 2 + (o.dz ?? 0);
    const rot = o.rot ?? (R.x1 - R.x0 >= R.z1 - R.z0 ? 0 : Math.PI / 2);
    for (const [ox, oz] of [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3], [0.6, 0.3], [-0.6, -0.3], [0.6, -0.3], [-0.6, 0.3]] as const) {
      const it: Item = { type, x: cx + ox, z: cz + oz, rot };
      if (o.tilt !== undefined) it.tilt = o.tilt;
      const p = this.tryPut(room, it, o.m ?? 0.35);
      if (p) return p;
    }
    return null;
  }

  /**
   * Table entourée de bancs ou de chaises (groupe posé d'un bloc) : la table et ses sièges doivent tous trouver
   * leur place, sinon rien n'est posé.
   */
  dining(room: Room, at: P2, rot: number, seats: 'bench' | 'chair' | 'stool', table: FurnType = 'table'): boolean {
    const [tw, td] = FURN[table];
    const parts: Item[] = [{ type: table, x: at[0], z: at[1], rot }];
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const loc = (lx: number, lz: number): P2 => [at[0] + lx * c + lz * s, at[1] - lx * s + lz * c];
    if (seats === 'bench') {
      const off = td / 2 + 0.3;
      for (const sz of [-1, 1]) {
        const [x, z] = loc(0, sz * off);
        parts.push({ type: 'bench', x, z, rot: rot + (sz < 0 ? 0 : Math.PI) });
      }
    } else {
      const off = td / 2 + 0.32;
      const n = table === 'tableRound' ? 1 : 2;
      for (const sz of [-1, 1])
        for (let k = 0; k < n; k++) {
          const lx = n === 1 ? 0 : (k - 0.5) * tw * 0.5;
          const [x, z] = loc(lx, sz * off);
          parts.push({ type: seats, x, z, rot: rot + (sz < 0 ? 0 : Math.PI) + (this.r() - 0.5) * 0.3 });
        }
    }
    const rects = parts.map(itemRect);
    // les sièges sont légèrement de biais : leur emprise est calculée sans rotation, avec une marge réduite
    if (!rects.every((rr) => this.free(rr, room, 0.05))) return false;
    for (let i = 0; i < parts.length; i++) {
      this.level.items.push(parts[i]);
      this.blocked.push(rects[i]);
    }
    return true;
  }
}

// ───────────────────────── génération ─────────────────────────

const half = (b: BuildingSpec) => ({ hw: b.w / 2, hd: b.d / 2 });

function shrink(r: Rect, t: number): Rect {
  return rect(r.x0 + t, r.x1 - t, r.z0 + t, r.z1 - t);
}

function makeLevel(index: number, name: string, y: number, h: number, outer: Rect, t: number): Level {
  return { index, name, y, h, outer, inner: shrink(outer, t), t, rooms: [], partitions: [], items: [], holes: [] };
}

/** Réserve autour d'une porte de cloison (des deux côtés). */
function doorClear(p: Partition, d: DoorGap, depth = 0.85): Rect {
  const dx = p.b[0] - p.a[0];
  const dz = p.b[1] - p.a[1];
  const len = Math.hypot(dx, dz);
  const ux = dx / len;
  const uz = dz / len;
  const cx = p.a[0] + ux * d.at;
  const cz = p.a[1] + uz * d.at;
  const hw = d.w / 2 + 0.15;
  return Math.abs(ux) > 0.5 ? rect(cx - hw, cx + hw, cz - depth, cz + depth) : rect(cx - depth, cx + depth, cz - hw, cz + hw);
}

/** Dégagement intérieur d'une ouverture de façade. */
function openingClear(l: Level, o: WallOpening, depth = 1.3): Rect {
  const hw = o.w / 2 + 0.2;
  const I = l.inner;
  if (o.side === 'front') return rect(o.at - hw, o.at + hw, I.z1 - depth, I.z1);
  if (o.side === 'back') return rect(o.at - hw, o.at + hw, I.z0, I.z0 + depth);
  if (o.side === 'left') return rect(I.x0, I.x0 + depth, o.at - hw, o.at + hw);
  return rect(I.x1 - depth, I.x1, o.at - hw, o.at + hw);
}

/**
 * Escalier droit le long d'un mur : `start` = pied de l'escalier, `dir` = sens de la montée. Réserve l'emprise
 * et un palier au pied (niveau de départ) et à l'arrivée (niveau d'arrivée), perce la trémie du niveau supérieur.
 */
function addStair(plan: Plan, fromIdx: number, toIdx: number, start: P2, dir: P2, width = STAIR_W, kind: 'stair' | 'ladder' = 'stair') {
  const from = plan.levels[fromIdx];
  const to = plan.levels[toIdx];
  const rise = to.y - from.y;
  const run = kind === 'ladder' ? 1.0 : stairRun(rise);
  const ex = start[0] + dir[0] * run;
  const ez = start[1] + dir[1] * run;
  const side: P2 = [Math.abs(dir[1]), Math.abs(dir[0])];
  const r = rect(start[0], ex, start[1], ez);
  const sr = rect(r.x0 - (side[0] * width) / 2, r.x1 + (side[0] * width) / 2, r.z0 - (side[1] * width) / 2, r.z1 + (side[1] * width) / 2);
  plan.stairs.push({ rect: sr, dir, from: fromIdx, rise, kind });
  // trémie : toute la volée (échappée suffisante), un peu plus large que l'escalier
  const hole = rect(sr.x0 - side[0] * 0.05, sr.x1 + side[0] * 0.05, sr.z0 - side[1] * 0.05, sr.z1 + side[1] * 0.05);
  to.holes.push(hole);
  return sr;
}

/** Zones à garder libres autour d'un escalier : pied (niveau bas), arrivée (niveau haut). */
function stairClearances(s: Stair, levels: Level[]): { level: number; r: Rect; furnitureOnly?: boolean }[] {
  const run = s.kind === 'ladder' ? 1.0 : stairRun(s.rise);
  void run;
  const R = s.rect;
  const out: { level: number; r: Rect; furnitureOnly?: boolean }[] = [];
  const L = 0.9;
  // pied : avant le début de la volée (côté opposé à `dir`)
  const foot =
    s.dir[0] > 0 ? rect(R.x0 - L, R.x0, R.z0, R.z1) : s.dir[0] < 0 ? rect(R.x1, R.x1 + L, R.z0, R.z1) : s.dir[1] > 0 ? rect(R.x0, R.x1, R.z0 - L, R.z0) : rect(R.x0, R.x1, R.z1, R.z1 + L);
  const top =
    s.dir[0] > 0 ? rect(R.x1, R.x1 + L, R.z0, R.z1) : s.dir[0] < 0 ? rect(R.x0 - L, R.x0, R.z0, R.z1) : s.dir[1] > 0 ? rect(R.x0, R.x1, R.z1, R.z1 + L) : rect(R.x0, R.x1, R.z0 - L, R.z0);
  // les paliers débordent sur les côtés : on doit pouvoir y tourner pour sortir (le palier d'arrivée est souvent
  // coincé contre un mur, la sortie se fait alors de côté) ; aucun meuble n'y est posé
  const wide = (q: Rect): Rect => (s.dir[0] !== 0 ? rect(q.x0, q.x1, q.z0 - 1.0, q.z1 + 1.0) : rect(q.x0 - 1.0, q.x1 + 1.0, q.z0, q.z1));
  out.push({ level: s.from, r: R }, { level: s.from, r: foot }, { level: s.from, r: wide(foot), furnitureOnly: true });
  const toIdx = levels.findIndex((l) => Math.abs(l.y - (levels[s.from].y + s.rise)) < 0.01);
  if (toIdx >= 0) out.push({ level: toIdx, r: R });
  if (toIdx >= 0 && s.kind === 'stair') out.push({ level: toIdx, r: top }, { level: toIdx, r: wide(top), furnitureOnly: true });
  return out;
}

/** Fenêtres régulières sur chaque façade, une ou deux par pièce, à l'écart des portes, cloisons et cheminée. */
function addWindows(plan: Plan, b: BuildingSpec, r: () => number, opts: { sides?: Side[]; y0?: number; y1?: number; w?: number; kind?: WallOpening['kind'] } = {}) {
  for (const l of plan.levels) {
    if (l.underground || l.name === 'Combles') continue;
    const sides = opts.sides ?? (['front', 'back', 'left', 'right'] as Side[]);
    for (const side of sides) {
      for (const room of l.rooms) {
        const R = room.rect;
        const I = l.inner;
        const touches = side === 'front' ? Math.abs(R.z1 - I.z1) < 0.05 : side === 'back' ? Math.abs(R.z0 - I.z0) < 0.05 : side === 'left' ? Math.abs(R.x0 - I.x0) < 0.05 : Math.abs(R.x1 - I.x1) < 0.05;
        if (!touches) continue;
        const [a0, a1] = side === 'front' || side === 'back' ? [R.x0, R.x1] : [R.z0, R.z1];
        const span = a1 - a0;
        if (span < 1.7) continue;
        const ww = opts.w ?? (l.index === 0 ? 0.95 : 0.85);
        const n = span > 5.2 ? 2 : 1;
        for (let k = 0; k < n; k++) {
          const at = n === 1 ? (a0 + a1) / 2 : a0 + (span * (k + 0.5)) / n;
          const clash = plan.openings.some((o) => o.level === l.index && o.side === side && Math.abs(o.at - at) < o.w / 2 + ww / 2 + 0.45);
          const nearChimney =
            plan.chimney && side === 'left' && at > plan.chimney.z0 - ww / 2 - 0.3 && at < plan.chimney.z1 + ww / 2 + 0.3;
          if (clash || nearChimney) continue;
          // pas de fenêtre au droit d'un escalier qui longe ce mur à mi-hauteur (on verrait les marches couper la baie)
          const y0 = opts.y0 ?? (l.index === 0 ? 1.0 : 0.95);
          const y1 = opts.y1 ?? Math.min(l.h - 0.45, y0 + 1.25);
          if (l.y + y1 > plan.wallTop - 0.15) continue;
          plan.openings.push({ level: l.index, side, at, w: ww, y0, y1, kind: opts.kind ?? 'window', lit: room.lit, shutters: r() < 0.55 });
        }
      }
    }
  }
}

/** Contour des niveaux d'un bâtiment courant (rez, étages en encorbellement, combles). */
function levelsFor(b: BuildingSpec, groundH: number, upperH: number, cellar: boolean): Level[] {
  const { hw, hd } = half(b);
  const out: Level[] = [];
  const tg = wallT(b.ground);
  const tu = wallT(b.upper);
  if (cellar) {
    const l = makeLevel(-1, 'Cave', -CELLAR_H, CELLAR_H, rect(-hw, hw, -hd, hd), tg);
    l.underground = true;
    out.push(l);
  }
  out.push(makeLevel(0, 'Rez-de-chaussée', 0, groundH, rect(-hw, hw, -hd, hd), tg));
  let y = groundH;
  for (let f = 1; f < b.floors; f++) {
    out.push(makeLevel(f, f === 1 ? '1er étage' : `${f}e étage`, y, upperH, rect(-hw, hw, -hd, hd + b.jetty), tu));
    y += upperH;
  }
  return out;
}

/** Combles : plancher posé sur les murs du dernier niveau (accessible ou non). */
function atticLevel(plan: Plan, top: Level): Level {
  const l = makeLevel(plan.levels.length, 'Combles', top.y + top.h, 2.2, top.outer, top.t);
  return l;
}

// ── maison ──

function housePlan(b: BuildingSpec, r: () => number): Plan {
  const levels = levelsFor(b, GROUND_H, UPPER_H, b.cellar);
  const top = levels[levels.length - 1];
  const plan: Plan = { levels, stairs: [], openings: [], chimney: null, wallTop: top.y + top.h, atticHatch: null, lights: [], ruined: b.kind === 'abandoned' };
  const g = levels.find((l) => l.index === 0)!;
  const I = g.inner;
  const xs = I.x0 + (I.x1 - I.x0) * (0.52 + r() * 0.08);
  const roomLit = () => r() < b.lit;

  // cheminée sur le mur gauche, dans la moitié arrière
  const cz = I.z0 + Math.min(1.9, (I.z1 - I.z0) * 0.3);
  plan.chimney = rect(g.outer.x0, I.x0 + 0.7, cz - 0.65, cz + 0.65);

  // porte d'entrée dans la salle commune (gauche), à l'écart de la cloison
  const doorX = Math.min(xs - 0.95, (I.x0 + xs) / 2 + 0.4);
  plan.openings.push({ level: 0, side: 'front', at: doorX, w: 1.05, y0: 0, y1: 2.15, kind: 'door', shutters: true });
  // porte de derrière vers le jardin
  if (b.garden) plan.openings.push({ level: 0, side: 'back', at: (xs + I.x1) / 2, w: 0.9, y0: 0, y1: 2.05, kind: 'door', shutters: true });

  // escaliers : 1re volée contre le mur droit (montée vers l'avant), 2e volée contre la cloison (montée vers l'arrière) ;
  // chaque volée garde un palier libre à ses deux extrémités
  const stairLevels = levels.filter((l) => !l.underground);
  const three = stairLevels.length >= 3;
  for (let i = 0; i < stairLevels.length; i++) {
    const l = stairLevels[i];
    const isTop = i === stairLevels.length - 1;
    l.rooms.push({ name: i === 0 ? 'Salle commune' : 'Chambre', type: i === 0 ? 'salle' : 'chambre', rect: rect(l.inner.x0, xs - INT_T / 2, l.inner.z0, l.inner.z1), lit: roomLit() });
    const rightType: RoomType = i === 0 ? 'cuisine' : isTop ? 'chambre' : 'palier';
    l.rooms.push({ name: i === 0 ? 'Cuisine' : rightType === 'palier' ? 'Palier et rangement' : 'Petite chambre', type: rightType, rect: rect(xs + INT_T / 2, l.inner.x1, l.inner.z0, l.inner.z1), lit: roomLit() });
    const pl = l.inner.z1 - l.inner.z0;
    // porte de cloison : à l'écart des volées et des trémies
    // (3 niveaux : aux étages, la 2e volée longe la cloison côté arrière → porte côté façade)
    const doorAt = i === 0 ? (b.cellar ? 1.0 : pl * 0.32) : three ? pl - 0.7 : pl * 0.5;
    l.partitions.push({ a: [xs, l.inner.z0], b: [xs, l.inner.z1], doors: [{ at: doorAt, w: 1.0, h: 2.0 }], kind: 'wall' });
  }
  for (let i = 0; i < stairLevels.length - 1; i++) {
    const from = levels.indexOf(stairLevels[i]);
    const to = levels.indexOf(stairLevels[i + 1]);
    const l = stairLevels[i];
    const run = stairRun(stairLevels[i + 1].y - l.y);
    if (i === 0) addStair(plan, from, to, [l.inner.x1 - STAIR_W / 2 - 0.02, l.inner.z0 + 0.9], [0, 1]);
    else addStair(plan, from, to, [xs + INT_T / 2 + STAIR_W / 2 + 0.05, l.inner.z0 + 0.9 + run], [0, -1]);
  }
  // combles accessibles par une échelle (maisons de plain-pied, maison abandonnée)
  if (stairLevels.length === 1 || b.kind === 'abandoned') {
    const attic = atticLevel(plan, top);
    attic.rooms.push({ name: 'Grenier', type: 'grenier', rect: attic.inner, lit: false });
    levels.push(attic);
    const tl = stairLevels[stairLevels.length - 1];
    // l'échelle monte vers le centre de la maison : on débouche dans le grenier, pas contre le mur du fond
    const s = addStair(plan, levels.indexOf(tl), levels.length - 1, [xs - INT_T / 2 - 0.4, tl.inner.z0 + 1.0], [0, 1], 0.6, 'ladder');
    plan.atticHatch = s;
  }
  // cave : escalier le long de la cloison, côté cuisine, qui remonte vers l'arrière
  if (b.cellar) {
    const c = levels[0];
    c.rooms.push({ name: 'Cave', type: 'cave', rect: c.inner, lit: false });
    const run = stairRun(CELLAR_H);
    addStair(plan, 0, 1, [xs + INT_T / 2 + STAIR_W / 2 + 0.05, c.inner.z1 - 0.9], [0, -1]);
    void run;
  }
  addWindows(plan, b, r);
  return plan;
}

// ── taverne ──

function tavernPlan(b: BuildingSpec, r: () => number): Plan {
  const levels = levelsFor(b, 3.4, UPPER_H, true);
  const top = levels[levels.length - 1];
  const plan: Plan = { levels, stairs: [], openings: [], chimney: null, wallTop: top.y + top.h, atticHatch: null, lights: [], ruined: false };
  const [cellar, g, u] = levels;
  const I = g.inner;
  const kx = I.x1 - 4.2; // cuisine à l'arrière droit
  const kz = I.z0 + 4.4;
  const czc = (I.z0 + I.z1) / 2 + 0.6;
  plan.chimney = rect(g.outer.x0, I.x0 + 0.8, czc - 0.8, czc + 0.8);
  g.rooms.push({ name: 'Grande salle', type: 'salle-taverne', rect: rect(I.x0, I.x1, kz + INT_T / 2, I.z1), lit: true });
  g.rooms.push({ name: 'Salle du fond', type: 'salle-taverne', rect: rect(I.x0, kx - INT_T / 2, I.z0, kz - INT_T / 2), lit: true });
  g.rooms.push({ name: 'Cuisine', type: 'cuisine-taverne', rect: rect(kx + INT_T / 2, I.x1, I.z0, kz - INT_T / 2), lit: true });
  // la grande salle et la salle du fond communiquent par une large arcade
  g.partitions.push({ a: [I.x0, kz], b: [kx, kz], doors: [{ at: (kx - I.x0) * 0.5, w: 3.2, h: 2.4 }], kind: 'wall' });
  g.partitions.push({ a: [kx, I.z0], b: [kx, kz], doors: [{ at: (kz - I.z0) * 0.5, w: 0.95, h: 2.05 }], kind: 'wall' });
  g.partitions.push({ a: [kx, kz], b: [I.x1, kz], doors: [{ at: 1.2, w: 0.95, h: 2.05 }], kind: 'wall' });
  plan.openings.push({ level: 0, side: 'front', at: -1.2, w: 1.5, y0: 0, y1: 2.4, kind: 'door', shutters: true });
  plan.openings.push({ level: 0, side: 'right', at: I.z0 + 1.6, w: 0.95, y0: 0, y1: 2.1, kind: 'door', shutters: true });
  // escalier vers l'étage : contre le mur du fond de la salle du fond, montée vers la droite
  addStair(plan, 1, 2, [I.x0 + 1.4, I.z0 + STAIR_W / 2 + 0.02], [1, 0]);
  // cave : escalier dans la cuisine, contre le mur droit, qui remonte vers l'avant
  addStair(plan, 0, 1, [I.x1 - STAIR_W / 2 - 0.02, I.z0 + 0.05], [0, 1]);
  cellar.rooms.push({ name: 'Cave à vin et à bière', type: 'cave', rect: cellar.inner, lit: true });
  // étage : couloir central (axe x) et chambres de part et d'autre
  const U = u.inner;
  const cz0 = U.z0 + 3.0;
  const cz1 = cz0 + 1.4;
  u.rooms.push({ name: 'Couloir', type: 'palier', rect: rect(U.x0, U.x1, cz0 + INT_T / 2, cz1 - INT_T / 2), lit: true });
  const nFront = 3;
  const wF = (U.x1 - U.x0) / nFront;
  for (let k = 0; k < nFront; k++) {
    const x0 = U.x0 + k * wF;
    u.rooms.push({ name: `Chambre ${k + 1}`, type: 'chambre-auberge', rect: rect(x0 + (k ? INT_T / 2 : 0), x0 + wF - (k < nFront - 1 ? INT_T / 2 : 0), cz1 + INT_T / 2, U.z1), lit: r() < 0.6 });
    if (k > 0) u.partitions.push({ a: [x0, cz1], b: [x0, U.z1], doors: [], kind: 'wall' });
  }
  const backXs = [U.x0, U.x0 + 7.2, U.x1];
  u.rooms.push({ name: 'Palier', type: 'palier', rect: rect(backXs[0], backXs[1] - INT_T / 2, U.z0, cz0 - INT_T / 2), lit: true });
  u.rooms.push({ name: "Chambre de l'aubergiste", type: 'chambre', rect: rect(backXs[1] + INT_T / 2, backXs[2], U.z0, cz0 - INT_T / 2), lit: true });
  u.partitions.push({ a: [U.x0, cz1], b: [U.x1, cz1], doors: [0, 1, 2].map((k) => ({ at: k * wF + wF / 2, w: 1.0, h: 2.0 })), kind: 'wall' });
  // le palier s'ouvre sur le couloir ; la chambre de l'aubergiste a sa porte
  u.partitions.push({ a: [backXs[1], cz0], b: [U.x1, cz0], doors: [{ at: 1.0, w: 1.0, h: 2.0 }], kind: 'wall' });
  u.partitions.push({ a: [backXs[1], U.z0], b: [backXs[1], cz0], doors: [], kind: 'wall' });
  addWindows(plan, b, r);
  plan.lights.push({ x: I.x0 + 0.9, y: 0.6, z: czc, color: '#ff8a3a', intensity: 9, distance: 9, flicker: true });
  plan.lights.push({ x: (I.x0 + I.x1) / 2, y: 2.6, z: (kz + I.z1) / 2, color: '#ffb766', intensity: 7, distance: 11, flicker: true });
  return plan;
}

// ── forge ──

function forgePlan(b: BuildingSpec, r: () => number): Plan {
  const levels = levelsFor(b, 3.6, UPPER_H, false);
  const top = levels[levels.length - 1];
  const plan: Plan = { levels, stairs: [], openings: [], chimney: null, wallTop: top.y + top.h, atticHatch: null, lights: [], ruined: false };
  const [g, u] = levels;
  const I = g.inner;
  const xs = I.x1 - 4.0;
  g.rooms.push({ name: 'Atelier', type: 'atelier-forge', rect: rect(I.x0, xs - INT_T / 2, I.z0, I.z1), lit: true });
  g.rooms.push({ name: 'Réserve de fer et de charbon', type: 'reserve-forge', rect: rect(xs + INT_T / 2, I.x1, I.z0, I.z1), lit: false });
  g.partitions.push({ a: [xs, I.z0], b: [xs, I.z1], doors: [{ at: (I.z1 - I.z0) * 0.7, w: 1.0, h: 2.1 }], kind: 'wall' });
  // cheminée de forge : contre le mur du fond de l'atelier
  const hx = I.x0 + 2.6;
  plan.chimney = null;
  plan.openings.push({ level: 0, side: 'front', at: (I.x0 + xs) / 2 - 0.4, w: 3.4, y0: 0, y1: 2.8, kind: 'big-door', shutters: true });
  plan.openings.push({ level: 0, side: 'front', at: xs + 2.0, w: 1.0, y0: 0, y1: 2.1, kind: 'door', shutters: true });
  // étage : logement du forgeron, accès par un escalier dans la réserve
  const U = u.inner;
  const us = U.x0 + (U.x1 - U.x0) * 0.55;
  u.rooms.push({ name: 'Salle du forgeron', type: 'salle', rect: rect(U.x0, us - INT_T / 2, U.z0, U.z1), lit: true });
  u.rooms.push({ name: 'Chambre du forgeron', type: 'chambre', rect: rect(us + INT_T / 2, U.x1, U.z0, U.z1), lit: r() < 0.5 });
  u.partitions.push({ a: [us, U.z0], b: [us, U.z1], doors: [{ at: (U.z1 - U.z0) * 0.5, w: 1.0, h: 2.0 }], kind: 'wall' });
  addStair(plan, 0, 1, [I.x1 - STAIR_W / 2 - 0.02, I.z0 + 0.9], [0, 1]);
  addWindows(plan, b, r, {});
  plan.lights.push({ x: hx, y: 1.2, z: I.z0 + 1.0, color: '#ff6a1a', intensity: 14, distance: 12, flicker: true });
  return plan;
}

// ── boutiques (apothicaire, échoppe, boulangerie) ──

function shopPlan(b: BuildingSpec, r: () => number): Plan {
  const plan = housePlan({ ...b, garden: b.garden }, r);
  const g = plan.levels.find((l) => l.index === 0)!;
  const shopType: RoomType = b.kind === 'apothecary' ? 'boutique-apothicaire' : b.kind === 'bakery' ? 'fournil' : 'boutique';
  g.rooms[0] = { ...g.rooms[0], name: b.kind === 'apothecary' ? 'Officine' : b.kind === 'bakery' ? 'Fournil et boutique' : 'Boutique', type: shopType, lit: true };
  g.rooms[1] = { ...g.rooms[1], name: 'Arrière-boutique', type: 'reserve' };
  // vitrine : large baie à volets à côté de la porte
  for (const o of plan.openings) if (o.level === 0 && o.side === 'front' && o.kind === 'window') {
    o.w = 1.5;
    o.y0 = 0.85;
    o.lit = true;
  }
  if (b.kind === 'bakery') plan.lights.push({ x: g.inner.x0 + 1.0, y: 0.9, z: plan.chimney ? (plan.chimney.z0 + plan.chimney.z1) / 2 : 0, color: '#ff7a2a', intensity: 8, distance: 8, flicker: true });
  return plan;
}

// ── église ──

function churchPlan(b: BuildingSpec, r: () => number): Plan {
  const { hw, hd } = half(b);
  const t = 0.8;
  const nave = makeLevel(0, 'Nef', 0, 9.5, rect(-hw, hw, -hd, hd), t);
  const plan: Plan = { levels: [nave], stairs: [], openings: [], chimney: null, wallTop: 9.5, atticHatch: null, lights: [], ruined: false };
  const I = nave.inner;
  const choirZ = I.z0 + 4.5;
  nave.rooms.push({ name: 'Nef', type: 'nef', rect: rect(I.x0, I.x1, choirZ, I.z1), lit: true });
  nave.rooms.push({ name: 'Chœur', type: 'choeur', rect: rect(I.x0, I.x1, I.z0, choirZ), lit: true });
  // le clocher-porche, devant la façade : niveaux superposés reliés par des échelles
  const tw = 2.6;
  const tz0 = hd;
  const tz1 = hd + CHURCH_TOWER_DEPTH;
  const tt = 0.7;
  const towerLevels: [string, number, number][] = [['Porche du clocher', 0, 4.6], ['Chambre des cordes', 4.6, 4.4], ['Salle de la charpente', 9.0, 4.4], ['Chambre des cloches', 13.4, 4.6]];
  for (const [name, y, h] of towerLevels) {
    const l = makeLevel(plan.levels.length, name, y, h, rect(-tw, tw, tz0, tz1), tt);
    // le mur commun avec la nef n'est pas doublé : l'intérieur du clocher commence au nu de la façade
    l.inner = rect(-tw + tt, tw - tt, tz0 + 0.1, tz1 - tt);
    if (y === 0) l.skipWalls = ['back'];
    l.rooms.push({ name, type: y === 0 ? 'porche' : 'clocher', rect: l.inner, lit: y === 0 });
    plan.levels.push(l);
  }
  for (let k = 1; k < towerLevels.length; k++) addStair(plan, k, k + 1, [(k % 2 ? 1 : -1) * (tw - tt - 0.45), tz1 - tt - 0.35], [0, -1], 0.6, 'ladder');
  plan.wallTop = 9.5;
  // portes : portail du clocher (façade), passage clocher → nef, porte latérale
  plan.openings.push({ level: 1, side: 'front', at: 0, w: 1.8, y0: 0, y1: 3.4, kind: 'arch', shutters: true });
  plan.openings.push({ level: 0, side: 'front', at: 0, w: 2.0, y0: 0, y1: 3.6, kind: 'arch', shutters: false });
  plan.openings.push({ level: 0, side: 'right', at: I.z1 - 4.0, w: 1.1, y0: 0, y1: 2.5, kind: 'arch', shutters: true });
  // baies hautes en arc brisé, verrière du chœur, abat-sons du clocher
  for (let k = 0; k < 4; k++) {
    const z = choirZ + 1.6 + k * ((I.z1 - choirZ - 3) / 3.2);
    for (const side of ['left', 'right'] as Side[])
      if (!(side === 'right' && Math.abs(z - (I.z1 - 4.0)) < 1.5)) plan.openings.push({ level: 0, side, at: z, w: 1.1, y0: 3.0, y1: 7.2, kind: 'lancet', lit: true });
  }
  plan.openings.push({ level: 0, side: 'back', at: 0, w: 1.8, y0: 3.4, y1: 8.0, kind: 'lancet', lit: true });
  for (const side of ['front', 'left', 'right', 'back'] as Side[]) plan.openings.push({ level: 4, side, at: side === 'left' || side === 'right' ? (tz0 + tz1) / 2 : 0, w: 1.3, y0: 1.2, y1: 3.8, kind: 'belfry' });
  plan.openings.push({ level: 2, side: 'front', at: 0, w: 0.5, y0: 1.4, y1: 2.6, kind: 'lancet', lit: false });
  plan.lights.push({ x: 0, y: 2.2, z: I.z0 + 2.2, color: '#ffc27a', intensity: 7, distance: 12, flicker: true });
  plan.lights.push({ x: 0, y: 3.5, z: (choirZ + I.z1) / 2, color: '#ffb366', intensity: 5, distance: 14, flicker: true });
  void r;
  return plan;
}

// ── poste du shérif ──

function sheriffPlan(b: BuildingSpec, r: () => number): Plan {
  const levels = levelsFor(b, GROUND_H, UPPER_H, false);
  const plan: Plan = { levels, stairs: [], openings: [], chimney: null, wallTop: levels[1].y + levels[1].h, atticHatch: null, lights: [], ruined: false };
  const [g, u] = levels;
  const I = g.inner;
  const zb = I.z0 + 3.0; // cellule et réserve à l'arrière
  const xc = I.x0 + 3.6;
  plan.chimney = rect(g.outer.x0, I.x0 + 0.7, zb + 0.6, zb + 1.9);
  g.rooms.push({ name: 'Bureau du shérif', type: 'bureau-sherif', rect: rect(I.x0, I.x1, zb + INT_T / 2, I.z1), lit: true });
  g.rooms.push({ name: 'Cellule', type: 'cellule', rect: rect(I.x0, xc - INT_T / 2, I.z0, zb - INT_T / 2), lit: false });
  g.rooms.push({ name: 'Réserve et armurerie', type: 'reserve', rect: rect(xc + INT_T / 2, I.x1, I.z0, zb - INT_T / 2), lit: false });
  g.partitions.push({ a: [I.x0, zb], b: [xc, zb], doors: [{ at: 1.6, w: 1.0, h: 2.0 }], kind: 'bars' });
  g.partitions.push({ a: [xc, zb], b: [I.x1, zb], doors: [{ at: 0.8, w: 1.0, h: 2.0 }], kind: 'wall' });
  g.partitions.push({ a: [xc, I.z0], b: [xc, zb], doors: [], kind: 'wall' });
  plan.openings.push({ level: 0, side: 'front', at: 0.6, w: 1.2, y0: 0, y1: 2.3, kind: 'door', shutters: true });
  // étage : archives et logement
  const U = u.inner;
  const us = U.x0 + 4.0;
  u.rooms.push({ name: 'Archives', type: 'archives', rect: rect(U.x0, us - INT_T / 2, U.z0, U.z1), lit: r() < 0.6 });
  u.rooms.push({ name: 'Chambre du shérif', type: 'chambre', rect: rect(us + INT_T / 2, U.x1, U.z0, U.z1), lit: true });
  u.partitions.push({ a: [us, U.z0], b: [us, U.z1], doors: [{ at: (U.z1 - U.z0) * 0.72, w: 1.0, h: 2.0 }], kind: 'wall' });
  addStair(plan, 0, 1, [I.x1 - STAIR_W / 2 - 0.02, I.z1 - 0.9], [0, -1]);
  addWindows(plan, b, r);
  // la cellule n'a qu'un soupirail
  for (const o of plan.openings) if (o.level === 0 && o.kind === 'window' && o.side === 'back' && o.at < xc) {
    o.w = 0.5;
    o.y0 = 1.8;
    o.y1 = 2.3;
    o.shutters = false;
  }
  plan.lights.push({ x: I.x0 + 0.9, y: 0.6, z: zb + 1.25, color: '#ff8a3a', intensity: 5, distance: 7, flicker: true });
  return plan;
}

// ── écuries ──

function stablePlan(b: BuildingSpec, r: () => number): Plan {
  const { hw, hd } = half(b);
  const t = wallT(b.ground);
  const g = makeLevel(0, 'Écurie', 0, 3.4, rect(-hw, hw, -hd, hd), t);
  const loft = makeLevel(1, 'Fenil', 3.4, 2.4, rect(-hw, hw, -hd, hd), t);
  const plan: Plan = { levels: [g, loft], stairs: [], openings: [], chimney: null, wallTop: 3.4 + 0.6, atticHatch: null, lights: [], ruined: false };
  const I = g.inner;
  const xs = I.x1 - 3.4;
  g.rooms.push({ name: 'Stalles', type: 'ecurie', rect: rect(I.x0, xs - INT_T / 2, I.z0, I.z1), lit: true });
  g.rooms.push({ name: 'Sellerie', type: 'sellerie', rect: rect(xs + INT_T / 2, I.x1, I.z0, I.z1), lit: false });
  g.partitions.push({ a: [xs, I.z0], b: [xs, I.z1], doors: [{ at: (I.z1 - I.z0) * 0.72, w: 1.0, h: 2.1 }], kind: 'wall' });
  plan.openings.push({ level: 0, side: 'front', at: (I.x0 + xs) / 2, w: 3.0, y0: 0, y1: 2.9, kind: 'big-door', shutters: true });
  plan.openings.push({ level: 0, side: 'front', at: xs + 1.7, w: 1.0, y0: 0, y1: 2.1, kind: 'door', shutters: true });
  // fenil : plancher sur la moitié arrière, échelle depuis la sellerie
  const L = loft.inner;
  loft.partialFloor = [rect(L.x0, L.x1, L.z0, L.z0 + 3.4)];
  loft.rooms.push({ name: 'Fenil', type: 'fenil', rect: rect(L.x0, L.x1, L.z0, L.z0 + 3.4), lit: false });
  addStair(plan, 0, 1, [I.x1 - 0.5, I.z0 + 2.2], [0, -1], 0.6, 'ladder');
  addWindows(plan, b, r, { sides: ['back', 'left', 'right'], y0: 1.7, y1: 2.5, w: 0.8 });
  plan.lights.push({ x: (I.x0 + xs) / 2, y: 2.6, z: (I.z0 + I.z1) / 2 + 1.2, color: '#ffa850', intensity: 4, distance: 9, flicker: true });
  return plan;
}

// ── grange ──

function barnPlan(b: BuildingSpec, r: () => number): Plan {
  const { hw, hd } = half(b);
  const t = wallT(b.ground);
  const g = makeLevel(0, 'Grange', 0, 3.6, rect(-hw, hw, -hd, hd), t);
  const loft = makeLevel(1, 'Fenil', 3.6, 2.6, rect(-hw, hw, -hd, hd), t);
  const plan: Plan = { levels: [g, loft], stairs: [], openings: [], chimney: null, wallTop: 3.6 + 1.6, atticHatch: null, lights: [], ruined: false };
  const I = g.inner;
  g.rooms.push({ name: 'Aire de la grange', type: 'grange', rect: I, lit: false });
  const L = loft.inner;
  loft.partialFloor = [rect(L.x0, L.x1, L.z0, L.z0 + 5.5)];
  loft.rooms.push({ name: 'Fenil', type: 'fenil', rect: rect(L.x0, L.x1, L.z0, L.z0 + 5.5), lit: false });
  plan.openings.push({ level: 0, side: 'front', at: 0, w: 3.8, y0: 0, y1: 3.3, kind: 'big-door', shutters: true });
  plan.openings.push({ level: 0, side: 'back', at: I.x0 + 1.6, w: 1.0, y0: 0, y1: 2.1, kind: 'door', shutters: true });
  // l'échelle arrive au ras du plancher du fenil (au-delà, pas de plancher : on tomberait)
  addStair(plan, 0, 1, [I.x1 - 0.5, I.z0 + 6.5], [0, -1], 0.6, 'ladder');
  plan.openings.push({ level: 1, side: 'front', at: 0, w: 1.4, y0: 0.4, y1: 1.4, kind: 'window', shutters: true });
  void r;
  return plan;
}

// ───────────────────────── ameublement ─────────────────────────

function furnish(plan: Plan, b: BuildingSpec, r: () => number) {
  const ruined = plan.ruined;
  const tilt = () => (ruined && r() < 0.45 ? 0.6 + r() * 1.0 : undefined);
  const levelIdx = (l: Level) => plan.levels.indexOf(l);
  for (const l of plan.levels) {
    const f = new Furnisher(l, r);
    const li = levelIdx(l);
    // réserves : escaliers (emprise + paliers), trémies, cheminée, portes
    for (const s of plan.stairs) for (const c of stairClearances(s, plan.levels)) if (c.level === li) f.block(c.r);
    for (const h of l.holes) f.block(rect(h.x0 - 0.15, h.x1 + 0.15, h.z0 - 0.15, h.z1 + 0.15));
    if (plan.chimney && !l.underground && l.name !== 'Combles') f.block(rect(plan.chimney.x0, plan.chimney.x1 + (l.index === 0 ? 0.9 : 0.1), plan.chimney.z0 - 0.1, plan.chimney.z1 + 0.1));
    for (const o of plan.openings) if (o.level === l.index && (o.kind === 'door' || o.kind === 'big-door' || o.kind === 'arch')) f.block(openingClear(l, o, o.kind === 'big-door' ? 3.2 : 1.3));
    for (const p of l.partitions) for (const d of p.doors) f.block(doorClear(p, d));
    // emprise des cloisons elles-mêmes
    for (const p of l.partitions) {
      const th = INT_T / 2 + 0.02;
      f.block(rect(Math.min(p.a[0], p.b[0]) - th, Math.max(p.a[0], p.b[0]) + th, Math.min(p.a[1], p.b[1]) - th, Math.max(p.a[1], p.b[1]) + th));
    }
    // plancher partiel : rien hors des zones portées
    if (l.partialFloor) {
      const pf = l.partialFloor[0];
      f.block(rect(l.inner.x0 - 1, l.inner.x1 + 1, pf.z1, l.inner.z1 + 1));
    }

    for (const room of l.rooms) fillRoom(f, room, l, plan, b, r, tilt);
  }
}

function fillRoom(f: Furnisher, room: Room, l: Level, plan: Plan, b: BuildingSpec, r: () => number, tilt: () => number | undefined) {
  const R = room.rect;
  const W = R.x1 - R.x0;
  const D = R.z1 - R.z0;
  const ruined = plan.ruined;
  const put = (type: FurnType, sides?: Side[], o: { y?: number; gap?: number } = {}) => f.wall(room, type, sides, { ...o, tilt: tilt() });
  switch (room.type) {
    case 'salle': {
      if (!ruined) {
        const seat = r() < 0.5 ? 'bench' : 'chair';
        const rot = W >= D ? 0 : Math.PI / 2;
        const placed = [0.55, 0.65, 0.45, 0.75].some((k) => f.dining(room, [R.x0 + W / 2, R.z0 + D * k], rot, seat));
        if (!placed) [0.6, 0.45, 0.75].some((k) => f.dining(room, [R.x0 + W / 2, R.z0 + D * k], 0, 'stool', 'tableRound'));
      }
      else {
        f.center(room, 'table', { tilt: 0.3, m: 0.2 });
        f.center(room, 'chair', { dx: 1.2, dz: 0.6, rot: 1.2, tilt: 1.4, m: 0.1 });
        f.center(room, 'debris', { dx: -1, dz: -0.8, m: 0.05 });
      }
      put('cupboard', ['back', 'right']);
      put('chest', ['front', 'left', 'back']);
      put('shelf', ['right', 'back']);
      if (r() < 0.6) put('spinningWheel', ['front', 'left']);
      put('barrel', ['back', 'front']);
      if (!ruined) f.center(room, 'rug', { dz: D * 0.05, m: 0.02 });
      break;
    }
    case 'cuisine': {
      put('workbench', ['back', 'right']);
      put('shelf', ['right', 'back', 'front']);
      put('barrel', ['back', 'front', 'right']);
      put('sacks', ['front', 'back', 'right']);
      put('bucket', ['front', 'right', 'back']);
      put('firewood', ['left', 'front', 'back']);
      if (W > 2.6 && D > 3.2 && !ruined) f.center(room, 'tableSmall', { m: 0.45 });
      if (ruined) f.center(room, 'debris', { m: 0.05 });
      break;
    }
    case 'chambre':
    case 'chambre-auberge': {
      const bedType: FurnType = room.type === 'chambre' && W > 3 && D > 3.3 ? 'bedDouble' : 'bed';
      if (!put(bedType, ['back', 'left', 'right', 'front'])) put('bedroll');
      put('chest', ['front', 'right', 'left', 'back']);
      if (room.type === 'chambre') put('wardrobe', ['right', 'left', 'front', 'back']);
      put('tableSmall', ['left', 'right', 'front']);
      put('stool', ['front', 'left', 'right']);
      if (ruined) f.center(room, 'debris', { m: 0.05 });
      break;
    }
    case 'palier':
      put('chest', ['left', 'front', 'back']);
      put('crate', ['front', 'left']);
      break;
    case 'reserve':
      put('shelf', ['back', 'right', 'left']);
      put('crates', ['back', 'left', 'right', 'front']);
      put('barrel', ['right', 'left', 'front', 'back']);
      put('barrel', ['right', 'left', 'front', 'back']);
      put('sacks', ['front', 'left', 'back']);
      put('crate', ['front', 'back', 'left']);
      if (b.kind === 'sheriff') put('weaponRack', ['left', 'right', 'back']);
      break;
    case 'grenier':
      put('crates', ['back', 'front']);
      put('chest', ['front', 'back']);
      put('sacks', ['back', 'front']);
      put('hayBale', ['back', 'front']);
      if (ruined) f.center(room, 'debris', { m: 0.05 });
      break;
    case 'cave':
      put('barrelRack', ['back', 'left', 'right']);
      put('barrelRack', ['left', 'right', 'back', 'front']);
      put('wineRack', ['right', 'left', 'back', 'front']);
      put('crates', ['front', 'back', 'left']);
      put('sacks', ['front', 'right', 'left']);
      put('barrel', ['front', 'back', 'left', 'right']);
      if (ruined) f.center(room, 'debris', { m: 0.05 });
      break;
    case 'salle-taverne': {
      if (room.name === 'Grande salle') {
        // comptoir face à l'entrée, étagères et tonneaux derrière
        const behind = f.wall(room, 'barrelRack', ['right'], { gap: 0.04 });
        const cx = behind ? behind.x - 1.35 : R.x1 - 1.6;
        const cz = behind ? behind.z : (R.z0 + R.z1) / 2;
        f.tryPut(room, { type: 'counter', x: cx, z: cz, rot: Math.PI / 2 }, 0.05);
        // tables : grille régulière dans la salle, à l'écart du comptoir et de l'âtre
        const xA = R.x0 + 2.4;
        const cols = Math.max(1, Math.floor((cx - 1.2 - xA) / 3.0) + 1);
        for (let i = 0; i < cols; i++)
          for (const zz of [R.z0 + 1.3, R.z0 + 3.6]) f.dining(room, [xA + i * 3.0, zz], 0, i % 2 ? 'stool' : 'bench');
        put('barrel', ['front', 'left']);
        f.wall(room, 'noticeBoard', ['front'], { y: 1.3 });
      } else {
        f.dining(room, [R.x0 + 1.4, (R.z0 + R.z1) / 2 + 0.3], Math.PI / 2, 'chair', 'tableRound');
        put('shelf', ['back', 'left']);
        put('barrel', ['back', 'left', 'front']);
        put('crates', ['front', 'back']);
      }
      break;
    }
    case 'cuisine-taverne':
      put('workbench', ['back', 'right', 'left']);
      put('shelf', ['left', 'back', 'right']);
      put('barrel', ['right', 'back']);
      put('sacks', ['right', 'front', 'back']);
      put('tub', ['left', 'front', 'right']);
      put('firewood', ['front', 'left']);
      f.center(room, 'tableSmall', { m: 0.4 });
      break;
    case 'atelier-forge': {
      const hearth = f.wall(room, 'forgeHearth', ['back']);
      if (hearth) {
        f.tryPut(room, { type: 'bellows', x: hearth.x - 1.55, z: hearth.z - 0.15, rot: 0 }, 0.05);
        f.tryPut(room, { type: 'anvil', x: hearth.x + 0.2, z: hearth.z + 1.9, rot: 0 }, 0.3);
        f.tryPut(room, { type: 'quench', x: hearth.x + 2.0, z: hearth.z + 0.15, rot: 0 }, 0.05);
      }
      put('toolRack', ['left', 'back']);
      put('grindstone', ['left', 'front', 'back']);
      put('workbench', ['right', 'left', 'front']);
      put('coal', ['back', 'left', 'right']);
      put('barrel', ['front', 'left', 'right']);
      break;
    }
    case 'reserve-forge':
      put('toolRack', ['left', 'right', 'back']);
      put('crates', ['back', 'right', 'left']);
      put('coal', ['right', 'back', 'left']);
      put('barrel', ['front', 'left', 'right', 'back']);
      put('sacks', ['front', 'right', 'left']);
      break;
    case 'boutique-apothicaire':
      put('jarShelf', ['back']);
      f.counter(room);
      put('jarShelf', ['left', 'right']);
      put('herbRack', ['right', 'front', 'left'], { y: 1.5 });
      put('mortarTable', ['right', 'left', 'back']);
      put('barrel', ['front', 'right', 'left']);
      put('crate', ['right', 'front', 'back']);
      break;
    case 'boutique':
      put('shelf', ['back']);
      f.counter(room);
      put('shelf', ['left', 'right']);
      put('crates', ['left', 'right', 'back']);
      put('sacks', ['front', 'left', 'right']);
      put('barrel', ['front', 'right', 'left']);
      break;
    case 'fournil':
      put('oven', ['back', 'right', 'front']);
      f.counter(room, 'workbench');
      put('breadRack', ['right', 'back', 'left', 'front']);
      put('sacks', ['right', 'left', 'front']);
      put('sacks', ['front', 'right', 'left']);
      put('firewood', ['left', 'right', 'front']);
      break;
    case 'nef': {
      // deux rangées de bancs, allée centrale
      const n = Math.floor((D - 3.2) / 1.05);
      for (let k = 0; k < n; k++) {
        const z = R.z0 + 1.0 + k * 1.05;
        for (const sx of [-1, 1]) f.tryPut(room, { type: 'pew', x: sx * (FURN.pew[0] / 2 + 0.75), z, rot: Math.PI }, 0.02);
      }
      f.tryPut(room, { type: 'font', x: R.x0 + 1.1, z: R.z1 - 1.0, rot: 0 }, 0.05);
      for (const sx of [-1, 1]) f.tryPut(room, { type: 'candelabra', x: sx * (W / 2 - 0.5), z: R.z0 + 0.5, rot: 0 }, 0.02);
      break;
    }
    case 'choeur':
      f.tryPut(room, { type: 'altar', x: 0, z: R.z0 + 1.6, rot: 0 }, 0.05);
      f.tryPut(room, { type: 'lectern', x: W / 2 - 1.6, z: R.z1 - 0.9, rot: -Math.PI / 4 }, 0.05);
      for (const sx of [-1, 1]) f.tryPut(room, { type: 'candelabra', x: sx * 1.6, z: R.z0 + 1.2, rot: 0 }, 0.02);
      f.wall(room, 'bench', ['left', 'right']);
      f.wall(room, 'bench', ['right', 'left']);
      break;
    case 'porche':
      f.wall(room, 'bench', ['left', 'right']);
      f.wall(room, 'noticeBoard', ['right', 'left'], { y: 1.3 });
      break;
    case 'clocher':
      put('crate', ['back', 'left']);
      break;
    case 'bureau-sherif': {
      const desk = f.center(room, 'desk', { dz: -D * 0.15, rot: 0, m: 0.6 });
      if (desk) f.tryPut(room, { type: 'chair', x: desk.x, z: desk.z - 0.75, rot: 0 }, 0.02);
      put('weaponRack', ['right', 'back']);
      f.wall(room, 'noticeBoard', ['left', 'back', 'right'], { y: 1.3 });
      put('cupboard', ['back', 'right', 'left']);
      put('chest', ['right', 'left']);
      put('bench', ['front', 'left']);
      break;
    }
    case 'cellule':
      put('cot', ['left', 'back']);
      put('bucket', ['back', 'right', 'left']);
      break;
    case 'archives':
      put('shelf', ['back']);
      put('shelf', ['left', 'back', 'front']);
      put('shelf', ['front', 'left']);
      f.center(room, 'table', { m: 0.45 });
      put('chest', ['right', 'front', 'back']);
      break;
    case 'ecurie': {
      // stalles le long du mur du fond : séparations, mangeoires, litière
      const n = Math.floor(W / 2.4);
      for (let k = 0; k <= n; k++) {
        const x = R.x0 + 0.1 + k * ((W - 0.2) / n);
        f.tryPut(room, { type: 'stallDivider', x, z: R.z0 + 1.3, rot: 0 }, 0.0);
      }
      for (let k = 0; k < n; k++) {
        const x = R.x0 + 0.1 + (k + 0.5) * ((W - 0.2) / n);
        f.tryPut(room, { type: 'trough', x, z: R.z0 + 0.32, rot: 0 }, 0.0);
        if (k % 2 === 0) f.tryPut(room, { type: 'hayBale', x, z: R.z0 + 1.6, rot: 0.3 }, 0.0);
      }
      put('bucket', ['front', 'left']);
      put('barrel', ['front', 'left']);
      break;
    }
    case 'sellerie':
      put('saddleRack', ['back', 'left']);
      put('saddleRack', ['back', 'left', 'right']);
      put('toolRack', ['right', 'left']);
      put('chest', ['front', 'right']);
      put('sacks', ['front', 'right', 'left']);
      break;
    case 'grange':
      if (!f.center(room, 'cart', { dz: -D * 0.15, rot: 0, m: 0.4 })) f.center(room, 'cart', { dx: -W * 0.25, dz: -D * 0.1, rot: 0, m: 0.3 });
      put('hayPile', ['back', 'left', 'right']);
      put('hayPile', ['left', 'right', 'back']);
      put('hayBale', ['right', 'left', 'back']);
      put('hayBale', ['right', 'left', 'front']);
      put('toolRack', ['left', 'right']);
      put('sacks', ['left', 'right', 'front']);
      put('barrel', ['front', 'left', 'right']);
      break;
    case 'fenil':
      put('hayPile', ['back']);
      put('hayPile', ['back', 'left', 'right']);
      put('hayBale', ['left', 'right', 'back']);
      put('hayBale', ['right', 'left', 'back']);
      put('hayBale', ['back', 'left']);
      break;
  }
}

// ───────────────────────── point d'entrée ─────────────────────────

const planCache = new Map<string, Plan>();

/** Plan complet d'un bâtiment (mis en cache, déterministe). */
export function planOf(b: BuildingSpec): Plan {
  let p = planCache.get(b.id);
  if (p) return p;
  const r = rng(b.seed + 17);
  switch (b.kind) {
    case 'tavern':
      p = tavernPlan(b, r);
      break;
    case 'forge':
      p = forgePlan(b, r);
      break;
    case 'apothecary':
    case 'shop':
    case 'bakery':
      p = shopPlan(b, r);
      break;
    case 'church':
      p = churchPlan(b, r);
      break;
    case 'sheriff':
      p = sheriffPlan(b, r);
      break;
    case 'stable':
      p = stablePlan(b, r);
      break;
    case 'barn':
      p = barnPlan(b, r);
      break;
    default:
      p = housePlan(b, r);
  }
  // bâtiments habités : une bougie par pièce éclairée (le rendu choisit les plus proches de la caméra)
  for (const l of p.levels)
    for (const room of l.rooms)
      if (room.lit && !p.lights.some((li) => li.x > room.rect.x0 && li.x < room.rect.x1 && li.z > room.rect.z0 && li.z < room.rect.z1 && Math.abs(li.y - l.y - 1.5) < 2)) {
        p.lights.push({ x: (room.rect.x0 + room.rect.x1) / 2, y: l.y + 1.7, z: (room.rect.z0 + room.rect.z1) / 2, color: '#ffae5c', intensity: 3.2, distance: 6.5, flicker: true });
      }
  furnish(p, b, r);
  planCache.set(b.id, p);
  return p;
}

/** Exportés pour les tests. */
export const _test = { stairClearances, openingClear, doorClear };
