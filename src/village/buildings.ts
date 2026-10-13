/**
 * Construction 3D d'un bâtiment à partir de sa fiche (layout) et de son plan (plans) :
 *  - « exterieur » : socle, murs percés de leurs portes et fenêtres, colombages, encorbellement, cheminée ;
 *  - « interieur » : planchers, cloisons, escaliers et garde-corps, âtre, poutres apparentes, cave ;
 *  - « toit »      : versants, pignons, faîtage, plancher des combles. Groupe distinct : on peut le masquer
 *                    pour voir les pièces de l'étage (inspection, futur jeu vu de dessus).
 * Le mobilier est confié au `PropSet` (instancié pour tout le village).
 */
import * as THREE from 'three';
import { Batch, addSlab, addWall, compose, prismGeo, rng, type V3 } from './geom';
import { CHURCH_TOWER_DEPTH, PLINTH, baseOf, type BuildingSpec } from './layout';
import { FURN, INT_T, SLAB, STEP_RISE, planOf, stairRun, type Level, type Light, type Plan, type Rect, type Side, type Stair, type WallOpening } from './plans';
import { LANTERN_LIGHT, type PropSet } from './props';
import { PLASTER_TINTS, TILE_TINTS, VM } from './textures';

export interface WorldLight extends Light {
  /** lumière intérieure (seulement quand la caméra est proche) */
  indoor: boolean;
  building: string;
}

export interface BuiltBuilding {
  spec: BuildingSpec;
  plan: Plan;
  group: THREE.Group;
  roof: THREE.Group;
  interior: THREE.Group;
  /** repère local → monde */
  matrix: THREE.Matrix4;
  lights: WorldLight[];
  /** portes extérieures (monde) : position du seuil et direction de sortie */
  doors: { x: number; z: number; nx: number; nz: number; w: number }[];
  /** emprise de la cave (trou dans le terrain) */
  cellarHole: { x: number; z: number; rot: number; hw: number; hd: number } | null;
}

// ───────────────────────── matériaux ─────────────────────────

const STONE_TINTS = ['#ffffff', '#efe4d2', '#e0dad0', '#f4ead8', '#e6dccb', '#ddd4c4'];
const SHUTTER_TINTS = ['#4a5a3a', '#6a3a2a', '#3a4a5a', '#5a4632', '#4a3a2a', '#355070'];

function wallMat(kind: string, b: BuildingSpec) {
  const ruinTint = (c: string) => (b.kind === 'abandoned' ? new THREE.Color(c).multiply(new THREE.Color('#b0a898')).getStyle() : c);
  switch (kind) {
    case 'stone':
      return VM.stone(ruinTint(STONE_TINTS[b.tint % STONE_TINTS.length]));
    case 'stoneDark':
      return VM.stoneDark();
    case 'planks':
      return VM.planks(ruinTint(b.kind === 'stable' || b.kind === 'barn' ? '#9a7c5c' : '#b09474'));
    default:
      return VM.plaster(ruinTint(PLASTER_TINTS[b.tint % PLASTER_TINTS.length]));
  }
}
function roofMat(b: BuildingSpec) {
  switch (b.roof) {
    case 'tiles':
      return VM.roofTiles(TILE_TINTS[b.roofTint % TILE_TINTS.length]);
    case 'slate':
      return VM.slate();
    case 'thatch':
      return VM.thatch();
    default:
      return VM.woodShingles();
  }
}
const PITCH: Record<string, number> = { tiles: 0.7, slate: 0.82, shingles: 0.74, thatch: 0.9 };

function groundFloorMat(b: BuildingSpec, l: Level) {
  if (l.underground) return VM.dirtFloor();
  if (b.kind === 'forge' || b.kind === 'stable' || b.kind === 'barn') return VM.dirtFloor();
  if (b.kind === 'church' || b.kind === 'tavern' || b.kind === 'sheriff' || b.kind === 'bakery') return VM.flagstone();
  return (b.seed % 3) === 0 ? VM.flagstone() : VM.floorboards('#7a5a42');
}

// ───────────────────────── repères des façades ─────────────────────────

interface SideFrame {
  /** (abscisse le long du mur, hauteur, distance à la face extérieure vers l'extérieur) → repère du bâtiment */
  at(u: number, y: number, n: number): V3;
  /** rotation y d'une boîte dont l'axe x suit le mur */
  rotY: number;
  along: THREE.Vector3;
  out: THREE.Vector3;
}

function sideFrame(side: Side, O: Rect): SideFrame {
  switch (side) {
    case 'front':
      return { at: (u, y, n) => [u, y, O.z1 + n], rotY: 0, along: new THREE.Vector3(1, 0, 0), out: new THREE.Vector3(0, 0, 1) };
    case 'back':
      return { at: (u, y, n) => [u, y, O.z0 - n], rotY: 0, along: new THREE.Vector3(1, 0, 0), out: new THREE.Vector3(0, 0, -1) };
    case 'left':
      return { at: (u, y, n) => [O.x0 - n, y, u], rotY: -Math.PI / 2, along: new THREE.Vector3(0, 0, 1), out: new THREE.Vector3(-1, 0, 0) };
    default:
      return { at: (u, y, n) => [O.x1 + n, y, u], rotY: -Math.PI / 2, along: new THREE.Vector3(0, 0, 1), out: new THREE.Vector3(1, 0, 0) };
  }
}
const rotYOf = (d: THREE.Vector3) => Math.atan2(-d.z, d.x);

/** Boîte entre deux points (section `w` × `h`, la hauteur de section reste verticale autant que possible). */
function beamBetween(batch: Batch, mat: THREE.Material, a: V3, b: V3, w: number, h: number) {
  const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = d.length();
  const dir = d.clone().normalize();
  const up = Math.abs(dir.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const z = new THREE.Vector3().crossVectors(dir, up).normalize();
  const y = new THREE.Vector3().crossVectors(z, dir).normalize();
  const m = new THREE.Matrix4().makeBasis(dir, y, z);
  m.setPosition((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  const g = new THREE.BoxGeometry(len, h, w).toNonIndexed();
  batch.add(g, mat, m, 'local');
  g.dispose();
}

// ───────────────────────── construction ─────────────────────────

export function buildBuilding(b: BuildingSpec, props: PropSet): BuiltBuilding {
  const plan = planOf(b);
  const r = rng(b.seed + 91);
  const ext = new Batch();
  const int = new Batch();
  const roofB = new Batch();
  const floorY = baseOf(b) + PLINTH;
  const matrix = compose([b.x, floorY, b.z], [0, b.rot, 0]);
  const lights: WorldLight[] = [];
  const doors: BuiltBuilding['doors'] = [];
  const timber = VM.timber();
  const partitionMat = VM.plaster(b.kind === 'abandoned' ? '#a89c86' : '#ece2cc');
  const shutterMat = VM.planks(b.id === 'maison-j2' ? '#4a6a9a' : SHUTTER_TINTS[b.seed % SHUTTER_TINTS.length]);
  const levels = plan.levels;
  const habitable = levels.filter((l) => !l.underground && l.name !== 'Combles' && !isTower(b, l));
  const top = habitable[habitable.length - 1];
  const wallsMatOf = (l: Level) => (l.index === 0 || l.underground ? wallMat(b.ground, b) : wallMat(b.upper === 'timber' ? 'plaster' : b.upper, b));
  const toWorld = (p: V3): V3 => {
    const v = new THREE.Vector3(...p).applyMatrix4(matrix);
    return [v.x, v.y, v.z];
  };

  // ── socle (ou murs de cave) ──
  const G = levels.find((l) => l.index === 0)!;
  const hasCellar = levels.some((l) => l.underground);
  if (!hasCellar) {
    const O = b.kind === 'church' ? rect4(G.outer, 0, CHURCH_TOWER_DEPTH) : G.outer;
    ext.box(VM.stoneDark(), [O.x1 - O.x0 + 0.12, 1.8, O.z1 - O.z0 + 0.12], [(O.x0 + O.x1) / 2, -0.02 - 0.9, (O.z0 + O.z1) / 2]);
  }

  // ── niveaux : murs, planchers, cloisons ──
  for (const l of levels) {
    if (l.name === 'Combles') continue;
    const O = l.outer;
    const mat = wallsMatOf(l);
    const nextY = levels.find((x) => x.y > l.y + 0.01 && !isTower(b, x) === !isTower(b, l) && x.name !== 'Combles')?.y;
    const tower = isTower(b, l);
    let wallH = l.underground ? -l.y : nextY !== undefined && !(l === top && !tower) ? nextY - l.y : l === top ? plan.wallTop - l.y : l.h;
    if (tower && l === levels[levels.length - 1]) wallH = l.h;
    const y0 = l.underground ? l.y - SLAB : l.index === 0 || (tower && l.y === 0) ? -0.03 : l.y;
    const h = wallH + (l.y - y0);
    const t = l.t;
    const ops = plan.openings.filter((o) => o.level === l.index);
    const cut = (side: Side, mid: number) => ops.filter((o) => o.side === side).map((o) => ({ x: o.at - mid, w: o.w, y0: o.y0 + (l.y - y0), y1: o.y1 + (l.y - y0) }));
    const skip = new Set(l.skipWalls ?? []);
    const wm = l.underground ? VM.stoneDark() : mat;
    // murs de partie basse (hors sol) si une cave existe : le socle visible est le haut des murs de cave
    if (!skip.has('front')) addWall(ext, wm, [O.x0, O.z1 - t / 2], [O.x1, O.z1 - t / 2], y0, h, t, cut('front', 0));
    if (!skip.has('back')) addWall(ext, wm, [O.x0, O.z0 + t / 2], [O.x1, O.z0 + t / 2], y0, h, t, cut('back', 0));
    const zm = (O.z0 + O.z1) / 2;
    if (!skip.has('left')) addWall(ext, wm, [O.x0 + t / 2, O.z0 + t], [O.x0 + t / 2, O.z1 - t], y0, h, t, cut('left', zm));
    if (!skip.has('right')) addWall(ext, wm, [O.x1 - t / 2, O.z0 + t], [O.x1 - t / 2, O.z1 - t], y0, h, t, cut('right', zm));

    // colombages (étages en pan de bois)
    if (!l.underground && l.index > 0 && b.upper === 'timber' && !tower) halfTimber(ext, timber, l, ops, wallH, skip);

    // plancher (sauf trémies), poutres apparentes au plafond du niveau inférieur
    const fm = l.index === 0 || l.underground ? groundFloorMat(b, l) : VM.floorboards('#8a6a50');
    const I = l.inner;
    if (l.partialFloor) for (const pf of l.partialFloor) addSlab(int, fm, pf.x0, pf.x1, pf.z0, pf.z1, l.y, SLAB, l.holes);
    else if (!(tower && l.y === 0)) addSlab(int, fm, I.x0, I.x1, I.z0, I.z1, l.y, l.index === 0 && !hasCellar ? 0.05 : SLAB, l.holes);
    else addSlab(int, fm, I.x0, I.x1, I.z0 - 0.1, I.z1, l.y, 0.05, []);
    if (l.y > 0.5 && !tower) joists(int, timber, l, l.partialFloor?.[0]);
    if (l.partialFloor) loftEdge(int, timber, l);

    // cloisons
    for (const p of l.partitions) {
      const ph = p.kind === 'low' ? 1.4 : (p.h ?? wallH) - (l === top ? 0 : SLAB);
      if (p.kind === 'bars') bars(int, p.a, p.b, l.y, ph, p.doors);
      else addWall(int, partitionMat, p.a, p.b, l.y, ph, INT_T, p.doors.map((d) => ({ x: d.at - Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]) / 2, w: d.w, y0: 0, y1: d.h })));
      for (const d of p.doors) doorFrame(int, timber, p.a, p.b, d.at, d.w, d.h, l.y);
    }

    // ouvertures de façade
    for (const o of ops) opening(o, l, wallH, y0);

    // mobilier
    for (const it of l.items) {
      const [, , ih] = FURN[it.type];
      void ih;
      const m = new THREE.Matrix4().multiplyMatrices(
        matrix,
        new THREE.Matrix4().compose(
          new THREE.Vector3(it.x, l.y + (it.y ?? 0) + (it.tilt ? 0.12 : 0), it.z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(it.tilt ?? 0, it.rot, (it.tilt ?? 0) * 0.4, 'YXZ')),
          new THREE.Vector3(1, 1, 1),
        ),
      );
      props.add(it.type, m, false);
    }
  }

  // ── escaliers, échelles, garde-corps ──
  for (const s of plan.stairs) stair(s);

  // ── cheminée ──
  const roofInfo = roofGeometry();
  if (plan.chimney) chimney(plan.chimney, roofInfo);

  // ── volumes particuliers ──
  if (b.kind === 'church') churchExtras();
  if (b.kind === 'forge') forgeExtras();
  if (b.jetty > 0 && habitable.length > 1) jettyCorbels(habitable[0], habitable[1]);
  signsAndLanterns();

  // ── lumières ──
  for (const li of plan.lights) {
    const p = toWorld([li.x, li.y, li.z]);
    lights.push({ ...li, x: p[0], y: p[1], z: p[2], indoor: true, building: b.id });
  }

  const group = new THREE.Group();
  group.name = b.id;
  const exterior = ext.build('exterieur');
  const interior = int.build('interieur', { cast: false });
  const roof = roofB.build('toit');
  for (const g of [exterior, interior, roof]) {
    g.matrixAutoUpdate = false;
    g.matrix.copy(matrix);
    group.add(g);
  }
  group.userData = { id: b.id, name: b.name };
  const cellar = levels.find((l) => l.underground);
  const cellarHole = cellar ? { x: b.x, z: b.z, rot: b.rot, hw: (cellar.inner.x1 - cellar.inner.x0) / 2, hd: (cellar.inner.z1 - cellar.inner.z0) / 2 } : null;
  return { spec: b, plan, group, roof, interior, matrix, lights, doors, cellarHole };

  // ───────────── fonctions internes ─────────────

  function opening(o: WallOpening, l: Level, wallH: number, y0: number) {
    void wallH;
    void y0;
    const O = l.outer;
    const t = l.t;
    const F = sideFrame(o.side, O);
    const yb = l.y + o.y0;
    const yt = l.y + o.y1;
    const h = o.y1 - o.y0;
    const add = (batch: Batch, mat: THREE.Material, size: V3, u: number, y: number, n: number, extraRot = 0) => batch.box(mat, size, F.at(u, y, n), { rot: [0, F.rotY + extraRot, 0], uv: 'local' });
    const plane = (mat: THREE.Material, w: number, hh: number, u: number, y: number, n: number, outward: boolean) => {
      const g = new THREE.PlaneGeometry(w, hh);
      const ry = rotYOf(F.along) + (outward ? 0 : Math.PI);
      ext.add(g, mat, compose(F.at(u, y, n), [0, ry, 0]), 'local');
      g.dispose();
    };
    const stoneish = (o.level === 0 ? b.ground : b.upper) !== 'timber';
    const ruined = plan.ruined;

    if (o.kind === 'window') {
      // dormant, meneau et traverse, vitres (éclairée vers l'extérieur, sombre vers l'intérieur), appui, linteau
      const fd = 0.16;
      add(ext, timber, [0.08, h, fd], o.at - o.w / 2 + 0.04, yb + h / 2, -fd / 2 - 0.02);
      add(ext, timber, [0.08, h, fd], o.at + o.w / 2 - 0.04, yb + h / 2, -fd / 2 - 0.02);
      add(ext, timber, [o.w, 0.08, fd], o.at, yt - 0.04, -fd / 2 - 0.02);
      add(ext, timber, [o.w, 0.08, fd], o.at, yb + 0.04, -fd / 2 - 0.02);
      if (o.boarded || ruined) {
        plane(VM.paint('#060606', 1), o.w - 0.1, h - 0.1, o.at, yb + h / 2, -0.25, true);
        for (let k = 0; k < 3; k++) add(ext, VM.planks('#7a6a58'), [o.w + 0.25, 0.14, 0.03], o.at, yb + h * (0.25 + k * 0.25), 0.03, k === 1 ? 0 : 0);
        ext.box(VM.planks('#6a5a48'), [Math.hypot(o.w, h) * 0.9, 0.12, 0.03], F.at(o.at, yb + h / 2, 0.06), { rot: [0, F.rotY, 0], uv: 'local' });
      } else {
        add(ext, timber, [0.05, h - 0.1, 0.06], o.at, yb + h / 2, -0.1);
        add(ext, timber, [o.w - 0.1, 0.05, 0.06], o.at, yb + h * 0.62, -0.1);
        plane(o.lit ? VM.litWindow() : VM.darkWindow(), o.w - 0.1, h - 0.1, o.at, yb + h / 2, -0.12, true);
        plane(VM.darkWindow(), o.w - 0.1, h - 0.1, o.at, yb + h / 2, -0.13, false);
      }
      add(ext, VM.stone('#cfc6b6'), [o.w + 0.22, 0.08, 0.2], o.at, yb - 0.04, 0.04);
      if (stoneish) add(ext, timber, [o.w + 0.36, 0.16, 0.14], o.at, yt + 0.08, 0.02);
      if (o.shutters) {
        const sw = o.w / 2;
        for (const sx of [-1, 1]) {
          const broken = ruined && sx > 0;
          add(ext, shutterMat, [sw, h - 0.04, 0.04], o.at + sx * (o.w / 2 + sw / 2 + 0.03), yb + h / 2 - (broken ? 0.15 : 0), 0.03, broken ? 0.25 : 0);
          add(ext, timber, [sw * 0.9, 0.06, 0.05], o.at + sx * (o.w / 2 + sw / 2 + 0.03), yb + h * 0.25, 0.05);
          add(ext, timber, [sw * 0.9, 0.06, 0.05], o.at + sx * (o.w / 2 + sw / 2 + 0.03), yb + h * 0.75, 0.05);
        }
      }
      // jardinière fleurie sous quelques fenêtres d'étage
      if (!ruined && o.level > 0 && r() < 0.18) {
        add(ext, VM.planks('#7a5a3a'), [o.w, 0.18, 0.22], o.at, yb - 0.14, 0.14);
        for (let k = 0; k < 4; k++) {
          const g = new THREE.SphereGeometry(0.09, 7, 5);
          ext.add(g, VM.paint(k % 2 ? '#a83a4a' : '#4a6a32', 0.9), compose(F.at(o.at - o.w / 2 + 0.15 + k * ((o.w - 0.3) / 3), yb - 0.02, 0.14)), 'local');
          g.dispose();
        }
      }
      return;
    }

    if (o.kind === 'door' || o.kind === 'big-door') {
      const ground = o.level === 0 || (b.kind === 'church' && l.y === 0);
      add(ext, timber, [0.12, h + 0.06, t + 0.04], o.at - o.w / 2 - 0.04, yb + h / 2, -t / 2);
      add(ext, timber, [0.12, h + 0.06, t + 0.04], o.at + o.w / 2 + 0.04, yb + h / 2, -t / 2);
      add(ext, timber, [o.w + 0.4, 0.2, t + 0.06], o.at, yt + 0.1, -t / 2);
      const leafMat = VM.planks(ruined ? '#6a5a48' : '#8a6446');
      const leaves = o.kind === 'big-door' ? 2 : 1;
      const lw = o.w / leaves;
      for (let k = 0; k < leaves; k++) {
        const sign = leaves === 1 ? -1 : k === 0 ? -1 : 1;
        // gond côté `sign`, vantail ouvert vers l'intérieur (portes) ou rabattu vers l'extérieur (grandes portes)
        const angle = o.kind === 'big-door' ? 1.9 : ruined ? 1.7 : o.side === 'front' ? 1.15 : 0.35;
        const outward = o.kind === 'big-door';
        const hingeU = o.at + sign * (o.w / 2 - 0.04);
        const hingeN = outward ? 0.05 : -t + 0.06;
        const toward = F.along.clone().multiplyScalar(-sign);
        const dir = toward.clone().multiplyScalar(Math.cos(angle)).add(F.out.clone().multiplyScalar(outward ? Math.sin(angle) : -Math.sin(angle)));
        const hinge = new THREE.Vector3(...F.at(hingeU, yb, hingeN));
        const c = hinge.clone().add(dir.clone().multiplyScalar(lw / 2 - 0.02));
        const ry = rotYOf(dir);
        const lh = h - 0.04;
        ext.box(leafMat, [lw - 0.05, lh, 0.07], [c.x, yb + lh / 2 + (ruined && k === 0 ? -0.05 : 0), c.z], { rot: [0, ry, ruined ? 0.05 : 0], uv: 'local' });
        for (const fy of [0.25, 0.75]) ext.box(VM.iron(), [lw * 0.85, 0.06, 0.09], [c.x, yb + lh * fy, c.z], { rot: [0, ry, 0], uv: 'local' });
      }
      if (ground) {
        // seuil de pierre et marche dehors
        add(ext, VM.stone('#bdb4a4'), [o.w + 0.3, 0.12, t], o.at, -0.04, -t / 2);
        add(ext, VM.stone('#bdb4a4'), [o.w + 0.5, PLINTH + 0.25, 0.55], o.at, -PLINTH / 2 - 0.16, 0.27);
        const p = toWorld(F.at(o.at, 0, 0.6));
        const n = F.out.clone().transformDirection(matrix);
        doors.push({ x: p[0], z: p[2], nx: n.x, nz: n.z, w: o.w });
      }
      return;
    }

    if (o.kind === 'arch' || o.kind === 'lancet' || o.kind === 'belfry') {
      const pointed = o.kind !== 'arch';
      const w = o.w;
      const pts: [number, number][] = [];
      const apex = o.y1 - 0.06;
      if (!pointed) {
        const rr = w / 2;
        const cy = apex - rr;
        pts.push([-w / 2, cy]);
        for (let k = 1; k < 12; k++) {
          const a = Math.PI - (k / 12) * Math.PI;
          pts.push([Math.cos(a) * rr, cy + Math.sin(a) * rr]);
        }
        pts.push([w / 2, cy], [w / 2, o.y1], [-w / 2, o.y1]);
      } else {
        const ys = apex - 0.866 * w;
        pts.push([-w / 2, ys]);
        for (let k = 1; k < 8; k++) {
          const a = Math.PI - (k / 8) * (Math.PI / 3);
          pts.push([w / 2 + Math.cos(a) * w, ys + Math.sin(a) * w]);
        }
        pts.push([0, apex]);
        for (let k = 7; k >= 1; k--) {
          const a = (k / 8) * (Math.PI / 3);
          pts.push([-w / 2 + Math.cos(a) * w, ys + Math.sin(a) * w]);
        }
        pts.push([w / 2, ys], [w / 2, o.y1], [-w / 2, o.y1]);
      }
      const g = prismGeo(pts, t);
      ext.add(g, wallsMatOf(l), compose(F.at(o.at, l.y, -t / 2), [0, F.rotY, 0]), 'project');
      g.dispose();
      // claveaux : bandeau de pierre claire autour de l'arc
      add(ext, VM.stone('#cfc6b6'), [0.16, h * 0.6, 0.1], o.at - w / 2 - 0.08, yb + h * 0.3, 0.03);
      add(ext, VM.stone('#cfc6b6'), [0.16, h * 0.6, 0.1], o.at + w / 2 + 0.08, yb + h * 0.3, 0.03);
      if (o.kind === 'lancet') {
        const gh = o.y1 - o.y0 - 0.1;
        plane(o.lit ? VM.litWindow() : VM.darkWindow(), w - 0.06, gh, o.at, yb + gh / 2, -t / 2, true);
        plane(VM.darkWindow(), w - 0.06, gh, o.at, yb + gh / 2, -t / 2 - 0.01, false);
        if (w > 1) add(ext, VM.stone('#cfc6b6'), [0.08, gh, 0.12], o.at, yb + gh / 2, -t / 2);
      }
      if (o.kind === 'belfry') for (let k = 0; k < 5; k++) ext.box(timber, [w, 0.04, 0.32], F.at(o.at, yb + 0.35 + k * 0.42, -t / 2), { rot: [0.6 * (o.side === 'back' || o.side === 'left' ? -1 : 1) * 0, F.rotY, 0], uv: 'local' });
      if (o.kind === 'arch' && o.shutters) {
        // portail à deux vantaux entrouverts
        for (const sx of [-1, 1]) {
          const hinge = new THREE.Vector3(...F.at(o.at + sx * (w / 2 - 0.04), yb, -t + 0.08));
          const dir = F.along.clone().multiplyScalar(-sx).multiplyScalar(Math.cos(0.5)).add(F.out.clone().multiplyScalar(-Math.sin(0.5)));
          const c = hinge.clone().add(dir.clone().multiplyScalar(w / 4));
          ext.box(VM.planks('#5a4030'), [w / 2 - 0.04, o.y1 - o.y0 - w / 2, 0.09], [c.x, yb + (o.y1 - o.y0 - w / 2) / 2, c.z], { rot: [0, rotYOf(dir), 0], uv: 'local' });
        }
      }
      // portails extérieurs (vantaux) : dégagement devant la porte pour le décor
      if (o.kind === 'arch' && o.shutters && l.y === 0) {
        const p = toWorld(F.at(o.at, 0, 0.8));
        const n = F.out.clone().transformDirection(matrix);
        doors.push({ x: p[0], z: p[2], nx: n.x, nz: n.z, w: o.w });
      }
    }
  }

  function halfTimber(batch: Batch, mat: THREE.Material, l: Level, ops: WallOpening[], H: number, skip: Set<Side>) {
    const O = l.outer;
    for (const side of ['front', 'back', 'left', 'right'] as Side[]) {
      if (skip.has(side)) continue;
      const F = sideFrame(side, O);
      const [a0, a1] = side === 'front' || side === 'back' ? [O.x0, O.x1] : [O.z0, O.z1];
      const n = 0.02;
      const put = (u: number, y: number, w: number, h: number, rot = 0) => batch.box(mat, [w, h, 0.08], F.at(u, y, n), { rot: [0, F.rotY, rot], uv: 'local' });
      put((a0 + a1) / 2, l.y + 0.09, a1 - a0, 0.18);
      put((a0 + a1) / 2, l.y + H - 0.09, a1 - a0, 0.18);
      // poteaux : angles, bords des baies, intermédiaires
      const sideOps = ops.filter((o) => o.side === side);
      const posts = new Set<number>([a0 + 0.08, a1 - 0.08]);
      for (const o of sideOps) {
        posts.add(o.at - o.w / 2 - 0.1);
        posts.add(o.at + o.w / 2 + 0.1);
      }
      const sorted = [...posts].sort((p, q) => p - q);
      const all: number[] = [];
      for (let i = 0; i < sorted.length; i++) {
        all.push(sorted[i]);
        if (i < sorted.length - 1) {
          const gap = sorted[i + 1] - sorted[i];
          const inOpening = sideOps.some((o) => sorted[i] >= o.at - o.w / 2 - 0.2 && sorted[i + 1] <= o.at + o.w / 2 + 0.2);
          if (!inOpening && gap > 1.5) {
            const k = Math.ceil(gap / 1.3);
            for (let j = 1; j < k; j++) all.push(sorted[i] + (gap * j) / k);
          }
        }
      }
      all.sort((p, q) => p - q);
      for (const u of all) put(u, l.y + H / 2, 0.16, H - 0.2);
      // traverse d'allège et écharpes dans les panneaux pleins
      const ySill = l.y + 0.9;
      for (let i = 0; i < all.length - 1; i++) {
        const u0 = all[i];
        const u1 = all[i + 1];
        const mid = (u0 + u1) / 2;
        const hasOp = sideOps.some((o) => o.at > u0 && o.at < u1);
        if (hasOp) continue;
        put(mid, ySill, u1 - u0 - 0.16, 0.12);
        const w = u1 - u0 - 0.16;
        if (w > 0.45 && w < 1.8) {
          const hh = H - 0.36;
          const len = Math.hypot(w, hh * 0.5);
          const ang = Math.atan2(hh * 0.5, w) * (i % 2 ? 1 : -1);
          put(mid, l.y + 0.18 + hh * 0.75, len, 0.12, ang);
        }
      }
    }
  }

  function joists(batch: Batch, mat: THREE.Material, l: Level, only?: Rect) {
    const below = levels.filter((x) => x.y < l.y - 0.01 && !isTower(b, x)).pop();
    const I = only ?? (below ? below.inner : l.inner);
    const alongX = I.x1 - I.x0 < I.z1 - I.z0;
    const span = alongX ? I.x1 - I.x0 : I.z1 - I.z0;
    const len = alongX ? I.z1 - I.z0 : I.x1 - I.x0;
    const n = Math.max(2, Math.floor(len / 0.9));
    for (let k = 0; k <= n; k++) {
      const c = (alongX ? I.z0 : I.x0) + 0.1 + (k * (len - 0.2)) / n;
      const cx = alongX ? (I.x0 + I.x1) / 2 : c;
      const cz = alongX ? c : (I.z0 + I.z1) / 2;
      const hit = l.holes.some((h) => (alongX ? c > h.z0 - 0.08 && c < h.z1 + 0.08 : c > h.x0 - 0.08 && c < h.x1 + 0.08));
      if (hit) continue;
      batch.box(mat, alongX ? [span, 0.18, 0.14] : [0.14, 0.18, span], [cx, l.y - SLAB - 0.09, cz], { uv: 'local' });
    }
  }

  function loftEdge(batch: Batch, mat: THREE.Material, l: Level) {
    const pf = l.partialFloor![0];
    batch.box(mat, [pf.x1 - pf.x0, 0.25, 0.2], [(pf.x0 + pf.x1) / 2, l.y - 0.12, pf.z1], { uv: 'local' });
    for (let x = pf.x0 + 0.3; x < pf.x1; x += 1.2) {
      batch.box(mat, [0.12, 0.95, 0.12], [x, l.y + 0.47, pf.z1 - 0.06], { uv: 'local' });
      batch.box(mat, [0.18, l.y, 0.18], [x, l.y / 2, pf.z1 + 0.05], { uv: 'local' });
    }
    batch.box(mat, [pf.x1 - pf.x0, 0.08, 0.08], [(pf.x0 + pf.x1) / 2, l.y + 0.95, pf.z1 - 0.06], { uv: 'local' });
  }

  function bars(batch: Batch, a: [number, number], c: [number, number], y: number, h: number, ds: { at: number; w: number }[]) {
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const ux = (c[0] - a[0]) / len;
    const uz = (c[1] - a[1]) / len;
    const iron = VM.iron();
    for (let s = 0.08; s < len; s += 0.14) {
      const door = ds.find((d) => s > d.at - d.w / 2 && s < d.at + d.w / 2);
      if (door) continue;
      batch.box(iron, [0.03, h, 0.03], [a[0] + ux * s, y + h / 2, a[1] + uz * s], { uv: 'local' });
    }
    for (const yy of [0.08, 1.1, h - 0.08]) batch.box(iron, [Math.abs(ux) > 0.5 ? len : 0.05, 0.06, Math.abs(ux) > 0.5 ? 0.05 : len], [(a[0] + c[0]) / 2, y + yy, (a[1] + c[1]) / 2], { uv: 'local' });
    // porte grillagée entrouverte
    for (const d of ds) {
      const hx = a[0] + ux * (d.at - d.w / 2);
      const hz = a[1] + uz * (d.at - d.w / 2);
      const ang = 0.5;
      const dx = ux * Math.cos(ang) - uz * Math.sin(ang);
      const dz = uz * Math.cos(ang) + ux * Math.sin(ang);
      for (let s = 0.06; s < d.w; s += 0.14) batch.box(iron, [0.03, 2.0, 0.03], [hx + dx * s, y + 1.0, hz + dz * s], { uv: 'local' });
      for (const yy of [0.1, 1.0, 1.95]) batch.box(iron, [d.w, 0.05, 0.04], [hx + (dx * d.w) / 2, y + yy, hz + (dz * d.w) / 2], { rot: [0, Math.atan2(-dz, dx), 0], uv: 'local' });
    }
  }

  function doorFrame(batch: Batch, mat: THREE.Material, a: [number, number], c: [number, number], at: number, w: number, h: number, y: number) {
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const ux = (c[0] - a[0]) / len;
    const uz = (c[1] - a[1]) / len;
    const ry = Math.atan2(-uz, ux);
    const px = (s: number) => [a[0] + ux * s, a[1] + uz * s] as const;
    const [lx, lz] = px(at - w / 2 - 0.05);
    const [rx, rz] = px(at + w / 2 + 0.05);
    const [mx, mz] = px(at);
    batch.box(mat, [0.1, h, INT_T + 0.04], [lx, y + h / 2, lz], { rot: [0, ry, 0], uv: 'local' });
    batch.box(mat, [0.1, h, INT_T + 0.04], [rx, y + h / 2, rz], { rot: [0, ry, 0], uv: 'local' });
    batch.box(mat, [w + 0.2, 0.12, INT_T + 0.04], [mx, y + h + 0.06, mz], { rot: [0, ry, 0], uv: 'local' });
  }

  function stair(s: Stair) {
    const from = levels[s.from];
    const y = from.y;
    const R = s.rect;
    const alongZ = Math.abs(s.dir[1]) > 0.5;
    const len = alongZ ? R.z1 - R.z0 : R.x1 - R.x0;
    const width = alongZ ? R.x1 - R.x0 : R.z1 - R.z0;
    const start = alongZ ? (s.dir[1] > 0 ? R.z0 : R.z1) : s.dir[0] > 0 ? R.x0 : R.x1;
    const sg = alongZ ? s.dir[1] : s.dir[0];
    const cw = alongZ ? (R.x0 + R.x1) / 2 : (R.z0 + R.z1) / 2;
    const P = (along: number, yy: number, across: number): V3 => (alongZ ? [cw + across, yy, start + sg * along] : [start + sg * along, yy, cw + across]);
    const wood = VM.planks('#8a6a4a');
    if (s.kind === 'ladder') {
      for (const sx of [-1, 1]) beamBetween(int, VM.timber(), P(0, y, (sx * width) / 2 - sx * 0.04), P(len, y + s.rise + 0.4, (sx * width) / 2 - sx * 0.04), 0.07, 0.09);
      const n = Math.floor((s.rise + 0.3) / 0.3);
      for (let k = 1; k <= n; k++) {
        const f = (k * 0.3) / (s.rise + 0.4);
        const p = P(len * f, y + (s.rise + 0.4) * f, 0);
        int.box(VM.timber(), alongZ ? [width - 0.06, 0.045, 0.045] : [0.045, 0.045, width - 0.06], p, { uv: 'local' });
      }
      return;
    }
    const n = Math.ceil(s.rise / STEP_RISE);
    const rise = s.rise / n;
    const run = stairRun(s.rise) / n;
    for (let k = 0; k < n; k++) {
      const p = P((k + 0.5) * run, y + (k + 1) * rise - 0.025, 0);
      int.box(wood, alongZ ? [width - 0.1, 0.05, run + 0.03] : [run + 0.03, 0.05, width - 0.1], p, { uv: 'local' });
      // contremarche pleine pour les premières marches (escalier massif en bas)
      int.box(VM.timber(), alongZ ? [width - 0.1, rise, 0.03] : [0.03, rise, width - 0.1], P(k * run + 0.015, y + k * rise + rise / 2, 0), { uv: 'local' });
    }
    // limons
    const total = n * run;
    for (const sx of [-1, 1]) beamBetween(int, VM.timber(), P(0, y + 0.1, (sx * width) / 2), P(total, y + s.rise + 0.1, (sx * width) / 2), 0.06, 0.3);
    // rampe du côté opposé au mur le plus proche
    const lvl = from;
    const distWall = alongZ ? [R.x0 - lvl.inner.x0, lvl.inner.x1 - R.x1] : [R.z0 - lvl.inner.z0, lvl.inner.z1 - R.z1];
    const open = distWall[0] > distWall[1] ? -1 : 1;
    const ra = P(0, y + 0.95, (open * width) / 2);
    const rb = P(total, y + s.rise + 0.95, (open * width) / 2);
    beamBetween(int, VM.timber(), ra, rb, 0.06, 0.07);
    for (const f of [0, 0.5, 1]) {
      const p = P(total * f, y + s.rise * f + 0.47, (open * width) / 2);
      int.box(VM.timber(), [0.07, 0.95, 0.07], p, { uv: 'local' });
    }
    // garde-corps autour de la trémie à l'arrivée (sauf côté sortie et côtés contre un mur)
    const to = levels.find((l) => Math.abs(l.y - (y + s.rise)) < 0.01);
    if (!to) return;
    const H = to.holes.find((h) => h.x0 <= R.x0 + 0.01 && h.x1 >= R.x1 - 0.01 && h.z0 <= R.z0 + 0.01 && h.z1 >= R.z1 - 0.01);
    if (!H) return;
    const I = to.inner;
    const edges: { a: [number, number]; b: [number, number] }[] = [];
    const exitSide = alongZ ? (s.dir[1] > 0 ? 'z1' : 'z0') : s.dir[0] > 0 ? 'x1' : 'x0';
    if (exitSide !== 'z0' && H.z0 - I.z0 > 0.15) edges.push({ a: [H.x0, H.z0], b: [H.x1, H.z0] });
    if (exitSide !== 'z1' && I.z1 - H.z1 > 0.15) edges.push({ a: [H.x0, H.z1], b: [H.x1, H.z1] });
    if (exitSide !== 'x0' && H.x0 - I.x0 > 0.15) edges.push({ a: [H.x0, H.z0], b: [H.x0, H.z1] });
    if (exitSide !== 'x1' && I.x1 - H.x1 > 0.15) edges.push({ a: [H.x1, H.z0], b: [H.x1, H.z1] });
    for (const e of edges) {
      const L = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]);
      const mx = (e.a[0] + e.b[0]) / 2;
      const mz = (e.a[1] + e.b[1]) / 2;
      const ax = Math.abs(e.b[0] - e.a[0]) > 0.01;
      int.box(VM.timber(), ax ? [L, 0.07, 0.07] : [0.07, 0.07, L], [mx, to.y + 0.95, mz], { uv: 'local' });
      int.box(VM.timber(), ax ? [L, 0.05, 0.05] : [0.05, 0.05, L], [mx, to.y + 0.5, mz], { uv: 'local' });
      const np = Math.max(2, Math.ceil(L / 0.9) + 1);
      for (let k = 0; k < np; k++) {
        const f = k / (np - 1);
        int.box(VM.timber(), [0.07, 0.95, 0.07], [e.a[0] + (e.b[0] - e.a[0]) * f, to.y + 0.47, e.a[1] + (e.b[1] - e.a[1]) * f], { uv: 'local' });
      }
    }
  }

  /** Toit à deux versants sur le dernier niveau ; renvoie la hauteur du toit en un point (repère local). */
  function roofGeometry(): (x: number, z: number) => number {
    if (b.kind === 'church') return churchRoof();
    const R = top.outer;
    const axisX = b.kind === 'barn' ? false : b.id === 'maison-pignon' || b.id === 'maison-etroite' ? false : b.kind === 'stable' ? true : r() < 0.72 ? (R.x1 - R.x0) >= (R.z1 - R.z0) * 0.8 : false;
    const pitch = PITCH[b.roof] ?? 0.75;
    return gable(roofB, R, plan.wallTop, axisX, pitch, roofMat(b), wallsMatOf(top), b.roof === 'thatch' ? 0.42 : 0.16, true);
  }

  function gable(batch: Batch, R: Rect, wallTop: number, axisX: boolean, pitch: number, rm: THREE.Material, gm: THREE.Material, th: number, attic: boolean): (x: number, z: number) => number {
    const xc = (R.x0 + R.x1) / 2;
    const zc = (R.z0 + R.z1) / 2;
    const Lr = axisX ? R.x1 - R.x0 : R.z1 - R.z0;
    const S = axisX ? R.z1 - R.z0 : R.x1 - R.x0;
    const tanp = Math.tan(pitch);
    const rise = (S / 2) * tanp;
    const ov = 0.55;
    const gov = 0.4;
    const frame = new THREE.Matrix4().makeTranslation(xc, wallTop, zc).multiply(new THREE.Matrix4().makeRotationY(axisX ? 0 : -Math.PI / 2));
    const put = (geo: THREE.BufferGeometry, mat: THREE.Material, pos: V3, rot: V3, uv: 'local' | 'project' = 'local') => batch.add(geo, mat, new THREE.Matrix4().multiplyMatrices(frame, compose(pos, rot)), uv);
    const boxF = (mat: THREE.Material, size: V3, pos: V3, rot: V3 = [0, 0, 0], uv: 'local' | 'project' = 'local') => {
      const g = new THREE.BoxGeometry(...size).toNonIndexed();
      // UV en mètres
      const uvA = g.getAttribute('uv') as THREE.BufferAttribute;
      const nA = g.getAttribute('normal') as THREE.BufferAttribute;
      for (let i = 0; i < uvA.count; i++) {
        const ax = Math.abs(nA.getX(i));
        const ay = Math.abs(nA.getY(i));
        const [su, sv] = ax > 0.5 ? [size[2], size[1]] : ay > 0.5 ? [size[0], size[2]] : [size[0], size[1]];
        uvA.setXY(i, uvA.getX(i) * su, uvA.getY(i) * sv);
      }
      put(g, mat, pos, rot, uv);
      g.dispose();
    };
    const Ls = (S / 2 + ov) / Math.cos(pitch);
    const ruined = plan.ruined;
    for (const sv of [-1, 1]) {
      const mid = (S / 2 + ov) / 2;
      const nrm = new THREE.Vector3(0, Math.cos(pitch), sv * Math.sin(pitch));
      const c = new THREE.Vector3(0, rise - mid * tanp, sv * mid).add(nrm.clone().multiplyScalar(th / 2));
      const rot: V3 = [sv * pitch, 0, 0];
      if (ruined && sv > 0) {
        // versant crevé : seules les extrémités restent, chevrons à nu au milieu
        const seg = (Lr + 2 * gov) / 3;
        for (const k of [-1, 1]) boxF(rm, [seg, th, Ls], [k * seg, c.y, c.z], rot);
        for (let k = -1; k <= 1; k++) beamBetween(batch, VM.timber(), toLocal(frame, [k * seg * 0.45, rise, 0]), toLocal(frame, [k * seg * 0.45, -ov * tanp, S / 2 + ov]), 0.12, 0.14);
        boxF(rm, [seg * 0.5, th, Ls * 0.4], [0, c.y - Ls * 0.3 * Math.sin(pitch), c.z + Ls * 0.3 * Math.cos(pitch)], rot);
      } else boxF(rm, [Lr + 2 * gov, th, Ls], [c.x, c.y, c.z], rot);
      // lambris sous le toit (visible depuis les combles et les volumes ouverts)
      const inner = new THREE.Vector3(0, rise - (S / 4) * tanp, (sv * S) / 4).add(nrm.clone().multiplyScalar(-0.03));
      boxF(VM.planks('#7a6450'), [Lr - 0.1, 0.03, (S / 2) / Math.cos(pitch) - 0.05], [inner.x, inner.y, inner.z], rot);
      // planche de rive sous l'égout
      boxF(VM.timber(), [Lr + 2 * gov, 0.22, 0.06], [0, -ov * tanp - 0.05, sv * (S / 2 + ov)], [0, 0, 0]);
    }
    // faîtage
    if (b.roof === 'thatch') {
      const g = new THREE.CylinderGeometry(0.32, 0.32, Lr + 2 * gov, 10);
      put(g, rm, [0, rise + 0.16, 0], [0, 0, Math.PI / 2]);
      g.dispose();
    } else boxF(b.roof === 'tiles' ? rm : VM.stoneDark(), [Lr + 2 * gov + 0.02, 0.16, 0.36], [0, rise + th * 0.9, 0]);
    // pignons (triangles de mur) et planches de rive
    for (const sx of [-1, 1]) {
      const t = sx < 0 ? (axisX ? top.t : top.t) : top.t;
      const tri = prismGeo([[-S / 2, 0], [S / 2, 0], [0, rise]], t);
      put(tri, gm, [sx * (Lr / 2 - t / 2), 0, 0], [0, -Math.PI / 2, 0], 'project');
      tri.dispose();
      for (const sv of [-1, 1]) {
        const a = toLocal(frame, [sx * (Lr / 2 + gov), -ov * tanp + th, sv * (S / 2 + ov)]);
        const bb = toLocal(frame, [sx * (Lr / 2 + gov), rise + th, 0]);
        beamBetween(batch, VM.timber(), a, bb, 0.06, 0.24);
      }
      if (b.upper === 'timber') {
        // pan de bois du pignon
        const yb = rise * 0.45;
        boxF(VM.timber(), [0.09, 0.16, S * 0.55], [sx * (Lr / 2 + 0.02), yb, 0], [0, 0, 0]);
        boxF(VM.timber(), [0.09, rise - 0.2, 0.16], [sx * (Lr / 2 + 0.02), rise / 2, 0], [0, 0, 0]);
        for (const sv of [-1, 1]) beamBetween(batch, VM.timber(), toLocal(frame, [sx * (Lr / 2 + 0.03), 0.1, sv * S * 0.3]), toLocal(frame, [sx * (Lr / 2 + 0.03), yb, sv * 0.1]), 0.08, 0.14);
      }
    }
    // plancher des combles (plafond du dernier étage), avec trappe éventuelle
    if (attic && b.kind !== 'stable' && b.kind !== 'barn') {
      const I = top.inner;
      const holes = levels.filter((l) => l.name === 'Combles').flatMap((l) => l.holes);
      addSlab(batch, VM.floorboards('#7a5a42'), I.x0, I.x1, I.z0, I.z1, wallTop, SLAB, holes);
      joists(batch, VM.timber(), { ...top, y: wallTop, holes } as Level);
    } else {
      // entraits et poinçons apparents (granges, écuries)
      const n = Math.max(2, Math.floor(Lr / 3));
      for (let k = 0; k <= n; k++) {
        const x = -Lr / 2 + 0.3 + (k * (Lr - 0.6)) / n;
        boxF(VM.timber(), [0.2, 0.24, S - 0.2], [x, 0.12, 0]);
        boxF(VM.timber(), [0.18, rise - 0.3, 0.18], [x, rise / 2, 0]);
        for (const sv of [-1, 1]) beamBetween(batch, VM.timber(), toLocal(frame, [x, 0.2, sv * (S / 2 - 0.4)]), toLocal(frame, [x, rise * 0.7, sv * 0.1]), 0.14, 0.14);
      }
    }
    return (x: number, z: number) => {
      const d = axisX ? Math.abs(z - zc) : Math.abs(x - xc);
      return wallTop + Math.max(0, rise - d * tanp);
    };
  }

  function churchRoof(): (x: number, z: number) => number {
    const nave = levels[0];
    const f = gable(roofB, nave.outer, 9.5, false, 0.95, VM.slate(), wallMat('stone', b), 0.2, false);
    // clocher : flèche d'ardoise, croix, chambre des cloches
    const T = levels[levels.length - 1];
    const ty = T.y + T.h;
    const O = T.outer;
    const cx = (O.x0 + O.x1) / 2;
    const cz = (O.z0 + O.z1) / 2;
    const half = (O.x1 - O.x0) / 2;
    addSlab(roofB, VM.floorboards('#6a5040'), O.x0 + T.t, O.x1 - T.t, O.z0 + T.t, O.z1 - T.t, ty, SLAB);
    roofB.box(VM.stone('#d8d0c2'), [O.x1 - O.x0 + 0.3, 0.3, O.z1 - O.z0 + 0.3], [cx, ty + 0.15, cz]);
    const spire = new THREE.ConeGeometry((half + 0.25) * Math.SQRT2, 10, 4, 1, true);
    roofB.add(spire, VM.slate(), compose([cx, ty + 0.3 + 5, cz], [0, Math.PI / 4, 0]), 'local');
    spire.dispose();
    roofB.box(VM.iron(), [0.08, 1.4, 0.08], [cx, ty + 10.9, cz]);
    roofB.box(VM.iron(), [0.6, 0.08, 0.08], [cx, ty + 11.2, cz]);
    const bellLevel = levels[levels.length - 1];
    const bm = new THREE.Matrix4().multiplyMatrices(matrix, compose([cx, bellLevel.y + 1.3, cz]));
    props.add('bell', bm, true);
    // contreforts le long de la nef
    const I = nave.inner;
    for (let k = 0; k < 5; k++) {
      const z = I.z0 + 2.2 + k * ((I.z1 - I.z0 - 4.4) / 4);
      for (const sx of [-1, 1]) {
        ext.box(VM.stone('#e0d8c8'), [0.9, 6.5, 1.0], [sx * (nave.outer.x1 + 0.4), 3.2, z]);
        ext.box(VM.stone('#e0d8c8'), [0.6, 2.4, 0.8], [sx * (nave.outer.x1 + 0.28), 7.5, z]);
      }
    }
    // chœur : marche et dallage surélevé
    const choir = nave.rooms.find((x) => x.type === 'choeur')!.rect;
    int.box(VM.flagstone(), [choir.x1 - choir.x0, 0.2, 0.4], [0, 0.1, choir.z1 + 0.2]);
    // poutres de la charpente apparente
    return f;
  }

  function chimney(c: Rect, roofAt: (x: number, z: number) => number) {
    const stone = b.ground === 'stoneDark' ? VM.stoneDark() : VM.stone('#d8cfc0');
    const g0 = levels.find((l) => l.index === 0)!;
    const I = g0.inner;
    const zc = (c.z0 + c.z1) / 2;
    const zw = c.z1 - c.z0;
    const xIn = c.x1;
    const depthIn = c.x1 - I.x0;
    // âtre au rez-de-chaussée : jambages, linteau, contrecœur, braises
    const hearthW = Math.min(1.0, zw - 0.4);
    const jw = (zw - hearthW) / 2;
    for (const s of [-1, 1]) int.box(stone, [depthIn, 1.1, jw], [I.x0 + depthIn / 2, 0.55, zc + s * (hearthW / 2 + jw / 2)]);
    int.box(stone, [depthIn + 0.1, 0.3, zw + 0.1], [I.x0 + depthIn / 2 + 0.05, 1.25, zc]);
    int.box(VM.timber(), [0.25, 0.08, zw + 0.3], [xIn + 0.05, 1.42, zc]);
    int.box(VM.stoneDark(), [0.2, 1.1, hearthW], [I.x0 + 0.1, 0.55, zc]);
    int.box(stone, [depthIn, g0.h - 1.4, zw], [I.x0 + depthIn / 2, 1.4 + (g0.h - 1.4) / 2, zc]);
    const lit = plan.ruined ? false : g0.rooms.some((room) => room.lit && zc > room.rect.z0 && zc < room.rect.z1 && xIn > room.rect.x0 - 0.8 && xIn < room.rect.x1);
    if (!plan.ruined) {
      int.box(lit ? VM.glow('#ff5a14', 3) : VM.paint('#1a1714', 1), [0.5, 0.06, hearthW - 0.2], [I.x0 + 0.4, 0.05, zc]);
      for (let k = 0; k < 3; k++) {
        const g = new THREE.CylinderGeometry(0.06, 0.06, 0.55, 7);
        int.add(g, VM.timber(), compose([I.x0 + 0.35, 0.12 + (k === 2 ? 0.1 : 0), zc - 0.15 + k * 0.15], [Math.PI / 2, 0.3 * k, 0]), 'local');
        g.dispose();
      }
      const pot = new THREE.SphereGeometry(0.22, 10, 8);
      int.add(pot, VM.iron(), compose([I.x0 + 0.42, 0.55, zc], [0, 0, 0], [1, 0.85, 1]), 'local');
      pot.dispose();
      if (lit) lights.push({ ...toWorldLight([I.x0 + 0.6, 0.5, zc]), color: '#ff7a2a', intensity: 6, distance: 7, flicker: true, indoor: true, building: b.id });
    }
    // conduit à travers les étages
    for (const l of habitable) {
      if (l.index === 0) continue;
      int.box(stone, [depthIn, l.h, zw], [I.x0 + depthIn / 2, l.y + l.h / 2, zc]);
    }
    // souche au-dessus du toit
    const x0 = c.x0 - 0.05;
    const top = roofAt(x0, zc) + (plan.ruined ? 0.3 : 1.1);
    const base = plan.wallTop - 0.2;
    const sw = c.x1 - c.x0 + 0.05;
    roofB.box(stone, [sw, top - base, zw], [x0 + sw / 2, (base + top) / 2, zc]);
    if (!plan.ruined) {
      roofB.box(VM.stoneDark(), [sw + 0.16, 0.12, zw + 0.16], [x0 + sw / 2, top + 0.06, zc]);
      const pot = new THREE.CylinderGeometry(0.12, 0.14, 0.4, 8);
      roofB.add(pot, VM.paint('#7a4a32', 0.8), compose([x0 + sw / 2, top + 0.3, zc]), 'local');
      pot.dispose();
    }
  }

  function toWorldLight(p: V3) {
    const w = toWorld(p);
    return { x: w[0], y: w[1], z: w[2] };
  }

  function jettyCorbels(l0: Level, l1: Level) {
    const O0 = l0.outer;
    const j = l1.outer.z1 - O0.z1;
    if (j <= 0.05) return;
    const yb = l1.y;
    ext.box(VM.timber(), [O0.x1 - O0.x0 + 0.02, 0.22, j + 0.15], [(O0.x0 + O0.x1) / 2, yb - 0.11, O0.z1 + (j + 0.15) / 2 - 0.15], { uv: 'local' });
    const n = Math.max(2, Math.round((O0.x1 - O0.x0) / 1.4));
    for (let k = 0; k <= n; k++) {
      const x = O0.x0 + 0.15 + (k * (O0.x1 - O0.x0 - 0.3)) / n;
      beamBetween(ext, VM.timber(), [x, yb - 0.75, O0.z1], [x, yb - 0.2, O0.z1 + j * 0.9], 0.14, 0.16);
    }
  }

  function forgeExtras() {
    const g0 = levels[0];
    const O = g0.outer;
    const door = plan.openings.find((o) => o.kind === 'big-door')!;
    // auvent sur poteaux devant l'atelier
    const x0 = door.at - door.w / 2 - 0.9;
    const x1 = door.at + door.w / 2 + 0.9;
    const d = 2.6;
    for (const x of [x0, x1]) ext.box(VM.timber(), [0.2, 2.9, 0.2], [x, 1.45, O.z1 + d - 0.2], { uv: 'local' });
    ext.box(VM.timber(), [x1 - x0 + 0.3, 0.2, 0.2], [(x0 + x1) / 2, 2.95, O.z1 + d - 0.2], { uv: 'local' });
    const ang = Math.atan2(0.9, d);
    ext.box(VM.woodShingles(), [x1 - x0 + 0.6, 0.12, Math.hypot(d + 0.3, 0.9)], [(x0 + x1) / 2, 3.45, O.z1 + d / 2], { rot: [ang, 0, 0], uv: 'local' });
    // conduit de la forge contre le mur du fond (dehors)
    const hearth = g0.items.find((it) => it.type === 'forgeHearth');
    const hx = hearth ? hearth.x : O.x0 + 3;
    const roofTop = plan.wallTop + 3.2;
    ext.box(VM.stoneDark(), [1.2, roofTop, 0.9], [hx, roofTop / 2, O.z0 - 0.45]);
    ext.box(VM.stoneDark(), [1.4, 0.15, 1.1], [hx, roofTop + 0.07, O.z0 - 0.45]);
  }

  function churchExtras() {
    // rien de plus : clocher, contreforts et flèche sont posés avec le toit
  }

  function signsAndLanterns() {
    const g0 = levels.find((l) => l.index === 0 || (b.kind === 'church' && l.y === 0 && isTower(b, l)))!;
    const front = plan.openings.filter((o) => o.side === 'front' && (o.kind === 'door' || o.kind === 'big-door' || (o.kind === 'arch' && o.level === 1)));
    const main = front[0];
    if (!main) return;
    const lvl = levels.find((l) => l.index === main.level) ?? g0;
    const F = sideFrame('front', lvl.outer);
    const rotWorld = b.rot;
    const lanternAt = (u: number, y: number) => {
      const p = toWorld(F.at(u, y, 0));
      props.place('wallLantern', p[0], p[1], p[2], rotWorld, true);
      const lp = LANTERN_LIGHT.wallLantern;
      const w = toWorld(F.at(u, y + lp[1], lp[2]));
      lights.push({ x: w[0], y: w[1], z: w[2], color: '#ffb35c', intensity: 4, distance: 11, flicker: true, indoor: false, building: b.id });
    };
    const busy = ['tavern', 'sheriff', 'church', 'apothecary', 'shop', 'bakery', 'forge', 'stable'].includes(b.kind);
    if (busy) {
      lanternAt(main.at - main.w / 2 - 0.45, 2.3);
      if (b.kind === 'tavern' || b.kind === 'sheriff' || b.kind === 'church') lanternAt(main.at + main.w / 2 + 0.45, 2.3);
    } else if (r() < 0.35 && b.kind === 'house') lanternAt(main.at + main.w / 2 + 0.4, 2.2);
    if (b.kind === 'tavern' || b.kind === 'apothecary' || b.kind === 'shop' || b.kind === 'bakery' || b.kind === 'forge') {
      const p = toWorld(F.at(main.at + main.w / 2 + 1.1, 2.6, 0));
      props.place(b.kind === 'tavern' ? 'tavernSign' : 'shopSign', p[0], p[1], p[2], rotWorld + Math.PI / 2, true);
    }
    if (b.kind === 'sheriff') {
      const p = toWorld(F.at(main.at - main.w / 2 - 1.3, 2.7, 0));
      props.place('banner', p[0], p[1], p[2], rotWorld + Math.PI / 2, true);
    }
  }
}

function toLocal(frame: THREE.Matrix4, p: V3): V3 {
  const v = new THREE.Vector3(...p).applyMatrix4(frame);
  return [v.x, v.y, v.z];
}

function rect4(r: Rect, dz0: number, dz1: number): Rect {
  return { x0: r.x0, x1: r.x1, z0: r.z0 - dz0, z1: r.z1 + dz1 };
}

function isTower(b: BuildingSpec, l: Level) {
  return b.kind === 'church' && l.index > 0;
}
