/**
 * Salles Gunfight côté serveur : codes à 4 lettres (partagés avec les salons d'enquête, jamais en double),
 * messages `gf:*`, horloge (réapparitions, fin du temps) et diffusion des positions 15 fois par seconde.
 * Toute la logique de jeu est dans `GunfightRoom` (partagée avec le mode solo du navigateur).
 */
import { randomBytes, randomInt } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import { GFError, GunfightRoom } from '../shared/gunfightRoom';
import type { Ack, ClientToServer, ServerToClient } from '../shared/protocol';

type IO = Server<ClientToServer, ServerToClient>;
type Sight = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => boolean;

const cryptoRandom = () => randomInt(0, 2 ** 31) / 2 ** 31;

export function gunfightServer(io: IO, sight: Sight, newCode: (taken: (c: string) => boolean) => string, random: () => number = cryptoRandom) {
  const rooms = new Map<string, GunfightRoom>();
  const channel = (code: string) => `gf:${code}`;
  void randomBytes;

  const output = (code: string) => ({
    lobby: (v: Parameters<ServerToClient['gf:salon']>[0]) => io.to(channel(code)).emit('gf:salon', v),
    game: (v: Parameters<ServerToClient['gf:etat']>[0]) => io.to(channel(code)).emit('gf:etat', v),
    shot: (s: Parameters<ServerToClient['gf:tir']>[0]) => io.to(channel(code)).emit('gf:tir', s),
    event: (e: Parameters<ServerToClient['gf:evenement']>[0]) => io.to(channel(code)).emit('gf:evenement', e),
  });

  function onConnection(socket: Socket<ClientToServer, ServerToClient>) {
    let room: GunfightRoom | null = null;
    let pid = '';
    const guard = <T>(ack: Ack<T> | undefined, fn: () => T) => {
      if (typeof ack !== 'function') return;
      try {
        ack({ ok: true, data: fn() });
      } catch (e) {
        ack({ ok: false, error: e instanceof GFError ? e.message : 'Requête refusée.' });
        if (!(e instanceof GFError)) console.error(e);
      }
    };
    const attach = (r: GunfightRoom, id: string) => {
      room = r;
      pid = id;
      void socket.join(channel(r.code));
      socket.emit('gf:salon', r.lobbyView());
      if (r.phase !== 'salon') socket.emit('gf:etat', r.gameView());
    };
    const leave = (permanent: boolean) => {
      if (!room) return;
      room.leave(pid, permanent);
      void socket.leave(channel(room.code));
      if (room.empty) rooms.delete(room.code);
      room = null;
      pid = '';
    };
    const need = () => {
      if (!room) throw new GFError('Vous n’êtes dans aucune salle.');
      return room;
    };
    socket.on('gf:creer', (p, ack) =>
      guard(ack, () => {
        leave(true);
        const code = newCode((c) => rooms.has(c));
        const r = new GunfightRoom(code, p?.settings, output(code), Date.now, random, sight);
        const m = r.join(p?.name, p?.sex);
        rooms.set(code, r);
        attach(r, m.id);
        return { code, playerId: m.id, token: m.token };
      }),
    );
    socket.on('gf:rejoindre', (p, ack) =>
      guard(ack, () => {
        const r = rooms.get(String(p?.code ?? '').toUpperCase().trim());
        if (!r) throw new GFError('Aucune salle Gunfight avec ce code.');
        if (room !== r) leave(true);
        const m = r.join(p?.name, p?.sex, typeof p?.token === 'string' ? p.token : undefined);
        attach(r, m.id);
        return { code: r.code, playerId: m.id, token: m.token };
      }),
    );
    socket.on('gf:reglages', (p, ack) => guard(ack, () => need().setSettings(pid, p?.settings ?? {})));
    socket.on('gf:equipe', (p, ack) => guard(ack, () => need().setTeam(pid, p?.team)));
    socket.on('gf:lancer', (_p, ack) => guard(ack, () => need().start(pid)));
    socket.on('gf:retour', (_p, ack) => guard(ack, () => need().backToLobby(pid)));
    socket.on('gf:quitter', () => leave(true));
    socket.on('gf:pose', (p) => room?.pose(pid, p));
    socket.on('gf:tir', (p, ack) => guard(ack, () => need().shoot(pid, typeof p?.target === 'string' ? p.target : null, Array.isArray(p?.aim) && p.aim.length === 3 && p.aim.every(Number.isFinite) ? (p.aim as [number, number, number]) : undefined)));
    socket.on('gf:couteau', (p, ack) => guard(ack, () => need().stab(pid, String(p?.target))));
    socket.on('gf:recharger', (_p, ack) => guard(ack, () => need().reload(pid)));
    socket.on('disconnect', () => leave(room?.phase === 'salon'));
  }

  function tick() {
    for (const r of rooms.values()) {
      r.tick();
      if (r.phase === 'partie') io.to(channel(r.code)).emit('gf:poses', r.posesView());
    }
  }

  return { rooms, onConnection, tick };
}
