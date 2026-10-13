/**
 * Animation d'un personnage Rocketbox à partir de l'état de son contrôleur.
 *
 * Locomotion : les trois cycles « en place » (marche lente, marche rapide, course) jouent ensemble, pondérés
 * selon la vitesse RÉELLE, sur une phase commune (même pied en avant au même instant). La cadence est
 * recalculée à chaque image pour que la foulée corresponde exactement à la distance parcourue :
 *   cycles par seconde = vitesse / (vitesse sans glissement du clip × durée du clip).
 * Aucun clip n'est redémarré pendant le mouvement ; démarrage, accélération, ralentissement et arrêt sont des
 * variations continues de poids et de cadence (fondus explicites, sans coupure au milieu d'une foulée).
 *
 * Saut (aucune animation de saut dans Rocketbox) : impulsion et amorti joués avec le clip capturé
 * « accroupi » à poids partiel, pose aérienne procédurale (jambes repliées à la montée, tendues vers le sol
 * à la descente) par-dessus la foulée figée.
 */
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { ANIM, JUMP } from './config';
import { LOCOMOTION, type CharacterBase } from './assets';
import { applyPose, bipedRig, type Pose, type Rig } from './pose';

export interface AnimInput {
  /** vitesse horizontale réelle (m/s) */
  speed: number;
  /** +1 : le corps avance dans le sens de la marche ; -1 : il recule (cycle joué à l'envers) */
  direction: 1 | -1;
  /** vitesse de rotation du corps (rad/s), positive vers la gauche */
  turnRate: number;
  grounded: boolean;
  vy: number;
}

let blobGeo: THREE.CircleGeometry | null = null;
let blobMat: THREE.MeshBasicMaterial | null = null;

export class CharacterAnimator {
  /** racine à placer et orienter dans le monde (+z = avant du personnage) */
  readonly root = new THREE.Group();
  readonly model: THREE.Group;
  /** os de la tête (caméra subjective) */
  readonly head: THREE.Object3D;
  /** échelle appliquée au modèle */
  readonly scale: number;
  /** vitesses sans glissement des cycles, à l'échelle de CE personnage */
  readonly clipSpeeds: Record<(typeof LOCOMOTION)[number], number>;
  private mixer: THREE.AnimationMixer;
  private idle: THREE.AnimationAction;
  private idle2: THREE.AnimationAction | null;
  private crouch: THREE.AnimationAction | null;
  private loco: { a: THREE.AnimationAction; speed: number; offset: number; w: number }[];
  private rig: Rig;
  private phase = Math.random();
  private speedS = 0;
  private air = 0;
  private takeoff = 0;
  private land = 0;
  private landAmount = 0;
  private idleTime = 0;
  private idleAlt = 0;
  private lean = 0;
  private headMeshes: THREE.Object3D[] = [];
  private blob: THREE.Mesh;

  constructor(readonly base: CharacterBase) {
    this.model = cloneSkinned(base.scene) as THREE.Group;
    this.scale = base.variant.heightM / base.height;
    this.model.scale.setScalar(this.scale);
    this.root.name = `personnage:${base.variant.id}`;
    this.root.add(this.model);
    blobGeo ??= new THREE.CircleGeometry(0.34, 24);
    blobMat ??= new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.32, depthWrite: false });
    this.blob = new THREE.Mesh(blobGeo, blobMat);
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.position.y = 0.015;
    this.blob.renderOrder = 1;
    this.root.add(this.blob);

    let head: THREE.Object3D = this.model;
    this.model.traverse((o) => {
      if (o.name === 'Head') head = o;
      const m = o as THREE.Mesh;
      if (m.isMesh && ['head', 'hair', 'glasses'].includes((m.material as THREE.Material).name)) this.headMeshes.push(m);
    });
    this.head = head;
    this.rig = bipedRig(this.model);

    this.mixer = new THREE.AnimationMixer(this.model);
    const action = (name: string) => {
      const clip = base.clips.get(name);
      if (!clip) return null;
      const a = this.mixer.clipAction(clip);
      a.play();
      a.setEffectiveWeight(0);
      return a;
    };
    this.idle = action('idle')!;
    this.idle.setEffectiveWeight(1);
    this.idle.time = Math.random() * this.idle.getClip().duration;
    this.idle2 = action('idle2');
    this.crouch = action('crouch');
    if (this.crouch) {
      // posture accroupie figée (le clip boucle sur un accroupissement tenu)
      this.crouch.timeScale = 0;
      this.crouch.time = Math.min(1.2, this.crouch.getClip().duration * 0.15);
    }
    const k = base.stride * this.scale;
    this.clipSpeeds = { walk_slow: base.speed.walk_slow * k, walk: base.speed.walk * k, run: base.speed.run * k };
    this.loco = LOCOMOTION.map((n) => ({ a: action(n)!, speed: this.clipSpeeds[n], offset: base.phase[n] ?? 0, w: 0 }));
    // le temps des cycles est piloté à la main (phase commune) : pas de lecture automatique
    for (const l of this.loco) l.a.timeScale = 0;
  }

  /** Décollage : l'impulsion part d'une légère flexion. */
  onJump() {
    this.takeoff = 1;
    this.land = 0;
  }

  /** Atterrissage : amorti proportionnel à la vitesse de chute. */
  onLand(impact: number) {
    this.landAmount = THREE.MathUtils.clamp(impact / 9, 0.25, 0.85);
    this.land = 1;
  }

  /** Vue subjective : tête, cheveux et lunettes masqués (le corps et ses animations restent). */
  setFirstPerson(on: boolean) {
    for (const m of this.headMeshes) m.visible = !on;
    this.blob.visible = !on;
  }

  update(dt: number, s: AnimInput) {
    // vitesse lissée (évite les à-coups quand le personnage frôle un obstacle)
    this.speedS += (s.speed - this.speedS) * Math.min(1, dt * ANIM.speedSmoothing);
    const speed = this.speedS;

    // ── phases du saut ──
    const targetAir = s.grounded ? 0 : 1;
    this.air += (targetAir - this.air) * Math.min(1, dt / (s.grounded ? 0.07 : ANIM.airFade));
    this.takeoff = Math.max(0, this.takeoff - dt / ANIM.takeoffTime);
    this.land = Math.max(0, this.land - dt / ANIM.landTime);

    // ── locomotion : poids selon la vitesse, phase commune, cadence calée sur la vitesse réelle ──
    const [s1, s2, s3] = [this.loco[0].speed, this.loco[1].speed, this.loco[2].speed];
    let ws = 0;
    let ww = 0;
    let wr = 0;
    if (speed <= s1) ws = 1;
    else if (speed <= s2) {
      ww = (speed - s1) / (s2 - s1);
      ws = 1 - ww;
    } else {
      wr = THREE.MathUtils.clamp((speed - s2 * 1.05) / (s3 - s2 * 1.05), 0, 1);
      ww = 1 - wr;
    }
    const moving = THREE.MathUtils.smoothstep(speed, ANIM.idleBelow, ANIM.movingAbove) * (1 - this.air * 0.55);
    const k = Math.min(1, dt * ANIM.locomotionBlend);
    const targets = [ws * moving, ww * moving, wr * moving];
    let sumW = 0;
    let freq = 0;
    this.loco.forEach((l, i) => {
      l.w += (targets[i] - l.w) * k;
      sumW += l.w;
      freq += l.w * (Math.max(speed, 0.25) / l.speed / l.a.getClip().duration);
    });
    if (sumW > 1e-3) {
      // en l'air, la foulée se fige presque (les jambes ne « courent » pas dans le vide)
      const f = (freq / sumW) * (1 - this.air * 0.9);
      this.phase = (((this.phase + s.direction * dt * f) % 1) + 1) % 1;
    }
    for (const l of this.loco) {
      l.a.setEffectiveWeight(l.w);
      l.a.time = ((this.phase + l.offset) % 1) * l.a.getClip().duration;
    }
    const locoW = Math.min(1, sumW);

    // ── flexion d'impulsion et d'amorti (clip « accroupi » à poids partiel) ──
    const crouchW = Math.max(this.takeoff * 0.45, Math.sin(Math.PI * Math.min(1, (1 - this.land) * 1.15)) * this.landAmount * (this.land > 0 ? 1 : 0));
    this.crouch?.setEffectiveWeight(crouchW);

    // ── attente : posture neutre, parfois un regard alentour ──
    const idleW = Math.max(0, 1 - locoW - crouchW);
    if (locoW < 0.05 && s.grounded) this.idleTime += dt;
    else this.idleTime = 0;
    if (this.idle2) {
      const want = this.idleTime > 7 && this.idleTime % 18 < this.idle2.getClip().duration ? 1 : 0;
      if (want && this.idleAlt === 0) this.idle2.time = 0;
      this.idleAlt += (want - this.idleAlt) * Math.min(1, dt / ANIM.idleFade);
      this.idle2.setEffectiveWeight(idleW * this.idleAlt);
    }
    this.idle.setEffectiveWeight(idleW * (1 - this.idleAlt));
    this.mixer.update(dt);

    // ── couches procédurales : pose aérienne, inclinaison dans les virages ──
    const pose: Pose = {};
    if (this.air > 0.01) {
      const v0 = Math.sqrt(2 * JUMP.gravity * JUMP.height);
      const rise = THREE.MathUtils.clamp(s.vy / v0, -1, 1); // 1 = décollage, -1 = chute
      const tuck = THREE.MathUtils.clamp(0.55 + rise * 0.45, 0, 1); // jambes repliées en montée, tendues en chute
      const a = this.air;
      pose.RightUpLeg = { bend: -0.62 * tuck * a };
      pose.LeftUpLeg = { bend: -0.3 * tuck * a };
      pose.RightLeg = { bend: 1.0 * tuck * a };
      pose.LeftLeg = { bend: 0.55 * tuck * a };
      pose.RightArm = { bend: (-0.35 + 0.25 * (1 - tuck)) * a, side: 0.12 * a };
      pose.LeftArm = { bend: (-0.25 + 0.2 * (1 - tuck)) * a, side: -0.12 * a };
      pose.Spine = { bend: 0.08 * tuck * a };
    }
    const leanTarget = THREE.MathUtils.clamp(-s.turnRate * speed * ANIM.turnLean, -0.14, 0.14) * (s.grounded ? 1 : 0.3);
    this.lean += (leanTarget - this.lean) * Math.min(1, dt * 8);
    if (Math.abs(this.lean) > 0.002) pose.Spine1 = { ...pose.Spine1, side: this.lean };
    applyPose(this.rig, this.root, pose);

    // enfoncement du bassin à l'atterrissage (le corps encaisse le choc)
    this.model.position.y = -ANIM.landDip * crouchW * 0.6;
  }

  /** Vitesse de lecture effective des jambes, pour les contrôles (cycles par seconde). */
  get cadence() {
    let w = 0;
    let f = 0;
    for (const l of this.loco) {
      w += l.w;
      f += l.w * (Math.max(this.speedS, 0.25) / l.speed / l.a.getClip().duration);
    }
    return w > 1e-3 ? f / w : 0;
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    this.root.removeFromParent();
  }
}
