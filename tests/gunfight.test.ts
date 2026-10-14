/** Mode Gunfight : salon, équipes, tirs revérifiés, dégâts, réapparition, score, fin à l'heure, retour au salon. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { GunfightRoom, grenadePath, type GFOutput } from '../src/shared/gunfightRoom';
import { GF_RULES, GRENADES, PROGRESSION, WEAPONS, allowedWeapons, cleanSettings, damageAt, progressionStep, normalize, rayHitBody, type GFGun, type GFShot } from '../src/shared/gunfight';
import type { PlayerPose } from '../src/shared/protocol';
import { GF_MAPS, insideMap, mapOf } from '../src/shared/gunfightMaps';

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
  const c = cleanSettings({ maxPlayers: 99, scoreLimit: 1, minutes: 0, mode: 'x' as never });
  assert.deepEqual([c.mode, c.arsenal, c.night, c.grenades, c.map, c.maxPlayers, c.scoreLimit, c.minutes, c.weapons.length], ['ffa', 'libre', false, true, 'village', 16, 5, 2, 11]);
  const { room, ids } = setup({ maxPlayers: 4 }, 1);
  assert.throws(() => room.start(ids[0]), /au moins 2/);
  room.join('B', 'F');
  room.start(ids[0]);
  assert.throws(() => room.join('C', 'M'), /déjà commencé/);
});

test('chacun pour soi : quatre balles au corps pour éliminer, cadence, chargeur, rechargement, réapparition', () => {
  const { room, out, ids, clock } = setup({ mode: 'ffa', scoreLimit: 5 });
  room.start(ids[0]);
  const [a, b] = ids;
  face(room, clock, a, b);
  clock.advance(GF_RULES.spawnShield);
  assert.deepEqual(fire(room, a, b), { hit: true, killed: false, head: false });
  assert.equal(room.stateOf(b)!.hp, GF_RULES.health - WEAPONS.pistolet.damage);
  assert.throws(() => fire(room, a, b), /Trop rapide/);
  for (let i = 0; i < 2; i++) {
    clock.advance(0.4);
    fire(room, a, b);
  }
  clock.advance(0.4);
  assert.deepEqual(fire(room, a, b), { hit: true, killed: true, head: false });
  assert.equal(room.stateOf(b)!.alive, false);
  assert.equal(room.stateOf(a)!.kills, 1);
  assert.equal(room.stateOf(a)!.ammo.pistolet, WEAPONS.pistolet.magazine - 4);
  assert.equal(room.stateOf(a)!.ammo.fusil, WEAPONS.fusil.magazine, 'chaque arme a son chargeur');
  assert.equal(out.shots.length, 4);
  assert.throws(() => fire(room, b, a), /à terre/);
  // réapparition
  clock.advance(GF_RULES.respawnSeconds + 0.1);
  room.tick();
  assert.equal(room.stateOf(b)!.alive, true);
  assert.equal(room.stateOf(b)!.hp, GF_RULES.health);
  assert.equal(room.stateOf(b)!.spawn.n, 2);
  // chargeur vidé puis rechargé
  for (let i = 0; i < WEAPONS.pistolet.magazine - 4; i++) {
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
  room.setLoadout(a, { primary: 'precision', secondary: 'pistolet' });
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
  room.setLoadout(a, { primary: 'pompe' });
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
    for (let i = 0; i < 4; i++) {
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

test('dégâts selon la distance : pleins de près, réduits au loin ; le fusil à pompe ne vaut rien à 20 m', () => {
  const P = WEAPONS.pompe;
  assert.ok(damageAt(P, 3, false) * P.pellets >= GF_RULES.health, 'une cartouche à bout portant');
  assert.ok(damageAt(P, 20, false) * P.pellets < 45);
  assert.equal(damageAt(WEAPONS.pistolet, 10, false), WEAPONS.pistolet.damage);
  assert.ok(damageAt(WEAPONS.pistolet, 50, false) < WEAPONS.pistolet.damage * 0.7);
  assert.ok(damageAt(WEAPONS.precision, 200, true) >= GF_RULES.health, 'tête au fusil de précision : mort à toute distance');
  assert.ok(damageAt(WEAPONS.precision, 300, false) >= GF_RULES.health, 'au corps aussi, même de très loin');
  assert.ok(WEAPONS.precision.range >= 400);
});

test('cartes : points d’apparition dans la carte, réapparition sur la carte choisie, positions hors carte refusées', () => {
  for (const m of GF_MAPS) {
    assert.ok(m.spawns.length >= 8, `${m.id} : ${m.spawns.length} points d'apparition`);
    for (const p of m.spawns) assert.ok(insideMap(m, p.x, p.y ?? 0, p.z), `${m.id} : (${p.x}, ${p.z}) hors carte`);
  }
  for (const map of ['place', 'souterrains'] as const) {
    const { room, ids, clock } = setup({ mode: 'ffa', map });
    room.start(ids[0]);
    const s = room.stateOf(ids[0])!.spawn;
    assert.ok(insideMap(mapOf(map), s.x, s.y ?? 0, s.z), `${map} : apparition (${s.x}, ${s.z})`);
    if (map === 'souterrains') assert.ok((s.y ?? 0) < -5, 'sous terre');
    // un pas hors de la carte : refusé (la position reste la dernière valable)
    const before = room.posesView()[ids[0]];
    clock.advance(30);
    room.pose(ids[0], pose(200, 200));
    assert.deepEqual([room.posesView()[ids[0]].x, room.posesView()[ids[0]].z], [before.x, before.z]);
  }
});

test('invincibilité de 2 s à l’apparition', () => {
  const { room, ids, clock } = setup({ mode: 'ffa' });
  room.start(ids[0]);
  const s = room.stateOf(ids[1])!;
  assert.equal(s.shieldUntil - room.gameView().serverNow, 2000);
  void clock;
});

test('armes au choix : seules les armes cochées se sortent et tirent', () => {
  const s = cleanSettings({ weapons: ['fusil', 'couteau'] });
  assert.deepEqual(allowedWeapons(s, 0), ['fusil', 'couteau']);
  assert.deepEqual(cleanSettings({ weapons: [] }).weapons.length, 11, 'jamais aucune arme');
  const { room, ids, clock } = setup({ mode: 'ffa', weapons: ['fusil'] });
  room.start(ids[0]);
  const [a, b] = ids;
  face(room, clock, a, b, 6, 'pistolet');
  assert.equal(room.posesView()[a].item, 'fusil', 'pistolet interdit : on garde l’arme permise');
  clock.advance(GF_RULES.spawnShield);
  assert.throws(() => fire(room, a, b, 'pistolet'), /non autorisée/);
  assert.equal(fire(room, a, b, 'fusil').hit, true);
  room.pose(a, pose(0, 0, 0, 'couteau'));
  assert.throws(() => room.stab(a, b), /non autorisée/);
});

test('progression : couteau au départ, arme suivante à chaque palier, jusqu’au fusil de précision', () => {
  const s = cleanSettings({ arsenal: 'progression', scoreLimit: 10 });
  const step = progressionStep(s);
  assert.deepEqual(allowedWeapons(s, 0), ['couteau']);
  assert.deepEqual(allowedWeapons(s, step), ['pistolet', 'couteau']);
  assert.deepEqual(allowedWeapons(s, 99)[0], 'precision');
  assert.equal(PROGRESSION[0], 'couteau');
  // en partie : le premier palier franchi sort le pistolet et prévient le joueur
  const { room, out, ids, clock } = setup({ mode: 'ffa', arsenal: 'progression', scoreLimit: 10 });
  room.start(ids[0]);
  const [a, b] = ids;
  assert.equal(room.posesView()[a].item, 'couteau');
  for (let k = 0; k < step; k++) {
    clock.advance(GF_RULES.respawnSeconds + 0.1);
    room.tick();
    clock.advance(30);
    room.pose(a, pose(0, 0, 0, 'couteau'));
    room.pose(b, pose(0, 1.5, 0));
    clock.advance(GF_RULES.spawnShield);
    while (room.stateOf(b)!.alive) {
      clock.advance(1);
      room.stab(a, b);
    }
  }
  assert.equal(room.stateOf(a)!.kills, step);
  assert.equal(room.posesView()[a].item, 'pistolet');
  assert.ok(out.events.some((e) => /Nouvelle arme : Pistolet/.test(e)));
});

test('nuit : lampe et laser transmis aux autres seulement dans une partie de nuit', () => {
  for (const night of [false, true]) {
    const { room, ids, clock } = setup({ mode: 'ffa', night });
    room.start(ids[0]);
    clock.advance(30);
    room.pose(ids[0], { ...pose(0, 0), torch: true, laser: true });
    const v = room.posesView()[ids[0]];
    assert.equal(v.torch, night);
    assert.equal(v.laser, night);
  }
});

test('équipement : arme principale et secondaire au choix, tout de suite à l’apparition, sinon à la suivante', () => {
  const { room, ids, clock } = setup({ mode: 'ffa' });
  room.start(ids[0]);
  const [a] = ids;
  assert.deepEqual(room.allowed(a), ['fusil', 'pistolet', 'couteau'], 'par défaut : carabine et pistolet');
  room.setLoadout(a, { primary: 'mitrailleuse', secondary: 'revolver' });
  assert.deepEqual(room.allowed(a), ['mitrailleuse', 'revolver', 'couteau'], 'pendant la protection : immédiat');
  room.setLoadout(a, { primary: 'pistolet' as never });
  assert.equal(room.allowed(a)[0], 'fusil', 'une arme secondaire ne va pas en principale');
  clock.advance(GF_RULES.spawnShield + 1);
  room.setLoadout(a, { primary: 'tactique', secondary: 'pm' });
  assert.equal(room.allowed(a)[0], 'fusil', 'en cours de vie : à la prochaine apparition');
  assert.equal(room.gameView().players[a].loadout.primary, 'tactique', 'le choix est affiché');
});

test('grenades : trajectoire avec rebonds, éclats à couvert ou non, aveuglement selon le regard, fumée', () => {
  // le sol arrête la chute, un mur à x = 5 renvoie la grenade
  const solid = (x: number, y: number) => y < 0 || x > 5;
  const path = grenadePath([0, 1.5, 0], [10, 3, 0], 2, solid);
  const end = path[path.length - 1];
  assert.ok(end[0] < 5 && end[1] >= 0 && end[1] < 0.5, `au sol devant le mur : ${end.map((v) => v.toFixed(2))}`);
  // en partie : grenade aux pieds de b (5 m), a regarde ailleurs
  let wall = false;
  const { room, ids, clock } = setup({ mode: 'ffa' }, 3, () => !wall);
  room.start(ids[0]);
  const [a, b, c] = ids;
  clock.advance(30);
  room.pose(a, pose(0, 0, Math.PI));
  room.pose(b, pose(0, 5, Math.PI)); // b regarde vers a (et vers la grenade)
  room.pose(c, pose(40, 40, 0));
  clock.advance(GF_RULES.spawnShield);
  const g = room.throwGrenade(a, 'frag', [0, 1.5, 0], [0, 1, 2.2]);
  assert.equal(room.stateOf(a)!.grenades.frag, GRENADES.frag.count - 1);
  clock.advance(GRENADES.frag.fuse + 0.1);
  room.tick();
  const at = g.path[g.path.length - 1];
  assert.ok(room.stateOf(b)!.hp < GF_RULES.health, `b touché (grenade à ${at.map((v) => v.toFixed(1))}, vie ${room.stateOf(b)!.hp})`);
  assert.equal(room.stateOf(c)!.hp, GF_RULES.health, 'loin : intact');
  assert.throws(() => room.throwGrenade(a, 'frag', [0, 1.5, 0], [0, 0, 1]) && room.throwGrenade(a, 'frag', [0, 1.5, 0], [0, 0, 1]), /Plus de/);
  // aveuglante : b la regarde, a lui tourne le dos
  room.throwGrenade(a, 'flash', [0, 1.5, 0], [0, 1, 2]);
  clock.advance(GRENADES.flash.fuse + 0.1);
  room.tick();
  const blind = (id: string) => room.stateOf(id)!.blindUntil - room.gameView().serverNow;
  assert.ok(blind(b) > 1500, `b aveuglé ${blind(b)} ms`);
  assert.ok(blind(b) > blind(a), 'qui regarde l’éclair est aveuglé plus longtemps');
  // fumigène : un nuage apparaît puis se dissipe
  room.throwGrenade(a, 'fumee', [0, 1.5, 0], [0, 1, 2]);
  clock.advance(GRENADES.fumee.fuse + 0.1);
  room.tick();
  assert.equal(room.gameView().smokes.length, 1);
  clock.advance(GRENADES.fumee.seconds + 0.1);
  room.tick();
  assert.equal(room.gameView().smokes.length, 0);
  void wall;
});

test('cartes retravaillées : couverts déterministes, loin des apparitions, qui arrêtent les balles ; camps en équipes', async () => {
  const { gunfightProps } = await import('../src/shared/gunfightWorld');
  const { propsClear, spawnSide } = await import('../src/shared/gunfightProps');
  const counts: string[] = [];
  for (const m of GF_MAPS) {
    const props = gunfightProps(m.id);
    counts.push(`${m.id} ${props.length}`);
    assert.ok(props.length >= 6, `${m.id} : ${props.length} couverts`);
    for (const p of props) for (const s of m.spawns) assert.ok(Math.hypot(p.x - s.x, p.z - s.z) >= 4, `${m.id} : couvert sur un point d'apparition`);
    assert.equal(gunfightProps(m.id), props, 'calculés une fois');
    // une balle tirée à travers un couvert est arrêtée
    const p = props[0];
    const a = { x: p.x - Math.cos(p.rot) * 4, y: p.y + 0.8, z: p.z + Math.sin(p.rot) * 4 };
    const b = { x: p.x + Math.cos(p.rot) * 4, y: p.y + 0.8, z: p.z - Math.sin(p.rot) * 4 };
    assert.equal(propsClear(props, a, b), false, `${m.id} : ${p.kind} traversé`);
    // deux camps opposés
    const sides = m.spawns.map((s) => spawnSide(m, s));
    assert.ok(sides.filter((s) => s === 'rouge').length >= 3 && sides.filter((s) => s === 'bleu').length >= 3, `${m.id} : camps`);
  }
  console.log('couverts :', counts.join(', '));
  // sous terre, la vue n'est pas bouchée par le terrain (Salle du Conseil secret)
  const { gunfightWorld } = await import('../src/shared/gunfightWorld');
  assert.ok(gunfightWorld().lineClear(-8, -6.7, -35, 0, -6.7, -35), 'ligne de vue dans les souterrains');
  // en équipes, chacun apparaît dans son camp
  const { room, ids } = setup({ mode: 'equipes', map: 'place' }, 4);
  room.setTeam(ids[0], 'rouge');
  room.setTeam(ids[1], 'bleu');
  room.start(ids[0]);
  const map = mapOf('place');
  const at = (id: string) => ({ x: room.stateOf(id)!.spawn.x, z: room.stateOf(id)!.spawn.z });
  assert.equal(spawnSide(map, at(ids[0])), 'rouge');
  assert.equal(spawnSide(map, at(ids[1])), 'bleu');
});
