/**
 * Caméra du menu principal : un lent travelling au-dessus des toits, de nuit, autour de la place centrale
 * (lanternes, brume, clocher au loin). Un tour complet dure environ quatre minutes ; avec « réduire les
 * animations », la caméra reste sur un plan fixe.
 */
import * as THREE from 'three';

/** Points de passage (au-dessus des toits) et points regardés, parcourus en boucle. */
const PATH = [
  [28, 17, 34],
  [48, 19, -2],
  [30, 22, -42],
  [-14, 21, -50],
  [-46, 18, -12],
  [-36, 17, 30],
].map(([x, y, z]) => new THREE.Vector3(x, y, z));
const LOOK = [
  [-4, 4, -14],
  [2, 5, -30],
  [-6, 7, -70],
  [-2, 4, -10],
  [10, 3, -4],
  [4, 4, -12],
].map(([x, y, z]) => new THREE.Vector3(x, y, z));

export class CinematicCamera {
  private pos = new THREE.CatmullRomCurve3(PATH, true, 'centripetal');
  private look = new THREE.CatmullRomCurve3(LOOK, true, 'centripetal');
  private t = 0.02;
  private tmp = new THREE.Vector3();
  /** durée d'un tour (s) */
  period = 240;
  still = false;

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  update(dt: number) {
    if (!this.still) this.t = (this.t + dt / this.period) % 1;
    const p = this.pos.getPointAt(this.t, this.tmp);
    // léger flottement vertical, comme une caméra portée par le vent
    const bob = this.still ? 0 : Math.sin(performance.now() / 4000) * 0.4;
    this.camera.position.set(p.x, p.y + bob, p.z);
    this.camera.lookAt(this.look.getPointAt(this.t));
    if (this.camera.fov !== 50) {
      this.camera.fov = 50;
      this.camera.updateProjectionMatrix();
    }
  }
}
