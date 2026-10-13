/**
 * Couche de pose procédurale appliquée PAR-DESSUS les animations capturées (repris de l'outil de gestes
 * d'« Everyone Has a Secret ») : rotations autour d'axes liés au personnage (pencher, incliner, tourner),
 * indépendantes des repères locaux des os. Sert à la pose aérienne du saut et à l'inclinaison dans les virages,
 * Rocketbox ne fournissant aucune animation de saut.
 */
import * as THREE from 'three';

export type BoneKey = 'Hips' | 'Spine' | 'Spine1' | 'Spine2' | 'Neck' | 'Head' | 'RightArm' | 'RightForeArm' | 'LeftArm' | 'LeftForeArm' | 'RightUpLeg' | 'LeftUpLeg' | 'RightLeg' | 'LeftLeg' | 'RightFoot' | 'LeftFoot';
export type Rig = Partial<Record<BoneKey, THREE.Bone>>;
/** bend : vers l'avant (+) · side : vers la droite du personnage (+) · turn : autour de la verticale */
export interface BoneRot {
  bend?: number;
  side?: number;
  turn?: number;
}
export type Pose = Partial<Record<BoneKey, BoneRot>>;

/** Os du squelette Biped Rocketbox (noms renommés par le pipeline). */
export function bipedRig(model: THREE.Object3D): Rig {
  const by = new Map<string, THREE.Bone>();
  model.traverse((o) => (o as THREE.Bone).isBone && by.set(o.name, o as THREE.Bone));
  const r = (n: string) => by.get(n);
  return {
    Hips: r('Hips'),
    Spine: r('Spine1'),
    Spine1: r('Spine2'),
    Spine2: r('Spine2'),
    Neck: r('Neck'),
    Head: r('Head'),
    RightArm: r('R_UpperArm'),
    RightForeArm: r('R_Forearm'),
    LeftArm: r('L_UpperArm'),
    LeftForeArm: r('L_Forearm'),
    RightUpLeg: r('R_Thigh'),
    LeftUpLeg: r('L_Thigh'),
    RightLeg: r('R_Calf'),
    LeftLeg: r('L_Calf'),
    RightFoot: r('R_Foot'),
    LeftFoot: r('L_Foot'),
  };
}

const ORDER: BoneKey[] = ['Hips', 'Spine', 'Spine1', 'Neck', 'Head', 'RightUpLeg', 'LeftUpLeg', 'RightLeg', 'LeftLeg', 'RightFoot', 'LeftFoot', 'RightArm', 'RightForeArm', 'LeftArm', 'LeftForeArm'];
const UP = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _qw = new THREE.Quaternion();
const _qp = new THREE.Quaternion();
const _fwd = new THREE.Vector3();
const _bend = new THREE.Vector3();

function rotateWorld(bone: THREE.Bone, axis: THREE.Vector3, angle: number) {
  if (!angle || !bone.parent) return;
  bone.updateWorldMatrix(true, false);
  bone.getWorldQuaternion(_qw);
  bone.parent.getWorldQuaternion(_qp);
  _q.setFromAxisAngle(axis, angle).multiply(_qw);
  bone.quaternion.copy(_qp.invert().multiply(_q));
}

/** Applique une pose (après `mixer.update`). `root` : objet dont le +z est l'avant du personnage. */
export function applyPose(rig: Rig, root: THREE.Object3D, pose: Pose) {
  root.getWorldDirection(_fwd);
  _bend.crossVectors(UP, _fwd).normalize();
  for (const k of ORDER) {
    const p = pose[k];
    const bone = rig[k];
    if (!p || !bone) continue;
    if (p.turn) rotateWorld(bone, UP, p.turn);
    if (p.bend) rotateWorld(bone, _bend, p.bend);
    if (p.side) rotateWorld(bone, _fwd, p.side);
  }
}
