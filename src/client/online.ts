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
import type { Gesture, HeldItem, PlayerPose } from '../shared/protocol';
import { sfx } from '../audio/sfx';
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
  /** action pas encore possible (délai) : affichée en retrait */
  waiting?: boolean;
  action: () => Promise<unknown>;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class OnlineGame {
  readonly cam: PlayerCamera;
  player: Character | null = null;
  private remotes = new Map<string, Remote>();
  private bodies = new Map<string, CharacterAnimator | null>();
  private loading = false;
  /** incrémenté à chaque nettoyage : un chargement terminé après coup n'ajoute rien à la scène */
  private generation = 0;
  private sendAcc = 0;
  /** actions possibles à cet instant (affichées par l'interface) */
  prompts: Prompt[] = [];
  onFeedback: (text: string, kind?: 'info' | 'bad' | 'indice') => void = () => {};
  /** menu de pause ouvert : le personnage ne bouge plus (la partie continue pour les autres) */
  paused = false;

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
  /** arme en main (couteau du tueur, pistolet du shérif) : visible de tous */
  item: HeldItem = null;
  /** dernier tir du joueur (la détonation annoncée par le serveur n'est pas rejouée) */
  private lastShotAt = 0;
  /** corps déjà présents à l'arrivée (couchés d'emblée) ; les autres tombent */
  private bodiesAtJoin = new Set<string>();
  private falls = new Map<string, number>();

  toggleTorch() {
    if (!this.player || !this.alive) return;
    this.torch = !this.torch;
    if (this.torch) this.item = null;
    sfx.torch();
  }

  /** Arme du rôle : couteau (tueur), pistolet (shérif) ; aucune pour les autres. */
  get weapon(): HeldItem {
    const r = net.secret?.role;
    return r === 'tueur' ? 'couteau' : r === 'sherif' ? 'pistolet' : null;
  }

  /** Sortir ou ranger l'arme (touche 2) ; la lampe est rangée quand l'arme sort. */
  toggleWeapon() {
    if (!this.player || !this.alive || !this.weapon) return;
    this.item = this.item ? null : this.weapon;
    if (this.item) this.torch = false;
    sfx.draw();
    this.sendPoseNow();
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
    const gen = this.generation;
    try {
      const ids = Object.keys(g.appearances);
      const bases = await Promise.all(ids.map((id) => loadCharacter(g.appearances[id])));
      if (gen !== this.generation || this.player) return;
      const world = this.village.collision;
      this.bodiesAtJoin = new Set(net.game?.bodies.map((b) => b.id) ?? []);
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
    this.generation++;
    this.player?.dispose();
    this.player = null;
    for (const r of this.remotes.values()) r.anim.dispose();
    this.remotes.clear();
    for (const b of this.bodies.values()) b?.dispose();
    this.bodies.clear();
    this.prompts = [];
    this.torch = false;
    this.item = null;
    this.bodiesAtJoin.clear();
    this.falls.clear();
    this.torches.off();
  }

  /** Personnages en mouvement (sons de pas) : le joueur s'il est vivant, les autres joueurs vivants. */
  walkers() {
    const out: { id: string; x: number; y: number; z: number; grounded: boolean; local: boolean }[] = [];
    const g = net.game;
    if (!g || !this.player) return out;
    const c = this.player.controller;
    if (this.alive) out.push({ id: net.me, x: c.x, y: c.y, z: c.z, grounded: c.grounded, local: true });
    for (const [id, r] of this.remotes) if (g.alive[id]) out.push({ id, x: r.pos.x, y: r.pos.y, z: r.pos.z, grounded: r.grounded, local: false });
    return out;
  }

  private get alive() {
    return !!net.game?.alive[net.me];
  }

  update(dt: number) {
    const g = net.game;
    const p = this.player;
    if (!g || !p) return;
    const playing = g.phase === 'jeu';
    const frozen = !playing || this.paused;
    const m = this.input.takeMouse();
    if (!frozen) this.cam.look(m.dx, m.dy, m.wheel);
    if (!this.paused && this.input.consume('KeyV')) this.cam.toggle(p);
    if (!this.alive || !playing) this.item = null;
    // arme sortie : le corps fait face au regard (pistolet : strictement, pour viser)
    p.aimYaw = this.item === 'pistolet' ? this.cam.yaw : null;
    p.update(dt, readMove(this.input, this.cam, frozen), this.cam.mode === 'subjective' || this.item ? this.cam.yaw : null);
    p.animator.setItem(this.item ?? (this.torch && this.alive ? 'lampe' : null));
    p.animator.aimPitch = this.cam.pitch;
    this.cam.aiming = this.item === 'pistolet';
    document.body.classList.toggle('aiming', this.item === 'pistolet' && this.alive && playing);
    // éliminé : le joueur suit la partie en fantôme (corps invisible, plus aucune position envoyée)
    p.root.visible = this.alive && p.root.visible;
    this.sendAcc += dt;
    if (this.alive && playing && this.sendAcc > 1 / 15) this.sendPoseNow();
    this.updateRemotes(dt);
    this.updateBodies(dt);
    if (!frozen && (this.input.consume('KeyL') || this.input.consume('Digit1'))) this.toggleTorch();
    if (!frozen && this.input.consume('Digit2')) this.toggleWeapon();
    if (!this.alive && this.torch) this.torch = false;
    this.cam.update(dt, p, this.village.collision);
    aimTorch(this.torches, p, this.cam, this.torch && this.alive);
    // faisceaux des autres joueurs (lampe allumée, orientée selon leur regard)
    const beams: { from: THREE.Vector3; dir: THREE.Vector3 }[] = [];
    for (const [id, r] of this.remotes) {
      const t = r.target;
      const alive = !!net.game?.alive[id];
      const on = !!t?.torch && alive;
      r.anim.setItem(alive && t?.item ? t.item : on ? 'lampe' : null);
      r.anim.aimPitch = t?.pitch ?? 0;
      if (on) beams.push({ from: r.anim.handPosition(), dir: lookDir(t!.yaw, t!.pitch) });
    }
    this.torches.setRemotes(beams, p.root.position);
    if (!this.alive) p.root.visible = false;
    this.updatePrompts();
    // clic gauche (souris capturée) : coup de couteau ou tir
    if (!frozen && this.input.consume('Mouse0') && this.item) this.attack();
    for (const pr of this.prompts)
      if (pr.key !== 'Mouse0' && !this.paused && this.input.consume(pr.key))
        pr.action().catch((e: Error) => this.onFeedback(e.message, 'bad'));
  }

  /** Position envoyée tout de suite (avant une action : le serveur voit l'arme sortie et l'orientation). */
  private sendPoseNow() {
    const p = this.player;
    if (!p || !this.alive || net.game?.phase !== 'jeu') return;
    this.sendAcc = 0;
    const c = p.controller;
    net.sendPose({ x: c.x, y: c.y, z: c.z, yaw: p.yaw, speed: Math.hypot(c.realVx, c.realVz), grounded: c.grounded, vy: c.vy, dir: 1, torch: this.torch, pitch: this.cam.pitch, item: this.item });
  }

  /** Cible du couteau : la personne la plus proche, devant soi, à portée (complices exclus). */
  private knifeTarget() {
    const g = net.game!;
    const s = net.secret;
    const p = this.player!;
    let best: { id: string; d: number } | null = null;
    for (const [id, r] of this.remotes) {
      if (!g.alive[id] || s?.allies.includes(id)) continue;
      const dx = r.pos.x - p.controller.x;
      const dz = r.pos.z - p.controller.z;
      const d = Math.hypot(dx, dz);
      if (d > RULES.killRange || Math.abs(r.pos.y - p.controller.y) > 1.5) continue;
      if (d > 0.3 && Math.abs(wrap(Math.atan2(dx, dz) - p.yaw)) > RULES.stabAngle) continue;
      if (!best || d < best.d) best = { id, d };
    }
    return best?.id ?? null;
  }

  /** Cible du pistolet : la personne sur la ligne de visée (centre de l'écran), sans mur entre elle et le canon. */
  private gunTarget() {
    const g = net.game!;
    const cam = this.cam.camera;
    const o = cam.position;
    const dir = cam.getWorldDirection(new THREE.Vector3());
    const muzzle = this.player!.animator.muzzlePosition();
    let best: { id: string; t: number } | null = null;
    for (const [id, r] of this.remotes) {
      if (!g.alive[id]) continue;
      // distance du rayon au corps (segment pieds → tête)
      let hitT = -1;
      for (let h = 0.2; h <= 1.75; h += 0.15) {
        const q = new THREE.Vector3(r.pos.x, r.pos.y + h, r.pos.z).sub(o);
        const t = q.dot(dir);
        if (t <= 0) continue;
        if (q.addScaledVector(dir, -t).length() < 0.32) {
          hitT = t;
          break;
        }
      }
      if (hitT < 0 || Math.hypot(r.pos.x - this.player!.controller.x, r.pos.z - this.player!.controller.z) > RULES.shootRange) continue;
      const chest = new THREE.Vector3(r.pos.x, r.pos.y + 1.3, r.pos.z);
      if (!this.village.collision.lineClear(muzzle.x, muzzle.y, muzzle.z, chest.x, chest.y, chest.z)) continue;
      if (!best || hitT < best.t) best = { id, t: hitT };
    }
    return best?.id ?? null;
  }

  /** Clic avec l'arme en main. */
  private attack() {
    const p = this.player!;
    const s = net.secret;
    if (!s) return;
    this.sendPoseNow();
    if (this.item === 'couteau') {
      p.animator.strike();
      sfx.swing();
      const t = this.knifeTarget();
      if (!t) return;
      const wait = Math.ceil((s.killReadyAt - serverNow()) / 1000);
      if (wait > 0) return this.onFeedback(`Trop tôt : encore ${wait} s avant de pouvoir frapper.`, 'bad');
      net.eliminate(t).then(
        () => sfx.stab(),
        (e: Error) => this.onFeedback(e.message, 'bad'),
      );
    } else if (this.item === 'pistolet') {
      if (s.ammo <= 0) {
        sfx.dryFire();
        return this.onFeedback('Plus de balle.', 'bad');
      }
      p.animator.fire();
      this.lastShotAt = performance.now();
      sfx.gunshot();
      const t = this.gunTarget();
      net.shoot(t).then(
        (r) => this.onFeedback(r.hit ? `Touché : ${net.nameOf(t!)}.` : 'Manqué.', r.hit ? 'info' : 'bad'),
        (e: Error) => this.onFeedback(e.message, 'bad'),
      );
    }
  }

  /** Geste d'un autre joueur vu de près (coup de couteau, tir) : animation de son arme et son. */
  onGesture(g: Gesture) {
    if (g.id === net.me) return;
    const r = this.remotes.get(g.id);
    if (!r || !this.player) return;
    const d = r.pos.distanceTo(this.player.root.position);
    if (g.kind === 'couteau') {
      r.anim.setItem('couteau');
      r.anim.strike();
      sfx.stab(Math.max(0, 1 - d / 20));
    } else {
      r.anim.setItem('pistolet');
      r.anim.fire();
    }
  }

  /** La détonation annoncée par le serveur vient-elle du joueur lui-même (déjà jouée) ? */
  get justShot() {
    return performance.now() - this.lastShotAt < 1500;
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

  /** Corps là où les joueurs sont morts : ils s'effondrent (Rocketbox n'a pas d'animation de mort), puis restent couchés. */
  private updateBodies(dt: number) {
    const g = net.game!;
    for (const b of g.bodies) {
      if (this.bodies.has(b.id)) continue;
      const appearance = g.appearances[b.id];
      const gen = this.generation;
      this.bodies.set(b.id, null);
      // la victime visible tombe depuis l'endroit où on la voyait
      const remote = this.remotes.get(b.id);
      const from = remote?.anim.root.visible ? remote.pos.clone() : null;
      loadCharacter(appearance).then((base) => {
        if (gen !== this.generation || this.bodies.get(b.id) || !net.game) return;
        const anim = new CharacterAnimator(base);
        anim.update(0.016, { speed: 0, direction: 1, turnRate: 0, grounded: true, vy: 0 });
        const y = this.village.collision.groundAt(b.x, b.z, b.y + 0.5);
        anim.root.position.set(b.x, y + 0.12, b.z);
        anim.root.rotation.set(-Math.PI / 2, b.yaw, 0, 'YXZ');
        if (!this.bodiesAtJoin.has(b.id) && from) {
          anim.root.rotation.set(0, b.yaw, 0, 'YXZ');
          anim.root.position.set(b.x, y, b.z);
          this.falls.set(b.id, 0);
        }
        this.scene.add(anim.root);
        this.bodies.set(b.id, anim);
      }, (e: Error) => this.onFeedback(`Corps non affiché (modèle introuvable) : ${e.message}`, 'bad'));
    }
    for (const [id, t] of this.falls) {
      const a = this.bodies.get(id);
      if (!a) continue;
      const nt = Math.min(1, t + dt / 0.75);
      this.falls.set(id, nt);
      // chute : le corps bascule en arrière, de plus en plus vite, puis rebondit à peine
      const k = nt * nt;
      const b = g.bodies.find((x) => x.id === id);
      const ground = b ? this.village.collision.groundAt(b.x, b.z, b.y + 0.5) : a.root.position.y;
      a.root.rotation.x = (-Math.PI / 2) * k;
      a.root.position.y = ground + 0.12 * k;
      if (nt >= 1) this.falls.delete(id);
    }
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
      const near = others.find((o) => !s.allies.includes(o.id) && o.d <= RULES.killRange);
      const wait = Math.ceil((s.killReadyAt - serverNow()) / 1000);
      if (this.item === 'couteau') {
        const t = this.knifeTarget();
        if (t) this.prompts.push({ key: 'Mouse0', label: wait > 0 ? `Poignarder ${name(t)} (dans ${wait} s)` : `Poignarder ${name(t)}`, waiting: wait > 0, action: async () => {} });
      } else if (near) this.prompts.push({ key: 'Digit2', label: `Sortir le couteau (${name(near.id)} à portée)`, action: async () => this.toggleWeapon() });
    }
    if (s.role === 'sherif' && this.item === 'pistolet') {
      const t = this.gunTarget();
      const balles = `${s.ammo} balle${s.ammo > 1 ? 's' : ''}`;
      this.prompts.push({ key: 'Mouse0', label: s.ammo <= 0 ? 'Plus de balle' : t ? `Tirer sur ${name(t)} (${balles})` : `Tirer (${balles})`, waiting: s.ammo <= 0 || !t, action: async () => {} });
    }
    if (s.role === 'detective' && s.investigations > 0) {
      const t = others.find((o) => o.d <= RULES.investigateRange);
      if (t)
        this.prompts.push({
          key: 'KeyR',
          label: `Enquêter sur ${name(t.id)}`,
          action: () => net.investigate(t.id).then((r) => this.onFeedback(`Indice — votre enquête : ${name(t.id)} ${r.killer ? 'EST un tueur.' : 'n’est pas un tueur.'}`, 'indice')),
        });
    }
    const body = g.bodies.find((b) => !b.reported && Math.hypot(b.x - me.x, b.z - me.z) <= RULES.reportRange);
    if (body) this.prompts.push({ key: 'KeyT', label: `Signaler le corps de ${name(body.id)}`, action: () => net.report(body.id) });
    if (s.emergencyLeft > 0) this.prompts.push({ key: 'KeyU', label: 'Réunion d’urgence', action: () => net.emergency() });
  }
}

/** Horloge du serveur (les délais sont des horodatages serveur), corrigée de l'écart mesuré. */
export const serverNow = () => net.serverNow();
