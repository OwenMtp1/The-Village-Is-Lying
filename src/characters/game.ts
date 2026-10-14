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
import { dayState } from '../shared/rules';
import { insideLimit } from '../village/boundary';
import { UNDER } from '../village/underground';
import { heightAt } from '../village/layout';
import { lookDir, type Flashlights } from './flashlight';

/**
 * Oriente la lampe du joueur vers ce qu'il regarde : en troisième personne, le faisceau part de la main et vise
 * le point regardé par la caméra (à 15 m) ; en vue subjective, il part juste sous les yeux.
 */
export function aimTorch(torches: Flashlights, ch: Character, cam: PlayerCamera, on: boolean) {
  const dir = lookDir(cam.yaw, cam.pitch);
  if (!on) {
    torches.setLocal(false, dir, dir);
    return;
  }
  const c = cam.camera.position;
  let from: THREE.Vector3;
  if (cam.mode === 'subjective') from = c.clone().add(new THREE.Vector3(-Math.cos(cam.yaw) * 0.12, -0.18, Math.sin(cam.yaw) * 0.12));
  else from = ch.animator.handPosition().addScaledVector(dir, 0.15);
  const target = c.clone().addScaledVector(dir, 25);
  torches.setLocal(true, from, target.sub(from).normalize());
}

/** vitesse du vol libre (m/s) */
const NOCLIP_SPEED = 7;

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
  /** lampe de poche du joueur allumée */
  torch = false;
  /** vol libre à travers les murs (touche N, exploration solo seulement) */
  noclip = false;
  /** début de la partie (horloge du navigateur, s) : cycle du jour */
  private startedAt = 0;

  constructor(
    readonly village: Village,
    readonly scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    readonly input: Input,
    readonly torches: Flashlights,
  ) {
    this.cam = new PlayerCamera(camera);
  }

  /** Secondes écoulées depuis le début de la partie (cycle du jour et de la nuit). */
  get elapsed() {
    return this.player ? performance.now() / 1000 - this.startedAt : 0;
  }

  toggleTorch() {
    if (!this.player) return;
    this.torch = !this.torch;
    this.player.animator.setTorch(this.torch);
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
    this.startedAt = performance.now() / 1000;
    this.torch = false;
    this.noclip = false;
    const v = this.player.animator.base.variant;
    this.info = { seed, player: { id: 'joueur', variant: v.id, firstName: v.firstName }, appearances };
    this.input.flush();
    return this.info;
  }

  /** Téléportation (carte de l'écran de pause) : au sol du point choisi, ou dans les galeries souterraines. */
  teleport(x: number, z: number, underground: boolean) {
    const p = this.player;
    if (!p) return;
    const w = this.village.collision;
    let y = underground ? UNDER.floor + 0.02 : w.groundAt(x, z, heightAt(x, z) + 0.6);
    if (!Number.isFinite(y)) y = heightAt(x, z);
    // jamais dans un mur ou un meuble : on écarte le personnage de l'obstacle
    const r = w.resolve(x, z, 0.3, y, 1.7);
    const c = p.controller;
    c.x = r.x;
    c.z = r.z;
    c.y = y;
    c.vx = c.vz = c.vy = 0;
    c.grounded = true;
    p.fly(0, 0, 0, 0, this.cam.yaw);
    this.input.flush();
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
    this.torches.off();
  }

  /** Une image de jeu : commandes, déplacements, animations, caméra. */
  update(dt: number) {
    const p = this.player;
    if (!p) return;
    const inp = this.input;
    const m = inp.takeMouse();
    if (!this.frozen) this.cam.look(m.dx, m.dy, m.wheel);
    if (!this.frozen && inp.consume('KeyV')) this.cam.toggle(p);
    if (!this.frozen && inp.consume('KeyN')) this.noclip = !this.noclip;
    if (this.noclip) {
      // vol dans la direction du regard (tangage compris), Espace / C pour monter / descendre, Maj : ×3
      const f = this.frozen ? 0 : (inp.held('KeyW') || inp.held('ArrowUp') ? 1 : 0) - (inp.held('KeyS') || inp.held('ArrowDown') ? 1 : 0);
      const r = this.frozen ? 0 : (inp.held('KeyD') || inp.held('ArrowRight') ? 1 : 0) - (inp.held('KeyA') || inp.held('ArrowLeft') ? 1 : 0);
      const u = this.frozen ? 0 : (inp.held('Space') ? 1 : 0) - (inp.held('KeyC') || inp.held('ControlLeft') ? 1 : 0);
      const dir = lookDir(this.cam.yaw, this.cam.pitch);
      const right = new THREE.Vector3(-Math.cos(this.cam.yaw), 0, Math.sin(this.cam.yaw));
      const v = dir.multiplyScalar(f).addScaledVector(right, r);
      v.y += u;
      if (v.lengthSq() > 1) v.normalize();
      const speed = NOCLIP_SPEED * (inp.held('ShiftLeft') || inp.held('ShiftRight') ? 3 : 1);
      // le vol libre traverse les murs, pas la limite de la carte
      const nx = p.controller.x + v.x * speed * dt;
      const nz = p.controller.z + v.z * speed * dt;
      if (!insideLimit(nx, nz, 1)) v.x = v.z = 0;
      p.fly(dt, v.x * speed, v.y * speed, v.z * speed, this.cam.yaw);
    } else {
      const cmd = readMove(inp, this.cam, this.frozen);
      p.update(dt, cmd, this.cam.mode === 'subjective' ? this.cam.yaw : null);
    }
    if (!this.frozen && inp.consume('KeyL')) this.toggleTorch();
    for (const n of this.npcs) this.updateNpc(n, dt);
    this.cam.noCollide = this.noclip;
    this.cam.update(dt, p, this.village.collision);
    aimTorch(this.torches, p, this.cam, this.torch);
    // les villageois sortent leur lampe quand il fait sombre
    const dark = dayState(this.elapsed).light < 0.5;
    const beams: { from: THREE.Vector3; dir: THREE.Vector3 }[] = [];
    for (const n of this.npcs) {
      n.ch.animator.setTorch(dark);
      if (dark) beams.push({ from: n.ch.animator.handPosition(), dir: lookDir(n.ch.yaw, -0.18) });
    }
    this.torches.setRemotes(beams, p.root.position);
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
