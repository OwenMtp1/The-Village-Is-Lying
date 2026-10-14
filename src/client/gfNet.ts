/**
 * Connexion du mode Gunfight. Deux variantes, même interface :
 *  - en ligne : messages `gf:*` sur la connexion Socket.IO du jeu (le serveur décide de tout) ;
 *  - solo : la même salle (`GunfightRoom`) tourne dans le navigateur, avec des robots pilotés par `gunfight.ts`.
 */
import type { Sex } from '../characters/catalog';
import type { PlayerPose } from '../shared/protocol';
import type { GFEvent, GFGameView, GFGun, GFLobbyView, GFSettings, GFShot, GFShotResult, Team, Vec3 } from '../shared/gunfight';
import { GunfightRoom } from '../shared/gunfightRoom';
import { net } from './net';

type Listener = () => void;
type JoinResult = { code: string; playerId: string; token: string };

export abstract class GFClient {
  lobby: GFLobbyView | null = null;
  game: GFGameView | null = null;
  poses: Record<string, PlayerPose> = {};
  me = '';
  clockOffset = 0;
  onEvent: (e: GFEvent) => void = () => {};
  onShot: (s: GFShot) => void = () => {};
  private listeners = new Set<Listener>();
  abstract readonly local: boolean;

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  protected emit() {
    for (const l of this.listeners) l();
  }
  protected setLobby(v: GFLobbyView) {
    this.lobby = v;
    if (v.phase === 'salon') this.game = null;
    this.emit();
  }
  protected setGame(v: GFGameView) {
    this.game = v;
    this.clockOffset = v.serverNow - Date.now();
    this.emit();
  }
  serverNow() {
    return Date.now() + this.clockOffset;
  }
  nameOf(id: string) {
    return this.lobby?.players.find((p) => p.id === id)?.name ?? '?';
  }

  abstract setSettings(s: Partial<GFSettings>): Promise<unknown>;
  abstract setTeam(t: Team): Promise<unknown>;
  abstract start(): Promise<unknown>;
  abstract backToLobby(): Promise<unknown>;
  abstract leave(): void;
  abstract sendPose(p: PlayerPose): void;
  abstract shoot(weapon: GFGun, origin: Vec3, dirs: Vec3[], ends: Vec3[]): Promise<GFShotResult>;
  abstract stab(target: string): Promise<GFShotResult>;
  abstract reload(weapon: GFGun): Promise<unknown>;
}

/** Partie en ligne (serveur). */
export class SocketGF extends GFClient {
  readonly local = false;
  private off: (() => void)[] = [];

  constructor() {
    super();
    const s = net.socket;
    const on = <K extends 'gf:salon' | 'gf:etat' | 'gf:poses' | 'gf:tir' | 'gf:evenement'>(ev: K, fn: (...a: never[]) => void) => {
      s.on(ev, fn as never);
      this.off.push(() => s.off(ev, fn as never));
    };
    on('gf:salon', (v: GFLobbyView) => this.setLobby(v));
    on('gf:etat', (v: GFGameView) => this.setGame(v));
    on('gf:poses', (p: Record<string, PlayerPose>) => (this.poses = p));
    on('gf:tir', (x: GFShot) => this.onShot(x));
    on('gf:evenement', (e: GFEvent) => this.onEvent(e));
  }

  private call<T>(ev: string, p: unknown): Promise<T> {
    net.connect();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Le serveur ne répond pas.')), 8000);
      (net.socket.emit as (e: string, p: unknown, ack: (r: { ok: boolean; data: T; error: string }) => void) => void)(ev, p, (r) => {
        clearTimeout(t);
        if (r.ok) resolve(r.data);
        else reject(new Error(r.error));
      });
    });
  }

  async create(name: string, sex: Sex, settings: Partial<GFSettings>) {
    const r = await this.call<JoinResult>('gf:creer', { name, sex, settings });
    this.me = r.playerId;
    return r;
  }
  async join(code: string, name: string, sex: Sex) {
    const r = await this.call<JoinResult>('gf:rejoindre', { code, name, sex });
    this.me = r.playerId;
    return r;
  }
  setSettings(settings: Partial<GFSettings>) {
    return this.call('gf:reglages', { settings });
  }
  setTeam(team: Team) {
    return this.call('gf:equipe', { team });
  }
  start() {
    return this.call('gf:lancer', {});
  }
  backToLobby() {
    return this.call('gf:retour', {});
  }
  leave() {
    net.socket.emit('gf:quitter');
    for (const f of this.off) f();
    this.off = [];
    this.lobby = null;
    this.game = null;
    this.emit();
  }
  sendPose(p: PlayerPose) {
    if (net.socket.connected) net.socket.emit('gf:pose', p);
  }
  shoot(weapon: GFGun, origin: Vec3, dirs: Vec3[], ends: Vec3[]) {
    return this.call<GFShotResult>('gf:tir', { weapon, origin, dirs, ends });
  }
  stab(target: string) {
    return this.call<GFShotResult>('gf:couteau', { target });
  }
  reload(weapon: GFGun) {
    return this.call('gf:recharger', { weapon });
  }
}

export interface SoloOptions {
  settings: GFSettings;
  bots: number;
  difficulty: 'facile' | 'normal' | 'difficile';
  team: Team;
}

const BOT_NAMES = ['Bastien', 'Margot', 'Hugo', 'Lise', 'Armand', 'Jeanne', 'Gaspard', 'Agnès', 'Mathurin', 'Berthe', 'Thibault', 'Odile', 'Anselme', 'Clémence', 'Fulbert'];

/** Partie solo : la salle tourne dans le navigateur, robots compris. */
export class LocalGF extends GFClient {
  readonly local = true;
  readonly room: GunfightRoom;
  readonly bots: string[] = [];
  private timer: number;

  constructor(name: string, sex: Sex, readonly opts: SoloOptions, sight: (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => boolean) {
    super();
    const settings = { ...opts.settings, maxPlayers: Math.min(16, opts.bots + 1) };
    this.room = new GunfightRoom(
      'SOLO',
      settings,
      {
        lobby: (v) => this.setLobby(v),
        game: (v) => this.setGame(v),
        shot: (s) => this.onShot(s),
        event: (e) => this.onEvent(e),
      },
      Date.now,
      Math.random,
      sight,
    );
    const me = this.room.join(name, sex);
    this.me = me.id;
    if (settings.mode === 'equipes') this.room.setTeam(me.id, opts.team);
    for (let i = 0; i < opts.bots; i++) {
      const b = this.room.join(`${BOT_NAMES[i % BOT_NAMES.length]} (robot)`, i % 2 ? 'F' : 'M', undefined, true);
      // robots répartis pour équilibrer les équipes (le joueur compte dans la sienne)
      if (settings.mode === 'equipes') this.room.setTeam(b.id, this.smaller());
      this.bots.push(b.id);
    }
    this.room.start(me.id);
    this.timer = window.setInterval(() => {
      this.room.tick();
      this.poses = this.room.posesView();
    }, 66);
  }

  private smaller(): Team {
    const ps = this.room.lobbyView().players;
    const n = (t: Team) => ps.filter((p) => p.team === t).length;
    return n('rouge') <= n('bleu') ? 'rouge' : 'bleu';
  }

  setSettings() {
    return Promise.resolve();
  }
  setTeam() {
    return Promise.resolve();
  }
  start() {
    return Promise.resolve(this.room.start(this.me));
  }
  /** Solo : « retour à la salle » relance directement une nouvelle partie avec les mêmes robots. */
  backToLobby() {
    this.room.backToLobby(this.me);
    this.room.start(this.me);
    return Promise.resolve();
  }
  leave() {
    clearInterval(this.timer);
    this.lobby = null;
    this.game = null;
    this.emit();
  }
  sendPose(p: PlayerPose) {
    this.room.pose(this.me, p);
  }
  private wrap<T>(fn: () => T): Promise<T> {
    try {
      return Promise.resolve(fn());
    } catch (e) {
      return Promise.reject(e);
    }
  }
  shoot(weapon: GFGun, origin: Vec3, dirs: Vec3[], ends: Vec3[]) {
    return this.wrap(() => this.room.shoot(this.me, weapon, origin, dirs, ends));
  }
  stab(target: string) {
    return this.wrap(() => this.room.stab(this.me, target));
  }
  reload(weapon: GFGun) {
    return this.wrap(() => this.room.reload(this.me, weapon));
  }
}
