/**
 * Règles de partie revérifiées par le serveur : lignes de vue (murs du vrai village), joueurs éliminés,
 * munitions, fin de partie expliquée, retour au salon et manches successives sans état résiduel.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCollisionWorld } from '../src/village/collision';
import { RULES } from '../src/shared/rules';
import { C, gather, place, pose, setup } from './helpers';

const world = buildCollisionWorld();
const sight = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => world.lineClear(a.x, a.y, a.z, b.x, b.y, b.z);

// la taverne (7,5 ; −21,2), 15 m × 11 m : un joueur au rez-de-chaussée, un autre dehors, à l'est du pignon
const floorY = (x: number, z: number) => world.groundAt(x, z, 2);
const INSIDE = { x: 9, z: -21.2 };
const OUTSIDE = { x: 19, z: -21.2 };

test('ligne de vue : dégagée sur la place, coupée par les murs de la taverne', () => {
  assert.ok(world.lineClear(-4, 1.3, 4, 6, 1.3, 4), 'place dégagée');
  const yi = floorY(INSIDE.x, INSIDE.z);
  const yo = floorY(OUTSIDE.x, OUTSIDE.z);
  assert.ok(Number.isFinite(yi) && Number.isFinite(yo));
  assert.equal(world.lineClear(INSIDE.x, yi + 1.3, INSIDE.z, OUTSIDE.x, yo + 1.3, OUTSIDE.z), false, 'mur du pignon');
});

test('shérif : pistolet en main, 4 balles, tir manqué à travers un mur ou hors de l’axe, mort = plus aucune action', () => {
  const { room, out, ids, clock } = setup(C(1, 2, 0, 3), { sight });
  room.start(ids[0]);
  const killer = ids.find((i) => room.roleOf(i) === 'tueur')!;
  const [s1, s2] = ids.filter((i) => room.roleOf(i) === 'sherif');
  const villagers = ids.filter((i) => room.roleOf(i) === 'villageois');
  clock.advance(10);
  for (const id of ids) place(room, id, -4, 4);
  clock.advance(10);
  // pistolet rangé : pas de tir
  room.pose(s1, pose(-4, 4));
  assert.throws(() => room.shoot(s1, killer), /Sortez votre pistolet/);
  clock.advance(10);
  // à travers le mur de la taverne : la balle part mais ne touche pas
  place(room, s1, INSIDE.x, INSIDE.z, floorY(INSIDE.x, INSIDE.z), [OUTSIDE.x, OUTSIDE.z]);
  place(room, killer, OUTSIDE.x, OUTSIDE.z, floorY(OUTSIDE.x, OUTSIDE.z));
  assert.deepEqual(room.shoot(s1, killer), { hit: false });
  assert.ok(room.isAlive(killer));
  assert.equal(room.privateInfo(s1)!.ammo, RULES.sheriffAmmo - 1, 'la balle est partie');
  assert.ok(out.gestures.some((g) => g.g.id === s1 && g.g.kind === 'tir'), 'le tir est montré aux joueurs proches');
  // le second shérif vise ailleurs (dos tourné) : manqué ; puis il vise un innocent : il meurt avec lui
  clock.advance(10);
  place(room, s2, -4, 6, 0, [-4, 20]);
  assert.deepEqual(room.shoot(s2, villagers[0]), { hit: false }, 'cible hors de l’axe du regard');
  place(room, s2, -4, 6, 0, [-4, 4]);
  assert.deepEqual(room.shoot(s2, villagers[0]), { hit: true });
  assert.ok(!room.isAlive(s2) && !room.isAlive(villagers[0]));
  assert.throws(() => room.shoot(s2, killer), /éliminé/);
  assert.throws(() => room.emergency(s2), /éliminé/);
  assert.throws(() => room.report(s2, villagers[0]), /éliminé/);
});

test('tueur : couteau en main, face à la cible, pas à travers un mur', () => {
  const { room, out, ids, clock } = setup(C(1, 1, 1, 3), { sight });
  room.start(ids[0]);
  const killer = ids.find((i) => room.roleOf(i) === 'tueur')!;
  const victim = ids.find((i) => i !== killer)!;
  clock.advance(RULES.firstKillDelay + 10);
  for (const id of ids) place(room, id, -4, 4);
  clock.advance(10);
  // de part et d'autre du mur de façade sud de la taverne, à 1,6 m l'un de l'autre
  place(room, killer, 4, -16.5, floorY(4, -16.5), [4, -14.9]);
  place(room, victim, 4, -14.9, floorY(4, -14.9));
  assert.throws(() => room.eliminate(killer, victim), /obstacle/);
  clock.advance(10);
  // sur la place : couteau rangé, puis dos tourné, puis face à la victime
  room.pose(killer, pose(-4, 6));
  place(room, victim, -4, 7.5);
  assert.throws(() => room.eliminate(killer, victim), /Sortez votre couteau/);
  place(room, killer, -4, 6, 0, [-4, 0]);
  assert.throws(() => room.eliminate(killer, victim), /Faites face/);
  place(room, killer, -4, 6, 0, [-4, 7.5]);
  room.eliminate(killer, victim);
  assert.ok(!room.isAlive(victim));
  assert.ok(out.gestures.some((g) => g.g.kind === 'couteau' && g.to.includes(victim)));
});

test('armes : un innocent ne peut pas exhiber de couteau ni de pistolet', () => {
  const { room, ids, clock } = setup(C(1, 1, 1, 3));
  room.start(ids[0]);
  const villager = ids.find((i) => room.roleOf(i) === 'villageois')!;
  clock.advance(3);
  room.pose(villager, pose(0, 0, 0, 'couteau'));
  assert.equal(room.posesView()[villager].item, null);
});

test('vote : le décompte est expliqué, la majorité élimine', () => {
  const { room, out, ids, clock } = setup(C(1, 1, 1, 3));
  room.start(ids[0]);
  gather(room, ids, clock);
  const killer = ids.find((i) => room.roleOf(i) === 'tueur')!;
  room.emergency(ids.find((i) => i !== killer)!);
  const others = ids.filter((i) => i !== killer);
  for (const v of others.slice(0, 3)) room.vote(v, killer);
  room.vote(others[3], null);
  room.vote(others[4], null);
  room.vote(killer, others[0]);
  assert.ok(!room.isAlive(killer));
  assert.ok(out.events.some((e) => /est éliminé \(.*3 voix.*1 voix.*personne 2 voix\)/.test(e)), out.events.join(' | '));
});

test('fin de partie : raison lisible, survivants ; retour au salon puis nouvelle manche sans reste', () => {
  const { room, out, ids, clock } = setup(C(1, 1, 0, 2));
  room.start(ids[0]);
  gather(room, ids, clock);
  const killer = ids.find((i) => room.roleOf(i) === 'tueur')!;
  const sheriff = ids.find((i) => room.roleOf(i) === 'sherif')!;
  room.shoot(sheriff, killer);
  const r = room.gameView().result!;
  assert.equal(r.winner, 'innocents');
  assert.match(r.reason, /tueurs ont été éliminés/);
  assert.equal(r.survivors.length, 3);
  assert.throws(() => room.emergency(sheriff), /terminée|Aucune partie/, 'aucune action après la fin');
  assert.throws(() => room.start(ids[1]), /hôte/);
  // un joueur ferme son onglet pendant les résultats : sa place se libère au retour au salon
  room.leave(ids[3], true);
  room.backToLobby(ids[1]);
  const lv = room.lobbyView();
  assert.equal(lv.phase, 'salon');
  assert.equal(lv.players.length, 3);
  assert.match(lv.blocker ?? '', /Il manque 1 joueur/);
  room.join('Nouveau', 'F');
  room.start(ids[0]);
  const g = room.gameView();
  assert.equal(g.phase, 'jeu');
  assert.equal(g.result, null);
  assert.deepEqual(g.bodies, []);
  assert.equal(Object.values(g.alive).filter(Boolean).length, 4, 'tous vivants');
  assert.ok(g.log.length === 0);
  for (const id of Object.keys(g.alive)) assert.equal(room.privateInfo(id)!.findings && Object.keys(room.privateInfo(id)!.findings).length, 0);
  assert.equal(room.privateInfo(ids.find((i) => room.roleOf(i) === 'sherif') ?? '')?.ammo ?? RULES.sheriffAmmo, RULES.sheriffAmmo, 'balles rechargées');
  void out;
});

test('salon : un joueur quitte avant le lancement, la composition minimale et plusieurs tueurs', () => {
  const { room, ids } = setup(C(2, 1, 1, 4));
  room.leave(ids[5], true);
  assert.match(room.lobbyView().blocker ?? '', /Il manque 1 joueur/);
  assert.throws(() => room.start(ids[0]), /manque/);
  room.join('Retour', 'M');
  room.start(ids[0]);
  assert.equal(Object.keys(room.gameView().alive).length, 8);
  // composition minimale : 4 joueurs
  const m = setup(C(1, 0, 0, 3));
  m.room.start(m.ids[0]);
  assert.equal(m.room.gameView().phase, 'jeu');
});

test('réunion : un seul signalement par corps, votes comptés une fois, sans majorité personne n’est éliminé', () => {
  const { room, ids, clock } = setup(C(1, 1, 1, 3));
  room.start(ids[0]);
  gather(room, ids, clock);
  const killer = ids.find((i) => room.roleOf(i) === 'tueur')!;
  const others = ids.filter((i) => i !== killer);
  clock.advance(RULES.firstKillDelay + 1);
  room.eliminate(killer, others[0]);
  room.report(others[1], others[0]);
  room.vote(others[1], killer);
  assert.throws(() => room.vote(others[1], others[2]), /déjà voté/);
  for (const v of [others[2], others[3], others[4], killer]) room.vote(v, null);
  assert.equal(room.gameView().phase, 'jeu');
  assert.ok(room.isAlive(killer), '1 voix contre 4 abstentions : personne');
  assert.throws(() => room.report(others[2], others[0]), /Aucun corps/, 'corps déjà signalé');
});
