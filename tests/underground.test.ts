/**
 * Souterrains et limite de la carte, avec le vrai contrôleur de déplacement et le vrai monde de collisions :
 * on descend et on remonte par chaque entrée, toutes les salles sont reliées, on ne franchit pas la limite de la carte.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCollisionWorld } from '../src/village/collision';
import { CharacterController } from '../src/characters/controller';
import { MOVE } from '../src/characters/config';
import { ROOMS, SHAFTS, UNDER, undergroundGrid, undergroundPlace } from '../src/village/underground';
import { insideLimit, limitAt } from '../src/village/boundary';
import { VILLAGE_CENTER } from '../src/village/layout';
import { isFree } from '../src/village/layout';

const world = buildCollisionWorld();
const walk = (c: CharacterController, dx: number, dz: number, seconds: number) => {
  for (let i = 0; i < seconds * 60; i++) c.update(1 / 60, { x: dx, z: dz, run: false, jump: false });
};

for (const s of SHAFTS)
  test(`entrée « ${s.name} » : on descend l'échelle et on remonte`, () => {
    assert.ok(!isFree(s.x, s.z, 0), 'zone réservée : ni arbre ni décor sur le puits');
    // en surface, devant l'ouverture (côté +z), on avance vers le puits
    const c = new CharacterController(world, s.x, s.z + (s.look === 'mausolee' ? 3.2 : 1.7), 1.75, s.ground + 0.05);
    walk(c, 0, -1, 8);
    assert.ok(c.y < UNDER.floor + 0.5, `descendu jusqu'aux galeries (y = ${c.y.toFixed(2)})`);
    assert.match(undergroundPlace(c.x, c.y + 0.5, c.z) ?? '', /Sous|Galeries|Crypte|Ossuaire|Chapelle|Puits/);
    // au pied de l'échelle, on remonte
    const u = new CharacterController(world, s.x, s.z - UNDER.shaft / 2 - UNDER.niche + 0.27, 1.75, UNDER.floor + 0.02);
    walk(u, 0, 1, 10);
    assert.ok(u.y > s.ground - 0.4, `remonté en surface (y = ${u.y.toFixed(2)}, sol ${s.ground.toFixed(2)})`);
  });

test('galeries : toutes les salles sont reliées entre elles et aux cinq entrées', () => {
  const g = undergroundGrid();
  const F = UNDER.floor;
  const C = UNDER.cell;
  const seen = new Uint8Array(g.nx * g.nz);
  const s0 = SHAFTS[0];
  const start = [Math.floor((s0.x - g.x0) / C), Math.floor((s0.z - UNDER.shaft / 2 - 0.3 - g.z0) / C)];
  const q = [start];
  const free = (i: number, j: number) => {
    const x = g.x0 + (i + 0.5) * C;
    const z = g.z0 + (j + 0.5) * C;
    const y = world.groundAt(x, z, F + 0.4);
    return Math.abs(y - F) < 0.3 && !world.resolve(x, z, MOVE.radius, F, 1.7).hit;
  };
  while (q.length) {
    const [i, j] = q.pop()!;
    if (i < 0 || j < 0 || i >= g.nx || j >= g.nz || seen[j * g.nx + i] || !free(i, j)) continue;
    seen[j * g.nx + i] = 1;
    q.push([i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]);
  }
  const reached = (x: number, z: number) => seen[Math.floor((z - g.z0) / C) * g.nx + Math.floor((x - g.x0) / C)] === 1;
  const missing: string[] = [];
  for (const r of ROOMS) {
    let any = false;
    for (let x = r.x0 + 0.3; x < r.x1 && !any; x += 0.5) for (let z = r.z0 + 0.3; z < r.z1 && !any; z += 0.5) any = reached(x, z);
    if (!any) missing.push(r.name);
  }
  assert.deepEqual(missing, [], `salles inaccessibles : ${missing.join(', ')}`);
  for (const s of SHAFTS) assert.ok(reached(s.x, s.z - UNDER.shaft / 2 - 0.3), `pied du puits « ${s.name} » coupé du réseau`);
});

test('limite de la carte : mur invisible, on ne sort pas, même en courant et en sautant', () => {
  const [cx, cz] = VILLAGE_CENTER;
  for (const a of [0, 0.8, 1.3, 2.1, 2.6, 3.4, 4.1, 4.9, 5.5]) {
    const r0 = limitAt(a) - 12;
    const c = new CharacterController(world, cx + Math.cos(a) * r0, cz + Math.sin(a) * r0, 1.75);
    for (let i = 0; i < 20 * 60; i++) c.update(1 / 60, { x: Math.cos(a), z: Math.sin(a), run: true, jump: i % 30 === 0 });
    assert.ok(insideLimit(c.x, c.z), `sorti à l'angle ${a}`);
    assert.ok(Math.hypot(c.x - cx, c.z - cz) > limitAt(a) - 3, `arrêté trop tôt à l'angle ${a}`);
  }
});
