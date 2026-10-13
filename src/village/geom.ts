/**
 * Briques de géométrie du village : boîtes, prismes et pièces assemblées dans un « lot » (Batch) qui fusionne
 * tout ce qui partage un matériau en un seul maillage (un appel de dessin par matériau et par bâtiment).
 *
 * UV en mètres : les matériaux du village répètent leur texture selon une taille réelle (pierre 2 m, enduit 3 m…),
 * de sorte que les murs, sols et toits n'ont jamais de texture étirée. Les murs utilisent une projection selon la
 * face dominante, continue d'un morceau de mur à l'autre (pas de raccord autour des fenêtres).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type V3 = [number, number, number];

/** 'local' : UV de la pièce en mètres · 'project' : projection sur la face dominante (murs, sols). */
export type UvMode = 'local' | 'project';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _s = new THREE.Vector3();

/** Boîte non indexée, UV en mètres sur chaque face. */
export function boxGeo(w: number, h: number, d: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const n = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(n.getX(i));
    const ny = Math.abs(n.getY(i));
    const [su, sv] = nx > 0.5 ? [d, h] : ny > 0.5 ? [w, d] : [w, h];
    uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  }
  return g;
}

/** Prisme extrudé d'un contour 2D (x, y) sur une profondeur `depth` centrée en z. */
export function prismGeo(points: [number, number][], depth: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1 }).translate(0, 0, -depth / 2);
  const out = g.index ? g.toNonIndexed() : g;
  return out;
}

/** Recalcule les UV d'une géométrie déjà placée par projection sur l'axe dominant de chaque face. */
function projectUV(g: THREE.BufferGeometry) {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const n = g.getAttribute('normal') as THREE.BufferAttribute;
  let uv = g.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (!uv) {
    uv = new THREE.BufferAttribute(new Float32Array(p.count * 2), 2);
    g.setAttribute('uv', uv);
  }
  // une face (3 sommets) garde une seule projection : pas de déchirure à l'intérieur d'un triangle
  for (let i = 0; i < p.count; i += 3) {
    _n.set(0, 0, 0);
    for (let k = 0; k < 3; k++) _n.add(_v.fromBufferAttribute(n, i + k));
    const ax = Math.abs(_n.x);
    const ay = Math.abs(_n.y);
    const az = Math.abs(_n.z);
    for (let k = 0; k < 3; k++) {
      _v.fromBufferAttribute(p, i + k);
      if (ay >= ax && ay >= az) uv.setXY(i + k, _v.x, _v.z);
      else if (ax >= az) uv.setXY(i + k, _v.z * Math.sign(_n.x || 1), _v.y);
      else uv.setXY(i + k, -_v.x * Math.sign(_n.z || 1), _v.y);
    }
  }
  uv.needsUpdate = true;
}

/** Ne garde que position / normal / uv (condition pour fusionner des géométries d'origines différentes). */
function normalize(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(out.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') out.deleteAttribute(name);
  if (!out.getAttribute('normal')) out.computeVertexNormals();
  if (!out.getAttribute('uv')) out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(out.getAttribute('position').count * 2), 2));
  out.morphAttributes = {};
  out.clearGroups();
  return out;
}

export interface PlaceOpts {
  rot?: V3;
  uv?: UvMode;
}

/**
 * Lot de géométries regroupées par matériau. On y ajoute des pièces dans le repère du lot (en général le repère
 * local d'un bâtiment), puis `build()` crée un maillage fusionné par matériau.
 */
export class Batch {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();

  add(geo: THREE.BufferGeometry, mat: THREE.Material, matrix: THREE.Matrix4, uv: UvMode = 'local') {
    const g = normalize(geo.clone());
    g.applyMatrix4(matrix);
    if (uv === 'project') projectUV(g);
    let list = this.parts.get(mat);
    if (!list) this.parts.set(mat, (list = []));
    list.push(g);
  }

  /** Boîte de taille `size` centrée en `pos` (rotation en radians, ordre XYZ). */
  box(mat: THREE.Material, size: V3, pos: V3, o: PlaceOpts = {}) {
    const g = boxGeo(size[0], size[1], size[2]);
    this.add(g, mat, compose(pos, o.rot), o.uv ?? 'project');
    g.dispose();
  }

  /** Géométrie quelconque placée en `pos`. */
  geo(geo: THREE.BufferGeometry, mat: THREE.Material, pos: V3, o: PlaceOpts & { scale?: V3 } = {}) {
    this.add(geo, mat, compose(pos, o.rot, o.scale), o.uv ?? 'local');
  }

  get empty() {
    return this.parts.size === 0;
  }

  build(name: string, opts: { cast?: boolean; receive?: boolean } = {}): THREE.Group {
    const g = new THREE.Group();
    g.name = name;
    for (const [mat, list] of this.parts) {
      const merged = mergeGeometries(list, false);
      for (const p of list) p.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = opts.cast ?? true;
      mesh.receiveShadow = opts.receive ?? true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      g.add(mesh);
    }
    this.parts.clear();
    return g;
  }
}

export function compose(pos: V3, rot: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]): THREE.Matrix4 {
  _q.setFromEuler(_e.set(rot[0], rot[1], rot[2]));
  return _m.compose(_v.set(pos[0], pos[1], pos[2]), _q, _s.set(scale[0], scale[1], scale[2])).clone();
}

/**
 * Mur droit de longueur `len` (axe local x, centré), hauteur `h`, épaisseur `t`, posé en y = 0, avec des
 * ouvertures (portes/fenêtres). Chaque ouverture : centre `x` le long du mur, largeur `w`, de `y0` à `y1`.
 * Le mur est découpé en morceaux pleins autour des ouvertures.
 */
export interface Opening {
  x: number;
  w: number;
  y0: number;
  y1: number;
}
export function wallPieces(len: number, h: number, openings: Opening[]): { x0: number; x1: number; y0: number; y1: number }[] {
  const out: { x0: number; x1: number; y0: number; y1: number }[] = [];
  const ops = [...openings].sort((a, b) => a.x - b.x);
  let cursor = -len / 2;
  for (const o of ops) {
    const a = Math.max(-len / 2, o.x - o.w / 2);
    const b = Math.min(len / 2, o.x + o.w / 2);
    if (a > cursor + 0.001) out.push({ x0: cursor, x1: a, y0: 0, y1: h });
    if (o.y0 > 0.001) out.push({ x0: a, x1: b, y0: 0, y1: o.y0 });
    if (o.y1 < h - 0.001) out.push({ x0: a, x1: b, y0: o.y1, y1: h });
    cursor = Math.max(cursor, b);
  }
  if (cursor < len / 2 - 0.001) out.push({ x0: cursor, x1: len / 2, y0: 0, y1: h });
  return out;
}

/**
 * Ajoute au lot un mur entre deux points (repère du lot, plan horizontal), à partir de la hauteur `y`,
 * avec ses ouvertures (x mesuré depuis le milieu du mur, dans le sens a → b).
 */
export function addWall(b: Batch, mat: THREE.Material, a: [number, number], c: [number, number], y: number, h: number, t: number, openings: Opening[] = []) {
  const dx = c[0] - a[0];
  const dz = c[1] - a[1];
  const len = Math.hypot(dx, dz);
  const ang = Math.atan2(-dz, dx);
  const mx = (a[0] + c[0]) / 2;
  const mz = (a[1] + c[1]) / 2;
  const cos = Math.cos(ang);
  const sin = Math.sin(ang);
  for (const p of wallPieces(len, h, openings)) {
    const w = p.x1 - p.x0;
    const ph = p.y1 - p.y0;
    if (w < 0.01 || ph < 0.01) continue;
    const lx = (p.x0 + p.x1) / 2;
    // rotation autour de y d'angle `ang` : x local → (cos, -sin) en (x, z)
    b.box(mat, [w, ph, t], [mx + lx * cos, y + (p.y0 + p.y1) / 2, mz - lx * sin], { rot: [0, ang, 0] });
  }
}

/**
 * Dalle horizontale rectangulaire [x0,x1]×[z0,z1] d'épaisseur `t` (dessus en y), percée d'éventuelles trémies
 * (escaliers, trappes) : la dalle est découpée en bandes autour des trous.
 */
export function addSlab(b: Batch, mat: THREE.Material, x0: number, x1: number, z0: number, z1: number, y: number, t: number, holes: { x0: number; x1: number; z0: number; z1: number }[] = []) {
  // découpe en bandes selon z aux bords des trous, puis en x dans chaque bande
  const zs = new Set<number>([z0, z1]);
  for (const h of holes) {
    zs.add(Math.max(z0, Math.min(z1, h.z0)));
    zs.add(Math.max(z0, Math.min(z1, h.z1)));
  }
  const zl = [...zs].sort((p, q) => p - q);
  for (let i = 0; i < zl.length - 1; i++) {
    const za = zl[i];
    const zb = zl[i + 1];
    if (zb - za < 0.005) continue;
    const zm = (za + zb) / 2;
    const cuts = holes.filter((h) => h.z0 < zm && h.z1 > zm).sort((p, q) => p.x0 - q.x0);
    let cx = x0;
    for (const h of cuts) {
      if (h.x0 > cx + 0.005) b.box(mat, [h.x0 - cx, t, zb - za], [(cx + h.x0) / 2, y - t / 2, zm]);
      cx = Math.max(cx, h.x1);
    }
    if (x1 > cx + 0.005) b.box(mat, [x1 - cx, t, zb - za], [(cx + x1) / 2, y - t / 2, zm]);
  }
}

/** Générateur pseudo-aléatoire déterministe (même village à chaque chargement). */
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
