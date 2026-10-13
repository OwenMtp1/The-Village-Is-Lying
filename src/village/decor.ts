/**
 * Décor extérieur : éclairage public (lanternes), place du marché, puits, terrasse de la taverne, cours et jardins
 * clos, tas de bois, charrettes, enclos des écuries, meules, cimetière, calvaire, lavoir, poteaux indicateurs.
 * Chaque objet est posé sur le relief, hors des rues, des bâtiments et du passage devant les portes.
 */
import * as THREE from 'three';
import { Batch } from './geom';
import { BUILDINGS, CEMETERY, GARDENS, PATHS, PLAZA, heightAt, insideBuilding, localToWorld, pointAt, polygonDistance, roadDistance, rng, type P2 } from './layout';
import { LANTERN_LIGHT, type PropSet } from './props';
import { VM } from './textures';
import type { BuiltBuilding, WorldLight } from './buildings';

interface Ctx {
  props: PropSet;
  lights: WorldLight[];
  doors: { x: number; z: number; nx: number; nz: number; w: number }[];
  extra: Batch;
  lavoir?: THREE.Group;
}

/** Point libre : ni bâtiment, ni rue, ni devant une porte. */
function clear(c: Ctx, x: number, z: number, m = 0.6, roads = true) {
  if (BUILDINGS.some((b) => insideBuilding(b, x, z, m))) return false;
  if (roads && roadDistance(x, z).d < m) return false;
  for (const d of c.doors) {
    // couloir de 3 m devant chaque porte
    const dx = x - d.x;
    const dz = z - d.z;
    const along = dx * d.nx + dz * d.nz;
    const across = Math.abs(-dx * d.nz + dz * d.nx);
    if (along > -1.2 && along < 3.2 && across < d.w / 2 + 0.9) return false;
  }
  return true;
}

function lantern(c: Ctx, x: number, z: number, rot: number) {
  const y = heightAt(x, z);
  c.props.place('lanternPost', x, y, z, rot, true);
  const [lx, ly, lz] = LANTERN_LIGHT.lanternPost;
  const cs = Math.cos(rot);
  const sn = Math.sin(rot);
  c.lights.push({ x: x + lx * cs + lz * sn, y: y + ly, z: z - lx * sn + lz * cs, color: '#ffb056', intensity: 9, distance: 15, flicker: true, indoor: false, building: '' });
}

/** Rangée d'objets linéaires (clôtures, murets) entre deux points, segments de 2 m étirés au besoin. */
function fenceLine(c: Ctx, type: 'fence' | 'picket' | 'stoneWall', a: P2, b: P2, gaps: [number, number][] = []) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(1, Math.round(len / 2));
  const seg = len / n;
  const rot = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
  for (let k = 0; k < n; k++) {
    const t0 = k * seg;
    const t1 = t0 + seg;
    if (gaps.some(([g0, g1]) => t1 > g0 && t0 < g1)) continue;
    const t = (k + 0.5) / n;
    const x = a[0] + (b[0] - a[0]) * t;
    const z = a[1] + (b[1] - a[1]) * t;
    if (roadDistance(x, z).d < 0.2) continue;
    const y = heightAt(x, z);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y - 0.05, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, 0)), new THREE.Vector3(seg / 2, 1, 1));
    c.props.add(type, m, true);
  }
}

function put(c: Ctx, type: string, x: number, z: number, rot: number, o: { m?: number; check?: boolean; scale?: number; tilt?: number } = {}) {
  if (o.check !== false && !clear(c, x, z, o.m ?? 0.5)) return false;
  c.props.place(type, x, heightAt(x, z), z, rot, true, { scale: o.scale, tilt: o.tilt });
  return true;
}

export function buildDecor(built: BuiltBuilding[], props: PropSet): { lights: WorldLight[]; mesh: THREE.Group } {
  const c: Ctx = { props, lights: [], doors: built.flatMap((b) => b.doors), extra: new Batch() };
  const r = rng(909);

  // ── éclairage public : lanternes le long des rues pavées, plus serrées près de la place ──
  for (const p of PATHS) {
    if (p.road.kind === 'path') continue;
    const step = p.road.kind === 'street' ? 15 : p.road.kind === 'lane' ? 19 : 34;
    let side = 1;
    for (let s = 6; s < p.length - 3; s += step) {
      const { p: q, t } = pointAt(p, s);
      const n: P2 = [-t[1], t[0]];
      if (p.road.kind === 'dirt' && Math.hypot(q[0], q[1]) > 135) break;
      for (const tryS of [side, -side]) {
        const off = p.road.width / 2 + 0.55;
        const x = q[0] + n[0] * tryS * off;
        const z = q[1] + n[1] * tryS * off;
        if (polygonDistance(x, z, PLAZA) < 1) continue;
        if (!clear(c, x, z, 0.7, false) || roadDistance(x, z).d < 0.3) continue;
        // le bras de la lanterne avance au-dessus de la chaussée
        lantern(c, x, z, Math.atan2(-n[0] * tryS, -n[1] * tryS));
        side = -tryS;
        break;
      }
    }
  }

  // ── place centrale ──
  put(c, 'well', -2, 0.5, 0.3, { check: false });
  for (const [x, z, rot] of [[-7.5, -4, 0.6], [11, 1.5, -1.3], [3.5, 8.8, 3.0]] as const) put(c, 'stall', x, z, rot, { check: false });
  for (const [x, z, rot] of [[-2, -5.2, 0], [3.8, 0.6, -1.57], [-2, 6.2, 3.14], [-7.6, 0.8, 1.57]] as const) put(c, 'bench', x, z, rot, { check: false });
  for (const [x, z] of [[-14, -8], [14.5, -6.5], [15, 4.5], [-13.5, 7], [0, -12.6], [6, 11.5]] as P2[]) lantern(c, x, z, Math.atan2(-x, -z));
  // terrasse de la taverne
  const tav = BUILDINGS.find((b) => b.id === 'taverne')!;
  for (const lx of [-4.6, 4.5]) {
    const [x, z] = localToWorld(tav, lx, tav.d / 2 + tav.jetty + 2.2);
    put(c, 'table', x, z, tav.rot, { check: false });
    for (const sz of [-0.62, 0.62]) {
      const [bx, bz] = localToWorld(tav, lx, tav.d / 2 + tav.jetty + 2.2 + sz);
      put(c, 'bench', bx, bz, tav.rot + (sz < 0 ? 0 : Math.PI), { check: false });
    }
  }
  for (const [lx, lz, t] of [[-6.8, 1.0, 'barrel'], [-6.0, 1.1, 'barrel'], [6.6, 1.2, 'crates'], [7.3, 0.9, 'barrel']] as const) {
    const [x, z] = localToWorld(tav, lx, tav.d / 2 + tav.jetty + lz);
    put(c, t, x, z, tav.rot + r(), { check: false });
  }
  put(c, 'pillory', -16.5, -71, 0.4, { m: 0.3 });
  put(c, 'signPost', 13.5, -11.5, -0.8, { m: 0.2 });

  // ── abords des maisons : tas de bois, tonneaux, caisses, bancs, charrettes ──
  for (const bb of built) {
    const b = bb.spec;
    if (b.kind === 'church') continue;
    const tries: [string, number, number, number][] = [];
    tries.push(['woodpile', r() < 0.5 ? -b.w / 2 - 0.55 : b.w / 2 + 0.55, -b.d / 4, Math.PI / 2]);
    if (b.kind !== 'abandoned') {
      tries.push(['barrel', b.w / 2 - 0.5, b.d / 2 + b.jetty + 0.55, r() * 6]);
      if (r() < 0.5) tries.push(['bench', -b.w / 2 + 1.0, b.d / 2 + b.jetty + 0.45, 0]);
      if (r() < 0.4) tries.push(['crates', -b.w / 2 - 0.8, b.d / 4, r() * 0.4]);
    } else {
      tries.push(['debris', b.w / 2 + 1.0, 1.0, r() * 6]);
      tries.push(['debris', -b.w / 2 - 1.2, -1.5, r() * 6]);
      tries.push(['cart', b.w / 2 + 3.2, -1.5, 0.4]);
    }
    if (b.kind === 'forge') tries.push(['cart', -b.w / 2 - 2.2, 2.0, 0.1], ['barrel', b.w / 2 + 0.7, 2.6, 0], ['crates', b.w / 2 + 0.9, 1.0, 0.2]);
    if (b.kind === 'stable') tries.push(['cart', b.w / 2 + 2.2, 3.5, -0.3], ['trough', -b.w / 2 - 1.1, 1.5, Math.PI / 2], ['haystack', -b.w / 2 - 4, -3, 0]);
    if (b.kind === 'barn') tries.push(['haystack', b.w / 2 + 3.5, -3, 0], ['haystack', b.w / 2 + 4, 3, 1], ['cart', -b.w / 2 - 2.6, 3, 0.2]);
    for (const [type, lx, lz, rot] of tries) {
      const [x, z] = localToWorld(b, lx, lz);
      put(c, type, x, z, b.rot + rot, { m: type === 'barrel' || type === 'bench' ? 0.15 : 0.35 });
    }
  }

  // ── jardins clos : clôtures avec portillon, potagers, épouvantail ──
  for (const g of GARDENS) {
    const b = BUILDINGS.find((o) => o.id === g.building)!;
    const ruined = b.kind === 'abandoned';
    const A = localToWorld(b, g.x0, g.z1);
    const B = localToWorld(b, g.x0, g.z0);
    const C = localToWorld(b, g.x1, g.z0);
    const D = localToWorld(b, g.x1, g.z1);
    const type = r() < 0.5 ? 'picket' : 'fence';
    const wGarden = g.x1 - g.x0;
    fenceLine(c, type, A, B);
    fenceLine(c, type, B, C, [[wGarden * 0.45, wGarden * 0.45 + 1.2]]);
    fenceLine(c, type, C, D);
    void ruined;
    const rows = Math.floor((g.z1 - g.z0 - 1.5) / 1.1);
    for (let k = 0; k < rows; k++) {
      const lz = g.z0 + 1.0 + k * 1.1;
      const [x, z] = localToWorld(b, (g.x0 + g.x1) / 2 + 0.6, lz);
      put(c, k % 2 ? 'cabbages' : 'vegRow', x, z, b.rot, { check: false });
    }
    if (r() < 0.25) {
      const [x, z] = localToWorld(b, g.x0 + 0.9, (g.z0 + g.z1) / 2);
      put(c, 'scarecrow', x, z, b.rot + 0.5, { check: false });
    }
  }

  // ── écuries : enclos ──
  const st = BUILDINGS.find((b) => b.id === 'ecuries')!;
  {
    const pts = [localToWorld(st, -st.w / 2, -st.d / 2 - 0.5), localToWorld(st, -st.w / 2, -st.d / 2 - 12), localToWorld(st, st.w / 2 + 2, -st.d / 2 - 12), localToWorld(st, st.w / 2 + 2, -st.d / 2 - 0.5)];
    for (let i = 0; i < 3; i++) fenceLine(c, 'fence', pts[i], pts[i + 1], i === 1 ? [[3, 5.5]] : []);
    const [x, z] = localToWorld(st, 0, -st.d / 2 - 6);
    put(c, 'trough', x, z, st.rot, { check: false });
  }
  // ── ferme et champs ──
  const fe = BUILDINGS.find((b) => b.id === 'ferme')!;
  for (let k = 0; k < 9; k++) {
    for (let j = 0; j < 4; j++) {
      const [x, z] = localToWorld(fe, -8 + j * 3.2, -fe.d / 2 - 9 - k * 1.1);
      put(c, k % 3 === 0 ? 'cabbages' : 'vegRow', x, z, fe.rot, { m: 0.3 });
    }
  }
  {
    const pts = [localToWorld(fe, -10, -fe.d / 2 - 7.5), localToWorld(fe, -10, -fe.d / 2 - 19.5), localToWorld(fe, 4, -fe.d / 2 - 19.5), localToWorld(fe, 4, -fe.d / 2 - 7.5)];
    for (let i = 0; i < 3; i++) fenceLine(c, 'fence', pts[i], pts[i + 1]);
    const [x, z] = localToWorld(fe, -3, -fe.d / 2 - 13);
    put(c, 'scarecrow', x, z, 0.3, { check: false });
  }

  // ── cimetière : murets, portail, tombes en rangées irrégulières ──
  {
    const { x0, x1, z0, z1, gateX } = CEMETERY;
    fenceLine(c, 'stoneWall', [x0, z1], [x1, z1], [[gateX - x0 - 1.2, gateX - x0 + 1.2]]);
    fenceLine(c, 'stoneWall', [x1, z1], [x1, z0]);
    fenceLine(c, 'stoneWall', [x1, z0], [x0, z0]);
    fenceLine(c, 'stoneWall', [x0, z0], [x0, z1]);
    for (const sx of [-1, 1]) {
      c.extra.box(VM.stone('#d0c8b8'), [0.6, 2.1, 0.6], [gateX + sx * 1.5, heightAt(gateX, z1) + 1.0, z1]);
      c.extra.box(VM.stoneDark(), [0.8, 0.2, 0.8], [gateX + sx * 1.5, heightAt(gateX, z1) + 2.1, z1]);
    }
    lantern(c, gateX + 2.6, z1 + 1.2, Math.PI);
    const types = ['gravestone', 'gravestone', 'graveCross', 'woodCross', 'gravestone', 'tomb'];
    for (let row = 0; row < 5; row++)
      for (let k = 0; k < 9; k++) {
        const x = x0 + 2 + k * 2.4 + (r() - 0.5) * 0.5;
        const z = z0 + 3 + row * 4.4 + (r() - 0.5) * 0.4;
        if (Math.abs(x - gateX) < 1.6) continue;
        if (r() < 0.12) continue;
        const t = types[Math.floor(r() * types.length)];
        put(c, t, x, z, Math.PI + (r() - 0.5) * 0.15, { check: false, tilt: t === 'gravestone' && r() < 0.25 ? (r() - 0.5) * 0.35 : undefined });
      }
    // petite chapelle funéraire (enfeu) au fond
    const mx = x1 - 4;
    const mz = z0 + 3;
    const my = heightAt(mx, mz);
    c.extra.box(VM.stone('#cfc6b6'), [3.2, 2.8, 3.0], [mx, my + 1.4, mz]);
    c.extra.box(VM.slate(), [3.8, 0.2, 2.0], [mx, my + 3.2, mz - 0.75], { rot: [-0.6, 0, 0], uv: 'local' });
    c.extra.box(VM.slate(), [3.8, 0.2, 2.0], [mx, my + 3.2, mz + 0.75], { rot: [0.6, 0, 0], uv: 'local' });
    c.extra.box(VM.planks('#3a2a20'), [1.0, 1.8, 0.08], [mx, my + 0.9, mz + 1.52], { uv: 'local' });
  }

  // ── calvaire du parvis, croix de chemin ──
  for (const [x, z, s] of [[-11, -70.5, 1.6], [-58, -190, 1.3], [12, 200, 1.2]] as const) {
    const y = heightAt(x, z);
    c.extra.box(VM.stone('#cfc6b6'), [1.6, 0.5, 1.6], [x, y + 0.25, z]);
    c.extra.box(VM.stone('#cfc6b6'), [1.0, 0.5, 1.0], [x, y + 0.75, z]);
    c.extra.box(VM.stone('#d8d0c2'), [0.22, 2.6 * s, 0.22], [x, y + 1.0 + 1.3 * s, z]);
    c.extra.box(VM.stone('#d8d0c2'), [1.1 * s, 0.2, 0.2], [x, y + 1.0 + 2.0 * s, z]);
  }

  // ── lavoir (bassin de pierre couvert) au bord du chemin du lavoir ──
  {
    const x = -55;
    const z = -27;
    const y = heightAt(x, z);
    const rot = -0.6;
    const L = new Batch();
    L.box(VM.stone('#cfc6b6'), [6, 0.6, 0.4], [0, 0.3, 1.6]);
    L.box(VM.stone('#cfc6b6'), [6, 0.6, 0.4], [0, 0.3, -1.6]);
    L.box(VM.stone('#cfc6b6'), [0.4, 0.6, 3.6], [-3, 0.3, 0]);
    L.box(VM.stone('#cfc6b6'), [0.4, 0.6, 3.6], [3, 0.3, 0]);
    L.box(VM.stoneDark(), [5.6, 0.1, 2.8], [0, -0.3, 0]);
    L.box(VM.water(), [5.6, 0.02, 2.8], [0, 0.42, 0], { uv: 'local' });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) L.box(VM.timber(), [0.22, 2.6, 0.22], [sx * 3.1, 1.6, sz * 1.9], { uv: 'local' });
    for (const sz of [-1, 1]) L.box(VM.timber(), [6.6, 0.2, 0.2], [0, 2.9, sz * 1.9], { uv: 'local' });
    L.box(VM.roofTiles('#e8cfc0'), [7.2, 0.14, 2.4], [0, 3.4, -1.05], { rot: [0.5, 0, 0], uv: 'local' });
    L.box(VM.roofTiles('#e8cfc0'), [7.2, 0.14, 2.4], [0, 3.4, 1.05], { rot: [-0.5, 0, 0], uv: 'local' });
    for (const k of [-1.5, 0.8]) L.box(VM.stone('#bdb4a4'), [0.9, 0.08, 0.5], [k, 0.62, 1.6], { rot: [0.25, 0, 0] });
    const m = L.build('lavoir');
    m.position.set(x, y, z);
    m.rotation.y = rot;
    lantern(c, x + 4.4, z + 2.6, 2.4);
    c.lavoir = m;
  }

  // ── poteaux indicateurs à l'entrée des chemins de forêt ──
  for (const id of ['chemin-ouest', 'chemin-nord', 'chemin-sud', 'chemin-fermes']) {
    const p = PATHS.find((q) => q.road.id === id)!;
    const s = id === 'chemin-fermes' ? 75 : id === 'chemin-sud' ? 26 : 30;
    const { p: q, t } = pointAt(p, s);
    const x = q[0] - t[1] * (p.road.width / 2 + 0.8);
    const z = q[1] + t[0] * (p.road.width / 2 + 0.8);
    put(c, 'signPost', x, z, Math.atan2(t[0], t[1]), { m: 0.3 });
  }

  const mesh = c.extra.build('decor');
  const g = new THREE.Group();
  g.name = 'decor';
  g.add(mesh);
  if (c.lavoir) g.add(c.lavoir);
  return { lights: c.lights, mesh: g };
}
