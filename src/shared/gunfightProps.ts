/**
 * Aménagement des cartes Gunfight (à la manière des cartes de Call of Duty ou de Counter-Strike, sans changer le
 * village) : des couverts posés dans les rues, sur les places et dans les salles — caisses, piles de caisses,
 * tonneaux, charrettes, bottes de foin, murets, barricades, troncs couchés, rochers — pour casser les longues
 * lignes de tir et créer des couloirs de combat, et deux camps d'apparition opposés pour les parties en équipes.
 *
 * Données pures et déterministes : le serveur et le navigateur calculent exactement les mêmes couverts à partir
 * du même plan du village (le décor existant est évité grâce au test `blocked`, identique des deux côtés).
 */
import { BUILDINGS, KEEP_OUT, heightAt, insideBuilding, polygonDistance, rng } from '../village/layout';
import { ROOMS, UNDER } from '../village/underground';
import type { GFMap, GFSpawn } from './gunfightMaps';
import type { Team } from './gunfight';

export type PropKind = 'caisse' | 'caisses' | 'tonneaux' | 'charrette' | 'foin' | 'muret' | 'barricade' | 'tronc' | 'rocher';

export interface GFProp {
  kind: PropKind;
  x: number;
  z: number;
  /** pied (sol) */
  y: number;
  rot: number;
  /** largeur (le long de rot), profondeur, hauteur */
  w: number;
  d: number;
  h: number;
}

const SIZE: Record<PropKind, [number, number, number]> = {
  caisse: [1.2, 1.2, 1.2],
  caisses: [1.3, 1.3, 2.3],
  tonneaux: [1.5, 1.5, 1.15],
  charrette: [2.9, 1.5, 1.6],
  foin: [2.2, 1.15, 1.15],
  muret: [3.4, 0.55, 1.2],
  barricade: [3.0, 0.4, 1.55],
  tronc: [4.6, 0.85, 0.85],
  rocher: [2.3, 1.9, 1.7],
};

/** Couverts de chaque carte (selon son style) et densité : un couvert pour tant de m² de surface. */
const PALETTE: Record<string, { kinds: PropKind[]; every: number; gap: number }> = {
  village: { kinds: ['caisse', 'caisses', 'tonneaux', 'charrette', 'barricade'], every: 260, gap: 9 },
  souterrains: { kinds: ['caisse', 'caisses', 'tonneaux'], every: 18, gap: 3.5 },
  quartier: { kinds: ['caisse', 'caisses', 'tonneaux', 'charrette', 'barricade'], every: 150, gap: 7 },
  place: { kinds: ['caisse', 'caisses', 'tonneaux', 'charrette'], every: 110, gap: 6 },
  eglise: { kinds: ['muret', 'muret', 'caisse', 'barricade', 'tonneaux'], every: 140, gap: 7 },
  ferme: { kinds: ['foin', 'foin', 'charrette', 'caisse', 'barricade'], every: 130, gap: 7.5 },
  foret: { kinds: ['tronc', 'tronc', 'rocher', 'rocher', 'caisse'], every: 120, gap: 7 },
};

export type Blocked = (x: number, y: number, z: number) => boolean;

const cache = new Map<string, GFProp[]>();

/** Couverts d'une carte (calculés une fois). `blocked` : le décor existant (murs, meubles, arbres, étals…). */
export function mapProps(map: GFMap, blocked: Blocked): GFProp[] {
  const hit = cache.get(map.id);
  if (hit) return hit;
  const pal = PALETTE[map.id] ?? PALETTE.village;
  const rand = rng(map.id.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0);
  const out: GFProp[] = [];
  const spawns = map.spawns;
  // emplacements candidats : grille fine sur la zone jouable (ou les salles des souterrains)
  const cands: [number, number, number][] = [];
  let area = 0;
  if (map.underground) {
    for (const r of ROOMS) {
      area += (r.x1 - r.x0) * (r.z1 - r.z0);
      for (let x = r.x0 + 1.8; x <= r.x1 - 1.8; x += 1) for (let z = r.z0 + 1.8; z <= r.z1 - 1.8; z += 1) cands.push([x, UNDER.floor, z]);
    }
  } else {
    const zone = map.zone;
    const xs = zone ? zone.map((p) => p[0]) : [-60, 70];
    const zs = zone ? zone.map((p) => p[1]) : [-75, 55];
    const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    area = (x1 - x0) * (z1 - z0) * 0.6;
    for (let x = x0; x <= x1; x += 2) for (let z = z0; z <= z1; z += 2) if (!zone || polygonDistance(x, z, zone) < -3) cands.push([x, heightAt(x, z), z]);
  }
  const target = Math.round(area / pal.every);
  // ordre aléatoire (graine de la carte), puis on garde les emplacements libres et bien espacés
  for (let i = cands.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [cands[i], cands[j]] = [cands[j], cands[i]];
  }
  for (const [x, y, z] of cands) {
    if (out.length >= target) break;
    if (spawns.some((s) => Math.hypot(s.x - x, s.z - z) < 4)) continue;
    if (out.some((p) => Math.hypot(p.x - x, p.z - z) < pal.gap)) continue;
    if (!map.underground && (BUILDINGS.some((b) => insideBuilding(b, x, z, 2)) || KEEP_OUT.some((k) => Math.hypot(k.x - x, k.z - z) < k.r + 2))) continue;
    const kind = pal.kinds[Math.floor(rand() * pal.kinds.length)];
    const [w, d, h] = SIZE[kind];
    const rot = Math.floor(rand() * 4) * (Math.PI / 4) + (rand() - 0.5) * 0.3;
    // l'emprise (coins et centre) doit être libre de tout décor, au sol et à hauteur d'homme
    const c = Math.cos(rot);
    const sn = Math.sin(rot);
    const pts = [[0, 0], [w / 2 + 0.4, d / 2 + 0.4], [-w / 2 - 0.4, d / 2 + 0.4], [w / 2 + 0.4, -d / 2 - 0.4], [-w / 2 - 0.4, -d / 2 - 0.4]].map(([lx, lz]) => [x + lx * c + lz * sn, z - lx * sn + lz * c]);
    if (pts.some(([px, pz]) => blocked(px, y + 0.6, pz) || blocked(px, y + 1.6, pz))) continue;
    // terrain à peu près plat sous le couvert
    if (!map.underground && pts.some(([px, pz]) => Math.abs(heightAt(px, pz) - y) > 0.5)) continue;
    out.push({ kind, x, z, y, rot, w, d, h });
  }
  cache.set(map.id, out);
  return out;
}

/** Le point est-il dans un couvert ? */
export function inProp(props: GFProp[], x: number, y: number, z: number, pad = 0): boolean {
  for (const p of props) {
    if (y < p.y - pad || y > p.y + p.h + pad) continue;
    const dx = x - p.x;
    const dz = z - p.z;
    if (Math.abs(dx) > p.w + p.d || Math.abs(dz) > p.w + p.d) continue;
    const c = Math.cos(p.rot);
    const s = Math.sin(p.rot);
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    if (Math.abs(lx) < p.w / 2 + pad && Math.abs(lz) < p.d / 2 + pad) return true;
  }
  return false;
}

/** Ligne de vue entre deux points sans couvert (les extrémités, 0,3 m, sont ignorées). */
export function propsClear(props: GFProp[], a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): boolean {
  if (!props.length) return true;
  const d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  const n = Math.ceil(d / 0.2);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (t * d < 0.3 || (1 - t) * d < 0.3) continue;
    if (inProp(props, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t)) return false;
  }
  return true;
}

/**
 * Camps d'apparition (parties en équipes) : les points sont rangés le long du grand axe de la carte ; l'équipe
 * Rouge apparaît du côté « début », la Bleue du côté « fin » (2/5 des points chacune), le milieu est neutre.
 */
export function spawnSide(map: GFMap, s: GFSpawn): Team | null {
  const sp = map.spawns;
  const xs = sp.map((p) => p.x);
  const zs = sp.map((p) => p.z);
  const alongX = Math.max(...xs) - Math.min(...xs) >= Math.max(...zs) - Math.min(...zs);
  const v = (p: GFSpawn) => (alongX ? p.x : p.z);
  const sorted = sp.map(v).sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.4)];
  const hi = sorted[Math.ceil(sorted.length * 0.6) - 1];
  return v(s) <= lo ? 'rouge' : v(s) >= hi ? 'bleu' : null;
}
