/** Mode Gunfight : salon, équipes, tirs revérifiés, dégâts, réapparition, score, fin à l'heure, retour au salon. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { GunfightRoom, type GFOutput } from '../src/shared/gunfightRoom';
import { GF_RULES, WEAPONS, cleanSettings, normalize, rayHitBody, type GFGun, type GFShot } from '../src/shared/gunfight';
import type { PlayerPose } from '../src/shared/protocol';

class Out implements GFOutput {
  lobbies = 0;
  games = 0;
  shots: GFShot[] = [];
  events: string[] = [];
  lobby() {
    this.lobbies++;
  }
  game() {
    this.games++;
  }
  shot(s: GFShot) {
    this.shots.push(s);
  }
  event(e: { text: string }) {
    this.events.push(e.text);
  }
}

function setup(settings: Parameters<typeof cleanSettings>[0], n = 2, sight?: (a: unknown, b: unknown) => boolean) {
  let t = 1_000_000;
  const clock = { now: () => t, advance: (s: number) => (t += s * 1000) };
  const out = new Out();
  const room = new GunfightRoom('GF01', settings, out, clock.now, Math.random, sight as never);
  const ids = Array.from({ length: n }, (_, i) => room.join(`J${i}`, 'M').id);
  return { room, out, ids, clock };
}
const pose = (x: number, z: number, yaw = 0, item: PlayerPose['item'] = 'pistolet'): PlayerPose => ({ x, y: 0, z, yaw, speed: 0, grounded: true, vy: 0, dir: 1, torch: false, pitch: 0, item });
/** a regarde b, à `d` mètres */
function face(room: GunfightRoom, clock: { advance(s: number): void }, a: string, b: string, d = 6, item: PlayerPose['item'] = 'pistolet') {
  // les points d'apparition peuvent être loin : on laisse le temps de marcher (contrôle de vitesse du serveur)
  clock.advance(30);
  room.pose(a, pose(0, 0, 0, item));
  room.pose(b, pose(0, d, 0));
}
/** tir de `a` (œil en 0, 1.5, 0) vers la poitrine ou la tête de `b` ; `side` décale le point visé */
function fire(room: GunfightRoom, a: string, b: string | null, weapon: GFGun = 'pistolet', zone: 'corps' | 'tete' = 'corps', side = 0, pellets = 1) {
  const q = b ? room.gameView() && (room as unknown as { poses: Map<string, PlayerPose> }).poses.get(b)! : { x: 0, y: 0, z: 10 };
  const h = b ? room.bodyHeight(b) : 1.75;
  const y = q.y + (zone === 'tete' ? h - 0.13 : 1.1);
  const d = normalize([q.x + side, y - 1.5, q.z])!;
  return room.shoot(a, weapon, [0, 1.5, 0], Array.from({ length: pellets }, () => d));
}

test('réglages bornés ; au moins 2 joueurs ; on ne rejoint pas une partie commencée', () => {
  assert.deepEqual(cleanSettings({ maxPlayers: 99, scoreLimit: 1, minutes: 0, mode: 'x' as never }), { mode: 'ffa', maxPlayers: 16, scoreLimit: 5, minutes: 2 });
  const { room, ids } = setup({ maxPlayers: 4 }, 1);
  assert.throws(() => room.start(ids[0]), /au moins 2/);
  room.join('B', 'F');
  room.start(ids[0]);
  assert.throws(() => room.join('C', 'M'), /déjà commencé/);
});

test('chacun pour soi : trois balles au corps pour éliminer, cadence, chargeur, rechargement, réapparition', () => {
  const { room, out, ids, clock } = setup({ mode: 'ffa', scoreLimit: 5 });
  room.start(ids[0]);
  const [a, b] = ids;
  face(room, clock, a, b);
  clock.advance(GF_RULES.spawnShield);
  assert.deepEqual(fire(room, a, b), { hit: true, killed: false, head: false });
  assert.equal(room.stateOf(b)!.hp, GF_RULES.health - WEAPONS.pistolet.damage);
  assert.throws(() => fire(room, a, b), /Trop rapide/);
  clock.advance(0.4);
  fire(room, a, b);
  clock.advance(0.4);
  assert.deepEqual(fire(room, a, b), { hit: true, killed: true, head: false });
  assert.equal(room.stateOf(b)!.alive, false);
  assert.equal(room.stateOf(a)!.kills, 1);
  assert.equal(room.stateOf(a)!.ammo.pistolet, WEAPONS.pistolet.magazine - 3);
  assert.equal(room.stateOf(a)!.ammo.fusil, WEAPONS.fusil.magazine, 'chaque arme a son chargeur');
  assert.equal(out.shots.length, 3);
  assert.throws(() => fire(room, b, a), /à terre/);
  // réapparition
  clock.advance(GF_RULES.respawnSeconds + 0.1);
  room.tick();
  assert.equal(room.stateOf(b)!.alive, true);
  assert.equal(room.stateOf(b)!.hp, GF_RULES.health);
  assert.equal(room.stateOf(b)!.spawn.n, 2);
  // chargeur vidé puis rechargé
  for (let i = 0; i < WEAPONS.pistolet.magazine - 3; i++) {
    clock.advance(0.4);
    fire(room, a, null);
  }
  assert.throws(() => fire(room, a, null), /Chargeur vide/);
  room.reload(a);
  assert.throws(() => fire(room, a, null), /Rechargement/);
  clock.advance(WEAPONS.pistolet.reload + 0.1);
  room.tick();
  assert.equal(room.stateOf(a)!.ammo.pistolet, WEAPONS.pistolet.magazine);
});

test('tir à la tête : dégâts multipliés, signalé, compté ; le fusil de précision tue net', () => {
  const { room, out, ids, clock } = setup({ mode: 'ffa' });
  room.start(ids[0]);
  const [a, b] = ids;
  face(room, clock, a, b, 12);
  clock.advance(GF_RULES.spawnShield);
  const r = fire(room, a, b, 'pistolet', 'tete');
  assert.deepEqual(r, { hit: true, killed: false, head: true });
  assert.equal(room.stateOf(b)!.hp, GF_RULES.health - Math.round(WEAPONS.pistolet.damage * WEAPONS.pistolet.head));
  assert.equal(out.shots.at(-1)!.head, true);
  // fusil de précision : il faut l'avoir en main
  assert.throws(() => fire(room, a, b, 'precision', 'tete'), /Sortez/);
  clock.advance(1);
  room.pose(a, pose(0, 0, 0, 'precision'));
  room.pose(b, pose(0, 12, 0));
  clock.advance(1);
  room.pose(b, pose(0, 12, 0));
  assert.deepEqual(fire(room, a, b, 'precision', 'tete'), { hit: true, killed: true, head: true });
  const k = room.gameView().feed.at(-1)!;
  assert.equal(k.weapon, 'precision');
  assert.equal(k.head, true);
  assert.equal(room.stateOf(a)!.headshots, 1);
});

test('fusil à pompe : plusieurs plombs, dégâts cumulés ; pas plus de plombs que l’arme n’en tire', () => {
  const { room, out, ids, clock } = setup({ mode: 'ffa' });
  room.start(ids[0]);
  const [a, b] = ids;
  face(room, clock, a, b, 4, 'pompe');
  clock.advance(GF_RULES.spawnShield);
  const r = fire(room, a, b, 'pompe', 'corps', 0, 30);
  assert.equal(r.killed, true, `${WEAPONS.pompe.pellets} plombs × ${WEAPONS.pompe.damage} au contact`);
  assert.equal(out.shots.at(-1)!.to.length, WEAPONS.pompe.pellets);
  assert.equal(room.stateOf(a)!.ammo.pompe, WEAPONS.pompe.magazine - 1);
});

test('tir refusé : à côté, dos tourné, hors de portée, derrière un mur, visée trafiquée', () => {
  let wall = false;
  const { room, ids, clock } = setup({ mode: 'ffa' }, 2, () => !wall);
  room.start(ids[0]);
  const [a, b] = ids;
  face(room, clock, a, b);
  clock.advance(GF_RULES.spawnShield);
  assert.equal(fire(room, a, b, 'pistolet', 'corps', 0.8).hit, false, 'à côté');
  clock.advance(1);
  room.pose(a, pose(0, 0, Math.PI));
  assert.equal(fire(room, a, b).hit, false, 'dos tourné');
  clock.advance(1);
  room.pose(a, pose(0, 0, 0));
  assert.throws(() => room.shoot(a, 'pistolet', [0, 1.5, -20], [[0, 0, 1]]), /Visée invalide/);
  assert.throws(() => room.shoot(a, 'pistolet', [0, 1.5, 0], [[0, 0, 0]]), /Visée invalide/);
  clock.advance(1);
  room.pose(b, pose(0, 30, 0));
  clock.advance(10);
  room.pose(b, pose(0, WEAPONS.pistolet.range + 5, 0));
  clock.advance(1);
  room.pose(b, pose(0, WEAPONS.pistolet.range + 5, 0));
  assert.equal(fire(room, a, b).hit, false, 'trop loin');
  clock.advance(15);
  room.pose(b, pose(0, 6, 0));
  clock.advance(1);
  room.pose(b, pose(0, 6, 0));
  wall = true;
  assert.equal(fire(room, a, b).hit, false, 'mur');
  wall = false;
  clock.advance(1);
  assert.equal(fire(room, a, b).hit, true, 'dégagé');
});

test('latence compensée : une cible qui vient de bouger est touchée là où le tireur la voyait (pas au-delà)', () => {
  const { room, ids, clock } = setup({ mode: 'ffa' });
  room.start(ids[0]);
  const [a, b] = ids;
  face(room, clock, a, b, 10);
  clock.advance(GF_RULES.spawnShield);
  room.pose(b, pose(0, 10, 0));
  clock.advance(0.1);
  room.pose(b, pose(0.9, 10, 0)); // 0,9 m de côté en 100 ms
  const d = normalize([0, 1.1 - 1.5, 10])!;
  assert.equal(room.shoot(a, 'pistolet', [0, 1.5, 0], [d]).hit, true, 'vu il y a 100 ms');
  clock.advance(1);
  room.pose(b, pose(0.9, 10, 0));
  clock.advance(1);
  room.pose(b, pose(0.9, 10, 0));
  assert.equal(room.shoot(a, 'pistolet', [0, 1.5, 0], [d]).hit, false, 'position d’il y a 2 s');
});

test('zones de touche : tête au-dessus des épaules, corps dessous, rien à côté', () => {
  const p = { x: 0, y: 0, z: 5 };
  const at = (y: number, x = 0) => rayHitBody([x, y, 0], [0, 0, 1], p, 1.75);
  assert.equal(at(1.66)?.head, true);
  assert.equal(at(1.2)?.head, false);
  assert.equal(at(0.5)?.head, false);
  assert.equal(at(1.95), null);
  assert.equal(at(1.2, 0.5), null);
  assert.ok(Math.abs(at(1.2)!.t - (5 - 0.29)) < 1e-6);
});

test('couteau : en main seulement, gros dégâts au contact, inutile à distance', () => {
  const { room, ids, clock } = setup({ mode: 'ffa' });
  room.start(ids[0]);
  const [a, b] = ids;
  face(room, clock, a, b, 1.5);
  clock.advance(2);
  assert.throws(() => room.stab(a, b), /couteau/);
  room.pose(a, pose(0, 0, 0, 'couteau'));
  assert.deepEqual(room.stab(a, b), { hit: true, killed: false, head: false });
  assert.equal(room.stateOf(b)!.hp, GF_RULES.health - GF_RULES.knifeDamage);
  clock.advance(1);
  room.pose(b, pose(0, 6, 0));
  clock.advance(1);
  assert.equal(room.stab(a, b).hit, false);
});

test('équipes : choix d’équipe, pas de tir allié, score d’équipe, victoire au score visé', () => {
  const { room, out, ids, clock } = setup({ mode: 'equipes', scoreLimit: 5 }, 4);
  const [a, b, c, d] = ids;
  room.setTeam(a, 'rouge');
  room.setTeam(b, 'rouge');
  room.setTeam(c, 'bleu');
  room.setTeam(d, 'bleu');
  room.start(a);
  face(room, clock, a, b);
  clock.advance(2);
  assert.equal(fire(room, a, b).hit, false, 'allié');
  // la Rouge élimine 5 fois la Bleue
  for (let k = 0; k < 5; k++) {
    clock.advance(GF_RULES.respawnSeconds + 0.1);
    room.tick();
    clock.advance(30);
    room.pose(a, pose(0, 0, 0));
    room.pose(c, pose(0, 5, 0));
    clock.advance(2);
    for (let i = 0; i < 3; i++) {
      clock.advance(0.4);
      if (room.stateOf(a)!.ammo.pistolet === 0) {
        room.reload(a);
        clock.advance(WEAPONS.pistolet.reload + 0.1);
      }
      fire(room, a, c);
    }
  }
  const g = room.gameView();
  assert.equal(g.teamScores.rouge, 5);
  assert.equal(g.result?.winner, 'rouge');
  assert.ok(out.events.some((e) => /Rouge atteint 5/.test(e)));
  // retour au salon, nouvelle partie sans reste
  room.backToLobby(b);
  assert.equal(room.lobbyView().phase, 'salon');
  room.start(a);
  assert.deepEqual(room.gameView().teamScores, { rouge: 0, bleu: 0 });
  void d;
});

test('fin à l’heure : le meilleur score gagne, égalité possible', () => {
  const { room, ids, clock } = setup({ mode: 'ffa', minutes: 2 }, 3);
  room.start(ids[0]);
  clock.advance(121);
  room.tick();
  const r = room.gameView().result!;
  assert.equal(r.winner, null);
  assert.match(r.reason, /égalité/);
});
