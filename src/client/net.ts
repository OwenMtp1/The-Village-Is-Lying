/**
 * Connexion au serveur de jeu et état reçu (salon, partie, secret). Un seul socket pour toute l'application.
 * Le jeton de reconnexion est gardé pour l'onglet : une page rechargée retrouve sa place dans la partie.
 */
import { io, type Socket } from 'socket.io-client';
import type { ClientToServer, GameView, LobbyView, PlayerPose, PrivateInfo, ServerToClient } from '../shared/protocol';
import type { Composition } from '../shared/roles';
import type { Sex } from '../characters/catalog';

type Listener = () => void;

/** Version de démonstration publiée sans serveur de jeu (build `--mode static`) : pas de parties en ligne. */
export const STATIC = (import.meta as { env?: { MODE?: string } }).env?.MODE === 'static';
export const OFFLINE_MESSAGE = 'Version de démonstration sans serveur : les parties en ligne demandent de lancer le serveur du jeu (npm start). L’exploration solo est disponible.';

class Net {
  readonly socket: Socket<ServerToClient, ClientToServer>;
  lobby: LobbyView | null = null;
  game: GameView | null = null;
  secret: PrivateInfo | null = null;
  poses: Record<string, PlayerPose> = {};
  /** écart entre l'horloge du serveur et celle du navigateur (ms) */
  clockOffset = 0;
  posesAt = 0;
  me = '';
  connected = false;
  private listeners = new Set<Listener>();
  onEvent: (e: { text: string; kind: 'info' | 'mort' | 'reunion' | 'fin' }) => void = () => {};

  constructor() {
    this.socket = io({ autoConnect: false, transports: ['websocket', 'polling'] });
    this.socket.on('connect', () => {
      this.connected = true;
      this.rejoin();
      this.emit();
    });
    this.socket.on('disconnect', () => {
      this.connected = false;
      this.emit();
    });
    this.socket.on('salon:etat', (v) => {
      this.lobby = v;
      if (v.phase === 'salon') {
        this.game = null;
        this.secret = null;
      }
      this.emit();
    });
    this.socket.on('jeu:etat', (v) => {
      this.game = v;
      if (v.serverNow) this.clockOffset = v.serverNow - Date.now();
      this.emit();
    });
    this.socket.on('jeu:secret', (v) => {
      this.secret = v;
      this.emit();
    });
    this.socket.on('jeu:poses', (p) => {
      this.poses = p;
      this.posesAt = performance.now();
    });
    this.socket.on('jeu:evenement', (e) => this.onEvent(e));
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    for (const l of this.listeners) l();
  }

  connect() {
    if (STATIC) return;
    if (!this.socket.connected) this.socket.connect();
  }

  private call<T>(ev: keyof ClientToServer, p: unknown): Promise<T> {
    if (STATIC) return Promise.reject(new Error(OFFLINE_MESSAGE));
    this.connect();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Le serveur ne répond pas.')), 8000);
      (this.socket.emit as (e: string, p: unknown, ack: (r: { ok: boolean; data: T; error: string }) => void) => void)(ev, p, (r) => {
        clearTimeout(t);
        if (r.ok) resolve(r.data);
        else reject(new Error(r.error));
      });
    });
  }

  private remember(r: { code: string; playerId: string; token: string }, name: string, sex: Sex) {
    this.me = r.playerId;
    try {
      sessionStorage.setItem('village.session', JSON.stringify({ code: r.code, token: r.token, name, sex }));
    } catch {
      /* stockage indisponible : pas de reconnexion automatique */
    }
  }

  /** Reconnexion automatique (page rechargée, réseau coupé) avec le jeton de l'onglet. */
  private rejoin() {
    let s: { code: string; token: string; name: string; sex: Sex } | null = null;
    try {
      s = JSON.parse(sessionStorage.getItem('village.session') ?? 'null');
    } catch {
      s = null;
    }
    if (!s) return;
    this.call<{ code: string; playerId: string; token: string }>('salon:rejoindre', s).then(
      (r) => this.remember(r, s!.name, s!.sex),
      () => this.forget(),
    );
  }

  forget() {
    try {
      sessionStorage.removeItem('village.session');
    } catch {
      /* rien */
    }
  }

  async create(name: string, sex: Sex, composition: Composition) {
    const r = await this.call<{ code: string; playerId: string; token: string }>('salon:creer', { name, sex, composition });
    this.remember(r, name, sex);
    return r;
  }
  async join(code: string, name: string, sex: Sex) {
    const r = await this.call<{ code: string; playerId: string; token: string }>('salon:rejoindre', { code, name, sex });
    this.remember(r, name, sex);
    return r;
  }
  setComposition(composition: Composition) {
    return this.call('salon:composition', { composition });
  }
  setSex(sex: Sex) {
    return this.call('salon:sexe', { sex });
  }
  start() {
    return this.call('salon:lancer', {});
  }
  leave() {
    this.socket.emit('salon:quitter');
    this.forget();
    this.lobby = null;
    this.game = null;
    this.secret = null;
    this.me = '';
    this.emit();
  }
  sendPose(p: PlayerPose) {
    if (this.socket.connected) this.socket.emit('jeu:pose', p);
  }
  eliminate(target: string) {
    return this.call('jeu:eliminer', { target });
  }
  shoot(target: string) {
    return this.call('jeu:tirer', { target });
  }
  investigate(target: string) {
    return this.call<{ killer: boolean }>('jeu:enqueter', { target });
  }
  report(body: string) {
    return this.call('jeu:signaler', { body });
  }
  emergency() {
    return this.call('jeu:urgence', {});
  }
  vote(target: string | null) {
    return this.call('jeu:voter', { target });
  }
  /** Fin de partie lue : la salle repasse au salon (état de la partie effacé pour tous). */
  backToLobby() {
    return this.call('salon:retour', {});
  }
  /** Heure du serveur (ms) : délais et comptes à rebours identiques pour tous les joueurs. */
  serverNow() {
    return Date.now() + this.clockOffset;
  }
  nameOf(id: string) {
    return this.lobby?.players.find((p) => p.id === id)?.name ?? '?';
  }
}

export const net = new Net();
