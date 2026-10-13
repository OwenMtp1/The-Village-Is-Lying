/**
 * Composition des rôles et parties : validation, salon (places, hôte, lancement), distribution exacte et secrète
 * des rôles, capacités individuelles, votes, victoire avec plusieurs tueurs. Logique serveur testée sans réseau.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, compositionErrors, startBlocker, totalOf, type Composition, type Role } from '../src/shared/roles';
import { RULES, assignRoles, winnerOf } from '../src/shared/rules';
import { Room, RoomError, type RoomOutput } from '../src/server/room';
import type { PrivateInfo } from '../src/shared/protocol';

const C = (tueur: number, sherif: number, detective: number, villageois: number): Composition => ({ tueur, sherif, detective, villageois });

test('compositions valides : 4 à 10 joueurs, plusieurs rôles spéciaux', () => {
  for (const c of [C(1, 0, 0, 3), C(1, 1, 1, 3), C(2, 1, 1, 4), C(2, 2, 2, 2), C(3, 2, 2, 3), ...PRESETS.map((p) => p.composition)]) assert.deepEqual(compositionErrors(c), [], JSON.stringify(c));
  assert.deepEqual(PRESETS.map((p) => totalOf(p.composition)), [6, 8, 8, 10]);
});

test('compositions invalides : messages explicites, jamais corrigées', () => {
  const cases: [unknown, RegExp][] = [
    [C(0, 1, 1, 4), /au moins un tueur/],
    [C(1, 0, 0, 2), /au moins 4/],
    [C(2, 2, 2, 5), /10 au maximum/],
    [C(4, 0, 0, 0), /au moins un innocent/],
    [C(3, 0, 0, 3), /plus d’innocents que de tueurs/],
    [{ tueur: 1, sherif: 1, detective: 1 }, /villageois manquant/],
    [{ tueur: 1.5, sherif: 1, detective: 1, villageois: 3 }, /tueurs manquant ou invalide/],
    [{ tueur: -1, sherif: 1, detective: 1, villageois: 3 }, /négatif/],
    [null, /manquante/],
  ];
  for (const [c, re] of cases) {
    const errs = compositionErrors(c);
    assert.ok(errs.some((e) => re.test(e)), `${JSON.stringify(c)} → ${errs.join(' | ')}`);
  }
  assert.equal(startBlocker(C(1, 1, 1, 5), 6), 'Il manque 2 joueurs pour commencer.');
  assert.match(startBlocker(C(1, 1, 1, 3), 7)!, /1 joueur de trop/);
  assert.equal(startBlocker(C(1, 1, 1, 5), 8), null);
});

test('distribution : quantités exactes et joueurs mélangés', () => {
  const ids = Array.from({ length: 8 }, (_, i) => `p${i}`);
  const comp = C(2, 2, 1, 3);
  const firstKiller = new Set<string>();
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let k = 0; k < 300; k++) {
    const roles = assignRoles(ids, comp, rnd);
    const count = (r: Role) => Object.values(roles).filter((x) => x === r).length;
    assert.deepEqual([count('tueur'), count('sherif'), count('detective'), count('villageois')], [2, 2, 1, 3]);
    for (const [id, r] of Object.entries(roles)) if (r === 'tueur') firstKiller.add(id);
  }
  assert.equal(firstKiller.size, 8, 'chaque joueur a été tueur au moins une fois');
  assert.throws(() => assignRoles(ids.slice(0, 6), comp, rnd));
});

test('victoire calculée sur les vivants, plusieurs tueurs', () => {
  assert.equal(winnerOf(['tueur', 'tueur', 'sherif', 'detective', 'villageois']), null);
  assert.equal(winnerOf(['tueur', 'sherif', 'detective', 'villageois']), null);
  assert.equal(winnerOf(['tueur', 'tueur', 'villageois', 'sherif']), 'tueurs');
  assert.equal(winnerOf(['tueur', 'villageois']), 'tueurs');
  assert.equal(winnerOf(['sherif', 'villageois']), 'innocents');
});

// ───────────────────────── salon et partie (serveur, sans réseau) ─────────────────────────

class Recorder implements RoomOutput {
  lobbies: ReturnType<Room['lobbyView']>[] = [];
  games: ReturnType<Room['gameView']>[] = [];
  secrets = new Map<string, PrivateInfo>();
  events: string[] = [];
  lobby(v: ReturnType<Room['lobbyView']>) {
    this.lobbies.push(v);
  }
  game(v: ReturnType<Room['gameView']>) {
    this.games.push(v);
  }
  secret(id: string, info: PrivateInfo) {
    this.secrets.set(id, info);
  }
  event(text: string) {
    this.events.push(text);
  }
}

function setup(comp: Composition, n = totalOf(comp)) {
  const out = new Recorder();
  let t = 1_000_000;
  const clock = { now: () => t, advance: (s: number) => (t += s * 1000) };
  const room = new Room('ABCD', comp, out, clock.now);
  const ids = Array.from({ length: n }, (_, i) => room.join(`J${i}`, i % 2 ? 'F' : 'M').id);
  return { room, out, ids, clock };
}

/** Tout le monde marche jusqu'au même endroit (3 s : vitesse plausible, portées respectées). */
function gather(room: Room, ids: string[], clock?: { advance(s: number): void }) {
  clock?.advance(3);
  for (const id of ids) room.pose(id, { x: 0, y: 0, z: 0, yaw: 0, speed: 0, grounded: true, vy: 0, dir: 1 });
}

test('salon : places = somme des rôles, salon complet, lancement seulement au complet', () => {
  const { room, ids } = setup(C(1, 1, 1, 5), 6);
  const v = room.lobbyView();
  assert.equal(v.seats, 8);
  assert.equal(v.players.length, 6);
  assert.equal(v.blocker, 'Il manque 2 joueurs pour commencer.');
  assert.throws(() => room.start(ids[0]), /Il manque 2 joueurs/);
  room.join('J6', 'M');
  room.join('J7', 'F');
  assert.throws(() => room.join('J8', 'M'), /Salon complet \(8 \/ 8/);
  assert.throws(() => room.start(ids[1]), /Seul l’hôte/);
  room.start(ids[0]);
  assert.throws(() => room.join('J9', 'M'), /déjà commencé/);
  assert.throws(() => room.setComposition(ids[0], C(1, 1, 1, 5)), /verrouillée/);
});

test('salon : composition refusée par le serveur si invalide ou trop petite pour les présents', () => {
  const { room, ids } = setup(C(1, 1, 1, 5), 7);
  assert.throws(() => room.setComposition(ids[0], C(0, 1, 1, 6)), /au moins un tueur/);
  assert.throws(() => room.setComposition(ids[0], C(1, 1, 1, 3)), /7 joueurs sont déjà dans le salon/);
  assert.throws(() => room.setComposition(ids[0], { tueur: 1, sherif: 1, detective: 1 } as unknown as Composition), RoomError);
  room.setComposition(ids[0], C(2, 1, 1, 3));
  assert.equal(room.lobbyView().seats, 7);
  assert.equal(room.lobbyView().blocker, null);
  assert.throws(() => new Room('X', C(1, 0, 0, 2), new Recorder()), /au moins 4/);
});

test('salon : l’hôte part avant le lancement, le plus ancien prend la main', () => {
  const { room, ids } = setup(C(1, 1, 1, 3), 4);
  room.leave(ids[0], true);
  assert.equal(room.hostId, ids[1]);
  assert.equal(room.lobbyView().players.find((p) => p.host)?.id, ids[1]);
  assert.equal(room.lobbyView().blocker, 'Il manque 3 joueurs pour commencer.');
});

for (const comp of [C(1, 0, 0, 3), C(1, 1, 1, 3), C(2, 1, 1, 4), C(2, 2, 2, 2), C(3, 2, 2, 3)])
  test(`partie ${totalOf(comp)} joueurs ${JSON.stringify(comp)} : rôles exacts et secrets`, () => {
    const { room, out, ids } = setup(comp);
    room.start(ids[0]);
    const roles = ids.map((id) => out.secrets.get(id)!.role);
    for (const r of ['tueur', 'sherif', 'detective', 'villageois'] as Role[]) assert.equal(roles.filter((x) => x === r).length, comp[r]);
    // aucune vue publique ne contient de rôle avant la fin
    const pub = JSON.stringify([...out.games, ...out.lobbies]);
    assert.ok(!/tueur|sherif|detective|villageois"/.test(pub.replace(/"composition":\{[^}]*\}/g, '')), 'rôle dans une vue publique');
    // les tueurs connaissent les autres tueurs, et seulement eux
    for (const id of ids) {
      const s = out.secrets.get(id)!;
      if (s.role === 'tueur') assert.deepEqual(new Set(s.allies), new Set(ids.filter((o) => o !== id && room.roleOf(o) === 'tueur')));
      else assert.deepEqual(s.allies, []);
    }
    // apparences du bon sexe, sans doublon
    const app = room.gameView().appearances;
    assert.equal(new Set(Object.values(app)).size, ids.length);
  });

test('tueurs : délais individuels, pas de double élimination, pas entre tueurs', () => {
  const { room, out, ids, clock } = setup(C(2, 1, 1, 4));
  room.start(ids[0]);
  gather(room, ids, clock);
  const killers = ids.filter((i) => room.roleOf(i) === 'tueur');
  const victims = ids.filter((i) => room.roleOf(i) !== 'tueur');
  assert.throws(() => room.eliminate(killers[0], victims[0]), /Patience/);
  clock.advance(RULES.firstKillDelay + 1);
  assert.throws(() => room.eliminate(killers[0], killers[1]), /autre tueur/);
  assert.throws(() => room.eliminate(victims[0], victims[1]), /Seuls les tueurs/);
  room.eliminate(killers[0], victims[0]);
  assert.throws(() => room.eliminate(killers[1], victims[0]), /Cible invalide/, 'pas de double élimination');
  assert.throws(() => room.eliminate(killers[0], victims[1]), /Patience/, 'délai du premier tueur');
  room.eliminate(killers[1], victims[1]); // le second tueur a son propre délai
  assert.ok(!room.isAlive(victims[0]) && !room.isAlive(victims[1]));
  assert.equal(out.secrets.get(killers[0])!.killReadyAt > clock.now(), true);
  // portée
  room.pose(victims[2], { x: 0, y: 0, z: 0.3, yaw: 0, speed: 0, grounded: true, vy: 0, dir: 1 });
  clock.advance(RULES.killCooldown + 1);
  room.pose(killers[0], { x: 3, y: 0, z: 0, yaw: 0, speed: 0, grounded: true, vy: 0, dir: 1 });
  room.pose(victims[3], { x: 8, y: 0, z: 0, yaw: 0, speed: 0, grounded: true, vy: 0, dir: 1 });
  assert.throws(() => room.eliminate(killers[0], victims[3]), /Trop loin/);
});

test('8 joueurs, 2 tueurs : un tueur abattu ne suffit pas, le second fait perdre ou gagner', () => {
  const { room, out, ids, clock } = setup(C(2, 2, 1, 3));
  room.start(ids[0]);
  gather(room, ids, clock);
  const killers = ids.filter((i) => room.roleOf(i) === 'tueur');
  const sheriffs = ids.filter((i) => room.roleOf(i) === 'sherif');
  room.shoot(sheriffs[0], killers[0]);
  assert.equal(room.gameView().result, null, 'la partie continue tant qu’un tueur vit');
  assert.throws(() => room.shoot(sheriffs[0], killers[1]), /plus de balle/, 'balle individuelle épuisée');
  room.shoot(sheriffs[1], killers[1]); // le second shérif a toujours sa balle
  const v = room.gameView();
  assert.equal(v.result?.winner, 'innocents');
  assert.equal(Object.keys(v.result!.roles).length, 8, 'tous les rôles révélés à la fin');
  assert.ok(out.events.some((e) => /innocents ont gagné/.test(e)));
  void clock;
});

test('shérif qui abat un innocent : il meurt aussi ; victoire des tueurs quand ils égalent les innocents', () => {
  const { room, ids, clock } = setup(C(1, 1, 0, 2));
  room.start(ids[0]);
  gather(room, ids, clock);
  const sheriff = ids.find((i) => room.roleOf(i) === 'sherif')!;
  const villager = ids.find((i) => room.roleOf(i) === 'villageois')!;
  room.shoot(sheriff, villager);
  assert.ok(!room.isAlive(sheriff) && !room.isAlive(villager));
  // reste 1 tueur, 1 villageois : les tueurs gagnent
  assert.equal(room.gameView().result?.winner, 'tueurs');
});

test('détectives : une enquête chacun, résultat privé et exact', () => {
  const { room, out, ids, clock } = setup(C(2, 2, 2, 2));
  room.start(ids[0]);
  gather(room, ids, clock);
  const dets = ids.filter((i) => room.roleOf(i) === 'detective');
  const killer = ids.find((i) => room.roleOf(i) === 'tueur')!;
  const villager = ids.find((i) => room.roleOf(i) === 'villageois')!;
  assert.equal(room.investigate(dets[0], killer), true);
  assert.throws(() => room.investigate(dets[0], villager), /déjà mené/);
  assert.equal(room.investigate(dets[1], villager), false, 'l’enquête du premier n’empêche pas le second');
  assert.equal(out.secrets.get(dets[0])!.findings[killer], true);
  assert.deepEqual(out.secrets.get(dets[1])!.findings, { [villager]: false });
  assert.ok(!JSON.stringify(out.games).includes('findings'));
});

test('réunions et votes : seuls les vivants votent, majorité, égalité sans élimination, victoire recalculée', () => {
  const { room, ids, clock } = setup(C(1, 1, 1, 3));
  room.start(ids[0]);
  gather(room, ids, clock);
  const killer = ids.find((i) => room.roleOf(i) === 'tueur')!;
  const innocents = ids.filter((i) => i !== killer);
  clock.advance(RULES.firstKillDelay + 1);
  room.eliminate(killer, innocents[0]);
  const body = room.gameView().bodies[0];
  assert.equal(body.id, innocents[0]);
  room.report(innocents[1], innocents[0]);
  assert.equal(room.gameView().phase, 'reunion');
  assert.throws(() => room.vote(innocents[0], killer), /éliminé/, 'un mort ne vote pas');
  assert.throws(() => room.eliminate(killer, innocents[1]), /réunion/);
  // égalité : personne n'est éliminé
  room.vote(innocents[1], killer);
  room.vote(innocents[2], innocents[3]);
  room.vote(innocents[3], null);
  room.vote(innocents[4], null);
  assert.equal(room.gameView().phase, 'reunion', 'on attend le dernier vivant');
  room.vote(killer, innocents[1]);
  assert.equal(room.gameView().phase, 'jeu');
  assert.ok(room.isAlive(killer));
  // réunion d'urgence : majorité contre le tueur → innocents gagnants
  room.emergency(innocents[2]);
  assert.throws(() => room.emergency(innocents[2]), /réunion est en cours|déjà convoqué/);
  for (const v of [innocents[1], innocents[2], innocents[3], innocents[4]]) room.vote(v, killer);
  room.vote(killer, innocents[1]);
  assert.equal(room.gameView().result?.winner, 'innocents');
});

test('vote clos à l’échéance même si quelqu’un ne vote pas ; positions impossibles ignorées', () => {
  const { room, ids, clock } = setup(C(1, 1, 1, 3));
  room.start(ids[0]);
  gather(room, ids, clock);
  room.emergency(ids[1]);
  room.vote(ids[1], null);
  clock.advance(RULES.meetingSeconds + 1);
  room.tick();
  assert.equal(room.gameView().phase, 'jeu');
  room.pose(ids[2], { x: 0, y: 0, z: 0, yaw: 0, speed: 0, grounded: true, vy: 0, dir: 1 });
  clock.advance(0.1);
  room.pose(ids[2], { x: 50, y: 0, z: 0, yaw: 0, speed: 0, grounded: true, vy: 0, dir: 1 });
  assert.equal(room.posesView()[ids[2]].x, 0, 'téléportation refusée');
});

test('reconnexion pendant la partie avec le jeton : même joueur, même secret', () => {
  const { room, out, ids } = setup(C(1, 1, 1, 3));
  const token = [...room.players.values()][2].token;
  room.start(ids[0]);
  const role = out.secrets.get(ids[2])!.role;
  room.leave(ids[2], false);
  assert.throws(() => room.join('Intrus', 'M'), /déjà commencé/);
  const back = room.join('peu importe', 'M', token);
  assert.equal(back.id, ids[2]);
  assert.equal(out.secrets.get(ids[2])!.role, role);
});
