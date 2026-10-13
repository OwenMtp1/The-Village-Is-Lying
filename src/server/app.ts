/**
 * Serveur de jeu : HTTP (pages et ressources compilées) + Socket.IO (salons, parties).
 * Chaque requête est revalidée par `Room` ; les secrets ne partent que vers le joueur concerné.
 */
import { createServer, type Server as HttpServer } from 'node:http';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomInt } from 'node:crypto';
import express from 'express';
import { Server } from 'socket.io';
import { Room, RoomError, type SightTest } from './room';
import { buildCollisionWorld, type CollisionWorld } from '../village/collision';
import type { ClientToServer, ServerToClient, Ack } from '../shared/protocol';

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export interface GameServer {
  http: HttpServer;
  io: Server<ClientToServer, ServerToClient>;
  rooms: Map<string, Room>;
  close(): Promise<void>;
}

export function createGameServer(opts: { staticDir?: string } = {}): GameServer {
  const app = express();
  if (opts.staticDir && existsSync(opts.staticDir)) {
    app.use(express.static(opts.staticDir, { maxAge: '1h', index: 'index.html' }));
    app.get('*', (_req, res) => res.sendFile(join(opts.staticDir!, 'index.html')));
  }
  const http = createServer(app);
  const io = new Server<ClientToServer, ServerToClient>(http, { cors: { origin: true }, maxHttpBufferSize: 16_000 });
  const rooms = new Map<string, Room>();
  // le village (murs, planchers, relief) sert à vérifier les lignes de vue (construit une fois, ~80 ms)
  const world: CollisionWorld = buildCollisionWorld();
  const sight: SightTest = (a, b) => world.lineClear(a.x, a.y, a.z, b.x, b.y, b.z);
  /** joueur → socket (messages privés) */
  const sockets = new Map<string, string>();

  const newCode = () => {
    for (;;) {
      const c = Array.from({ length: 4 }, () => LETTERS[randomInt(LETTERS.length)]).join('');
      if (!rooms.has(c)) return c;
    }
  };

  const output = (code: string) => ({
    lobby: (v: Parameters<ServerToClient['salon:etat']>[0]) => io.to(code).emit('salon:etat', v),
    game: (v: Parameters<ServerToClient['jeu:etat']>[0]) => io.to(code).emit('jeu:etat', v),
    secret: (pid: string, info: Parameters<ServerToClient['jeu:secret']>[0]) => {
      const sid = sockets.get(pid);
      if (sid) io.to(sid).emit('jeu:secret', info);
    },
    event: (text: string, kind: 'info' | 'mort' | 'reunion' | 'fin', to?: string) => {
      if (to) {
        const sid = sockets.get(to);
        if (sid) io.to(sid).emit('jeu:evenement', { text, kind });
      } else io.to(code).emit('jeu:evenement', { text, kind });
    },
  });

  io.on('connection', (socket) => {
    let room: Room | null = null;
    let pid = '';
    const guard = <T>(ack: Ack<T> | undefined, fn: () => T) => {
      if (typeof ack !== 'function') return;
      try {
        ack({ ok: true, data: fn() });
      } catch (e) {
        ack({ ok: false, error: e instanceof RoomError ? e.message : 'Requête refusée.' });
        if (!(e instanceof RoomError)) console.error(e);
      }
    };
    const attach = (r: Room, id: string) => {
      room = r;
      pid = id;
      sockets.set(id, socket.id);
      void socket.join(r.code);
      // état courant pour le nouvel arrivant (le reste suit par diffusion)
      socket.emit('salon:etat', r.lobbyView());
      if (r.phase !== 'salon') {
        socket.emit('jeu:etat', r.gameView());
        const s = r.privateInfo(id);
        if (s) socket.emit('jeu:secret', s);
      }
    };
    const leaveCurrent = (permanent: boolean) => {
      if (!room) return;
      room.leave(pid, permanent);
      if (sockets.get(pid) === socket.id) sockets.delete(pid);
      void socket.leave(room.code);
      if (room.empty) rooms.delete(room.code);
      room = null;
      pid = '';
    };

    socket.on('salon:creer', (p, ack) =>
      guard(ack, () => {
        leaveCurrent(true);
        const code = newCode();
        const r = new Room(code, p?.composition, output(code), Date.now, undefined, sight);
        const m = r.join(p?.name, p?.sex);
        rooms.set(code, r);
        attach(r, m.id);
        return { code, playerId: m.id, token: m.token };
      }),
    );
    socket.on('salon:rejoindre', (p, ack) =>
      guard(ack, () => {
        const r = rooms.get(String(p?.code ?? '').toUpperCase().trim());
        if (!r) throw new RoomError('Aucun salon avec ce code.');
        if (room !== r) leaveCurrent(true);
        const m = r.join(p?.name, p?.sex, typeof p?.token === 'string' ? p.token : undefined);
        attach(r, m.id);
        return { code: r.code, playerId: m.id, token: m.token };
      }),
    );
    const need = () => {
      if (!room) throw new RoomError('Vous n’êtes dans aucun salon.');
      return room;
    };
    socket.on('salon:composition', (p, ack) => guard(ack, () => need().setComposition(pid, p?.composition)));
    socket.on('salon:sexe', (p, ack) => guard(ack, () => need().setSex(pid, p?.sex)));
    socket.on('salon:lancer', (_p, ack) => guard(ack, () => need().start(pid)));
    socket.on('salon:quitter', () => leaveCurrent(true));
    socket.on('salon:retour', (_p, ack) => guard(ack, () => need().backToLobby(pid)));
    socket.on('jeu:pose', (p) => room?.pose(pid, p));
    socket.on('jeu:eliminer', (p, ack) => guard(ack, () => need().eliminate(pid, String(p?.target))));
    socket.on('jeu:tirer', (p, ack) => guard(ack, () => need().shoot(pid, String(p?.target))));
    socket.on('jeu:enqueter', (p, ack) => guard(ack, () => ({ killer: need().investigate(pid, String(p?.target)) })));
    socket.on('jeu:signaler', (p, ack) => guard(ack, () => need().report(pid, String(p?.body))));
    socket.on('jeu:urgence', (_p, ack) => guard(ack, () => need().emergency(pid)));
    socket.on('jeu:voter', (p, ack) => guard(ack, () => need().vote(pid, p?.target === null ? null : String(p?.target))));
    // au salon, une déconnexion libère la place ; en partie, le joueur garde sa place (reconnexion par jeton)
    socket.on('disconnect', () => leaveCurrent(room?.phase === 'salon'));
  });

  // horloge des votes et diffusion des positions (15 fois par seconde)
  const timer = setInterval(() => {
    for (const r of rooms.values()) {
      r.tick();
      if (r.phase === 'partie') io.to(r.code).emit('jeu:poses', r.posesView());
    }
  }, 66);

  return {
    http,
    io,
    rooms,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(timer);
        void io.close(() => resolve());
      }),
  };
}
