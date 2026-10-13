/**
 * Partie locale : le joueur choisit seulement son sexe ; les apparences de tous les personnages de la partie
 * sont tirées une fois (graine de partie) et ne changent plus jusqu'à la nouvelle partie. Le village n'est
 * jamais reconstruit : seuls les personnages sont créés et retirés.
 *
 * En attendant le multijoueur, trois villageois non joueurs parcourent la place et les rues avec exactement
 * le même contrôleur et les mêmes animations que le joueur (test de charge et de cohérence).
 */
import * as THREE from 'three';
import { assignAppearances, newGameSeed, seededRandom, type PlayerChoice } from './appearance';
import { loadCharacter, releaseCharacter } from './assets';
import { PlayerCamera } from './camera';
import { Character } from './character';
import type { MoveInput } from './controller';
import type { Sex } from './catalog';
import type { Input } from '../input';
import type { Village } from '../village/village';

interface Npc {
  ch: Character;
  path: [number, number][];
  i: number;
  wait: number;
  run: boolean;
}

/** Itinéraires des villageois (place, Grand-Rue, rue des Tisserands). */
const ROUTES: [number, number][][] = [
  [[-9, -6], [7, -9], [11, 5], [-5, 9]],
  [[18, 0.5], [40, 3.5], [62, 1], [40, 3.5]],
  [[-18, 3.5], [-34, 6.5], [-50, 5.5], [-34, 6.5]],
];

/**
 * Commandes de déplacement du joueur, relatives au regard : avant / arrière / côtés (ZQSD = WASD physiques,
 * flèches), course (Maj), saut (Espace, front montant seulement). Partagé par la partie solo et en ligne.
 */
export function readMove(inp: Input, cam: PlayerCamera, frozen: boolean): MoveInput {
  let f = 0;
  let r = 0;
  if (!frozen) {
    if (inp.held('KeyW') || inp.held('ArrowUp')) f += 1;
    if (inp.held('KeyS') || inp.held('ArrowDown')) f -= 1;
    if (inp.held('KeyD') || inp.held('ArrowRight')) r += 1;
    if (inp.held('KeyA') || inp.held('ArrowLeft')) r -= 1;
  }
  const [fx, fz] = cam.forward;
  // droite du regard = (-cos, sin) pour un avant (sin, cos)
  let x = fx * f - fz * r;
  let z = fz * f + fx * r;
  const len = Math.hypot(x, z);
  if (len > 1) {
    x /= len;
    z /= len;
  }
  return { x, z, run: !frozen && (inp.held('ShiftLeft') || inp.held('ShiftRight')), jump: !frozen && inp.consume('Space') };
}

export interface GameInfo {
  seed: number;
  player: { id: string; variant: string; firstName: string };
  appearances: Record<string, string>;
}

export class Game {
  readonly cam: PlayerCamera;
  player: Character | null = null;
  private npcs: Npc[] = [];
  private loaded = new Set<string>();
  info: GameInfo | null = null;
  /** commandes du joueur gelées (menus ouverts) */
  frozen = false;

  constructor(
    readonly village: Village,
    readonly scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    readonly input: Input,
  ) {
    this.cam = new PlayerCamera(camera);
  }

  /** Démarre une partie avec le sexe choisi par le joueur. Les personnages précédents sont retirés. */
  async start(sex: Sex): Promise<GameInfo> {
    this.end();
    const seed = newGameSeed();
    const rnd = seededRandom(seed ^ 0x9e3779b9);
    const players: PlayerChoice[] = [{ playerId: 'joueur', sex }, ...ROUTES.map((_, i) => ({ playerId: `villageois-${i + 1}`, sex: (rnd() < 0.5 ? 'M' : 'F') as Sex }))];
    const appearances = assignAppearances(players, seed);
    const bases = await Promise.all(Object.values(appearances).map((id) => loadCharacter(id)));
    for (const id of Object.values(appearances)) this.loaded.add(id);
    const baseOf = (pid: string) => bases[Object.keys(appearances).indexOf(pid)];
    const world = this.village.collision;
    // le joueur apparaît au sud de la place, face au puits et à la taverne
    this.player = new Character('joueur', baseOf('joueur'), world, 3, 10.5, Math.PI);
    this.scene.add(this.player.root);
    this.cam.yaw = Math.PI;
    this.cam.pitch = -0.22;
    if (this.cam.mode === 'subjective') this.player.animator.setFirstPerson(true);
    ROUTES.forEach((path, i) => {
      const pid = `villageois-${i + 1}`;
      const [x, z] = path[0];
      const ch = new Character(pid, baseOf(pid), world, x, z, 0);
      this.scene.add(ch.root);
      this.npcs.push({ ch, path, i: 1, wait: rnd() * 2, run: false });
    });
    const v = this.player.animator.base.variant;
    this.info = { seed, player: { id: 'joueur', variant: v.id, firstName: v.firstName }, appearances };
    this.input.flush();
    return this.info;
  }

  /** Fin de partie : personnages retirés, modèles libérés (le village reste en place). */
  end() {
    this.player?.dispose();
    this.player = null;
    for (const n of this.npcs) n.ch.dispose();
    this.npcs = [];
    for (const id of this.loaded) void releaseCharacter(id);
    this.loaded.clear();
    this.info = null;
  }

  /** Une image de jeu : commandes, déplacements, animations, caméra. */
  update(dt: number) {
    const p = this.player;
    if (!p) return;
    const inp = this.input;
    const m = inp.takeMouse();
    if (!this.frozen) this.cam.look(m.dx, m.dy, m.wheel);
    if (!this.frozen && inp.consume('KeyV')) this.cam.toggle(p);
    const cmd = readMove(inp, this.cam, this.frozen);
    p.update(dt, cmd, this.cam.mode === 'subjective' ? this.cam.yaw : null);
    for (const n of this.npcs) this.updateNpc(n, dt);
    this.cam.update(dt, p, this.village.collision);
  }

  private updateNpc(n: Npc, dt: number) {
    const c = n.ch.controller;
    const [tx, tz] = n.path[n.i];
    const dx = tx - c.x;
    const dz = tz - c.z;
    const d = Math.hypot(dx, dz);
    let cmd: MoveInput = { x: 0, z: 0, run: false, jump: false };
    if (n.wait > 0) n.wait -= dt;
    else if (d < 0.6) {
      n.i = (n.i + 1) % n.path.length;
      n.wait = 1 + Math.random() * 3;
      n.run = Math.random() < 0.25;
    } else cmd = { x: dx / d, z: dz / d, run: n.run, jump: false };
    n.ch.update(dt, cmd);
  }

  /** Personnages de la partie (contrôles automatiques, captures). */
  get characters(): Character[] {
    return [...(this.player ? [this.player] : []), ...this.npcs.map((n) => n.ch)];
  }
}
