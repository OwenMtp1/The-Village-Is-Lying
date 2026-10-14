/** Carte ASCII d'une zone des souterrains (contrôle) : # mur, o libre pour un personnage, . bloqué. */
import { buildCollisionWorld } from '../src/village/collision';
import { UNDER } from '../src/village/underground';
const [x0, x1, z0, z1] = process.argv.slice(2).map(Number);
const w = buildCollisionWorld();
for (let z = z1; z >= z0; z -= 0.5) {
  let row = '';
  for (let x = x0; x <= x1; x += 0.5) {
    const y = w.groundAt(x, z, UNDER.floor + 0.4);
    row += Math.abs(y - UNDER.floor) > 0.3 ? ' ' : w.resolve(x, z, 0, UNDER.floor, 1.7).hit ? '#' : w.resolve(x, z, 0.25, UNDER.floor, 1.7).hit ? '.' : 'o';
  }
  console.log(z.toFixed(1).padStart(6), row);
}
