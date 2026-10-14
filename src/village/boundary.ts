/**
 * Limite du monde (données pures) : un mur invisible et infranchissable qui suit la lisière de la forêt, 35 m sous
 * les arbres (on peut s'y enfoncer un peu, pas aller se perdre dans les collines du fond). Rien n'est dessiné :
 * on bute simplement dessus, même en sautant ou en vol libre.
 */
import { VILLAGE_CENTER, forestEdge, heightAt, roadDistance } from './layout';

export const BOUNDARY = { depth: 35, segments: 160, height: 7, thick: 2 };

/** Distance de la limite au centre du village dans la direction `a` (rad). */
export function limitAt(a: number) {
  const [cx, cz] = VILLAGE_CENTER;
  return forestEdge(cx + Math.cos(a) * 50, cz + Math.sin(a) * 50) + BOUNDARY.depth;
}

/** Le point (x, z) est-il dans la zone jouable (avec une marge) ? */
export function insideLimit(x: number, z: number, margin = 0) {
  const [cx, cz] = VILLAGE_CENTER;
  return Math.hypot(x - cx, z - cz) < limitAt(Math.atan2(z - cz, x - cx)) - margin;
}

export interface WallSegment {
  x: number;
  z: number;
  /** longueur et orientation (rot : convention des boîtes de collision et de Three.js, rotation autour de y) */
  len: number;
  rot: number;
  /** sol le plus bas et le plus haut sous le segment */
  g0: number;
  g1: number;
  gate: boolean;
}

export const WALL: WallSegment[] = (() => {
  const out: WallSegment[] = [];
  const n = BOUNDARY.segments;
  const [cx, cz] = VILLAGE_CENTER;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const ax = cx + Math.cos(a0) * limitAt(a0);
    const az = cz + Math.sin(a0) * limitAt(a0);
    const bx = cx + Math.cos(a1) * limitAt(a1);
    const bz = cz + Math.sin(a1) * limitAt(a1);
    const x = (ax + bx) / 2;
    const z = (az + bz) / 2;
    let g0 = Infinity;
    let g1 = -Infinity;
    for (let t = 0; t <= 1; t += 0.25) {
      const h = heightAt(ax + (bx - ax) * t, az + (bz - az) * t);
      g0 = Math.min(g0, h);
      g1 = Math.max(g1, h);
    }
    out.push({ x, z, len: Math.hypot(bx - ax, bz - az), rot: -Math.atan2(bz - az, bx - ax), g0, g1, gate: roadDistance(x, z).d < 5 });
  }
  return out;
})();

/** Boîtes de collision de la limite (très hautes : on ne la franchit pas en sautant). */
export function wallObstacles() {
  return WALL.map((s) => ({ x: s.x, z: s.z, hx: s.len / 2 + 0.4, hz: BOUNDARY.thick / 2, rot: s.rot, y0: s.g0 - 4, y1: s.g1 + BOUNDARY.height + 20, tag: 'limite' }));
}
