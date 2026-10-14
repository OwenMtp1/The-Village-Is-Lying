/**
 * Cinématique inverse à deux os (bras, avant-bras) : amène le poignet sur un point du monde, le coude plié vers
 * une direction donnée, puis oriente la main. Appliquée après les animations capturées, elle sert à tenir les
 * armes à deux mains : les mains restent sur l'arme quoi que fassent les jambes et le buste.
 */
import * as THREE from 'three';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _to = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _elbow = new THREE.Vector3();
const _from = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qw = new THREE.Quaternion();
const _qp = new THREE.Quaternion();

/** Tourne l'os (rotation dans le repère du monde) pour que la direction `from` devienne `to`. */
function aimBone(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3) {
  if (!bone.parent || from.lengthSq() < 1e-10 || to.lengthSq() < 1e-10) return;
  _q.setFromUnitVectors(from.normalize(), to.normalize());
  bone.getWorldQuaternion(_qw);
  bone.parent.getWorldQuaternion(_qp);
  bone.quaternion.copy(_qp.invert().multiply(_q.multiply(_qw)));
  bone.updateMatrixWorld(true);
}

/** Donne à l'os une orientation absolue (monde). */
export function setWorldQuaternion(bone: THREE.Object3D, q: THREE.Quaternion) {
  if (!bone.parent) return;
  bone.parent.getWorldQuaternion(_qp);
  bone.quaternion.copy(_qp.invert().multiply(q));
  bone.updateMatrixWorld(true);
}

/**
 * Place le poignet (`hand`) sur `target` en pliant `upper` et `fore` ; le coude part vers `pole` (direction monde).
 * Si la cible est hors de portée, le bras se tend dans sa direction.
 */
export function solveArm(upper: THREE.Object3D, fore: THREE.Object3D, hand: THREE.Object3D, target: THREE.Vector3, pole: THREE.Vector3) {
  upper.updateWorldMatrix(true, true);
  upper.getWorldPosition(_a);
  fore.getWorldPosition(_b);
  hand.getWorldPosition(_c);
  const l1 = _a.distanceTo(_b);
  const l2 = _b.distanceTo(_c);
  _dir.subVectors(target, _a);
  const d = THREE.MathUtils.clamp(_dir.length(), Math.abs(l1 - l2) + 1e-3, (l1 + l2) * 0.999);
  _dir.normalize();
  const cosA = THREE.MathUtils.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  _pole.copy(pole).addScaledVector(_dir, -pole.dot(_dir));
  if (_pole.lengthSq() < 1e-8) _pole.set(0, -1, 0).addScaledVector(_dir, _dir.y);
  _pole.normalize();
  _elbow.copy(_a).addScaledVector(_dir, l1 * cosA).addScaledVector(_pole, l1 * sinA);
  aimBone(upper, _from.subVectors(_b, _a), _to.subVectors(_elbow, _a));
  fore.getWorldPosition(_b);
  hand.getWorldPosition(_c);
  _to.copy(_a).addScaledVector(_dir, d);
  aimBone(fore, _from.subVectors(_c, _b), _to.sub(_b));
}
