/** Contrôle rapide de l'implantation : recouvrements de bâtiments, bâtiments sur une rue ou une place. */
import { BUILDINGS, CEMETERY, CHURCH_SQUARE, GARDENS, PLAZA, convexOverlap, footprint, polygonDistance, roadDistance, type P2 } from '../src/village/layout';

const problems: string[] = [];
for (let i = 0; i < BUILDINGS.length; i++)
  for (let j = i + 1; j < BUILDINGS.length; j++)
    if (convexOverlap(footprint(BUILDINGS[i], 0), footprint(BUILDINGS[j], 0))) problems.push(`recouvrement ${BUILDINGS[i].id} × ${BUILDINGS[j].id}`);
for (const b of BUILDINGS) {
  const fp = footprint(b);
  const samples: P2[] = [];
  for (let i = 0; i < 4; i++) {
    const a = fp[i];
    const c = fp[(i + 1) % 4];
    for (let k = 0; k <= 10; k++) samples.push([a[0] + ((c[0] - a[0]) * k) / 10, a[1] + ((c[1] - a[1]) * k) / 10]);
  }
  const road = samples.map(([x, z]) => roadDistance(x, z)).reduce((m, r) => (r.d < m.d ? r : m), { d: Infinity, road: null } as ReturnType<typeof roadDistance>);
  if (road.d < 0.4) problems.push(`${b.id} sur la rue ${road.road?.id} (${road.d.toFixed(2)} m)`);
  const pl = Math.min(...samples.map(([x, z]) => Math.min(polygonDistance(x, z, PLAZA), polygonDistance(x, z, CHURCH_SQUARE))));
  if (pl < 0.4) problems.push(`${b.id} empiète sur une place (${pl.toFixed(2)} m)`);
  if (samples.some(([x, z]) => x > CEMETERY.x0 - 0.5 && x < CEMETERY.x1 + 0.5 && z > CEMETERY.z0 - 0.5 && z < CEMETERY.z1 + 0.5)) problems.push(`${b.id} dans le cimetière`);
  console.log(b.id.padEnd(20), b.x.toFixed(1).padStart(7), b.z.toFixed(1).padStart(7), 'rue', road.d.toFixed(1));
}
console.log(`jardins : ${GARDENS.length}/${BUILDINGS.filter((b) => b.garden).length}`);
console.log(problems.length ? problems.join('\n') : 'aucun conflit');
process.exitCode = problems.length ? 1 : 0;
