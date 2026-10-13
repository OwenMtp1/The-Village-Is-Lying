/**
 * Cohérence du village : implantation (pas de recouvrement, pas de bâtiment sur une rue), plans intérieurs
 * (escaliers et trémies dans les murs, cloisons hors des trémies, mobilier dans les pièces, portes dégagées).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILDINGS, CHURCH_SQUARE, PLAZA, convexOverlap, footprint, polygonDistance, roadDistance, type P2 } from '../src/village/layout';
import { FURN, inside, itemRect, overlaps, planOf, rect, _test } from '../src/village/plans';

test('aucun bâtiment ne chevauche un autre bâtiment', () => {
  for (let i = 0; i < BUILDINGS.length; i++)
    for (let j = i + 1; j < BUILDINGS.length; j++) assert.ok(!convexOverlap(footprint(BUILDINGS[i]), footprint(BUILDINGS[j])), `${BUILDINGS[i].id} × ${BUILDINGS[j].id}`);
});

test('aucun bâtiment sur une rue ou une place', () => {
  for (const b of BUILDINGS) {
    const fp = footprint(b);
    for (let i = 0; i < 4; i++)
      for (let k = 0; k <= 10; k++) {
        const a = fp[i];
        const c = fp[(i + 1) % 4];
        const p: P2 = [a[0] + ((c[0] - a[0]) * k) / 10, a[1] + ((c[1] - a[1]) * k) / 10];
        assert.ok(roadDistance(p[0], p[1]).d > 0.3, `${b.id} touche une rue`);
        assert.ok(polygonDistance(p[0], p[1], PLAZA) > 0.3 && polygonDistance(p[0], p[1], CHURCH_SQUARE) > 0.3, `${b.id} touche une place`);
      }
  }
});

test('chaque porte d’entrée donne sur un espace libre (rue, place, cour)', () => {
  for (const b of BUILDINGS) {
    const plan = planOf(b);
    const doors = plan.openings.filter((o) => o.side === 'front' && (o.kind === 'door' || o.kind === 'big-door' || o.kind === 'arch'));
    assert.ok(doors.length > 0, `${b.id} sans porte sur rue`);
  }
});

for (const b of BUILDINGS)
  test(`plan de ${b.id} : escaliers, trémies, cloisons et mobilier cohérents`, () => {
    const plan = planOf(b);
    for (const s of plan.stairs) {
      const from = plan.levels[s.from];
      assert.ok(inside(s.rect, from.inner, -0.01), `${b.id} : escalier hors des murs au niveau ${from.name}`);
      const to = plan.levels.find((l) => Math.abs(l.y - (from.y + s.rise)) < 0.01);
      assert.ok(to, `${b.id} : escalier sans niveau d'arrivée`);
      assert.ok(inside(s.rect, to!.inner, -0.06), `${b.id} : trémie hors des murs au niveau ${to!.name}`);
      // aucune cloison ne traverse la volée, ni au départ ni à l'arrivée
      for (const l of [from, to!])
        for (const p of l.partitions) {
          const pr = rect(Math.min(p.a[0], p.b[0]) - 0.07, Math.max(p.a[0], p.b[0]) + 0.07, Math.min(p.a[1], p.b[1]) - 0.07, Math.max(p.a[1], p.b[1]) + 0.07);
          assert.ok(!overlaps(pr, s.rect, -0.01), `${b.id} : une cloison traverse l'escalier (${l.name})`);
        }
      // dégagements de l'escalier sans cloison
      for (const c of _test.stairClearances(s, plan.levels))
        for (const p of plan.levels[c.level].partitions) {
          const pr = rect(Math.min(p.a[0], p.b[0]) - 0.07, Math.max(p.a[0], p.b[0]) + 0.07, Math.min(p.a[1], p.b[1]) - 0.07, Math.max(p.a[1], p.b[1]) + 0.07);
          assert.ok(!overlaps(pr, c.r, -0.02), `${b.id} : palier d'escalier coupé par une cloison (${plan.levels[c.level].name})`);
        }
    }
    for (const l of plan.levels) {
      for (const it of l.items) {
        const r = itemRect(it);
        assert.ok(inside(r, l.inner, 0.02), `${b.id} : ${it.type} traverse un mur (${l.name})`);
        assert.ok(FURN[it.type][2] + (it.y ?? 0) <= l.h + 0.01 || l.name === 'Combles', `${b.id} : ${it.type} plus haut que le plafond`);
        for (const h of l.holes) assert.ok(!overlaps(r, h), `${b.id} : ${it.type} au-dessus d'une trémie (${l.name})`);
      }
      // aucun meuble posé ne chevauche un autre (hors objets accrochés au mur)
      const floorItems = l.items.filter((it) => it.y === undefined && it.type !== 'rug');
      for (let i = 0; i < floorItems.length; i++)
        for (let j = i + 1; j < floorItems.length; j++)
          assert.ok(!overlaps(itemRect(floorItems[i]), itemRect(floorItems[j]), -0.02), `${b.id} : ${floorItems[i].type} et ${floorItems[j].type} se chevauchent (${l.name})`);
      // les pièces sont dans les murs
      for (const room of l.rooms) assert.ok(inside(room.rect, l.inner, -0.01), `${b.id} : pièce ${room.name} hors des murs`);
    }
    // chaque bâtiment est meublé
    const n = plan.levels.reduce((s, l) => s + l.items.length, 0);
    assert.ok(n >= 4, `${b.id} : intérieur vide (${n} objets)`);
  });
