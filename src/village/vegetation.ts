/**
 * Végétation : forêt dense qui ferme l'horizon autour du village (feuillus, sapins, arbres morts), arbres isolés
 * dans les jardins et les cours, buissons le long des murs et en lisière, rochers, touffes d'herbe et fougères.
 * Tout est instancié (quelques appels de dessin pour des milliers de plantes) et posé sur le relief.
 * Les chemins qui mènent hors du village restent dégagés : la forêt s'ouvre sur eux.
 */
import * as THREE from 'three';
import type { Obb } from './collision';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BUILDINGS, FIELDS, GARDENS, ORCHARD, VILLAGE_CENTER, WORLD_HALF, fieldPoly, forestEdge, heightAt, inField, insideBuilding, isFree, localToWorld, noise2, roadDistance, rng } from './layout';

// ───────────────────────── géométries ─────────────────────────

function hash(x: number, y: number, z: number) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise3(x: number, y: number, z: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const f = (t: number) => t * t * (3 - 2 * t);
  const xf = f(x - xi);
  const yf = f(y - yi);
  const zf = f(z - zi);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash(xi + dx, yi + dy, zi + dz);
  return l(l(l(c(0, 0, 0), c(1, 0, 0), xf), l(c(0, 1, 0), c(1, 1, 0), xf), yf), l(l(c(0, 0, 1), c(1, 0, 1), xf), l(c(0, 1, 1), c(1, 1, 1), xf), yf), zf);
}

/** Touffe de feuillage bosselée, couleurs par sommet (clair dessus, sombre dessous). */
function clump(radius: number, seed: number, top: string, bottom: string, detail = 2): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const ct = new THREE.Color(top);
  const cb = new THREE.Color(bottom);
  const c = new THREE.Color();
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const n = noise3(v.x * 2.2 + seed * 7.1, v.y * 2.2 + seed * 3.3, v.z * 2.2 - seed * 5.7);
    const n2 = noise3(v.x * 6 + seed, v.y * 6, v.z * 6);
    let r = radius * (0.8 + n * 0.36 + n2 * 0.1);
    if (v.y < -0.2) r *= 1 + (v.y + 0.2) * 0.35;
    pos.setXYZ(i, v.x * r, v.y * r, v.z * r);
    const k = THREE.MathUtils.clamp((v.y + 1) / 2 + (n2 - 0.5) * 0.45, 0, 1);
    c.copy(cb).lerp(ct, k * k * (3 - 2 * k));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.deleteAttribute('uv');
  const out = g.index ? g.toNonIndexed() : g;
  out.computeVertexNormals();
  return out;
}

function colored(g: THREE.BufferGeometry, color: string) {
  const out = g.index ? g.toNonIndexed() : g;
  out.deleteAttribute('uv');
  const c = new THREE.Color(color);
  const a = new Float32Array(out.getAttribute('position').count * 3);
  for (let i = 0; i < a.length; i += 3) a.set([c.r, c.g, c.b], i);
  out.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return out;
}

/** Feuillu : tronc, branches maîtresses, houppier de plusieurs touffes. */
function leafyTree(seed: number, palette: [string, string], detail = 2): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const r = rng(seed);
  parts.push(colored(new THREE.CylinderGeometry(0.2, 0.36, 4.2, 7).translate(0, 2.1, 0), '#3e2c1e'));
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + r();
    parts.push(colored(new THREE.CylinderGeometry(0.07, 0.13, 2.0, 5).translate(0, 1, 0).rotateZ(0.7).rotateY(a).translate(0, 3.4, 0), '#3e2c1e'));
  }
  const blobs: [number, number, number, number][] = [
    [0, 5.4, 0, 2.3],
    [1.3, 4.9, 0.5, 1.6],
    [-1.2, 5.0, -0.4, 1.7],
    [0.2, 6.4, -0.5, 1.5],
    [-0.4, 5.2, 1.3, 1.4],
    [0.6, 4.4, -1.2, 1.3],
  ];
  blobs.forEach(([x, y, z, s], i) => parts.push(clump(s, seed * 3 + i, palette[0], palette[1], detail).translate(x, y, z)));
  const m = mergeGeometries(parts)!;
  m.computeVertexNormals();
  return m;
}

/** Sapin : étages de cônes irréguliers. */
function firTree(seed: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const r = rng(seed);
  parts.push(colored(new THREE.CylinderGeometry(0.14, 0.26, 2.2, 6).translate(0, 1.1, 0), '#3a2a1c'));
  const tiers = 5;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const rad = 2.1 * (1 - t * 0.78);
    const h = 2.4 - t * 0.9;
    const cone = new THREE.ConeGeometry(rad, h, 8, 2).translate(0, 1.6 + i * 1.35 + h / 2, 0).rotateY(r() * 2);
    const pos = cone.getAttribute('position') as THREE.BufferAttribute;
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k);
      const z = pos.getZ(k);
      const n = 0.85 + noise3(x * 1.3 + seed, pos.getY(k), z * 1.3) * 0.3;
      pos.setXYZ(k, x * n, pos.getY(k), z * n);
    }
    const nonIdx = cone.toNonIndexed();
    nonIdx.deleteAttribute('uv');
    const col = new Float32Array(nonIdx.getAttribute('position').count * 3);
    const dark = new THREE.Color('#14261c');
    const light = new THREE.Color('#3c5e40');
    const c = new THREE.Color();
    const p2 = nonIdx.getAttribute('position') as THREE.BufferAttribute;
    for (let k = 0; k < p2.count; k++) {
      const y = (p2.getY(k) - (1.6 + i * 1.35)) / h;
      c.copy(dark).lerp(light, THREE.MathUtils.clamp(y * 0.9 + 0.1, 0, 1));
      col.set([c.r, c.g, c.b], k * 3);
    }
    nonIdx.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push(nonIdx);
  }
  const m = mergeGeometries(parts)!;
  m.computeVertexNormals();
  return m;
}

/** Arbre mort : tronc tordu et branches nues (cimetière, maison abandonnée, lisière). */
function deadTree(seed: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const r = rng(seed);
  const bark = '#2e2620';
  parts.push(colored(new THREE.CylinderGeometry(0.16, 0.34, 4.5, 6).translate(0, 2.25, 0).rotateZ(0.06), bark));
  const branch = (len: number, rad: number, y: number, a: number, tilt: number) => colored(new THREE.CylinderGeometry(rad * 0.4, rad, len, 5).translate(0, len / 2, 0).rotateZ(tilt).rotateY(a).translate(0, y, 0), bark);
  for (let k = 0; k < 6; k++) {
    const y = 2.4 + k * 0.45;
    const a = r() * Math.PI * 2;
    const tilt = 0.6 + r() * 0.6;
    parts.push(branch(1.4 + r() * 1.2, 0.09, y, a, tilt));
    const len = 1.4;
    parts.push(branch(0.8, 0.04, y + Math.cos(tilt) * len * 0.8, a + 0.8, tilt + 0.5).translate(Math.sin(tilt) * len * 0.8 * Math.cos(a), 0, -Math.sin(tilt) * len * 0.8 * Math.sin(a)));
  }
  const m = mergeGeometries(parts)!;
  m.computeVertexNormals();
  return m;
}

function bushGeo(seed: number, palette: [string, string]) {
  const parts = [clump(0.9, seed, palette[0], palette[1], 1).translate(0, 0.55, 0), clump(0.7, seed + 1, palette[0], palette[1], 1).translate(0.7, 0.4, 0.2), clump(0.6, seed + 2, palette[0], palette[1], 1).translate(-0.6, 0.38, -0.2)];
  return mergeGeometries(parts)!;
}

function rockGeo(seed: number) {
  const g = new THREE.DodecahedronGeometry(1, 1);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = 0.75 + noise3(x * 1.7 + seed, y * 1.7, z * 1.7) * 0.5;
    pos.setXYZ(i, x * n * 1.2, y * n * 0.7, z * n);
  }
  const out = g.index ? g.toNonIndexed() : g;
  out.deleteAttribute('uv');
  out.computeVertexNormals();
  const col = new Float32Array(out.getAttribute('position').count * 3);
  const p = out.getAttribute('position') as THREE.BufferAttribute;
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const moss = p.getY(i) > 0.3 ? noise3(p.getX(i) * 2, 0, p.getZ(i) * 2) : 0;
    c.set('#6b665e').lerp(new THREE.Color('#3f4a2c'), moss * 0.8);
    col.set([c.r, c.g, c.b], i * 3);
  }
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

function grassTuft(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const blade = new THREE.ConeGeometry(0.05, 0.42 + (i % 2) * 0.12, 3).translate(0, 0.21, 0).rotateZ(Math.cos(a) * 0.35).rotateX(Math.sin(a) * 0.35).translate(Math.cos(a) * 0.06, 0, Math.sin(a) * 0.06);
    parts.push(colored(blade, i % 2 ? '#4a6a36' : '#5a7a40'));
  }
  return mergeGeometries(parts)!;
}

function fern(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const leaf = new THREE.PlaneGeometry(0.22, 0.8, 1, 3).translate(0, 0.4, 0);
    const pos = leaf.getAttribute('position') as THREE.BufferAttribute;
    for (let k = 0; k < pos.count; k++) {
      const y = pos.getY(k);
      pos.setX(k, pos.getX(k) * (1 - y / 0.85) * (0.6 + Math.sin((y / 0.8) * Math.PI) * 0.8));
      pos.setZ(k, Math.pow(y, 2) * 0.5);
    }
    leaf.rotateX(-0.5).rotateY(a);
    parts.push(colored(leaf, i % 2 ? '#3d5e2e' : '#4a6b34'));
  }
  return mergeGeometries(parts)!;
}

// ───────────────────────── placement ─────────────────────────

const vegMat = () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });

class Scatter {
  readonly m = new Map<string, THREE.Matrix4[]>();
  add(kind: string, x: number, z: number, s: number, rot: number, sink = 0.15, sy = 1) {
    const y = heightAt(x, z) - sink;
    const mm = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot), new THREE.Vector3(s, s * sy, s));
    let l = this.m.get(kind);
    if (!l) this.m.set(kind, (l = []));
    l.push(mm);
  }
}

/** Distance minimale d'un arbre à un bâtiment (les houppiers ne traversent pas les toits). */
const nearBuilding = (x: number, z: number, m: number) => BUILDINGS.some((b) => insideBuilding(b, x, z, m));

/**
 * Placement de la végétation (sans géométrie) : instances par espèce et obstacles (troncs, gros rochers). Rapide et
 * sans rendu : le serveur s'en sert pour connaître les arbres (couverts du Gunfight, lignes de vue).
 */
export function scatterVegetation(): { sc: Scatter; obstacles: Obb[] } {
  const sc = new Scatter();
  const r = rng(4242);
  const [cx, cz] = VILLAGE_CENTER;
  const H = WORLD_HALF - 4;

  // forêt : dense au-delà de la lisière, clairsemée en approche ; les chemins restent ouverts
  for (let i = 0; i < 26000; i++) {
    const x = (r() * 2 - 1) * H;
    const z = (r() * 2 - 1) * H;
    const d = Math.hypot(x - cx, z - cz);
    const edge = forestEdge(x, z);
    const clump = noise2(x * 0.04, z * 0.04);
    const p = THREE.MathUtils.smoothstep(d, edge - 18, edge + 30) * (0.35 + clump * 0.75);
    if (r() > p * 0.42) continue;
    const road = roadDistance(x, z).d;
    if (road < 2.5 + r() * 2) continue;
    if (nearBuilding(x, z, 4) || inField(x, z, 3)) continue;
    const s = 0.85 + r() * 0.75;
    const conifer = noise2(x * 0.015 + 9, z * 0.015) > 0.52 ? 0.75 : 0.25;
    const k = r();
    const kind = k < 0.012 ? 'dead' : k < conifer ? `fir${Math.floor(r() * 2)}` : `leafy${Math.floor(r() * 3)}`;
    // au cœur de la forêt : modèle allégé, sans ombre portée (on n'y voit que des silhouettes dans la brume)
    const far = d > edge + 18 ? '_far' : '';
    sc.add(kind + far, x, z, s, r() * Math.PI * 2, 0.2, 0.9 + r() * 0.35);
    // sous-bois
    if (r() < 0.5) sc.add(r() < 0.5 ? 'fern' : `bush${Math.floor(r() * 2)}`, x + (r() - 0.5) * 5, z + (r() - 0.5) * 5, 0.7 + r() * 0.8, r() * 6, 0.1);
  }

  // arbres isolés dans le village : jardins, cours, bords de chemins
  for (const gd of GARDENS) {
    const b = BUILDINGS.find((o) => o.id === gd.building)!;
    if (r() < 0.6) {
      const [x, z] = localToWorld(b, gd.x0 + 1.2 + r() * 0.5, gd.z0 + 1.2);
      if (!nearBuilding(x, z, 2.5) && roadDistance(x, z).d > 2) sc.add(r() < 0.5 ? 'leafy2' : 'fruit', x, z, 0.55 + r() * 0.25, r() * 6, 0.1);
    }
  }
  for (let i = 0; i < 1400; i++) {
    const x = cx + (r() * 2 - 1) * 150;
    const z = cz + (r() * 2 - 1) * 150;
    const d = Math.hypot(x - cx, z - cz);
    if (d > forestEdge(x, z) - 10) continue;
    if (!isFree(x, z, 3.2) || nearBuilding(x, z, 4.5)) continue;
    const k = r();
    if (k < 0.05) sc.add(r() < 0.75 ? `leafy${Math.floor(r() * 3)}` : 'fir0', x, z, 0.7 + r() * 0.5, r() * 6, 0.15);
    else if (k < 0.2) sc.add(`bush${Math.floor(r() * 2)}`, x, z, 0.6 + r() * 0.6, r() * 6, 0.1);
    else if (k < 0.24) sc.add('rock', x, z, 0.3 + r() * 0.4, r() * 6, 0.15);
  }

  // buissons au pied de certains murs (pas devant les portes : `isFree` + distance aux portes vérifiée par le décor)
  for (const b of BUILDINGS) {
    const n = b.kind === 'abandoned' ? 14 : b.kind === 'church' ? 4 : 2;
    for (let k = 0; k < n; k++) {
      const side = Math.floor(r() * 3);
      const lx = side === 0 ? -b.w / 2 - 0.9 : side === 1 ? b.w / 2 + 0.9 : (r() - 0.5) * b.w;
      const lz = side === 2 ? -b.d / 2 - 0.9 : (r() - 0.5) * b.d * 0.8;
      const [x, z] = localToWorld(b, lx, lz);
      if (roadDistance(x, z).d < 1 || !isFree(x, z, 0.6)) continue;
      if (BUILDINGS.some((o) => o !== b && insideBuilding(o, x, z, 1))) continue;
      sc.add(b.kind === 'abandoned' && r() < 0.4 ? 'deadBush' : `bush${Math.floor(r() * 2)}`, x, z, 0.5 + r() * 0.4, r() * 6, 0.1);
    }
  }
  // haies vives autour des champs, verger
  for (const f of FIELDS) {
    if (f.edge !== 'haie') continue;
    const p = fieldPoly(f, 1.2);
    for (let i = 0; i < 4; i++) {
      const a = p[i];
      const b = p[(i + 1) % 4];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let s = 0.6; s < len; s += 1.3 + r() * 0.5) {
        if (i === 0 && Math.abs(s - len / 2) < 2) continue; // passage vers le chemin
        const x = a[0] + ((b[0] - a[0]) * s) / len;
        const z = a[1] + ((b[1] - a[1]) * s) / len;
        if (roadDistance(x, z).d < 1) continue;
        sc.add(`bush${Math.floor(r() * 2)}`, x, z, 0.75 + r() * 0.35, r() * 6, 0.1, 1.1);
        if (r() < 0.08) sc.add(`leafy${Math.floor(r() * 3)}`, x, z, 0.8 + r() * 0.3, r() * 6, 0.15);
      }
    }
  }
  {
    const { cx: ox, cz: oz, cols, rows, step, rot } = ORCHARD;
    for (let i = 0; i < cols; i++)
      for (let j = 0; j < rows; j++) {
        const lx = (i - (cols - 1) / 2) * step + (r() - 0.5) * 0.8;
        const lz = (j - (rows - 1) / 2) * step + (r() - 0.5) * 0.8;
        const x = ox + lx * Math.cos(rot) + lz * Math.sin(rot);
        const z = oz - lx * Math.sin(rot) + lz * Math.cos(rot);
        if (isFree(x, z, 2.5)) sc.add('fruit', x, z, 0.55 + r() * 0.15, r() * 6, 0.1);
      }
  }

  // arbres morts : cimetière et maison abandonnée
  sc.add('dead', 25.5, -91, 1.1, 0.4, 0.2);
  sc.add('dead', -108, -58, 1.25, 2.1, 0.2);
  sc.add('dead', -93, -76, 0.95, 1.1, 0.2);

  // rochers et touffes d'herbe
  for (let i = 0; i < 2600; i++) {
    const x = (r() * 2 - 1) * H;
    const z = (r() * 2 - 1) * H;
    const d = Math.hypot(x - cx, z - cz);
    const rocky = d > forestEdge(x, z) - 20 ? 1 : 0.15;
    if (r() > rocky) continue;
    if (!isFree(x, z, 1.2) || roadDistance(x, z).d < 1.5) continue;
    sc.add('rock', x, z, 0.35 + r() * r() * 1.6, r() * 6, 0.25);
  }
  for (let i = 0; i < 24000; i++) {
    const x = cx + (r() * 2 - 1) * 175;
    const z = cz + (r() * 2 - 1) * 175;
    if (!isFree(x, z, 0.5) || roadDistance(x, z).d < 0.4) continue;
    if (nearBuilding(x, z, 0.4)) continue;
    sc.add('tuft', x, z, 0.6 + r() * 0.7, r() * 6, 0.02);
  }

  // troncs et gros rochers : obstacles (les buissons et l'herbe se traversent)
  const obstacles: Obb[] = [];
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  for (const [kind, list] of sc.m) {
    const trunk = /^(leafy|fir|fruit|dead)/.test(kind) ? 0.3 : kind === 'rock' ? 0.85 : 0;
    if (!trunk) continue;
    for (const mm of list) {
      mm.decompose(p, q, s);
      if (Math.hypot(p.x - cx, p.z - cz) > 230) continue;
      const r = trunk * s.x;
      if (kind === 'rock' && r < 0.45) continue;
      obstacles.push({ x: p.x, z: p.z, hx: r * 0.75, hz: r * 0.75, rot: 0, y0: p.y - 0.5, y1: p.y + (kind === 'rock' ? 0.7 * s.y : 4), tag: kind });
    }
  }

  return { sc, obstacles };
}

let scattered: ReturnType<typeof scatterVegetation> | null = null;
/** Obstacles de la végétation (troncs et rochers), calculés une fois. */
export function vegetationObstacles(): Obb[] {
  scattered ??= scatterVegetation();
  return scattered.obstacles;
}

export function buildVegetation(): { group: THREE.Group; obstacles: Obb[] } {
  const g = new THREE.Group();
  g.name = 'vegetation';
  scattered ??= scatterVegetation();
  const { sc, obstacles } = scattered;
  const [cx, cz] = VILLAGE_CENTER;
  void cx;
  void cz;

  // géométries
  const geos: Record<string, THREE.BufferGeometry> = {
    leafy0: leafyTree(11, ['#4c6a3c', '#16261a']),
    leafy1: leafyTree(23, ['#5a6e3a', '#1c2a18']),
    leafy2: leafyTree(37, ['#46603e', '#14221a']),
    fruit: leafyTree(51, ['#5e7a40', '#1c2e1a']),
    leafy0_far: leafyTree(11, ['#4c6a3c', '#16261a'], 0),
    leafy1_far: leafyTree(23, ['#5a6e3a', '#1c2a18'], 0),
    leafy2_far: leafyTree(37, ['#46603e', '#14221a'], 0),
    fir0: firTree(5),
    fir1: firTree(9),
    dead: deadTree(3),
    dead_far: deadTree(3),
    bush0: bushGeo(7, ['#4a663a', '#16241a']),
    bush1: bushGeo(17, ['#55693a', '#1a2818']),
    deadBush: bushGeo(29, ['#5a5440', '#221e16']),
    rock: rockGeo(2),
    tuft: grassTuft(),
    fern: fern(),
  };
  const mats = { solid: vegMat(), rock: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }) };
  for (const [kind, list] of sc.m) {
    const geo = geos[kind] ?? geos[kind.replace('_far', '')];
    const im = new THREE.InstancedMesh(geo, kind === 'rock' ? mats.rock : mats.solid, list.length);
    list.forEach((mm, i) => im.setMatrixAt(i, mm));
    im.instanceMatrix.needsUpdate = true;
    // seuls les arbres et buissons proches du village projettent une ombre (la carte d'ombre suit la caméra)
    im.castShadow = kind !== 'tuft' && kind !== 'fern' && !kind.endsWith('_far');
    im.receiveShadow = true;
    im.computeBoundingSphere();
    im.name = `vegetation:${kind}`;
    g.add(im);
  }
  return { group: g, obstacles };
}
