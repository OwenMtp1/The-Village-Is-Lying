/** Outils partagés des tests de partie (salon et partie sans réseau, horloge contrôlée). */
import { Room, type RoomOutput, type SightTest } from '../src/server/room';
import type { Gesture, HeldItem, PrivateInfo, PlayerPose } from '../src/shared/protocol';
import { totalOf, type Composition } from '../src/shared/roles';

export class Recorder implements RoomOutput {
  lobbies: ReturnType<Room['lobbyView']>[] = [];
  games: ReturnType<Room['gameView']>[] = [];
  secrets = new Map<string, PrivateInfo>();
  events: string[] = [];
  gestures: { g: Gesture; to: string[] }[] = [];
  gesture(g: Gesture, to: string[]) {
    this.gestures.push({ g, to });
  }
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

export const C = (tueur: number, sherif: number, detective: number, villageois: number): Composition => ({ tueur, sherif, detective, villageois });

export function setup(comp: Composition, opts: { n?: number; sight?: SightTest } = {}) {
  const out = new Recorder();
  let t = 1_000_000;
  const clock = { now: () => t, advance: (s: number) => (t += s * 1000) };
  const room = new Room('ABCD', comp, out, clock.now, undefined, opts.sight);
  const n = opts.n ?? totalOf(comp);
  const ids = Array.from({ length: n }, (_, i) => room.join(`J${i}`, i % 2 ? 'F' : 'M').id);
  return { room, out, ids, clock };
}

export const pose = (x: number, z: number, y = 0, item: HeldItem = null, yaw = 0): PlayerPose => ({ x, y, z, yaw, speed: 0, grounded: true, vy: 0, dir: 1, torch: false, pitch: 0, item });

/** Arme du rôle sortie (couteau du tueur, pistolet du shérif). */
export const armed = (room: Room, id: string): HeldItem => (room.roleOf(id) === 'tueur' ? 'couteau' : room.roleOf(id) === 'sherif' ? 'pistolet' : null);

/** Position d'un joueur, arme du rôle en main, tourné vers (tx, tz). */
export function place(room: Room, id: string, x: number, z: number, y = 0, toward?: [number, number]) {
  room.pose(id, pose(x, z, y, armed(room, id), toward ? Math.atan2(toward[0] - x, toward[1] - z) : 0));
}

/** Tout le monde marche jusqu'au même endroit (3 s : vitesse plausible, portées respectées), armes sorties. */
export function gather(room: Room, ids: string[], clock: { advance(s: number): void }, x = 0, z = 0) {
  clock.advance(3);
  for (const id of ids) place(room, id, x, z);
}
