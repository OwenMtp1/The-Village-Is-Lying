/** Mode Gunfight : salon, équipes, tirs revérifiés, dégâts, réapparition, score, fin à l'heure, retour au salon. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { GunfightRoom, type GFOutput } from '../src/shared/gunfightRoom';
import { GF_RULES, cleanSettings, type GFShot } from '../src/shared/gunfight';
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
function face(room: GunfightRoom, clock: { advance(s: number): void }, a: string, b: string, d = 6) {
  // les points d'apparition peuvent être loin : on laisse le temps de marcher (contrôle de vitesse du serveur)
  clock.advance(30);
  room.pose(a, pose(0, 0, 0));
  room.pose(b, pose(0, d, 0));
}

test('réglages bornés ; au moins 2 joueurs ; on ne rejoint pas une partie commencée', () => {
  assert.deepEqual(cleanSettings({ maxPlayers: 99, scoreLimit: 1, minutes: 0, mode: 'x' as never }), { mode: 'ffa', maxPlayers: 16, scoreLimit: 5, minutes: 2 });
  const { room, ids } = setup({ maxPlayers: 4 }, 1);
  assert.throws(() => room.start(ids[0]), /au moins 2/);
  room.join('B', 'F');
  room.start(ids[0]);
  assert.throws(() => room.join('C', 'M'), /déjà commencé/);
});

test('chacun pour soi : trois balles pour éliminer, cadence, chargeur, rechargement, réapparition', () => {
  const { room, out, ids, clock } = setup({ mode: 'ffa', scoreLimit: 5 });
  room.start(ids[0]);
  const [a, b] = ids;
  face(room, clock, a, b);
  clock.advance(GF_RULES.spawnShield);
  assert.deepEqual(room.shoot(a, b), { hit: true, killed: false });
  assert.throws(() => room.shoot(a, b), /Trop rapide/);
  clock.advance(0.4);
  room.shoot(a, b);
  clock.advance(0.4);
  assert.deepEqual(room.shoot(a, b), { hit: true, killed: true });
  assert.equal(room.stateOf(b)!.alive, false);
  assert.equal(room.stateOf(a)!.kills, 1);
  assert.equal(room.stateOf(a)!.ammo, GF_RULES.magazine - 3);
  assert.equal(out.shots.length, 3);
  assert.throws(() => room.shoot(b, a), /à terre/);
  // réapparition
  clock.advance(GF_RULES.respawnSeconds + 0.1);
  room.tick();
  assert.equal(room.stateOf(b)!.alive, true);
  assert.equal(room.stateOf(b)!.hp, GF_RULES.health);
  assert.equal(room.stateOf(b)!.spawn.n, 2);
  // chargeur vidé puis rechargé
  for (let i = 0; i < 5; i++) {
    clock.advance(0.4);
    room.shoot(a, null);
  }
  assert.throws(() => room.shoot(a, null), /Chargeur vide/);
  room.reload(a);
  assert.throws(() => room.shoot(a, null), /Rechargement/);
  clock.advance(GF_RULES.reloadSeconds + 0.1);
  room.tick();
  assert.equal(room.stateOf(a)!.ammo, GF_RULES.magazine);
});

test('tir refusé hors de l’axe, hors de portée, derrière un mur, ou pendant la protection d’apparition', () => {
  let wall = false;
  const { room, ids, clock } = setup({ mode: 'ffa' }, 2, () => !wall);
  room.start(ids[0]);
  const [a, b] = ids;
  face(room, clock, a, b);
  room.pose(a, pose(0, 0, Math.PI));
  assert.equal(room.shoot(a, b).hit, false, 'dos tourné');
  clock.advance(1);
  room.pose(a, pose(0, 0, 0));
  room.pose(b, pose(0, 60, 0));
  clock.advance(10);
  room.pose(b, pose(0, 60, 0));
  assert.equal(room.shoot(a, b).hit, false, 'trop loin');
  clock.advance(5);
  room.pose(b, pose(0, 6, 0));
  wall = true;
  clock.advance(1);
  assert.equal(room.shoot(a, b).hit, false, 'mur');
});

test('couteau : gros dégâts au contact, inutile à distance', () => {
  const { room, ids, clock } = setup({ mode: 'ffa' });
  room.start(ids[0]);
  const [a, b] = ids;
  face(room, clock, a, b, 1.5);
  clock.advance(2);
  assert.deepEqual(room.stab(a, b), { hit: true, killed: false });
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
  assert.equal(room.shoot(a, b).hit, false, 'allié');
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
      if (room.stateOf(a)!.ammo === 0) {
        room.reload(a);
        clock.advance(GF_RULES.reloadSeconds + 0.1);
      }
      room.shoot(a, c);
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
