/**
 * Serveur réel (Socket.IO) avec plusieurs clients : création avec composition, compositions refusées,
 * salon complet, lancement seulement au complet, chaque client ne reçoit que son propre rôle.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { io, type Socket } from 'socket.io-client';
import type { AddressInfo } from 'node:net';
import { createGameServer } from '../src/server/app';
import type { Composition } from '../src/shared/roles';
import type { LobbyView, PrivateInfo } from '../src/shared/protocol';

const server = createGameServer();
await new Promise<void>((r) => server.http.listen(0, r));
const url = `http://localhost:${(server.http.address() as AddressInfo).port}`;
const clients: Socket[] = [];

function client() {
  const s = io(url, { transports: ['websocket'], forceNew: true });
  clients.push(s);
  const secrets: PrivateInfo[] = [];
  const lobbies: LobbyView[] = [];
  s.on('jeu:secret', (x: PrivateInfo) => secrets.push(x));
  s.on('salon:etat', (x: LobbyView) => lobbies.push(x));
  const call = <T>(ev: string, p: unknown) => new Promise<{ ok: boolean; data?: T; error?: string }>((r) => s.emit(ev, p, r));
  return { s, call, secrets, lobbies };
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test.after(async () => {
  for (const c of clients) c.close();
  await server.close();
  server.http.close();
});

test('création refusée pour une composition invalide (serveur)', async () => {
  const a = client();
  for (const composition of [{ tueur: 0, sherif: 1, detective: 1, villageois: 4 }, { tueur: 1, sherif: 0, detective: 0, villageois: 1 }, { tueur: 3, sherif: 3, detective: 3, villageois: 3 }, { tueur: 1, sherif: 1 }]) {
    const r = await a.call('salon:creer', { name: 'Hôte', sex: 'M', composition });
    assert.equal(r.ok, false, JSON.stringify(composition));
    assert.ok(r.error && r.error.length > 10, r.error);
  }
});

test('salon de 8 : 6 connectés → lancement refusé ; au complet → rôles exacts, chacun le sien', async () => {
  const comp: Composition = { tueur: 2, sherif: 2, detective: 1, villageois: 3 };
  const host = client();
  const created = await host.call<{ code: string; playerId: string }>('salon:creer', { name: 'Hôte', sex: 'F', composition: comp });
  assert.ok(created.ok);
  const code = created.data!.code;
  const players = [host];
  const ids = [created.data!.playerId];
  for (let i = 1; i < 6; i++) {
    const c = client();
    const r = await c.call<{ playerId: string }>('salon:rejoindre', { code, name: `J${i}`, sex: i % 2 ? 'M' : 'F' });
    assert.ok(r.ok, r.error);
    players.push(c);
    ids.push(r.data!.playerId);
  }
  await wait(50);
  const last = host.lobbies.at(-1)!;
  assert.equal(`${last.players.length} / ${last.seats}`, '6 / 8');
  assert.equal(last.blocker, 'Il manque 2 joueurs pour commencer.');
  assert.match((await host.call('salon:lancer', {})).error!, /Il manque 2 joueurs/);
  // un joueur (non hôte) ne peut ni modifier la composition ni lancer
  assert.match((await players[1].call('salon:composition', { composition: { tueur: 1, sherif: 1, detective: 1, villageois: 5 } })).error!, /Seul l’hôte/);
  assert.match((await players[1].call('salon:lancer', {})).error!, /Seul l’hôte/);
  for (let i = 6; i < 8; i++) {
    const c = client();
    const r = await c.call<{ playerId: string }>('salon:rejoindre', { code, name: `J${i}`, sex: 'M' });
    assert.ok(r.ok, r.error);
    players.push(c);
    ids.push(r.data!.playerId);
  }
  const extra = client();
  assert.match((await extra.call('salon:rejoindre', { code, name: 'Neuvième', sex: 'M' })).error!, /Salon complet \(8 \/ 8/);
  const started = await host.call('salon:lancer', {});
  assert.ok(started.ok, started.error);
  await wait(100);
  const roles = players.map((p) => p.secrets.at(-1)?.role);
  assert.equal(roles.filter((r) => r === 'tueur').length, 2);
  assert.equal(roles.filter((r) => r === 'sherif').length, 2);
  assert.equal(roles.filter((r) => r === 'detective').length, 1);
  assert.equal(roles.filter((r) => r === 'villageois').length, 3);
  // chaque client n'a reçu que des secrets le concernant (un seul rôle, jamais celui d'un autre)
  for (const p of players) assert.equal(new Set(p.secrets.map((x) => x.role)).size, 1);
  assert.match((await extra.call('salon:rejoindre', { code, name: 'Retard', sex: 'M' })).error!, /déjà commencé/);
  assert.match((await host.call('salon:composition', { composition: comp })).error!, /verrouillée/);
});
