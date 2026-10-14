/**
 * Partie Gunfight dans la scène : le personnage du joueur (pistolet en main, couteau sur la touche 2), les autres
 * joueurs (positions reçues, interpolées) ou les robots du mode solo (pilotés ici avec le même contrôleur que le
 * joueur), les tirs (recul, éclair, traçante, son localisé), la chute des joueurs éliminés et les réapparitions.
 * Le serveur — ou la salle locale en solo — décide de chaque dégât.
 */
import * as THREE from 'three';
import { loadCharacter } from '../characters/assets';
import { CharacterAnimator } from '../characters/animator';
import { PlayerCamera } from '../characters/camera';
import { Character } from '../characters/character';
import { readMove } from '../characters/game';
import type { MoveInput } from '../characters/controller';
import type { Input } from '../input';
import type { Village } from '../village/village';
import type { PlayerPose } from '../shared/protocol';
import { GF_RULES, SPAWNS, type GFShot, type Team } from '../shared/gunfight';
import { sfx } from '../audio/sfx';
import { LocalGF, type GFClient } from './gfNet';

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const TEAM_COLOR: Record<Team, string> = { rouge: '#e0574a', bleu: '#5a9be6' };

interface Remote {
  anim: CharacterAnimator;
  pos: THREE.Vector3;
  yaw: number;
  target: PlayerPose | null;
  grounded: boolean;
  tag: THREE.Sprite;
  fall: number;
}

interface Bot {
  ch: Character;
  tag: THREE.Sprite;
  spawnN: number;
  target: string | null;
  waypoint: [number, number];
  stuck: number;
  nextShot: number;
  strafe: number;
  fall: number;
  thinkAt: number;
}

function nameTag(text: string, color: string) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 48;
  const g = c.getContext('2d')!;
  g.font = 'bold 26px Cinzel, Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 5;
  g.strokeStyle = 'rgba(0,0,0,0.75)';
  g.strokeText(text, 128, 24);
  g.fillStyle = color;
  g.fillText(text, 128, 24);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true }));
  s.scale.set(1.6, 0.3, 1);
  s.renderOrder = 5;
  return s;
}

export class GunfightGame {
  readonly cam: PlayerCamera;
  player: Character | null = null;
  private remotes = new Map<string, Remote>();
  private bots = new Map<string, Bot>();
  private loading = false;
  private generation = 0;
  private sendAcc = 0;
  private spawnN = 0;
  private tracers: { line: THREE.Line; life: number }[] = [];
  private fallMe = 0;
  item: 'pistolet' | 'couteau' = 'pistolet';
  paused = false;
  client: GFClient | null = null;
  /** retour visuel (marqueur de touche, élimination, dégâts) pour l'interface */
  onHitMarker: (killed: boolean) => void = () => {};
  onDamaged: () => void = () => {};
  onFeedback: (text: string) => void = () => {};

  constructor(
    readonly village: Village,
    readonly scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    readonly input: Input,
  ) {
    this.cam = new PlayerCamera(camera);
  }

  attach(client: GFClient) {
    this.dispose();
    this.client = client;
    client.onShot = (s) => this.onShot(s);
  }

  get alive() {
    const c = this.client;
    return !!c?.game?.players[c.me]?.alive;
  }

  private teamOf(id: string): Team | null {
    return this.client?.game?.teams[id] ?? null;
  }
  private isEnemy(id: string) {
    const g = this.client?.game;
    if (!g || id === this.client!.me) return false;
    return g.settings.mode === 'ffa' || this.teamOf(id) !== this.teamOf(this.client!.me);
  }
  private tagColor(id: string) {
    const t = this.teamOf(id);
    return t ? TEAM_COLOR[t] : '#f0d9a6';
  }

  /** Crée les personnages (apparences tirées par la salle). */
  async ensure() {
    const c = this.client;
    const g = c?.game;
    if (!c || !g || this.player || this.loading) return;
    this.loading = true;
    const gen = this.generation;
    try {
      const ids = Object.keys(g.appearances);
      const bases = await Promise.all(ids.map((id) => loadCharacter(g.appearances[id])));
      if (gen !== this.generation || this.player) return;
      const world = this.village.collision;
      const local = c instanceof LocalGF ? c : null;
      ids.forEach((id, i) => {
        const sp = g.players[id]?.spawn ?? { x: 0, z: 0, yaw: 0, n: 0 };
        if (id === c.me) {
          this.player = new Character(id, bases[i], world, sp.x, sp.z, sp.yaw);
          this.scene.add(this.player.root);
          this.cam.yaw = sp.yaw;
          this.cam.pitch = -0.1;
          this.spawnN = sp.n;
          if (this.cam.mode === 'subjective') this.player.animator.setFirstPerson(true);
        } else if (local?.bots.includes(id)) {
          const ch = new Character(id, bases[i], world, sp.x, sp.z, sp.yaw);
          const tag = nameTag(c.nameOf(id), this.tagColor(id));
          ch.root.add(tag);
          tag.position.y = ch.height + 0.35;
          this.scene.add(ch.root);
          this.bots.set(id, { ch, tag, spawnN: sp.n, target: null, waypoint: SPAWNS[Math.floor(Math.random() * SPAWNS.length)], stuck: 0, nextShot: 0, strafe: Math.random() * 6, fall: 0, thinkAt: 0 });
        } else {
          const anim = new CharacterAnimator(bases[i]);
          const y = world.groundAt(sp.x, sp.z, 1e6);
          anim.root.position.set(sp.x, y, sp.z);
          const tag = nameTag(c.nameOf(id), this.tagColor(id));
          anim.root.add(tag);
          tag.position.y = (bases[i].variant.heightM ?? 1.75) + 0.35;
          this.scene.add(anim.root);
          this.remotes.set(id, { anim, pos: new THREE.Vector3(sp.x, y, sp.z), yaw: sp.yaw, target: null, grounded: true, tag, fall: 0 });
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
    for (const b of this.bots.values()) b.ch.dispose();
    this.bots.clear();
    for (const t of this.tracers) t.line.removeFromParent();
    this.tracers = [];
    document.body.classList.remove('aiming');
  }

  /** Personnages en mouvement (sons de pas). */
  walkers() {
    const out: { id: string; x: number; y: number; z: number; grounded: boolean; local: boolean }[] = [];
    const c = this.client;
    if (!c?.game || !this.player) return out;
    const p = this.player.controller;
    if (this.alive) out.push({ id: c.me, x: p.x, y: p.y, z: p.z, grounded: p.grounded, local: true });
    for (const [id, r] of this.remotes) if (c.game.players[id]?.alive) out.push({ id, x: r.pos.x, y: r.pos.y, z: r.pos.z, grounded: r.grounded, local: false });
    for (const [id, b] of this.bots) if (c.game.players[id]?.alive) out.push({ id, x: b.ch.controller.x, y: b.ch.controller.y, z: b.ch.controller.z, grounded: b.ch.controller.grounded, local: false });
    return out;
  }

  private placeAt(ch: Character, x: number, z: number) {
    const w = this.village.collision;
    const c = ch.controller;
    c.x = x;
    c.z = z;
    c.y = w.groundAt(x, z, w.groundAt(x, z, 1e6) + 0.1);
    if (!Number.isFinite(c.y)) c.y = 0;
    c.vx = c.vz = c.vy = 0;
    c.grounded = true;
  }

  update(dt: number) {
    const c = this.client;
    const g = c?.game;
    const p = this.player;
    if (!c || !g || !p) return;
    const me = g.players[c.me];
    const playing = g.phase === 'jeu';
    // réapparition décidée par la salle : on se place au point donné
    if (me && me.spawn.n !== this.spawnN) {
      this.spawnN = me.spawn.n;
      this.placeAt(p, me.spawn.x, me.spawn.z);
      p.yaw = me.spawn.yaw;
      this.cam.yaw = me.spawn.yaw;
      p.root.rotation.x = 0;
      this.fallMe = 0;
      this.item = 'pistolet';
    }
    const alive = !!me?.alive;
    const frozen = !playing || this.paused || !alive;
    const m = this.input.takeMouse();
    if (!this.paused) this.cam.look(m.dx, m.dy, m.wheel);
    if (!this.paused && this.input.consume('KeyV')) this.cam.toggle(p);
    if (!frozen && this.input.consume('Digit1')) this.switchTo('pistolet');
    if (!frozen && this.input.consume('Digit2')) this.switchTo('couteau');
    if (!frozen && this.input.consume('KeyR')) this.reload();
    if (alive) {
      p.update(dt, readMove(this.input, this.cam, frozen), this.cam.yaw);
      if (this.item === 'pistolet') p.yaw = this.cam.yaw;
      p.root.visible = true;
    } else {
      // à terre : le corps bascule, la caméra reste
      this.fallMe = Math.min(1, this.fallMe + dt / 0.6);
      p.root.rotation.x = (-Math.PI / 2) * this.fallMe * this.fallMe;
    }
    p.animator.setItem(alive ? this.item : null);
    p.animator.aimPitch = this.cam.pitch;
    this.cam.aiming = alive && this.item === 'pistolet';
    document.body.classList.toggle('aiming', alive && playing && this.item === 'pistolet' && !this.paused);
    this.sendAcc += dt;
    if (alive && playing && this.sendAcc > 1 / 15) this.sendPoseNow();
    if (!frozen && this.input.consume('Mouse0')) this.attack();
    this.updateRemotes(dt);
    if (c instanceof LocalGF) this.updateBots(dt, c);
    this.cam.update(dt, p, this.village.collision);
    for (const t of this.tracers) {
      t.life -= dt;
      (t.line.material as THREE.LineBasicMaterial).opacity = Math.max(0, t.life / 0.12);
    }
    this.tracers = this.tracers.filter((t) => (t.life > 0 ? true : (t.line.removeFromParent(), false)));
  }

  private switchTo(item: 'pistolet' | 'couteau') {
    if (this.item === item) return;
    this.item = item;
    sfx.draw();
    this.sendPoseNow();
  }

  private sendPoseNow() {
    const p = this.player;
    const c = this.client;
    if (!p || !c) return;
    this.sendAcc = 0;
    const k = p.controller;
    c.sendPose({ x: k.x, y: k.y, z: k.z, yaw: p.yaw, speed: Math.hypot(k.realVx, k.realVz), grounded: k.grounded, vy: k.vy, dir: 1, torch: false, pitch: this.cam.pitch, item: this.item });
  }

  private reload() {
    const me = this.client?.game?.players[this.client.me];
    if (!me || me.ammo >= GF_RULES.magazine || me.reloadUntil) return;
    sfx.draw();
    this.client!.reload().catch(() => {});
  }

  /** Point visé : premier obstacle sur le rayon de la caméra (traçante), à 45 m au plus. */
  private aimPoint(): THREE.Vector3 {
    const cam = this.cam.camera;
    const dir = cam.getWorldDirection(new THREE.Vector3());
    const o = cam.position.clone();
    const w = this.village.collision;
    for (let d = 1; d < GF_RULES.range; d += 0.75) {
      const q = o.clone().addScaledVector(dir, d);
      if (w.blocksPoint(q.x, q.y, q.z, 0)) return q;
    }
    return o.addScaledVector(dir, GF_RULES.range);
  }

  /** Adversaire sous le viseur (rayon de la caméra contre le corps), sans mur entre le canon et lui. */
  private aimedEnemy(): string | null {
    const cam = this.cam.camera;
    const o = cam.position;
    const dir = cam.getWorldDirection(new THREE.Vector3());
    const muzzle = this.player!.animator.muzzlePosition();
    const g = this.client!.game!;
    let best: { id: string; t: number } | null = null;
    const consider = (id: string, pos: THREE.Vector3) => {
      if (!g.players[id]?.alive || !this.isEnemy(id)) return;
      for (let hgt = 0.2; hgt <= 1.75; hgt += 0.15) {
        const q = new THREE.Vector3(pos.x, pos.y + hgt, pos.z).sub(o);
        const t = q.dot(dir);
        if (t <= 0) continue;
        if (q.addScaledVector(dir, -t).length() < 0.33) {
          const pc = this.player!.controller;
          if (Math.hypot(pos.x - pc.x, pos.z - pc.z) > GF_RULES.range) return;
          if (!this.village.collision.lineClear(muzzle.x, muzzle.y, muzzle.z, pos.x, pos.y + 1.3, pos.z)) return;
          if (!best || t < best.t) best = { id, t };
          return;
        }
      }
    };
    for (const [id, r] of this.remotes) consider(id, r.pos);
    for (const [id, b] of this.bots) consider(id, b.ch.root.position);
    return (best as { id: string } | null)?.id ?? null;
  }

  private knifeTarget(): string | null {
    const p = this.player!;
    const g = this.client!.game!;
    let best: { id: string; d: number } | null = null;
    const consider = (id: string, pos: THREE.Vector3) => {
      if (!g.players[id]?.alive || !this.isEnemy(id)) return;
      const dx = pos.x - p.controller.x;
      const dz = pos.z - p.controller.z;
      const d = Math.hypot(dx, dz);
      if (d > GF_RULES.knifeRange || Math.abs(pos.y - p.controller.y) > 1.5) return;
      if (d > 0.3 && Math.abs(wrap(Math.atan2(dx, dz) - p.yaw)) > GF_RULES.knifeAngle) return;
      if (!best || d < best.d) best = { id, d };
    };
    for (const [id, r] of this.remotes) consider(id, r.pos);
    for (const [id, b] of this.bots) consider(id, b.ch.root.position);
    return (best as { id: string } | null)?.id ?? null;
  }

  private attack() {
    const c = this.client!;
    const me = c.game!.players[c.me];
    const p = this.player!;
    this.sendPoseNow();
    if (this.item === 'couteau') {
      p.animator.strike();
      sfx.swing();
      const t = this.knifeTarget();
      if (t) c.stab(t).then((r) => r.hit && this.hit(r.killed), () => {});
      return;
    }
    if (me.reloadUntil) return;
    if (me.ammo <= 0) {
      sfx.dryFire();
      this.reload();
      return;
    }
    const t = this.aimedEnemy();
    const aim = this.aimPoint();
    c.shoot(t, [aim.x, aim.y, aim.z]).then(
      (r) => {
        if (r.hit) this.hit(r.killed);
        const left = c.game?.players[c.me]?.ammo ?? 1;
        if (left <= 0) this.reload();
      },
      (e: Error) => {
        if (/vide/.test(e.message)) this.reload();
      },
    );
  }

  private hit(killed: boolean) {
    this.onHitMarker(killed);
    if (killed) sfx.notify();
    else sfx.vote();
  }

  /** Tir vu de tous : recul et éclair du tireur, traçante, son atténué avec la distance, dégâts reçus. */
  private onShot(s: GFShot) {
    const c = this.client;
    if (!c) return;
    const me = c.me;
    const shooterAnim = s.by === me ? this.player?.animator : (this.remotes.get(s.by)?.anim ?? this.bots.get(s.by)?.ch.animator);
    if (s.weapon === 'pistolet') {
      shooterAnim?.fire();
      const from = s.by === me && this.player ? this.player.animator.muzzlePosition() : new THREE.Vector3(...s.from);
      const geo = new THREE.BufferGeometry().setFromPoints([from, new THREE.Vector3(...s.to)]);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: '#ffe0a0', transparent: true, opacity: 1 }));
      this.scene.add(line);
      this.tracers.push({ line, life: 0.12 });
      const pp = this.player?.root.position;
      const d = pp ? pp.distanceTo(new THREE.Vector3(...s.from)) : 0;
      if (s.by === me || d < 140) sfx.gunshotAt(Math.max(0.08, 1 - d / 140));
    } else shooterAnim?.strike();
    if (s.hit === me) {
      this.onDamaged();
      sfx.stab(0.8);
    }
  }

  private updateRemotes(dt: number) {
    const c = this.client!;
    const g = c.game!;
    for (const [id, r] of this.remotes) {
      const st = g.players[id];
      const pose = c.poses[id];
      if (!st?.alive) {
        // éliminé : il s'effondre, puis disparaît jusqu'à sa réapparition
        r.fall = Math.min(1, r.fall + dt / 0.6);
        r.anim.root.rotation.x = (-Math.PI / 2) * r.fall * r.fall;
        r.tag.visible = false;
        r.target = null;
        continue;
      }
      if (r.fall > 0) {
        r.fall = 0;
        r.anim.root.rotation.x = 0;
        if (pose) r.pos.set(pose.x, pose.y, pose.z);
      }
      r.tag.visible = true;
      if (pose) r.target = pose;
      const t = r.target;
      if (!t) continue;
      const k = Math.min(1, dt * 12);
      const before = r.pos.clone();
      r.pos.x += (t.x - r.pos.x) * k;
      r.pos.z += (t.z - r.pos.z) * k;
      r.pos.y += (t.y - r.pos.y) * Math.min(1, dt * (t.grounded ? 14 : 25));
      if (r.pos.distanceTo(new THREE.Vector3(t.x, t.y, t.z)) > 6) r.pos.set(t.x, t.y, t.z);
      const step = wrap(t.yaw - r.yaw) * Math.min(1, dt * 12);
      r.yaw = wrap(r.yaw + step);
      if (r.grounded && !t.grounded) r.anim.onJump();
      if (!r.grounded && t.grounded) r.anim.onLand(6);
      r.grounded = t.grounded;
      r.anim.setItem(t.item ?? 'pistolet');
      r.anim.aimPitch = t.pitch;
      const moved = Math.hypot(r.pos.x - before.x, r.pos.z - before.z) / Math.max(dt, 1e-3);
      r.anim.update(dt, { speed: Math.min(t.speed, moved * 1.2 + 0.05), direction: t.dir, turnRate: step / Math.max(dt, 1e-3), grounded: t.grounded, vy: t.vy });
      r.anim.root.position.copy(r.pos);
      r.anim.root.rotation.y = r.yaw;
    }
  }

  // ───────────────────────── robots (solo) ─────────────────────────

  /**
   * Robots : ils cherchent l'adversaire visible le plus proche, s'en approchent à bonne distance en se décalant
   * de côté, tirent quand ils visent juste (précision et cadence selon la difficulté), rechargent, et sinon
   * patrouillent de point en point. Leurs tirs passent par la même salle que ceux du joueur.
   */
  private updateBots(dt: number, c: LocalGF) {
    const g = c.game!;
    const world = this.village.collision;
    const diff = c.opts.difficulty;
    const accuracy = diff === 'facile' ? 0.3 : diff === 'normal' ? 0.5 : 0.72;
    const delay = diff === 'facile' ? 1.1 : diff === 'normal' ? 0.75 : 0.5;
    const reaction = diff === 'facile' ? 0.9 : diff === 'normal' ? 0.55 : 0.3;
    const now = performance.now() / 1000;
    const positions = new Map<string, THREE.Vector3>();
    if (this.player && g.players[c.me]?.alive) positions.set(c.me, this.player.root.position);
    for (const [id, b] of this.bots) if (g.players[id]?.alive) positions.set(id, b.ch.root.position);
    for (const [id, b] of this.bots) {
      const st = g.players[id];
      const ch = b.ch;
      if (!st) continue;
      if (st.spawn.n !== b.spawnN) {
        b.spawnN = st.spawn.n;
        this.placeAt(ch, st.spawn.x, st.spawn.z);
        ch.yaw = st.spawn.yaw;
        ch.root.rotation.x = 0;
        b.fall = 0;
        b.target = null;
        b.thinkAt = now + reaction;
      }
      if (!st.alive) {
        b.fall = Math.min(1, b.fall + dt / 0.6);
        ch.root.rotation.x = (-Math.PI / 2) * b.fall * b.fall;
        b.tag.visible = false;
        continue;
      }
      b.tag.visible = true;
      const pos = ch.root.position;
      const chest = (v: THREE.Vector3) => [v.x, v.y + 1.3, v.z] as const;
      // cible : adversaire visible le plus proche (réévaluée régulièrement)
      if (now >= b.thinkAt) {
        b.thinkAt = now + 0.4;
        let best: { id: string; d: number } | null = null;
        for (const [oid, op] of positions) {
          if (oid === id) continue;
          const enemy = g.settings.mode === 'ffa' || g.teams[oid] !== g.teams[id];
          if (!enemy) continue;
          const d = pos.distanceTo(op);
          if (d > GF_RULES.range * 0.9) continue;
          if (!world.lineClear(...chest(pos), ...chest(op))) continue;
          if (!best || d < best.d) best = { id: oid, d };
        }
        if (best && best.id !== b.target) b.nextShot = now + reaction;
        b.target = best?.id ?? null;
      }
      const tp = b.target ? positions.get(b.target) : undefined;
      let cmd: MoveInput = { x: 0, z: 0, run: false, jump: false };
      let look: number | null = null;
      if (tp) {
        const dx = tp.x - pos.x;
        const dz = tp.z - pos.z;
        const d = Math.hypot(dx, dz);
        look = Math.atan2(dx, dz);
        b.strafe += dt;
        const side = Math.sin(b.strafe * 1.3) > 0 ? 1 : -1;
        const fwd = d > 16 ? 1 : d < 6 ? -1 : 0;
        cmd = { x: (dx / d) * fwd + (-dz / d) * side * 0.8, z: (dz / d) * fwd + (dx / d) * side * 0.8, run: d > 20, jump: false };
        const ln = Math.hypot(cmd.x, cmd.z);
        if (ln > 1) {
          cmd.x /= ln;
          cmd.z /= ln;
        }
        if (st.reloadUntil) {
          // à couvert pendant le rechargement : il recule
          cmd = { x: -dx / d, z: -dz / d, run: true, jump: false };
        } else if (st.ammo <= 0) c.room.reload(id);
        else if (now >= b.nextShot && Math.abs(wrap(look - ch.yaw)) < 0.25) {
          b.nextShot = now + delay * (0.7 + Math.random() * 0.6);
          const hitIt = Math.random() < accuracy * (d < 10 ? 1.2 : d > 30 ? 0.6 : 1);
          try {
            c.room.shoot(id, hitIt ? b.target : null, [tp.x + (Math.random() - 0.5) * 2, tp.y + 1 + Math.random(), tp.z + (Math.random() - 0.5) * 2]);
          } catch {
            /* cadence, rechargement : il réessaiera */
          }
        }
      } else {
        // patrouille de point d'apparition en point d'apparition
        const [wx, wz] = b.waypoint;
        const dx = wx - pos.x;
        const dz = wz - pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 2.5 || b.stuck > 1.2) {
          b.waypoint = SPAWNS[Math.floor(Math.random() * SPAWNS.length)];
          b.stuck = 0;
        } else cmd = { x: dx / d, z: dz / d, run: d > 12, jump: ch.controller.blocked && Math.random() < 0.02 };
        if (st.ammo < GF_RULES.magazine && !st.reloadUntil) c.room.reload(id);
      }
      ch.update(dt, cmd, look);
      if (look !== null) ch.yaw = wrap(ch.yaw + wrap(look - ch.yaw) * Math.min(1, dt * 8));
      b.stuck = ch.controller.blocked && Math.hypot(cmd.x, cmd.z) > 0 ? b.stuck + dt : Math.max(0, b.stuck - dt);
      ch.animator.setItem('pistolet');
      ch.animator.aimPitch = 0;
      const k = ch.controller;
      c.room.pose(id, { x: k.x, y: k.y, z: k.z, yaw: ch.yaw, speed: Math.hypot(k.realVx, k.realVz), grounded: k.grounded, vy: k.vy, dir: 1, torch: false, pitch: 0, item: 'pistolet' });
    }
  }
}
