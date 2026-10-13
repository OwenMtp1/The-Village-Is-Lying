/**
 * Partie en ligne côté navigateur : le personnage du joueur (même contrôleur et mêmes animations qu'en solo),
 * les autres joueurs animés à partir des positions reçues, les corps, et les actions de rôle (demandes au
 * serveur, qui décide). Les apparences viennent du serveur et ne changent plus pendant la partie.
 */
import * as THREE from 'three';
import { loadCharacter } from '../characters/assets';
import { CharacterAnimator } from '../characters/animator';
import { PlayerCamera } from '../characters/camera';
import { Character } from '../characters/character';
import { aimTorch, readMove } from '../characters/game';
import { lookDir, type Flashlights } from '../characters/flashlight';
import { RULES } from '../shared/rules';
import type { PlayerPose } from '../shared/protocol';
import type { Input } from '../input';
import type { Village } from '../village/village';
import { net } from './net';

interface Remote {
  anim: CharacterAnimator;
  pos: THREE.Vector3;
  yaw: number;
  target: PlayerPose | null;
  grounded: boolean;
}

export interface Prompt {
  key: string;
  label: string;
  action: () => Promise<unknown>;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class OnlineGame {
  readonly cam: PlayerCamera;
  player: Character | null = null;
  private remotes = new Map<string, Remote>();
  private bodies = new Map<string, CharacterAnimator>();
  private loading = false;
  private sendAcc = 0;
  /** actions possibles à cet instant (affichées par l'interface) */
  prompts: Prompt[] = [];
  onFeedback: (text: string, bad?: boolean) => void = () => {};

  constructor(
    readonly village: Village,
    readonly scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    readonly input: Input,
    readonly torches: Flashlights,
  ) {
    this.cam = new PlayerCamera(camera);
  }

  /** lampe de poche du joueur allumée */
  torch = false;

  toggleTorch() {
    if (!this.player || !this.alive) return;
    this.torch = !this.torch;
    this.player.animator.setTorch(this.torch);
  }

  /** Secondes écoulées depuis le début de la partie, selon l'horloge du serveur. */
  get elapsed() {
    const g = net.game;
    return g && g.startedAt ? (Date.now() + net.clockOffset - g.startedAt) / 1000 : 0;
  }

  /** Crée les personnages de la partie (une fois les apparences connues). */
  async ensure() {
    const g = net.game;
    if (!g || this.player || this.loading) return;
    this.loading = true;
    try {
      const ids = Object.keys(g.appearances);
      const bases = await Promise.all(ids.map((id) => loadCharacter(g.appearances[id])));
      const world = this.village.collision;
      ids.forEach((id, i) => {
        const p = net.poses[id] ?? { x: -2, y: 0, z: 6, yaw: Math.PI };
        if (id === net.me) {
          this.player = new Character(id, bases[i], world, p.x, p.z, p.yaw);
          this.scene.add(this.player.root);
          this.cam.yaw = p.yaw;
          this.cam.pitch = -0.22;
          if (this.cam.mode === 'subjective') this.player.animator.setFirstPerson(true);
        } else {
          const anim = new CharacterAnimator(bases[i]);
          const y = world.groundAt(p.x, p.z, 1e6);
          anim.root.position.set(p.x, y, p.z);
          this.scene.add(anim.root);
          this.remotes.set(id, { anim, pos: new THREE.Vector3(p.x, y, p.z), yaw: p.yaw, target: null, grounded: true });
        }
      });
    } finally {
      this.loading = false;
    }
  }

  dispose() {
    this.player?.dispose();
    this.player = null;
    for (const r of this.remotes.values()) r.anim.dispose();
    this.remotes.clear();
    for (const b of this.bodies.values()) b.dispose();
    this.bodies.clear();
    this.prompts = [];
    this.torch = false;
    this.torches.off();
  }

  private get alive() {
    return !!net.game?.alive[net.me];
  }

  update(dt: number) {
    const g = net.game;
    const p = this.player;
    if (!g || !p) return;
    const playing = g.phase === 'jeu';
    const frozen = !playing;
    const m = this.input.takeMouse();
    if (!frozen) this.cam.look(m.dx, m.dy, m.wheel);
    if (this.input.consume('KeyV')) this.cam.toggle(p);
    p.update(dt, readMove(this.input, this.cam, frozen), this.cam.mode === 'subjective' ? this.cam.yaw : null);
    // éliminé : le joueur suit la partie en fantôme (corps invisible, plus aucune position envoyée)
    p.root.visible = this.alive && p.root.visible;
    const c = p.controller;
    this.sendAcc += dt;
    if (this.alive && playing && this.sendAcc > 1 / 15) {
      this.sendAcc = 0;
      net.sendPose({ x: c.x, y: c.y, z: c.z, yaw: p.yaw, speed: Math.hypot(c.realVx, c.realVz), grounded: c.grounded, vy: c.vy, dir: 1, torch: this.torch, pitch: this.cam.pitch });
    }
    this.updateRemotes(dt);
    this.updateBodies();
    if (!frozen && this.input.consume('KeyL')) this.toggleTorch();
    if (!this.alive && this.torch) this.toggleTorch();
    this.cam.update(dt, p, this.village.collision);
    aimTorch(this.torches, p, this.cam, this.torch && this.alive);
    // faisceaux des autres joueurs (lampe allumée, orientée selon leur regard)
    const beams: { from: THREE.Vector3; dir: THREE.Vector3 }[] = [];
    for (const [id, r] of this.remotes) {
      const t = r.target;
      const on = !!t?.torch && !!net.game?.alive[id];
      r.anim.setTorch(on);
      if (on) beams.push({ from: r.anim.handPosition(), dir: lookDir(t!.yaw, t!.pitch) });
    }
    this.torches.setRemotes(beams, p.root.position);
    if (!this.alive) p.root.visible = false;
    this.updatePrompts();
    for (const pr of this.prompts)
      if (this.input.consume(pr.key))
        pr.action().catch((e: Error) => this.onFeedback(e.message, true));
  }

  private updateRemotes(dt: number) {
    const g = net.game!;
    for (const [id, r] of this.remotes) {
      const pose = net.poses[id];
      const alive = g.alive[id];
      r.anim.root.visible = !!alive;
      if (!alive) continue;
      if (pose) r.target = pose;
      const t = r.target;
      if (!t) continue;
      // poursuite douce de la dernière position reçue (15 par seconde) : pas d'à-coups
      const k = Math.min(1, dt * 12);
      const before = r.pos.clone();
      r.pos.x += (t.x - r.pos.x) * k;
      r.pos.z += (t.z - r.pos.z) * k;
      r.pos.y += (t.y - r.pos.y) * Math.min(1, dt * (t.grounded ? 14 : 25));
      if (r.pos.distanceTo(new THREE.Vector3(t.x, t.y, t.z)) > 6) r.pos.set(t.x, t.y, t.z);
      const dy = wrap(t.yaw - r.yaw);
      const step = dy * Math.min(1, dt * 12);
      r.yaw = wrap(r.yaw + step);
      if (r.grounded && !t.grounded) r.anim.onJump();
      if (!r.grounded && t.grounded) r.anim.onLand(6);
      r.grounded = t.grounded;
      const moved = Math.hypot(r.pos.x - before.x, r.pos.z - before.z) / Math.max(dt, 1e-3);
      r.anim.update(dt, { speed: Math.min(t.speed, moved * 1.2 + 0.05), direction: t.dir, turnRate: step / Math.max(dt, 1e-3), grounded: t.grounded, vy: t.vy });
      r.anim.root.position.copy(r.pos);
      r.anim.root.rotation.y = r.yaw;
    }
  }

  /** Corps allongés là où les joueurs sont morts (Rocketbox n'a pas d'animation de mort : le corps est couché). */
  private updateBodies() {
    const g = net.game!;
    for (const b of g.bodies) {
      if (this.bodies.has(b.id)) continue;
      const appearance = g.appearances[b.id];
      void loadCharacter(appearance).then((base) => {
        if (this.bodies.has(b.id) || !net.game) return;
        const anim = new CharacterAnimator(base);
        anim.update(0.016, { speed: 0, direction: 1, turnRate: 0, grounded: true, vy: 0 });
        const y = this.village.collision.groundAt(b.x, b.z, b.y + 0.5);
        anim.root.position.set(b.x, y + 0.12, b.z);
        anim.root.rotation.set(-Math.PI / 2, b.yaw, 0, 'YXZ');
        this.scene.add(anim.root);
        this.bodies.set(b.id, anim);
      });
    }
    for (const [id, a] of this.bodies) if (!g.bodies.some((b) => b.id === id) || g.phase === 'reunion') a.root.visible = g.bodies.some((b) => b.id === id);
  }

  /** Actions disponibles selon le rôle et les personnes à portée (le serveur revérifie tout). */
  private updatePrompts() {
    const g = net.game!;
    const s = net.secret;
    const p = this.player!;
    this.prompts = [];
    if (!s || g.phase !== 'jeu' || !this.alive) return;
    const me = p.controller;
    const others = [...this.remotes.entries()]
      .filter(([id]) => g.alive[id])
      .map(([id, r]) => ({ id, d: Math.hypot(r.pos.x - me.x, r.pos.z - me.z), dy: r.pos.y - me.y, ang: Math.abs(wrap(Math.atan2(r.pos.x - me.x, r.pos.z - me.z) - this.cam.yaw)) }))
      .filter((o) => Math.abs(o.dy) < 2.2)
      .sort((a, b) => a.d - b.d);
    const name = (id: string) => net.nameOf(id);
    if (s.role === 'tueur') {
      const t = others.find((o) => !s.allies.includes(o.id) && o.d <= RULES.killRange);
      const wait = Math.ceil((s.killReadyAt - serverNow()) / 1000);
      if (t) this.prompts.push({ key: 'KeyE', label: wait > 0 ? `Éliminer ${name(t.id)} (dans ${wait} s)` : `Éliminer ${name(t.id)}`, action: () => net.eliminate(t.id) });
    }
    if (s.role === 'sherif' && s.ammo > 0) {
      // on tire sur la personne visée (devant la caméra), à portée
      const t = others.filter((o) => o.d <= RULES.shootRange && o.ang < 0.35).sort((a, b) => a.ang - b.ang)[0];
      if (t) this.prompts.push({ key: 'KeyF', label: `Tirer sur ${name(t.id)} (1 balle)`, action: () => net.shoot(t.id) });
    }
    if (s.role === 'detective' && s.investigations > 0) {
      const t = others.find((o) => o.d <= RULES.investigateRange);
      if (t)
        this.prompts.push({
          key: 'KeyR',
          label: `Enquêter sur ${name(t.id)}`,
          action: () => net.investigate(t.id).then((r) => this.onFeedback(`Votre enquête : ${name(t.id)} ${r.killer ? 'EST un tueur.' : 'n’est pas un tueur.'}`)),
        });
    }
    const body = g.bodies.find((b) => !b.reported && Math.hypot(b.x - me.x, b.z - me.z) <= RULES.reportRange);
    if (body) this.prompts.push({ key: 'KeyT', label: `Signaler le corps de ${name(body.id)}`, action: () => net.report(body.id) });
    if (s.emergencyLeft > 0) this.prompts.push({ key: 'KeyU', label: 'Réunion d’urgence', action: () => net.emergency() });
  }
}

/** Horloge serveur approchée (les délais sont des horodatages serveur ; même machine en local). */
export const serverNow = () => Date.now();
