/**
 * Messages échangés entre le navigateur et le serveur (Socket.IO). Les vues publiques ne contiennent
 * jamais le rôle d'un autre joueur ; chaque joueur reçoit son secret par un message privé.
 */
import type { Sex } from '../characters/catalog';
import type { Composition, Role } from './roles';
import type { Winner } from './rules';
import type { GFEvent, GFGameView, GFGun, GFLobbyView, GFSettings, GFShot, GFShotResult, Team, Vec3 } from './gunfight';

export interface LobbyPlayer {
  id: string;
  name: string;
  sex: Sex;
  connected: boolean;
  host: boolean;
  ready: boolean;
}

/** État public d'un salon. */
export interface LobbyView {
  code: string;
  composition: Composition;
  /** places prévues = somme des rôles */
  seats: number;
  players: LobbyPlayer[];
  /** raison qui empêche le départ (null = la partie peut commencer) */
  blocker: string | null;
  phase: 'salon' | 'partie' | 'fin';
}

export interface PlayerPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** vitesse horizontale réelle, au sol, vitesse verticale (animation des autres joueurs) */
  speed: number;
  grounded: boolean;
  vy: number;
  dir: 1 | -1;
  /** lampe de poche allumée, et tangage du regard (direction du faisceau) */
  torch: boolean;
  pitch: number;
  /** arme en main (visible de tous) : couteau (tueurs), pistolet (shérifs) */
  item?: HeldItem;
  /** Gunfight de nuit : laser de l'arme allumé (les autres en voient le point rouge) */
  laser?: boolean;
}

export type HeldItem = 'couteau' | 'pistolet' | 'fusil' | 'pompe' | 'precision' | null;

/** Geste vu par les joueurs proches : coup de couteau, tir (pour animer l'arme du joueur concerné). */
export interface Gesture {
  id: string;
  kind: 'couteau' | 'tir';
}

/** État public de la partie (aucun rôle avant la fin). */
export interface GameView {
  phase: 'jeu' | 'reunion' | 'fin';
  /** apparences tirées au sort (publiques : chacun voit les autres) */
  appearances: Record<string, string>;
  alive: Record<string, boolean>;
  /** corps au sol, à l'endroit de la mort */
  bodies: { id: string; x: number; y: number; z: number; yaw: number; reported: boolean }[];
  meeting: null | { by: string; reason: 'urgence' | 'corps'; body?: string; endsAt: number; voted: string[] };
  /** journal public (éliminations sans révéler le rôle, résultats des votes) */
  log: string[];
  /** fin : camp gagnant, raison lisible, rôles de tous, survivants */
  result: null | { winner: Winner; roles: Record<string, Role>; reason: string; survivors: string[] };
  /** début de la partie et heure du serveur à l'envoi (ms) : cycle du jour identique pour tous */
  startedAt: number;
  serverNow: number;
}

/** Secret d'un joueur (envoyé à lui seul). */
export interface PrivateInfo {
  role: Role;
  /** autres tueurs (seulement pour un tueur) */
  allies: string[];
  ammo: number;
  investigations: number;
  /** prochain meurtre possible (horodatage serveur, ms) */
  killReadyAt: number;
  emergencyLeft: number;
  /** résultats d'enquête : joueur → est-ce un tueur ? */
  findings: Record<string, boolean>;
}

/** Annonce publique ou privée : `tir` = coup de feu entendu de tous (son), `indice` = résultat d'enquête. */
export type EventKind = 'info' | 'mort' | 'reunion' | 'fin' | 'tir' | 'indice';
export interface GameEvent {
  text: string;
  kind: EventKind;
}

export type Ack<T = unknown> = (r: { ok: true; data: T } | { ok: false; error: string }) => void;

type JoinAck = Ack<{ code: string; playerId: string; token: string }>;

export interface ClientToServer {
  // mode Gunfight
  'gf:creer': (p: { name: string; sex: Sex; settings: Partial<GFSettings> }, ack: JoinAck) => void;
  'gf:rejoindre': (p: { code: string; name: string; sex: Sex; token?: string }, ack: JoinAck) => void;
  'gf:reglages': (p: { settings: Partial<GFSettings> }, ack: Ack) => void;
  'gf:equipe': (p: { team: Team }, ack: Ack) => void;
  'gf:lancer': (p: Record<string, never>, ack: Ack) => void;
  'gf:quitter': () => void;
  'gf:retour': (p: Record<string, never>, ack: Ack) => void;
  'gf:pose': (p: PlayerPose) => void;
  /** origine (caméra), direction de chaque balle, impacts vus par le navigateur (traçantes) */
  'gf:tir': (p: { weapon: GFGun; origin: Vec3; dirs: Vec3[]; ends?: Vec3[] }, ack: Ack<GFShotResult>) => void;
  'gf:couteau': (p: { target: string }, ack: Ack<GFShotResult>) => void;
  'gf:recharger': (p: { weapon?: GFGun }, ack: Ack) => void;
  'salon:creer': (p: { name: string; sex: Sex; composition: Composition }, ack: Ack<{ code: string; playerId: string; token: string }>) => void;
  'salon:rejoindre': (p: { code: string; name: string; sex: Sex; token?: string }, ack: Ack<{ code: string; playerId: string; token: string }>) => void;
  'salon:composition': (p: { composition: Composition }, ack: Ack) => void;
  'salon:sexe': (p: { sex: Sex }, ack: Ack) => void;
  'salon:pret': (p: { ready: boolean }, ack: Ack) => void;
  'salon:lancer': (p: Record<string, never>, ack: Ack) => void;
  'salon:quitter': () => void;
  'salon:retour': (p: Record<string, never>, ack: Ack) => void;
  'jeu:pose': (p: PlayerPose) => void;
  'jeu:eliminer': (p: { target: string }, ack: Ack) => void;
  'jeu:tirer': (p: { target: string | null }, ack: Ack<{ hit: boolean }>) => void;
  'jeu:enqueter': (p: { target: string }, ack: Ack<{ killer: boolean }>) => void;
  'jeu:signaler': (p: { body: string }, ack: Ack) => void;
  'jeu:urgence': (p: Record<string, never>, ack: Ack) => void;
  'jeu:voter': (p: { target: string | null }, ack: Ack) => void;
}

export interface ServerToClient {
  'gf:salon': (v: GFLobbyView) => void;
  'gf:etat': (v: GFGameView) => void;
  'gf:poses': (p: Record<string, PlayerPose>) => void;
  'gf:tir': (s: GFShot) => void;
  'gf:evenement': (e: GFEvent) => void;
  'salon:etat': (v: LobbyView) => void;
  'jeu:etat': (v: GameView) => void;
  'jeu:secret': (v: PrivateInfo) => void;
  'jeu:poses': (p: Record<string, PlayerPose>) => void;
  'jeu:geste': (g: Gesture) => void;
  'jeu:evenement': (e: GameEvent) => void;
}
