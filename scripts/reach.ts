/**
 * Accessibilité des pièces pour un personnage réel (rayon 0,27 m, 1,7 m) : remplissage depuis la rue autour de
 * chaque bâtiment, en suivant planchers, marches et escaliers (marche franchissable 0,36 m), avec les vrais
 * obstacles de collision (murs, cloisons, mobilier). Affiche la part de chaque pièce que l'on peut atteindre.
 *   npx tsx scripts/reach.ts            résumé
 *   npx tsx scripts/reach.ts --all      toutes les pièces
 */
import { buildCollisionWorld } from '../src/village/collision';
import { BUILDINGS, CHURCH_SQUARE, PLAZA, floorOf, localToWorld, polygonDistance, roadDistance } from '../src/village/layout';
import { planOf } from '../src/village/plans';
import { MOVE } from '../src/characters/config';

const world = buildCollisionWorld();
const R = MOVE.radius;
const STEP = 0.2;
const all = process.argv.includes('--all');
let totalRooms = 0;
let badRooms = 0;
const lines: string[] = [];

export function reachBuilding(id: string) {
  const b = BUILDINGS.find((x) => x.id === id)!;
  const plan = planOf(b);
  const base = floorOf(b);
  const half = Math.max(b.w, b.d) / 2 + 3;
  const n = Math.ceil((half * 2) / STEP);
  const seen = new Set<string>();
  const queue: [number, number, number][] = [];
  const free = (x: number, z: number, y: number) => !world.resolve(x, z, R, y, 1.7).hit;
  const toW = (i: number, j: number) => localToWorld(b, -half + i * STEP, -half + j * STEP);
  // départ : les points libres du pourtour proches d'une rue ou d'une place (pas un jardin clos)
  const public_ = (x: number, z: number) => roadDistance(x, z).d < 3 || polygonDistance(x, z, PLAZA) < 2 || polygonDistance(x, z, CHURCH_SQUARE) < 2;
  for (let i = 0; i < n; i++)
    for (const [a, c] of [[i, 0], [i, n - 1], [0, i], [n - 1, i]]) {
      const [x, z] = toW(a, c);
      const y = world.groundAt(x, z, 1e6);
      // côté façade (+z local, toujours sur l'espace public) ou près d'une rue / place
      if (Number.isFinite(y) && (c === n - 1 || public_(x, z)) && free(x, z, y)) queue.push([a, c, y]);
    }
  while (queue.length) {
    const [i, j, y] = queue.pop()!;
    const key = `${i},${j},${Math.round(y * 2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di;
      const c = j + dj;
      if (a < 0 || c < 0 || a >= n || c >= n) continue;
      const [x, z] = toW(a, c);
      // en jeu, le contrôleur suit une rampe par petits pas (1/120 s) : une échelle raide se gravit ; ici, pas de 0,2 m
      const ny = world.groundAt(x, z, y + 1.0);
      if (!Number.isFinite(ny) || ny < y - 3) continue;
      if (world.ceilingAt(x, z, ny) < ny + 1.75) continue;
      if (!free(x, z, ny)) continue;
      const k2 = `${a},${c},${Math.round(ny * 2)}`;
      if (!seen.has(k2)) queue.push([a, c, ny]);
    }
  }
  const out: { level: string; room: string; reach: number; freeCells: number }[] = [];
  for (const l of plan.levels) {
    const y = base + l.y;
    for (const room of l.rooms) {
      let freeCells = 0;
      let reached = 0;
      for (let lx = room.rect.x0 + 0.1; lx < room.rect.x1; lx += STEP)
        for (let lz = room.rect.z0 + 0.1; lz < room.rect.z1; lz += STEP) {
          const i = Math.round((lx + half) / STEP);
          const j = Math.round((lz + half) / STEP);
          const [x, z] = toW(i, j);
          const gy = world.groundAt(x, z, y + 0.4);
          if (!Number.isFinite(gy) || Math.abs(gy - y) > 0.45 || !free(x, z, gy)) continue;
          freeCells++;
          if (seen.has(`${i},${j},${Math.round(gy * 2)}`)) reached++;
        }
      out.push({ level: l.name, room: room.name, reach: freeCells ? reached / freeCells : 0, freeCells });
    }
  }
  return out;
}

if (process.argv[1]?.endsWith('reach.ts')) {
  for (const b of BUILDINGS) {
    const rooms = reachBuilding(b.id);
    for (const r of rooms) {
      totalRooms++;
      const bad = r.reach < 0.6;
      if (bad) badRooms++;
      if (bad || all) lines.push(`${bad ? '✖' : '✔'} ${b.id.padEnd(16)} ${r.level.padEnd(14)} ${r.room.padEnd(24)} ${(r.reach * 100).toFixed(0).padStart(3)} % de ${r.freeCells} cases libres`);
    }
  }
  console.log(lines.join('\n'));
  console.log(`${badRooms} pièces sur ${totalRooms} difficilement accessibles (< 60 % atteignable)`);
}
