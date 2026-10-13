/**
 * Personnages : attribution des apparences, contrôleur de déplacement (vitesses, indépendance au nombre
 * d'images par seconde, diagonales, murs, portes, escaliers, saut, plafonds) sur le vrai village.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { VARIANTS, variantById, variantsOf } from '../src/characters/catalog';
import { assignAppearances, pickVariant, seededRandom } from '../src/characters/appearance';
import { CharacterController, type MoveInput } from '../src/characters/controller';
import { JUMP, MOVE } from '../src/characters/config';
import { buildCollisionWorld } from '../src/village/collision';
import { BUILDINGS, floorOf, localToWorld } from '../src/village/layout';
import { planOf } from '../src/village/plans';

const world = buildCollisionWorld();
const idle: MoveInput = { x: 0, z: 0, run: false, jump: false };

function simulate(c: CharacterController, seconds: number, input: MoveInput | ((t: number) => MoveInput), fps = 60) {
  const dt = 1 / fps;
  const events: string[] = [];
  let maxY = c.y;
  const n = Math.round(seconds * fps);
  for (let i = 0; i < n; i++) {
    const t = i / fps;
    const inp = typeof input === 'function' ? input(t) : input;
    for (const e of c.update(dt, inp)) events.push(e.type);
    maxY = Math.max(maxY, c.y);
  }
  return { events, maxY };
}

test('catalogue : 20 femmes et 20 hommes distincts', () => {
  assert.equal(variantsOf('F').length, 20);
  assert.equal(variantsOf('M').length, 20);
  assert.equal(new Set(VARIANTS.map((v) => v.id)).size, 40);
});

test('apparence : toujours du sexe choisi, répartie sur toutes les variantes', () => {
  const r = seededRandom(7);
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i++) {
    const id = pickVariant('F', r);
    assert.equal(variantById(id)!.sex, 'F');
    seen.add(id);
  }
  assert.equal(seen.size, 20, 'toutes les variantes féminines sortent');
});

test('apparences d’une partie : sans doublon tant que possible, stables, doublons acceptés au-delà', () => {
  const players = Array.from({ length: 8 }, (_, i) => ({ playerId: `p${i}`, sex: (i % 2 ? 'F' : 'M') as 'F' | 'M' }));
  const a = assignAppearances(players, 1234);
  assert.equal(new Set(Object.values(a)).size, 8);
  for (const p of players) assert.equal(variantById(a[p.playerId])!.sex, p.sex);
  // même graine, ordre d'arrivée différent → mêmes apparences (cohérence entre clients)
  assert.deepEqual(assignAppearances([...players].reverse(), 1234), a);
  // un joueur qui arrive en cours de partie ne change l'apparence de personne
  const b = assignAppearances([...players, { playerId: 'p9', sex: 'M' }], 99, a);
  for (const p of players) assert.equal(b[p.playerId], a[p.playerId]);
  assert.ok(!Object.values(a).includes(b.p9));
  // 25 hommes pour 20 modèles : la partie se crée quand même
  const many = assignAppearances(Array.from({ length: 25 }, (_, i) => ({ playerId: `m${i}`, sex: 'M' as const })), 5);
  assert.equal(Object.keys(many).length, 25);
  assert.equal(new Set(Object.values(many)).size, 20);
});

test('marche et course : vitesses de croisière, accélération progressive', () => {
  const c = new CharacterController(world, -5, 4, 1.75);
  simulate(c, 0.1, { x: 1, z: 0, run: false, jump: false });
  assert.ok(c.speed > 0.2 && c.speed < MOVE.walkSpeed * 0.6, `démarrage progressif (${c.speed.toFixed(2)})`);
  simulate(c, 1.5, { x: 1, z: 0, run: false, jump: false });
  assert.ok(Math.abs(c.speed - MOVE.walkSpeed) < 0.05, `marche ${c.speed}`);
  simulate(c, 0.2, { x: 1, z: 0, run: true, jump: false });
  assert.ok(c.speed > MOVE.walkSpeed && c.speed < MOVE.runSpeed - 0.5, 'passage progressif à la course');
  simulate(c, 1.2, { x: 1, z: 0, run: true, jump: false });
  assert.ok(Math.abs(c.speed - MOVE.runSpeed) < 0.06, `course ${c.speed}`);
  simulate(c, 0.15, idle);
  assert.ok(c.speed > 1, 'ralentit sans s’arrêter net');
  simulate(c, 1.0, idle);
  assert.ok(c.speed < 0.01, 'puis s’arrête');
});

test('diagonale pas plus rapide que les axes', () => {
  const c = new CharacterController(world, -5, 4, 1.75);
  simulate(c, 2, { x: Math.SQRT1_2, z: Math.SQRT1_2, run: false, jump: false });
  assert.ok(c.speed <= MOVE.walkSpeed + 0.01, `${c.speed}`);
  const d = new CharacterController(world, -5, 4, 1.75);
  simulate(d, 2, { x: 1, z: 1, run: false, jump: false });
  assert.ok(d.speed <= MOVE.walkSpeed + 0.01, `entrée non normalisée ${d.speed}`);
});

test('même trajectoire à 30, 60 et 144 images par seconde', () => {
  const pos = [30, 60, 144].map((fps) => {
    const c = new CharacterController(world, -5, 4, 1.75);
    simulate(c, 2.0, (t) => ({ x: 1, z: t >= 1 ? 1 : 0, run: t >= 0.5, jump: t >= 1.2 && t < 1.2 + 1 / fps }), fps);
    return [c.x, c.y, c.z];
  });
  for (const p of pos.slice(1)) for (let k = 0; k < 3; k++) assert.ok(Math.abs(p[k] - pos[0][k]) < 0.05, `écart ${p[k] - pos[0][k]}`);
});

test('un mur arrête le personnage, qui ne « marche » plus sur place', () => {
  // la taverne : on marche vers son mur de façade, à côté de la porte
  const tav = BUILDINGS.find((b) => b.id === 'taverne')!;
  const [x, z] = localToWorld(tav, 4.5, tav.d / 2 + 2.5);
  const c = new CharacterController(world, x, z, 1.75);
  simulate(c, 3, { x: 0, z: -1, run: false, jump: false });
  const [, lz] = [0, c.z - tav.z];
  assert.ok(lz > tav.d / 2 - 0.05, `traverse le mur (${lz})`);
  assert.ok(c.speed < 0.05, `vitesse réelle contre le mur ${c.speed}`);
});

test('on franchit la porte de la taverne et on entre dans la grande salle', () => {
  const tav = BUILDINGS.find((b) => b.id === 'taverne')!;
  const door = planOf(tav).openings.find((o) => o.side === 'front' && o.kind === 'door')!;
  const [x, z] = localToWorld(tav, door.at, tav.d / 2 + 3);
  const c = new CharacterController(world, x, z, 1.75);
  simulate(c, 4, { x: 0, z: -1, run: false, jump: false });
  const lz = c.z - tav.z;
  assert.ok(lz < tav.d / 2 - 1.5, `toujours dehors (${lz.toFixed(2)})`);
  assert.ok(Math.abs(c.y - floorOf(tav)) < 0.02, 'sur le plancher de la salle');
});

test('on monte un escalier jusqu’à l’étage', () => {
  let tested = 0;
  for (const id of ['drapier', 'maison-t1', 'sherif', 'forge']) {
    const b = BUILDINGS.find((x) => x.id === id)!;
    const plan = planOf(b);
    const s = plan.stairs.find((q) => q.kind === 'stair' && plan.levels[q.from].index === 0)!;
    const R = s.rect;
    const cx = (R.x0 + R.x1) / 2;
    const cz = (R.z0 + R.z1) / 2;
    const half = Math.abs(s.dir[1]) > 0.5 ? (R.z1 - R.z0) / 2 : (R.x1 - R.x0) / 2;
    const [sx, sz] = localToWorld(b, cx - s.dir[0] * (half + 0.5), cz - s.dir[1] * (half + 0.5));
    const [ex, ez] = localToWorld(b, cx + s.dir[0], cz + s.dir[1]);
    const dx = ex - sx;
    const dz = ez - sz;
    const l = Math.hypot(dx, dz);
    const c = new CharacterController(world, sx, sz, 1.75, floorOf(b));
    simulate(c, 6, { x: dx / l, z: dz / l, run: false, jump: false });
    assert.ok(c.y > floorOf(b) + s.rise - 0.05, `${id} : arrivé à ${(c.y - floorOf(b)).toFixed(2)} m au lieu de ${s.rise}`);
    tested++;
  }
  assert.equal(tested, 4);
});

test('saut : une seule impulsion, hauteur et durée crédibles, atterrissage détecté', () => {
  const c = new CharacterController(world, -5, 4, 1.75);
  const y0 = c.y;
  // Espace enfoncé à la première image puis maintenu (le jeu ne transmet que le front montant)
  const r = simulate(c, 2, (t) => ({ x: 0, z: 0, run: false, jump: t < 1 / 120 }));
  assert.deepEqual(r.events.filter((e) => e !== 'fall'), ['jump', 'land']);
  assert.ok(Math.abs(r.maxY - y0 - JUMP.height) < 0.03, `hauteur ${r.maxY - y0}`);
  assert.ok(c.grounded && Math.abs(c.y - y0) < 1e-6);
  // appuis répétés pendant le vol : pas de second saut en l'air
  const d = new CharacterController(world, -5, 4, 1.75);
  const r2 = simulate(d, 0.35, (t) => ({ x: 0, z: 0, run: false, jump: Math.floor(t * 60) % 6 === 0 && t < 0.3 }));
  assert.equal(r2.events.filter((e) => e === 'jump').length, 1);
});

test('saut sous un plafond : la tête ne traverse pas le plancher de l’étage', () => {
  const tav = BUILDINGS.find((b) => b.id === 'taverne')!;
  const [x, z] = localToWorld(tav, -2, 3);
  const c = new CharacterController(world, x, z, 1.75, floorOf(tav));
  const ceil = world.ceilingAt(x, z, c.y);
  assert.ok(ceil < floorOf(tav) + 3.4, 'plafond détecté');
  const r = simulate(c, 1.5, (t) => ({ x: 0, z: 0, run: false, jump: t < 1 / 120 }));
  assert.ok(r.maxY + 1.75 <= ceil + 1e-6);
});
