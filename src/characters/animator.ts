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
import { torchModel } from './flashlight';
import { gunRig, knifeModel, type GunKind, type GunRig } from './weapons';
import { setWorldQuaternion, solveArm } from './armIk';

/** Objet tenu en main (un seul à la fois) : lampe, couteau, ou une arme à feu tenue à deux mains. */
export type HandItem = 'lampe' | 'couteau' | GunKind | null;
const GUN_KINDS: readonly string[] = ['pistolet', 'fusil', 'pompe', 'precision'];
export const isGunItem = (i: HandItem): i is GunKind => !!i && GUN_KINDS.includes(i);

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _mb = new THREE.Matrix4();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const AXIS_Z = new THREE.Vector3(0, 0, 1);
/** orientation des mains par rapport à l'arme (repère des os de main Biped) */
const HAND_R = new THREE.Quaternion();
const HAND_L = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI, 0, 0));

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
  /** lampe de poche tenue dans la main droite (visible quand elle est allumée) */
  private torch: THREE.Group = torchModel();
  private knife: THREE.Group = knifeModel();
  private guns: Partial<Record<GunKind, GunRig>> = {};
  private hand: THREE.Object3D | null = null;
  private lHand: THREE.Object3D | null = null;
  item: HandItem = null;
  /** coup de couteau, recul du tir : 1 au déclenchement, décroît jusqu'à 0 */
  private strikeT = 0;
  private fireT = 0;
  /** tangage de la visée (armes à feu), positif vers le haut */
  aimPitch = 0;
  /** point visé (monde) : l'arme pointe exactement dessus (joueur local) ; sinon, tangage seul */
  aimTarget: THREE.Vector3 | null = null;
  /** visée épaulée (clic droit), de 0 à 1 */
  ads = 0;

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
    this.model.traverse((o) => {
      if (o.name === 'R_Hand') this.hand = o;
      if (o.name === 'L_Hand') this.lHand = o;
    });
    if (this.hand) {
      // la lampe suit la main ; l'échelle du modèle est compensée pour garder sa vraie taille
      this.torch.scale.setScalar(1 / this.scale);
      this.torch.position.set(0.09 / this.scale, 0.01 / this.scale, 0.03 / this.scale);
      this.hand.add(this.torch);
      this.knife.scale.setScalar(1 / this.scale);
      this.knife.position.set(0.08 / this.scale, 0.0, 0.03 / this.scale);
      this.hand.add(this.knife);
    }

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

  /** Affiche la lampe dans la main (allumée) ou la range (éteinte). */
  setTorch(on: boolean) {
    if (on) this.setItem('lampe');
    else if (this.item === 'lampe') this.setItem(null);
  }

  /** Objet en main : lampe, couteau, arme à feu ou rien (un seul à la fois). */
  setItem(item: HandItem) {
    if (isGunItem(item) && !this.guns[item]) {
      // armes créées à la première utilisation ; portées par la racine (vraie taille), placées à chaque image
      const g = gunRig(item);
      this.guns[item] = g;
      this.root.add(g.group);
    }
    this.item = item;
    this.torch.visible = item === 'lampe';
    this.knife.visible = item === 'couteau';
    for (const [k, g] of Object.entries(this.guns)) g.group.visible = k === item;
  }

  private get gun(): GunRig | null {
    return isGunItem(this.item) ? (this.guns[this.item] ?? null) : null;
  }

  /** Coup de couteau (bras projeté vers l'avant). */
  strike() {
    this.strikeT = 1;
  }

  /** Tir : recul du bras et éclair du canon. */
  fire() {
    this.fireT = 1;
  }

  /** Position (monde) de la bouche du canon (départ de la balle, éclair). */
  muzzlePosition(out = new THREE.Vector3()) {
    this.root.updateMatrixWorld(true);
    const g = this.gun;
    if (!g) return this.handPosition(out);
    return out.copy(g.muzzle).applyMatrix4(g.group.matrixWorld);
  }

  /** Position (monde) de la main droite : départ du faisceau de la lampe. */
  handPosition(out = new THREE.Vector3()) {
    this.root.updateMatrixWorld(true);
    return (this.hand ?? this.head).getWorldPosition(out);
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
    // objet en main : lampe pointée devant soi, couteau tenu bas, pistolet bras tendu dans l'axe de la visée
    this.strikeT = Math.max(0, this.strikeT - dt / 0.38);
    this.fireT = Math.max(0, this.fireT - dt / 0.22);
    if (this.air < 0.5) {
      if (this.item === 'lampe') {
        pose.RightArm = { bend: -0.55 };
        pose.RightForeArm = { bend: -0.75 };
      } else if (this.item === 'couteau') {
        const c = Math.sin(Math.PI * (1 - this.strikeT)) * (this.strikeT > 0 ? 1 : 0);
        pose.RightArm = { bend: -0.3 - 1.05 * c, side: -0.1 * c };
        pose.RightForeArm = { bend: -1.0 + 0.95 * c };
        if (c > 0) pose.Spine = { bend: 0.18 * c };
      }
    }
    const flash = this.gun?.group.getObjectByName('eclair') as THREE.Mesh | undefined;
    if (flash) {
      (flash.material as THREE.MeshBasicMaterial).opacity = this.fireT > 0.55 ? 1 : 0;
      flash.scale.setScalar(0.7 + Math.random() * 0.6);
    }
    if (this.air > 0.01) {
      const v0 = Math.sqrt(2 * JUMP.gravity * JUMP.height);
      const rise = THREE.MathUtils.clamp(s.vy / v0, -1, 1); // 1 = décollage, -1 = chute
      const tuck = THREE.MathUtils.clamp(0.55 + rise * 0.45, 0, 1); // jambes repliées en montée, tendues en chute
      const a = this.air;
      pose.RightUpLeg = { bend: -0.62 * tuck * a };
      pose.LeftUpLeg = { bend: -0.3 * tuck * a };
      pose.RightLeg = { bend: 1.0 * tuck * a };
      pose.LeftLeg = { bend: 0.55 * tuck * a };
      if (!this.gun) {
        pose.RightArm = { bend: (-0.35 + 0.25 * (1 - tuck)) * a, side: 0.12 * a };
        pose.LeftArm = { bend: (-0.25 + 0.2 * (1 - tuck)) * a, side: -0.12 * a };
      }
      pose.Spine = { bend: 0.08 * tuck * a };
    }
    const leanTarget = THREE.MathUtils.clamp(-s.turnRate * speed * ANIM.turnLean, -0.14, 0.14) * (s.grounded ? 1 : 0.3);
    this.lean += (leanTarget - this.lean) * Math.min(1, dt * 8);
    if (Math.abs(this.lean) > 0.002) pose.Spine1 = { ...pose.Spine1, side: this.lean };
    applyPose(this.rig, this.root, pose);

    // enfoncement du bassin à l'atterrissage (le corps encaisse le choc)
    this.model.position.y = -ANIM.landDip * crouchW * 0.6;
    this.holdGun();
  }

  /**
   * Arme à feu tenue à deux mains : l'arme est placée devant les épaules dans l'axe de la visée (bras tendus pour
   * le pistolet, crosse à l'épaule pour les armes longues), puis les bras vont la chercher (cinématique inverse) :
   * main droite sur la poignée, main gauche en soutien. Le recul repousse l'arme et relève le canon.
   */
  private holdGun() {
    const g = this.gun;
    const R = this.rig;
    if (!g || !this.hand || !this.lHand || !R.RightArm || !R.RightForeArm || !R.LeftArm || !R.LeftForeArm) return;
    this.root.updateMatrixWorld(true);
    const inv = _m.copy(this.root.matrixWorld).invert();
    const sR = R.RightArm.getWorldPosition(_v1).applyMatrix4(inv);
    const sL = R.LeftArm.getWorldPosition(_v2).applyMatrix4(inv);
    // pivot de la visée : entre les épaules (pistolet), épaule droite (armes longues) ; repère de la racine (+z avant, -x droite)
    const pivot = g.long ? sR.clone().lerp(sL, 0.2) : sR.clone().lerp(sL, 0.5);
    pivot.y += g.long ? -0.04 : 0.02 + 0.06 * this.ads;
    const dir = _v3;
    if (this.aimTarget) dir.copy(this.aimTarget).applyMatrix4(inv).sub(pivot);
    else dir.set(0, Math.sin(this.aimPitch), Math.cos(this.aimPitch));
    // l'arme reste devant le personnage
    if (dir.z < 0.35 * Math.hypot(dir.x, dir.z)) dir.z = 0.35 * Math.hypot(dir.x, dir.z) + 1e-3;
    dir.normalize();
    const X = dir.clone();
    const Y = new THREE.Vector3(0, 1, 0).addScaledVector(X, -X.y).normalize();
    const Z = new THREE.Vector3().crossVectors(X, Y);
    const kick = this.fireT * this.fireT;
    const reach = g.long ? 0.26 - 0.03 * this.ads : 0.47;
    const pos = pivot.clone().addScaledVector(X, reach - g.kickBack * kick).addScaledVector(Y, g.long ? -0.03 : -0.02);
    if (!g.long) pos.x -= 0.03;
    g.group.position.copy(pos);
    g.group.quaternion.setFromRotationMatrix(_mb.makeBasis(X, Y, Z)).multiply(_q1.setFromAxisAngle(AXIS_Z, g.kickUp * kick));
    g.group.updateMatrixWorld(true);
    const gunQ = g.group.getWorldQuaternion(_q2);
    const rootQ = this.root.getWorldQuaternion(new THREE.Quaternion());
    // mains : poignets sur les points de prise, coudes vers le bas et l'extérieur
    const rw = g.group.localToWorld(g.rightWrist.clone());
    solveArm(R.RightArm, R.RightForeArm, this.hand, rw, new THREE.Vector3(-0.7, -1, -0.25).applyQuaternion(rootQ));
    setWorldQuaternion(this.hand, gunQ.clone().multiply(HAND_R));
    const lw = g.group.localToWorld(g.leftWrist.clone());
    solveArm(R.LeftArm, R.LeftForeArm, this.lHand, lw, new THREE.Vector3(0.7, -1, -0.25).applyQuaternion(rootQ));
    setWorldQuaternion(this.lHand, gunQ.clone().multiply(HAND_L));
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
