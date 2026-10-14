/**
 * Cartes du mode Gunfight : chacune est une partie du village (même monde, même décor), avec ses points
 * d'apparition et une limite invisible qu'on ne franchit pas. Données pures : le serveur s'en sert pour les
 * réapparitions et pour refuser les positions hors carte, le navigateur pour arrêter le joueur et les robots.
 *
 *  - Le Village : tout le village, des champs à la lisière (grandes parties).
 *  - Les Souterrains : les galeries et salles à 8 m sous terre ; couloirs étroits, angles morts, combats rapprochés.
 *  - Le Quartier des Tisserands : rues et ruelles bordées de maisons, jardins, portes ouvertes (couloirs de tir et
 *    raccourcis par les maisons).
 *  - La Place du Marché : petite arène autour du puits et de la fontaine, ça tire de partout.
 *  - L'Église et le Cimetière : parvis, tombes, mausolée et murets pour se couvrir.
 *  - La Ferme des Brumes : grange, écuries, ferme et champs ouverts (longues distances, fusil de précision).
 *  - La Forêt de la Lisière : sous-bois dense de l'ouest, troncs pour se cacher, lignes de tir courtes.
 */
import { BUILDINGS, CEMETERY, PATHS, PLAZA, VILLAGE_CENTER, forestEdge, inPolygon, isFree, polygonDistance, type P2 } from '../village/layout';
import { ROOMS, TUNNELS, UNDER } from '../village/underground';
import { limitAt } from '../village/boundary';

export type GFMapId = 'village' | 'souterrains' | 'quartier' | 'place' | 'eglise' | 'ferme' | 'foret';

export interface GFSpawn {
  x: number;
  z: number;
  /** souterrains : hauteur du sol (sinon, sol de la surface) */
  y?: number;
}

export interface GFMap {
  id: GFMapId;
  name: string;
  /** une ligne pour le choix de la carte */
  desc: string;
  /** joueurs conseillés */
  size: string;
  spawns: GFSpawn[];
  /** contour (surface) ; absent : tout le village */
  zone?: P2[];
  underground?: boolean;
}

/** Contour rectangulaire autour d'un ensemble de bâtiments, élargi de `m` mètres. */
function around(ids: (b: (typeof BUILDINGS)[number]) => boolean, m: number, extra: P2[] = []): P2[] {
  const pts: P2[] = [...extra];
  for (const b of BUILDINGS.filter(ids)) {
    const r = Math.hypot(b.w, b.d) / 2;
    pts.push([b.x - r, b.z - r], [b.x + r, b.z + r]);
  }
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  const [x0, x1, z0, z1] = [Math.min(...xs) - m, Math.max(...xs) + m, Math.min(...zs) - m, Math.max(...zs) + m];
  return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
}

/** Secteur de forêt : de la lisière (un peu avant) jusqu'au mur du monde, entre deux directions. */
function forestSector(a0: number, a1: number): P2[] {
  const [cx, cz] = VILLAGE_CENTER;
  const inner: P2[] = [];
  const outer: P2[] = [];
  for (let i = 0; i <= 24; i++) {
    const a = a0 + ((a1 - a0) * i) / 24;
    const edge = forestEdge(cx + Math.cos(a) * 50, cz + Math.sin(a) * 50);
    inner.push([cx + Math.cos(a) * (edge - 12), cz + Math.sin(a) * (edge - 12)]);
    outer.push([cx + Math.cos(a) * (limitAt(a) - 1.5), cz + Math.sin(a) * (limitAt(a) - 1.5)]);
  }
  return [...inner, ...outer.reverse()];
}

/** Points d'apparition dans une zone : rues et chemins, puis terrain libre ; écartés d'au moins `gap` m. */
function spawnsIn(zone: P2[], gap: number, edge = 3, open = true): GFSpawn[] {
  const out: GFSpawn[] = [];
  const add = (x: number, z: number) => {
    if (polygonDistance(x, z, zone) > -edge) return;
    if (out.some((p) => Math.hypot(p.x - x, p.z - z) < gap)) return;
    out.push({ x, z });
  };
  for (const p of PATHS)
    for (let s = 0; s < p.length; s += 4) {
      const k = Math.min(p.pts.length - 1, Math.floor((s / p.length) * (p.pts.length - 1)));
      add(p.pts[k][0], p.pts[k][1]);
    }
  if (open) {
    const xs = zone.map((p) => p[0]);
    const zs = zone.map((p) => p[1]);
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += 5)
      for (let z = Math.min(...zs); z <= Math.max(...zs); z += 5) if (isFree(x, z, 1.5) || inPolygon(x, z, PLAZA)) add(x, z);
  }
  return out;
}

function villageSpawns(): GFSpawn[] {
  const out: GFSpawn[] = [];
  for (const p of PATHS) {
    if (p.road.kind === 'path') continue;
    for (let s = 0; s < p.length; s += 14) {
      const k = Math.min(p.pts.length - 1, Math.floor((s / p.length) * (p.pts.length - 1)));
      const [x, z] = p.pts[k];
      if (Math.hypot(x - 5, z + 10) > 95) continue;
      if (out.some((q) => Math.hypot(q.x - x, q.z - z) < 9)) continue;
      out.push({ x, z });
    }
  }
  for (const [x, z] of [[-8, 6], [10, 6], [-10, -8], [12, -8]] as P2[]) if (inPolygon(x, z, PLAZA)) out.push({ x, z });
  return out;
}

/** Souterrains : centre de chaque salle (un peu décalé des tables), coudes et milieux des galeries. */
function undergroundSpawns(): GFSpawn[] {
  const out: GFSpawn[] = [];
  const y = UNDER.floor;
  for (const r of ROOMS) {
    out.push({ x: r.x0 + (r.x1 - r.x0) * 0.25, z: (r.z0 + r.z1) / 2, y });
    out.push({ x: r.x0 + (r.x1 - r.x0) * 0.75, z: (r.z0 + r.z1) / 2, y });
  }
  for (const t of TUNNELS) {
    if (t.secret || t.w < 2.4) continue;
    for (let i = 1; i < t.pts.length; i++) {
      const [a, b] = [t.pts[i - 1], t.pts[i]];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let s = 6; s < len - 3; s += 12) out.push({ x: a[0] + ((b[0] - a[0]) * s) / len, z: a[1] + ((b[1] - a[1]) * s) / len, y });
    }
  }
  return out.filter((p, i) => !out.slice(0, i).some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 5));
}

const QUARTIER = around((b) => b.district === 'residentiel', 6);
const PLACE = around((b) => b.district === 'place', 3);
const EGLISE = around((b) => b.district === 'eglise', 5, [[CEMETERY.x0, CEMETERY.z0], [CEMETERY.x1, CEMETERY.z1]]);
const FERME = around((b) => b.district === 'abords' && b.id !== 'abandonnee', 16);
const FORET = forestSector(Math.PI * 0.62, Math.PI * 0.98);

export const GF_MAPS: GFMap[] = [
  { id: 'village', name: 'Le Village', desc: 'Tout le village, des rues aux champs : grandes parties, toutes les distances.', size: '8 à 16', spawns: villageSpawns() },
  { id: 'souterrains', name: 'Les Souterrains', desc: 'Galeries et salles secrètes à 8 m sous terre : couloirs, angles morts, corps à corps.', size: '4 à 10', spawns: undergroundSpawns(), underground: true },
  { id: 'quartier', name: 'Le Quartier des Tisserands', desc: 'Rues et ruelles serrées entre les maisons, jardins et raccourcis.', size: '6 à 12', spawns: spawnsIn(QUARTIER, 7), zone: QUARTIER },
  { id: 'place', name: 'La Place du Marché', desc: 'Petite arène autour du puits : ça tire de partout, réapparitions rapides.', size: '2 à 8', spawns: spawnsIn(PLACE, 6, 2), zone: PLACE },
  { id: 'eglise', name: "L'Église et le Cimetière", desc: 'Parvis, tombes et mausolée pour se couvrir ; le clocher domine.', size: '4 à 10', spawns: spawnsIn(EGLISE, 7), zone: EGLISE },
  { id: 'ferme', name: 'La Ferme des Brumes', desc: 'Grange, écuries et champs ouverts : longues distances, fusil de précision.', size: '6 à 12', spawns: spawnsIn(FERME, 9), zone: FERME },
  { id: 'foret', name: 'La Forêt de la Lisière', desc: 'Sous-bois dense à l’ouest : troncs pour se cacher, lignes de tir courtes.', size: '4 à 10', spawns: spawnsIn(FORET, 9, 4), zone: FORET },
];

export const GF_MAP_IDS = GF_MAPS.map((m) => m.id);
export const mapOf = (id: string | undefined): GFMap => GF_MAPS.find((m) => m.id === id) ?? GF_MAPS[0];

/** La position est-elle dans la carte (avec une tolérance `margin` en mètres) ? */
export function insideMap(map: GFMap, x: number, y: number, z: number, margin = 0): boolean {
  if (map.underground) return y < UNDER.floor + 3.5 + margin;
  if (!map.zone) return true;
  return y > UNDER.floor + 4 && polygonDistance(x, z, map.zone) < margin;
}
