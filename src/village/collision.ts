/**
 * Monde des collisions du village, déduit des données du plan (aucune géométrie 3D) :
 *  - obstacles : murs extérieurs percés de leurs portes, cloisons (et leurs portes), grilles, garde-corps,
 *    mobilier, décor extérieur et troncs d'arbres — des boîtes orientées avec une étendue verticale ;
 *  - surfaces praticables : terrain (même triangulation que le maillage), socles des maisons, planchers
 *    percés de leurs trémies, rampes d'escaliers et d'échelles, dessus des meubles bas ;
 *  - plafonds : dessous des planchers (on ne traverse pas un plancher en sautant).
 * Les fenêtres ne sont pas franchissables. Données pures : testables sous Node, réutilisables côté serveur.
 */
import { BUILDINGS, PLINTH, floorOf, groundHeight, localToWorld, type BuildingSpec } from './layout';
import { FURN, INT_T, SLAB, planOf, stairRun, type Level, type Plan, type Rect, type Side } from '../village/plans';

/** Boîte orientée : centre (x, z), demi-dimensions (hx le long de l'axe tourné de `rot`), de y0 à y1. */
export interface Obb {
  x: number;
  z: number;
  hx: number;
  hz: number;
  rot: number;
  y0: number;
  y1: number;
  tag?: string;
}

/** Surface praticable : rectangle orienté, à hauteur fixe ou en rampe (de `y` à `y + rise` le long de son axe x local). */
export interface Surface {
  x: number;
  z: number;
  hx: number;
  hz: number;
  rot: number;
  y: number;
  rise?: number;
  /** épaisseur sous la surface (plafond pour les étages inférieurs) ; 0 = pas de plafond */
  thick: number;
  tag?: string;
}

const CELL = 4;

class Grid<T extends { x: number; z: number; hx: number; hz: number }> {
  private cells = new Map<number, number[]>();
  readonly items: T[] = [];
  add(it: T) {
    const id = this.items.push(it) - 1;
    const r = Math.hypot(it.hx, it.hz);
    for (let cx = Math.floor((it.x - r) / CELL); cx <= Math.floor((it.x + r) / CELL); cx++)
      for (let cz = Math.floor((it.z - r) / CELL); cz <= Math.floor((it.z + r) / CELL); cz++) {
        const k = cx * 100003 + cz;
        let l = this.cells.get(k);
        if (!l) this.cells.set(k, (l = []));
        l.push(id);
      }
  }
  near(x: number, z: number, out: T[]): T[] {
    out.length = 0;
    const l = this.cells.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL));
    if (l) for (const i of l) out.push(this.items[i]);
    return out;
  }
}

/** Coordonnées locales (repère de la boîte) d'un point monde. */
function toLocal(b: { x: number; z: number; rot: number }, x: number, z: number): [number, number] {
  const c = Math.cos(b.rot);
  const s = Math.sin(b.rot);
  const dx = x - b.x;
  const dz = z - b.z;
  return [dx * c - dz * s, dx * s + dz * c];
}

export interface Hole {
  x: number;
  z: number;
  rot: number;
  hw: number;
  hd: number;
}

export class CollisionWorld {
  readonly obstacles = new Grid<Obb>();
  readonly surfaces = new Grid<Surface>();
  /** zones où le terrain est percé (caves) */
  readonly holes: Hole[] = [];
  private tmpO: Obb[] = [];
  private tmpS: Surface[] = [];

  addObstacle(o: Obb) {
    this.obstacles.add(o);
  }
  addSurface(s: Surface) {
    this.surfaces.add(s);
  }

  /** Hauteur de la surface en (x, z) si elle la couvre, sinon null. */
  private surfaceAt(s: Surface, x: number, z: number): number | null {
    const [lx, lz] = toLocal(s, x, z);
    if (Math.abs(lx) > s.hx || Math.abs(lz) > s.hz) return null;
    return s.rise ? s.y + ((lx + s.hx) / (2 * s.hx)) * s.rise : s.y;
  }

  private inHole(x: number, z: number) {
    for (const h of this.holes) {
      const [lx, lz] = toLocal(h, x, z);
      if (Math.abs(lx) < h.hw && Math.abs(lz) < h.hd) return true;
    }
    return false;
  }

  /**
   * Sol sous les pieds : la plus haute surface couvrant (x, z) dont le dessus ne dépasse pas `maxY`
   * (hauteur des pieds + marche franchissable). -Infinity s'il n'y a rien (vide sous une trémie…).
   */
  groundAt(x: number, z: number, maxY: number): number {
    let best = -Infinity;
    if (!this.inHole(x, z)) {
      const t = groundHeight(x, z);
      if (t <= maxY) best = t;
    }
    for (const s of this.surfaces.near(x, z, this.tmpS)) {
      const y = this.surfaceAt(s, x, z);
      if (y !== null && y <= maxY + 1e-6 && y > best) best = y;
    }
    return best;
  }

  /** Plafond au-dessus de `y` (dessous du plancher le plus bas au-dessus des épaules), Infinity sinon. */
  ceilingAt(x: number, z: number, y: number): number {
    let best = Infinity;
    for (const s of this.surfaces.near(x, z, this.tmpS)) {
      if (!s.thick) continue;
      const top = this.surfaceAt(s, x, z);
      if (top === null) continue;
      const under = top - s.thick;
      if (under > y + 0.2 && under < best) best = under;
    }
    return best;
  }

  /**
   * Repousse un cercle (rayon r, pieds à `y`, tête à `y + h`) hors des obstacles qui le chevauchent
   * verticalement. Retourne la position corrigée et la normale cumulée des contacts.
   */
  resolve(x: number, z: number, r: number, y: number, h: number): { x: number; z: number; nx: number; nz: number; hit: boolean } {
    let nx = 0;
    let nz = 0;
    let hit = false;
    for (let iter = 0; iter < 4; iter++) {
      let moved = false;
      for (const o of this.obstacles.near(x, z, this.tmpO)) {
        if (o.y1 <= y + 0.05 || o.y0 >= y + h) continue;
        const [lx, lz] = toLocal(o, x, z);
        const cx = Math.max(-o.hx, Math.min(o.hx, lx));
        const cz = Math.max(-o.hz, Math.min(o.hz, lz));
        let dx = lx - cx;
        let dz = lz - cz;
        let d = Math.hypot(dx, dz);
        let push: number;
        if (d < 1e-6) {
          // centre dans la boîte : sortie par la face la plus proche
          const px = o.hx - Math.abs(lx);
          const pz = o.hz - Math.abs(lz);
          if (px < pz) {
            dx = Math.sign(lx) || 1;
            dz = 0;
            push = px + r;
          } else {
            dx = 0;
            dz = Math.sign(lz) || 1;
            push = pz + r;
          }
          d = 1;
        } else {
          if (d >= r) continue;
          push = r - d;
        }
        const ux = dx / d;
        const uz = dz / d;
        // retour au repère monde
        const c = Math.cos(o.rot);
        const s = Math.sin(o.rot);
        const wx = ux * c + uz * s;
        const wz = -ux * s + uz * c;
        x += wx * push;
        z += wz * push;
        nx += wx;
        nz += wz;
        moved = true;
        hit = true;
      }
      if (!moved) break;
    }
    return { x, z, nx, nz, hit };
  }

  /** Un point (caméra) est-il dans un obstacle ou sous un plancher ? */
  blocksPoint(x: number, y: number, z: number, pad = 0.15): boolean {
    for (const o of this.obstacles.near(x, z, this.tmpO)) {
      if (y < o.y0 - pad || y > o.y1 + pad) continue;
      const [lx, lz] = toLocal(o, x, z);
      if (Math.abs(lx) < o.hx + pad && Math.abs(lz) < o.hz + pad) return true;
    }
    for (const s of this.surfaces.near(x, z, this.tmpS)) {
      if (!s.thick) continue;
      const top = this.surfaceAt(s, x, z);
      if (top !== null && y > top - s.thick - pad && y < top + pad) return true;
    }
    return !this.inHole(x, z) && y < groundHeight(x, z) + pad;
  }

  /**
   * Ligne de vue entre deux points (tir, élimination, enquête) : aucun mur, plancher, relief ou objet plein
   * sur le segment, échantillonné tous les `step` mètres (les extrémités, sur les personnages, sont exclues).
   */
  lineClear(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, step = 0.2): boolean {
    const d = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
    const n = Math.ceil(d / step);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (t * d < 0.35 || (1 - t) * d < 0.35) continue;
      if (this.blocksPoint(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z0 + (z1 - z0) * t, 0)) return false;
    }
    return true;
  }
}

// ───────────────────────── construction depuis le plan du village ─────────────────────────

/** Furniture trop bas pour gêner (on marche dessus ou à travers). */
const FLAT = new Set(['rug', 'pallet', 'bedroll', 'debris']);
/**
 * Petits sièges et objets légers : on les écarte en passant (pas de blocage). Sans cela, les tables
 * entourées de bancs et de chaises fermaient les pièces à un personnage de 0,5 m de large.
 */
const PASSABLE = new Set(['chair', 'stool', 'bench', 'bucket', 'candelabra', 'lectern']);
/** retrait des boîtes de collision du mobilier (m par côté) : on frôle les meubles au lieu de s'y accrocher */
const FURN_INSET = 0.07;

function slabPieces(R: Rect, holes: Rect[]): Rect[] {
  const zs = new Set<number>([R.z0, R.z1]);
  for (const h of holes) {
    zs.add(Math.max(R.z0, Math.min(R.z1, h.z0)));
    zs.add(Math.max(R.z0, Math.min(R.z1, h.z1)));
  }
  const zl = [...zs].sort((a, b) => a - b);
  const out: Rect[] = [];
  for (let i = 0; i < zl.length - 1; i++) {
    const za = zl[i];
    const zb = zl[i + 1];
    if (zb - za < 0.005) continue;
    const zm = (za + zb) / 2;
    const cuts = holes.filter((h) => h.z0 < zm && h.z1 > zm).sort((p, q) => p.x0 - q.x0);
    let cx = R.x0;
    for (const h of cuts) {
      if (h.x0 > cx + 0.005) out.push({ x0: cx, x1: h.x0, z0: za, z1: zb });
      cx = Math.max(cx, h.x1);
    }
    if (R.x1 > cx + 0.005) out.push({ x0: cx, x1: R.x1, z0: za, z1: zb });
  }
  return out;
}

/** Ajoute un bâtiment au monde des collisions (repère local → monde). */
export function addBuilding(w: CollisionWorld, b: BuildingSpec, plan: Plan = planOf(b)) {
  const fy = floorOf(b);
  const P = (lx: number, lz: number) => localToWorld(b, lx, lz);
  const box = (lx0: number, lx1: number, lz0: number, lz1: number, y0: number, y1: number, tag: string) => {
    const [x, z] = P((lx0 + lx1) / 2, (lz0 + lz1) / 2);
    w.addObstacle({ x, z, hx: Math.abs(lx1 - lx0) / 2, hz: Math.abs(lz1 - lz0) / 2, rot: b.rot, y0: fy + y0, y1: fy + y1, tag });
  };
  const surf = (r: Rect, y: number, thick: number, tag: string) => {
    const [x, z] = P((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2);
    w.addSurface({ x, z, hx: (r.x1 - r.x0) / 2, hz: (r.z1 - r.z0) / 2, rot: b.rot, y: fy + y, thick, tag });
  };
  const levels = plan.levels;
  const tower = (l: Level) => b.kind === 'church' && l.index > 0;
  const habitable = levels.filter((l) => !l.underground && l.name !== 'Combles' && !tower(l));
  const top = habitable[habitable.length - 1];
  const cellar = levels.some((l) => l.underground);

  // socle : on monte la marche du seuil ; pour les maisons à cave, seulement la couronne sous les murs
  const G = levels.find((l) => l.index === 0)!;
  const O = G.outer;
  if (!cellar) surf({ x0: O.x0, x1: O.x1, z0: O.z0, z1: O.z1 + (b.kind === 'church' ? 5 : 0) }, -0.02, 0, `${b.id}:socle`);
  else {
    const t = G.t;
    for (const r of [
      { x0: O.x0, x1: O.x1, z0: O.z0, z1: O.z0 + t },
      { x0: O.x0, x1: O.x1, z0: O.z1 - t, z1: O.z1 },
      { x0: O.x0, x1: O.x0 + t, z0: O.z0, z1: O.z1 },
      { x0: O.x1 - t, x1: O.x1, z0: O.z0, z1: O.z1 },
    ])
      surf(r, 0, 0, `${b.id}:socle`);
  }

  for (const l of levels) {
    const isAttic = l.name === 'Combles';
    const I = l.inner;
    // planchers (percés des trémies) : dessus à l.y, épaisseur = plafond du niveau inférieur
    const thick = l.y > 0.5 || isAttic ? SLAB : 0;
    const areas = l.partialFloor ?? [I];
    for (const a of areas) for (const p of slabPieces(a, l.holes)) surf(p, l.y, thick, `${b.id}:plancher`);
    if (isAttic) {
      // combles : pignons et pans de toit fermés (on ne sort pas du grenier par le bord du plancher)
      const R = l.outer;
      const t = l.t;
      const y0 = l.y - 0.1;
      const y1 = l.y + 2.4;
      box(R.x0, R.x1, R.z1 - t, R.z1, y0, y1, `${b.id}:comble`);
      box(R.x0, R.x1, R.z0, R.z0 + t, y0, y1, `${b.id}:comble`);
      box(R.x0, R.x0 + t, R.z0, R.z1, y0, y1, `${b.id}:comble`);
      box(R.x1 - t, R.x1, R.z0, R.z1, y0, y1, `${b.id}:comble`);
      continue;
    }

    // murs extérieurs, percés des portes (les fenêtres restent des murs)
    const nextY = levels.find((x) => x.y > l.y + 0.01 && tower(x) === tower(l) && x.name !== 'Combles')?.y;
    let H = l.underground ? -l.y : nextY !== undefined && !(l === top && !tower(l)) ? nextY - l.y : l === top ? plan.wallTop - l.y : l.h;
    if (tower(l) && l === levels[levels.length - 1]) H = l.h;
    const y0 = l.underground ? l.y - SLAB : l.y - 0.4;
    // murs de cave : leur arase sert de socle (on y monte depuis la rue), ils ne bloquent que sous terre
    const y1 = l.underground ? l.y + H - 0.35 : l.y + H;
    const t = l.t;
    const R = l.outer;
    const skip = new Set(l.skipWalls ?? []);
    const doors = plan.openings.filter((o) => o.level === l.index && o.y0 < 0.1 && (o.kind === 'door' || o.kind === 'big-door' || o.kind === 'arch'));
    const run = (side: Side, a0: number, a1: number, fixed: number, alongX: boolean) => {
      if (skip.has(side)) return;
      const gaps = doors.filter((o) => o.side === side).map((o) => [o.at - o.w / 2 + 0.04, o.at + o.w / 2 - 0.04] as const).sort((p, q) => p[0] - q[0]);
      let c = a0;
      const seg = (s0: number, s1: number) => {
        if (s1 - s0 < 0.01) return;
        if (alongX) box(s0, s1, fixed - t / 2, fixed + t / 2, y0, y1, `${b.id}:mur`);
        else box(fixed - t / 2, fixed + t / 2, s0, s1, y0, y1, `${b.id}:mur`);
      };
      for (const [g0, g1] of gaps) {
        seg(c, g0);
        // linteau au-dessus de la porte (on ne passe pas la tête dans le mur en sautant)
        const o = doors.find((d) => d.side === side && Math.abs(d.at - (g0 + g1) / 2) < 0.1)!;
        if (alongX) box(g0, g1, fixed - t / 2, fixed + t / 2, l.y + o.y1, y1, `${b.id}:linteau`);
        else box(fixed - t / 2, fixed + t / 2, g0, g1, l.y + o.y1, y1, `${b.id}:linteau`);
        c = Math.max(c, g1);
      }
      seg(c, a1);
    };
    run('front', R.x0, R.x1, R.z1 - t / 2, true);
    run('back', R.x0, R.x1, R.z0 + t / 2, true);
    run('left', R.z0, R.z1, R.x0 + t / 2, false);
    run('right', R.z0, R.z1, R.x1 - t / 2, false);

    // cloisons, grilles, murets de stalle
    for (const p of l.partitions) {
      const len = Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]);
      const ux = (p.b[0] - p.a[0]) / len;
      const uz = (p.b[1] - p.a[1]) / len;
      const ph = p.kind === 'low' ? 1.4 : H;
      const gaps = p.doors.map((d) => [d.at - d.w / 2 + 0.01, d.at + d.w / 2 - 0.01] as const).sort((q, s) => q[0] - s[0]);
      let c = 0;
      const seg = (s0: number, s1: number, ya: number, yb: number) => {
        if (s1 - s0 < 0.01) return;
        const ax = p.a[0] + ux * s0;
        const az = p.a[1] + uz * s0;
        const bx = p.a[0] + ux * s1;
        const bz = p.a[1] + uz * s1;
        const th = INT_T / 2 + 0.01;
        box(Math.min(ax, bx) - (Math.abs(ux) > 0.5 ? 0 : th), Math.max(ax, bx) + (Math.abs(ux) > 0.5 ? 0 : th), Math.min(az, bz) - (Math.abs(ux) > 0.5 ? th : 0), Math.max(az, bz) + (Math.abs(ux) > 0.5 ? th : 0), ya, yb, `${b.id}:cloison`);
      };
      for (const [g0, g1] of gaps) {
        seg(c, g0, l.y - 0.1, l.y + ph);
        seg(g0, g1, l.y + 2.0, l.y + ph);
        c = g1;
      }
      seg(c, len, l.y - 0.1, l.y + ph);
    }

    // mobilier : obstacles, et dessus des meubles bas (on peut y sauter)
    for (const it of l.items) {
      if (FLAT.has(it.type) || PASSABLE.has(it.type) || it.y !== undefined) continue;
      const [fw, fd, fh] = FURN[it.type];
      const [x, z] = P(it.x, it.z);
      const h = it.tilt ? fh * 0.6 : fh;
      w.addObstacle({ x, z, hx: Math.max(0.1, fw / 2 - FURN_INSET), hz: Math.max(0.1, fd / 2 - FURN_INSET), rot: b.rot + it.rot, y0: fy + l.y - 0.05, y1: fy + l.y + h, tag: `${b.id}:${it.type}` });
      if (h <= 1.0 && !it.tilt) w.addSurface({ x, z, hx: fw / 2 - 0.05, hz: fd / 2 - 0.05, rot: b.rot + it.rot, y: fy + l.y + h, thick: 0, tag: `${b.id}:${it.type}:dessus` });
    }
  }

  // escaliers et échelles : rampes praticables ; garde-corps autour des trémies
  for (const s of plan.stairs) {
    const from = levels[s.from];
    const R = s.rect;
    const alongZ = Math.abs(s.dir[1]) > 0.5;
    const run = alongZ ? R.z1 - R.z0 : R.x1 - R.x0;
    const [x, z] = P((R.x0 + R.x1) / 2, (R.z0 + R.z1) / 2);
    // axe x local de la rampe = sens de la montée
    const rampRot = b.rot + (alongZ ? (s.dir[1] > 0 ? -Math.PI / 2 : Math.PI / 2) : s.dir[0] > 0 ? 0 : Math.PI);
    const width = alongZ ? R.x1 - R.x0 : R.z1 - R.z0;
    w.addSurface({ x, z, hx: run / 2, hz: width / 2, rot: rampRot, y: fy + from.y, rise: s.rise, thick: 0, tag: `${b.id}:${s.kind === 'ladder' ? 'echelle' : 'escalier'}` });
    void stairRun;
    // garde-corps sur l'étage d'arrivée (tous les bords de la trémie sauf la sortie et les murs)
    const to = levels.find((l) => Math.abs(l.y - (from.y + s.rise)) < 0.01);
    if (!to || s.kind === 'ladder') continue;
    const H = to.holes.find((h) => h.x0 <= R.x0 + 0.01 && h.x1 >= R.x1 - 0.01 && h.z0 <= R.z0 + 0.01 && h.z1 >= R.z1 - 0.01);
    if (!H) continue;
    const I = to.inner;
    const exit = alongZ ? (s.dir[1] > 0 ? 'z1' : 'z0') : s.dir[0] > 0 ? 'x1' : 'x0';
    const y0 = to.y - 0.1;
    const y1 = to.y + 1.0;
    if (exit !== 'z0' && H.z0 - I.z0 > 0.15) box(H.x0, H.x1, H.z0 - 0.05, H.z0 + 0.05, y0, y1, `${b.id}:garde-corps`);
    if (exit !== 'z1' && I.z1 - H.z1 > 0.15) box(H.x0, H.x1, H.z1 - 0.05, H.z1 + 0.05, y0, y1, `${b.id}:garde-corps`);
    if (exit !== 'x0' && H.x0 - I.x0 > 0.15) box(H.x0 - 0.05, H.x0 + 0.05, H.z0, H.z1, y0, y1, `${b.id}:garde-corps`);
    if (exit !== 'x1' && I.x1 - H.x1 > 0.15) box(H.x1 - 0.05, H.x1 + 0.05, H.z0, H.z1, y0, y1, `${b.id}:garde-corps`);
  }

  // conduit de cheminée (souche dans la pièce)
  if (plan.chimney) {
    const c = plan.chimney;
    box(c.x0, c.x1, c.z0, c.z1, -0.1, plan.wallTop, `${b.id}:cheminee`);
  }
  if (cellar) {
    const c = levels.find((l) => l.underground)!;
    const [x, z] = P(0, 0);
    w.holes.push({ x, z, rot: b.rot, hw: (c.inner.x1 - c.inner.x0) / 2, hd: (c.inner.z1 - c.inner.z0) / 2 });
  }
  void PLINTH;
}

/** Monde des collisions de tout le village (bâtiments seuls ; le décor s'ajoute ensuite). */
export function buildCollisionWorld(): CollisionWorld {
  const w = new CollisionWorld();
  for (const b of BUILDINGS) addBuilding(w, b);
  return w;
}
