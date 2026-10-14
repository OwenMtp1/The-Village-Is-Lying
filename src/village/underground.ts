/**
 * Souterrains du village (données pures, sans Three.js : partagées par le rendu, les collisions et le serveur).
 *
 * À 8 m sous terre, un réseau de galeries relie des salles oubliées : crypte, geôles, salle du conseil secret,
 * réserve des contrebandiers, laboratoire d'alchimiste, citerne, chapelle des Pénitents, ossuaire. Des boyaux
 * étroits et sans lumière (tunnel d'évasion, passage des contrebandiers) doublent les galeries principales.
 * Cinq entrées discrètes, loin les unes des autres : un mausolée, un puits asséché dans le verger, des trappes
 * derrière les écuries, dans le jardin de la maison abandonnée et entre les rochers de la lisière. Chacune
 * descend par une échelle au fond d'un puits.
 *
 * Tout est construit sur une grille de 0,5 m : salles et galeries « creusent » des cases, puis murs, sols et
 * plafonds suivent le contour des cases creusées (galeries droites, angles nets, jonctions sans couture).
 */
import { KEEP_OUT, heightAt, isFree, roadDistance, type P2 } from './layout';

export const UNDER = {
  /** dessus du sol des galeries (m, absolu) */
  floor: -8,
  /** hauteur sous plafond */
  height: 3.0,
  cell: 0.5,
  /** côté intérieur des puits d'accès */
  shaft: 1.6,
  /** niche sans plafond au pied de l'échelle (côté −z) : on se redresse avant de monter */
  niche: 1.0,
};

export type RoomKind = 'crypte' | 'prison' | 'conseil' | 'reserve' | 'citerne' | 'labo' | 'chapelle' | 'ossuaire';
export interface URoom {
  id: string;
  name: string;
  kind: RoomKind;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}
export interface UTunnel {
  pts: P2[];
  /** largeur intérieure */
  w: number;
  /** boyau étroit, sans lanternes */
  secret?: boolean;
}
export interface UShaft {
  id: string;
  name: string;
  /** déguisement en surface */
  look: 'mausolee' | 'puits' | 'trappe-foin' | 'trappe-jardin' | 'rochers';
  x: number;
  z: number;
  /** hauteur du sol en surface */
  ground: number;
}

export const ROOMS: URoom[] = [
  { id: 'crypte', name: 'Crypte des Aubin', kind: 'crypte', x0: 8, x1: 22, z0: -108, z1: -96 },
  { id: 'geoles', name: 'Geôles oubliées', kind: 'prison', x0: -48, x1: -30, z0: -64, z1: -52 },
  { id: 'conseil', name: 'Salle du Conseil secret', kind: 'conseil', x0: -10, x1: 2, z0: -40, z1: -30 },
  { id: 'reserve', name: 'Réserve des contrebandiers', kind: 'reserve', x0: 40, x1: 54, z0: -22, z1: -12 },
  { id: 'citerne', name: 'Citerne', kind: 'citerne', x0: 12, x1: 30, z0: 22, z1: 36 },
  { id: 'labo', name: "Laboratoire de l'alchimiste", kind: 'labo', x0: -50, x1: -38, z0: 18, z1: 28 },
  { id: 'chapelle', name: 'Chapelle des Pénitents', kind: 'chapelle', x0: -92, x1: -80, z0: -42, z1: -28 },
  { id: 'ossuaire', name: 'Ossuaire', kind: 'ossuaire', x0: -112, x1: -102, z0: 34, z1: 42 },
];

/** Entrées : position souhaitée, ajustée au premier endroit libre (hors rues, bâtiments, champs). */
const WANTED: Omit<UShaft, 'ground'>[] = [
  { id: 'mausolee', name: 'Mausolée des Aubin', look: 'mausolee', x: 33, z: -104 },
  { id: 'verger', name: 'Puits asséché du verger', look: 'puits', x: -76, z: -14 },
  { id: 'ecuries', name: 'Trappe derrière les écuries', look: 'trappe-foin', x: 104, z: 42 },
  { id: 'abandonnee', name: 'Trappe du jardin abandonné', look: 'trappe-jardin', x: -92, z: -56 },
  { id: 'lisiere', name: 'Rochers de la lisière', look: 'rochers', x: -118, z: 46 },
];

function freeSpot(x: number, z: number): P2 {
  for (let r = 0; r < 30; r += 0.5)
    for (let a = 0; a < Math.PI * 2; a += 0.4) {
      const px = Math.round((x + Math.cos(a) * r) * 2) / 2;
      const pz = Math.round((z + Math.sin(a) * r) * 2) / 2;
      if (isFree(px, pz, 3) && roadDistance(px, pz).d > 4) return [px, pz];
    }
  return [x, z];
}

export const SHAFTS: UShaft[] = WANTED.map((w) => {
  const [x, z] = freeSpot(w.x, w.z);
  return { ...w, x, z, ground: heightAt(x, z) };
});
for (const s of SHAFTS) KEEP_OUT.push({ x: s.x, z: s.z, r: s.look === 'mausolee' ? 4 : 2.5 });

const S = (id: string) => SHAFTS.find((s) => s.id === id)!;
/** Liaison en L (d'abord x, puis z) d'un point vers un autre. */
const L = (a: P2, b: P2): P2[] => [a, [b[0], a[1]], b];

export const TUNNELS: UTunnel[] = [
  // galeries principales (2,4 m, lanternes)
  { w: 2.4, pts: [[15, -96], [15, -70], [-4, -70], [-4, -40]] },
  { w: 2.4, pts: [[-10, -35], [-24, -35], [-24, -58], [-30, -58]] },
  { w: 2.4, pts: [[-48, -58], [-70, -58], [-70, -34], [-80, -34]] },
  { w: 2.4, pts: [[2, -35], [30, -35], [30, -17], [40, -17]] },
  { w: 2.4, pts: [[-4, -30], [-4, 29], [12, 29]] },
  { w: 2.4, pts: [[-4, 23], [-38, 23]] },
  { w: 2.4, pts: [[-50, 23], [-107, 23], [-107, 34]] },
  { w: 2.4, pts: [[54, -17], [S('ecuries').x, -17], [S('ecuries').x, S('ecuries').z]] },
  // accès aux puits
  { w: 2.0, pts: L([22, -102], [S('mausolee').x, S('mausolee').z]) },
  { w: 2.0, pts: L([-70, -40], [S('verger').x, S('verger').z]).reverse() },
  { w: 2.0, pts: [[-86, -42], [-86, S('abandonnee').z], [S('abandonnee').x, S('abandonnee').z]] },
  { w: 2.0, pts: L([-107, 42], [S('lisiere').x, S('lisiere').z]) },
  // boyaux secrets (1 m, obscurs) : tunnel d'évasion des geôles vers la crypte, passage des contrebandiers
  { w: 1.0, secret: true, pts: [[-36.5, -64], [-36.5, -101], [8, -101]] },
  { w: 1.0, secret: true, pts: [[30, 29], [47, 29], [47, -12]] },
];

/** Cellules des geôles : 6 au nord, 6 au sud d'un couloir central ; certaines grilles sont ouvertes. */
export const CELLS = (() => {
  const g = ROOMS.find((r) => r.id === 'geoles')!;
  const out: { x0: number; x1: number; z0: number; z1: number; bars: number; open: boolean }[] = [];
  const cw = (g.x1 - g.x0) / 6;
  for (let i = 0; i < 6; i++) {
    const x0 = g.x0 + i * cw;
    out.push({ x0, x1: x0 + cw, z0: -57, z1: g.z1, bars: -57, open: i % 2 === 1 });
    // la 4e cellule du sud cache l'entrée du tunnel d'évasion : sa grille est ouverte
    out.push({ x0, x1: x0 + cw, z0: g.z0, z1: -59, bars: -59, open: i === 3 || i === 0 });
  }
  return out;
})();

// ───────────────────────── grille ─────────────────────────

export interface UGrid {
  x0: number;
  z0: number;
  nx: number;
  nz: number;
  /** 1 = creusé (sol praticable) */
  dug: Uint8Array;
  /** 1 = sous un puits (pas de plafond) */
  open: Uint8Array;
}

export interface Box {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  y0: number;
  y1: number;
}

let gridCache: UGrid | null = null;

export function undergroundGrid(): UGrid {
  if (gridCache) return gridCache;
  const C = UNDER.cell;
  const xs: number[] = [];
  const zs: number[] = [];
  for (const r of ROOMS) xs.push(r.x0, r.x1), zs.push(r.z0, r.z1);
  for (const t of TUNNELS) for (const [x, z] of t.pts) xs.push(x), zs.push(z);
  for (const s of SHAFTS) xs.push(s.x), zs.push(s.z);
  const x0 = Math.floor(Math.min(...xs) / C) * C - 4;
  const z0 = Math.floor(Math.min(...zs) / C) * C - 4;
  const nx = Math.ceil((Math.max(...xs) + 4 - x0) / C);
  const nz = Math.ceil((Math.max(...zs) + 4 - z0) / C);
  const dug = new Uint8Array(nx * nz);
  const open = new Uint8Array(nx * nz);
  const fill = (ax: number, bx: number, az: number, bz: number, arr = dug) => {
    const i0 = Math.max(0, Math.round((Math.min(ax, bx) - x0) / C));
    const i1 = Math.min(nx, Math.round((Math.max(ax, bx) - x0) / C));
    const j0 = Math.max(0, Math.round((Math.min(az, bz) - z0) / C));
    const j1 = Math.min(nz, Math.round((Math.max(az, bz) - z0) / C));
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) arr[j * nx + i] = 1;
  };
  for (const r of ROOMS) fill(r.x0, r.x1, r.z0, r.z1);
  for (const t of TUNNELS) {
    const h = t.w / 2;
    for (let k = 0; k < t.pts.length - 1; k++) {
      const [ax, az] = t.pts[k];
      const [bx, bz] = t.pts[k + 1];
      fill(Math.min(ax, bx) - h, Math.max(ax, bx) + h, Math.min(az, bz) - h, Math.max(az, bz) + h);
    }
  }
  const sh = UNDER.shaft / 2;
  for (const s of SHAFTS) {
    fill(s.x - sh - 0.5, s.x + sh + 0.5, s.z - sh - UNDER.niche - 0.8, s.z + sh + 0.5);
    fill(s.x - sh, s.x + sh, s.z - sh - UNDER.niche, s.z + sh, open);
  }
  gridCache = { x0, z0, nx, nz, dug, open };
  return gridCache;
}

/** Murs : faces entre cases creusées et roche, regroupées en longues boîtes (0,4 m d'épaisseur). */
export function wallBoxes(): Box[] {
  const g = undergroundGrid();
  const C = UNDER.cell;
  const T = 0.4;
  const y0 = UNDER.floor - 0.3;
  const y1 = UNDER.floor + UNDER.height + 0.3;
  const at = (i: number, j: number) => (i >= 0 && j >= 0 && i < g.nx && j < g.nz ? g.dug[j * g.nx + i] : 0);
  const out: Box[] = [];
  // faces nord / sud (le long de x)
  for (const side of [-1, 1])
    for (let j = 0; j < g.nz; j++) {
      let run = -1;
      for (let i = 0; i <= g.nx; i++) {
        const wall = i < g.nx && at(i, j) && !at(i, j + side);
        if (wall && run < 0) run = i;
        if (!wall && run >= 0) {
          const z = g.z0 + (side > 0 ? (j + 1) * C : j * C);
          out.push({ x0: g.x0 + run * C - (side ? T : 0), x1: g.x0 + i * C + T, z0: side > 0 ? z : z - T, z1: side > 0 ? z + T : z, y0, y1 });
          run = -1;
        }
      }
    }
  // faces ouest / est (le long de z)
  for (const side of [-1, 1])
    for (let i = 0; i < g.nx; i++) {
      let run = -1;
      for (let j = 0; j <= g.nz; j++) {
        const wall = j < g.nz && at(i, j) && !at(i + side, j);
        if (wall && run < 0) run = j;
        if (!wall && run >= 0) {
          const x = g.x0 + (side > 0 ? (i + 1) * C : i * C);
          out.push({ x0: side > 0 ? x : x - T, x1: side > 0 ? x + T : x, z0: g.z0 + run * C, z1: g.z0 + j * C, y0, y1 });
          run = -1;
        }
      }
    }
  return out;
}

/** Rectangles de sol (ou de plafond, puits exclus) regroupés par rangées. */
export function slabRects(ceiling: boolean): { x0: number; x1: number; z0: number; z1: number }[] {
  const g = undergroundGrid();
  const C = UNDER.cell;
  const out: { x0: number; x1: number; z0: number; z1: number }[] = [];
  for (let j = 0; j < g.nz; j++) {
    let run = -1;
    for (let i = 0; i <= g.nx; i++) {
      const k = j * g.nx + i;
      const on = i < g.nx && g.dug[k] === 1 && !(ceiling && g.open[k]);
      if (on && run < 0) run = i;
      if (!on && run >= 0) {
        out.push({ x0: g.x0 + run * C, x1: g.x0 + i * C, z0: g.z0 + j * C, z1: g.z0 + (j + 1) * C });
        run = -1;
      }
    }
  }
  return out;
}

// ───────────────────────── aménagement des salles ─────────────────────────

export interface UItem {
  type: string;
  x: number;
  z: number;
  rot: number;
  /** hauteur au-dessus du sol des galeries */
  y?: number;
  /** emprise bloquante (m) ; absent = franchissable */
  solid?: [number, number, number];
}

/** Mobilier et objets de chaque salle (types du catalogue d'objets `props.ts`). */
export function roomItems(): UItem[] {
  return rawItems().filter((it) => !it.solid || !doorways().some(([x, z]) => Math.hypot(it.x - x, it.z - z) < 2.0 + Math.max(it.solid![0], it.solid![1]) / 2));
}

/** Débouchés des galeries dans les salles (points de passage à garder libres). */
function doorways(): P2[] {
  const out: P2[] = [];
  for (const t of TUNNELS)
    for (const p of t.pts)
      for (const r of ROOMS) {
        const onX = Math.abs(p[0] - r.x0) < 0.01 || Math.abs(p[0] - r.x1) < 0.01;
        const onZ = Math.abs(p[1] - r.z0) < 0.01 || Math.abs(p[1] - r.z1) < 0.01;
        if ((onX && p[1] >= r.z0 && p[1] <= r.z1) || (onZ && p[0] >= r.x0 && p[0] <= r.x1)) out.push(p);
      }
  return out;
}

function rawItems(): UItem[] {
  const out: UItem[] = [];
  const put = (type: string, x: number, z: number, rot = 0, solid?: [number, number, number], y?: number) => out.push({ type, x, z, rot, solid, y });
  for (const r of ROOMS) {
    const cx = (r.x0 + r.x1) / 2;
    const cz = (r.z0 + r.z1) / 2;
    switch (r.kind) {
      case 'crypte':
        // tombeaux de pierre (coffres longs), autel, chandeliers
        for (const dx of [-4, 0, 4]) for (const dz of [-2.2, 2.2]) put('tombeau', cx + dx, cz + dz, 0, [1.0, 2.2, 0.9]);
        put('altar', cx, r.z0 + 1, 0, [2.2, 0.95, 1.05]);
        for (const dx of [-2, 2]) put('candelabra', cx + dx, r.z0 + 1.2);
        break;
      case 'prison':
        for (const c of CELLS) {
          const mz = (c.z0 + c.z1) / 2;
          put('cot', (c.x0 + c.x1) / 2, c.z0 < -58 ? c.z0 + 1.1 : c.z1 - 1.1, Math.PI / 2, [1.9, 0.8, 0.45]);
          put('bucket', c.x1 - 0.5, mz);
        }
        break;
      case 'conseil':
        // grande table ronde, douze sièges, bannières, chandeliers aux quatre coins
        put('tableRound', cx, cz, 0, [2.2, 2.2, 0.76]);
        for (let k = 0; k < 10; k++) {
          const a = (k / 10) * Math.PI * 2;
          put('chair', cx + Math.cos(a) * 2.0, cz + Math.sin(a) * 2.0, -a - Math.PI / 2);
        }
        for (const [x, z] of [[r.x0 + 0.8, r.z0 + 0.8], [r.x1 - 0.8, r.z0 + 0.8], [r.x0 + 0.8, r.z1 - 0.8], [r.x1 - 0.8, r.z1 - 0.8]]) put('candelabra', x, z);
        put('shelf', cx - 3.5, r.z1 - 0.25, Math.PI, [1.3, 0.36, 1.9]);
        put('chest', cx + 3.5, r.z0 + 0.4, 0, [0.95, 0.5, 0.55]);
        put('rug', cx, cz, 0);
        break;
      case 'reserve':
        for (let k = 0; k < 5; k++) put(k % 2 ? 'crates' : 'barrelRack', r.x0 + 1.5 + k * 2.7, r.z0 + 0.8, 0, k % 2 ? [1.3, 0.8, 1.15] : [2.1, 0.95, 1.25]);
        for (let k = 0; k < 4; k++) put(k % 2 ? 'sacks' : 'crate', r.x0 + 2 + k * 3, r.z1 - 1, 0, k % 2 ? [0.95, 0.65, 0.6] : [0.7, 0.7, 0.62]);
        put('barrel', cx - 1, cz, 0, [0.62, 0.62, 0.9]);
        put('barrel', cx + 0.2, cz + 0.4, 0, [0.62, 0.62, 0.9]);
        put('tableSmall', cx + 3, cz, 0, [0.8, 0.6, 0.74]);
        break;
      case 'citerne':
        // bassin central (parapet) ; on en fait le tour
        put('bucket', r.x0 + 1, r.z0 + 1);
        put('crate', r.x1 - 1, r.z1 - 1, 0, [0.7, 0.7, 0.62]);
        break;
      case 'labo':
        put('mortarTable', cx - 2, r.z0 + 0.6, 0, [1.0, 0.6, 0.85]);
        put('jarShelf', cx + 2, r.z0 + 0.3, 0, [1.4, 0.36, 2.0]);
        put('herbRack', r.x0 + 1.5, r.z1 - 0.2, Math.PI, [1.3, 0.3, 0.8]);
        put('workbench', cx, r.z1 - 0.6, Math.PI, [1.8, 0.8, 0.88]);
        put('tub', r.x1 - 1.2, cz, 0, [1.0, 1.0, 0.55]);
        put('candelabra', cx, cz);
        break;
      case 'chapelle':
        put('altar', cx, r.z0 + 1, 0, [2.2, 0.95, 1.05]);
        for (let k = 0; k < 4; k++) for (const dx of [-2.3, 2.3]) put('pew', cx + dx, r.z0 + 4 + k * 2.2, 0, [3.0, 0.62, 0.95]);
        for (const dx of [-3.5, 3.5]) put('candelabra', cx + dx, r.z0 + 1.5);
        put('lectern', cx, r.z0 + 2.4);
        break;
      case 'ossuaire':
        for (let k = 0; k < 4; k++) put('debris', r.x0 + 1.5 + k * 2.3, r.z0 + 1, k);
        put('shelf', cx, r.z1 - 0.25, Math.PI, [1.3, 0.36, 1.9]);
        put('candelabra', cx, cz);
        break;
    }
  }
  return out;
}

/** Bassin de la citerne (parapet de 0,6 m, eau dedans). */
export const CISTERN_POOL = (() => {
  const r = ROOMS.find((x) => x.id === 'citerne')!;
  return { x0: r.x0 + 3, x1: r.x1 - 3, z0: r.z0 + 3, z1: r.z1 - 3 };
})();

/** Lanternes murales : le long des galeries principales (une tous les 7 m, en alternance) et dans les salles. */
export function lanterns(): { x: number; z: number; rot: number }[] {
  const out: { x: number; z: number; rot: number }[] = [];
  for (const t of TUNNELS) {
    if (t.secret) continue;
    let side = 1;
    for (let k = 0; k < t.pts.length - 1; k++) {
      const [ax, az] = t.pts[k];
      const [bx, bz] = t.pts[k + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const ux = (bx - ax) / len;
      const uz = (bz - az) / len;
      for (let d = 3; d < len - 2; d += 7) {
        // perpendiculaire (côté du mur), lanterne tournée vers l'intérieur de la galerie
        const px = -uz * side;
        const pz = ux * side;
        out.push({ x: ax + ux * d + px * (t.w / 2), z: az + uz * d + pz * (t.w / 2), rot: Math.atan2(-px, -pz) });
        side = -side;
      }
    }
  }
  for (const r of ROOMS) {
    const cx = (r.x0 + r.x1) / 2;
    const cz = (r.z0 + r.z1) / 2;
    out.push({ x: r.x0, z: cz - 2, rot: Math.PI / 2 }, { x: r.x1, z: cz + 2, rot: -Math.PI / 2 });
    out.push({ x: cx + 2.5, z: r.z1, rot: Math.PI });
  }
  // ne garder que les lanternes contre un vrai mur (pas devant une ouverture)
  const g = undergroundGrid();
  const dugAt = (x: number, z: number) => {
    const i = Math.floor((x - g.x0) / UNDER.cell);
    const j = Math.floor((z - g.z0) / UNDER.cell);
    return i >= 0 && j >= 0 && i < g.nx && j < g.nz && g.dug[j * g.nx + i] === 1;
  };
  return out.filter((l) => !dugAt(l.x - Math.sin(l.rot) * 0.3, l.z - Math.cos(l.rot) * 0.3));
}

/** Salle ou galerie en un point (nom du lieu), null si l'on n'est pas sous terre. */
export function undergroundPlace(x: number, y: number, z: number): string | null {
  if (y > UNDER.floor + UNDER.height + 0.5) {
    const s = SHAFTS.find((q) => Math.abs(q.x - x) < 1.2 && Math.abs(q.z - z) < 1.2 && y < q.ground - 0.3);
    return s ? `Puits — ${s.name}` : null;
  }
  const r = ROOMS.find((q) => x >= q.x0 && x <= q.x1 && z >= q.z0 && z <= q.z1);
  if (r) return r.name;
  const g = undergroundGrid();
  const i = Math.floor((x - g.x0) / UNDER.cell);
  const j = Math.floor((z - g.z0) / UNDER.cell);
  if (i < 0 || j < 0 || i >= g.nx || j >= g.nz || !g.dug[j * g.nx + i]) return null;
  const near = SHAFTS.find((q) => Math.hypot(q.x - x, q.z - z) < 4);
  return near ? `Sous ${near.name.toLowerCase()}` : 'Galeries souterraines';
}

/** Rochers qui cachent l'entrée de la lisière (et la bloquent sur trois côtés). */
export function entranceRocks(): { x: number; z: number; w: number; d: number; h: number; rot: number }[] {
  const s = SHAFTS.find((q) => q.look === 'rochers')!;
  return [
    { x: s.x - 2.4, z: s.z - 0.6, w: 2.2, d: 3.2, h: 1.9, rot: 0.3 },
    { x: s.x + 2.5, z: s.z - 0.2, w: 2.0, d: 2.8, h: 2.3, rot: -0.4 },
    { x: s.x + 0.2, z: s.z - 2.6, w: 3.4, d: 1.8, h: 1.6, rot: 0.15 },
    { x: s.x - 3.6, z: s.z + 2.4, w: 1.4, d: 1.6, h: 1.1, rot: 0.8 },
  ].map((r) => ({ ...r, y: s.ground }));
}
