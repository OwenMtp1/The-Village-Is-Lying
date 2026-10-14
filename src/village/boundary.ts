/**
 * Limite du monde (données pures) : un mur invisible et infranchissable au bout de la carte (cercle de 295 m de
 * rayon, juste avant le bord du terrain qui s'arrête à 320 m), dans la forêt. Rien n'est dessiné : on bute
 * simplement dessus, même en sautant.
 */
import { heightAt, roadDistance } from './layout';

export const BOUNDARY = { radius: 295, segments: 160, height: 7, thick: 2 };

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
  const R = BOUNDARY.radius;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const ax = Math.cos(a0) * R;
    const az = Math.sin(a0) * R;
    const bx = Math.cos(a1) * R;
    const bz = Math.sin(a1) * R;
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
