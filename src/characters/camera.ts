/**
 * Caméra du joueur : troisième personne centrée derrière le personnage (par défaut), décalée sur l'épaule droite
 * pour viser (arme sortie), ou vue subjective (touche V).
 * La souris tourne la caméra ; le passage d'une vue à l'autre conserve l'orientation du regard.
 * En troisième personne, la caméra ne traverse ni les murs ni les planchers (elle se rapproche du personnage).
 */
import * as THREE from 'three';
import { CAMERA } from './config';
import type { Character } from './character';
import type { CollisionWorld } from '../village/collision';

export type ViewMode = 'troisieme' | 'subjective';

export class PlayerCamera {
  mode: ViewMode = 'troisieme';
  /** lacet du regard (0 = vers +z) et tangage (positif = vers le haut) */
  yaw = 0;
  pitch = -CAMERA.pitch;
  distance: number = CAMERA.distance;
  private curDist: number = CAMERA.distance;
  private pivot = new THREE.Vector3();
  /** visée (pistolet sorti) : caméra sur l'épaule droite et plus proche, le personnage ne cache pas le viseur */
  aiming = false;
  /** vol libre (noclip) : la caméra traverse aussi les murs */
  noCollide = false;
  /** visée épaulée (clic droit) : champ de vision réduit d'autant (1 = normal), caméra plus proche */
  zoom = 1;
  private zoomS = 1;
  private shoulderS = 0;
  private aimS = 0;
  private initialized = false;

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  /** Avant horizontal du regard (pour orienter les commandes de déplacement). */
  get forward(): [number, number] {
    return [Math.sin(this.yaw), Math.cos(this.yaw)];
  }

  look(dx: number, dy: number, wheel: number) {
    // en visée, la souris ralentit avec le grossissement (même geste = même déplacement à l'écran)
    const sens = CAMERA.sensitivity * this.zoomS;
    this.yaw -= dx * sens;
    const min = this.mode === 'subjective' ? CAMERA.fpMinPitch : CAMERA.minPitch;
    const max = this.mode === 'subjective' ? CAMERA.fpMaxPitch : CAMERA.maxPitch;
    // tangage : souris vers le bas = regarder vers le bas, dans les deux vues
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * sens * (CAMERA.invertY ? -1 : 1), -max, -min);
    if (this.mode === 'troisieme' && wheel) this.distance = THREE.MathUtils.clamp(this.distance + wheel * 0.0035, CAMERA.minDistance, CAMERA.maxDistance);
  }

  toggle(ch: Character) {
    this.mode = this.mode === 'troisieme' ? 'subjective' : 'troisieme';
    // même direction du regard ; le tangage est ramené dans les limites de la nouvelle vue
    const min = this.mode === 'subjective' ? CAMERA.fpMinPitch : CAMERA.minPitch;
    const max = this.mode === 'subjective' ? CAMERA.fpMaxPitch : CAMERA.maxPitch;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -max, -min);
    ch.animator.setFirstPerson(this.mode === 'subjective');
    this.camera.fov = CAMERA.fov + (this.mode === 'subjective' ? 6 : 0);
    this.camera.updateProjectionMatrix();
  }

  update(dt: number, ch: Character, world: CollisionWorld) {
    const cam = this.camera;
    this.zoomS += (this.zoom - this.zoomS) * Math.min(1, dt * 14);
    if (Math.abs(this.zoomS - this.zoom) < 1e-3) this.zoomS = this.zoom;
    const fov = (CAMERA.fov + (this.mode === 'subjective' ? 6 : 0)) * this.zoomS;
    if (Math.abs(cam.fov - fov) > 1e-3) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    const dir = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    if (this.mode === 'subjective') {
      ch.root.updateMatrixWorld(true);
      const head = new THREE.Vector3();
      ch.animator.head.getWorldPosition(head);
      // un peu devant les yeux : on ne voit pas l'intérieur du crâne
      cam.position.copy(head).add(new THREE.Vector3(Math.sin(this.yaw) * 0.14, 0.06, Math.cos(this.yaw) * 0.14));
      cam.lookAt(cam.position.clone().add(dir));
      this.initialized = false;
      return;
    }
    const c = ch.root.position;
    const want = new THREE.Vector3(c.x, c.y + ch.height * CAMERA.aimHeight, c.z);
    if (!this.initialized) {
      this.pivot.copy(want);
      this.initialized = true;
    }
    // suivi souple (vertical surtout : marches, sauts) sans retard horizontal gênant
    this.pivot.x += (want.x - this.pivot.x) * Math.min(1, dt * CAMERA.follow * 1.5);
    this.pivot.z += (want.z - this.pivot.z) * Math.min(1, dt * CAMERA.follow * 1.5);
    this.pivot.y += (want.y - this.pivot.y) * Math.min(1, dt * CAMERA.follow * 0.5);
    const right = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    const k = Math.min(1, dt * 8);
    this.aimS += ((this.aiming ? 1 : 0) - this.aimS) * k;
    this.shoulderS += ((this.aiming ? CAMERA.aimShoulder : CAMERA.shoulder) - this.shoulderS) * k;
    const shoulder = this.pivot.clone().addScaledVector(right, this.shoulderS);
    // la caméra ne traverse pas les murs : on cherche le premier obstacle entre le personnage et elle
    const head = this.pivot.clone();
    const zoomed = THREE.MathUtils.clamp((1 - this.zoomS) / 0.3, 0, 1);
    const wanted = THREE.MathUtils.lerp(THREE.MathUtils.lerp(this.distance, Math.min(this.distance, CAMERA.aimDistance), this.aimS), 1.25, zoomed * this.aimS);
    let free = wanted;
    const toShoulder = shoulder.clone().sub(head);
    for (let t = 0.1; t <= 1.0001 && !this.noCollide; t += 0.1) {
      const p = head.clone().addScaledVector(toShoulder, t);
      if (world.blocksPoint(p.x, p.y, p.z, 0.12)) {
        free = 0;
        break;
      }
    }
    const anchor = free === 0 ? head : shoulder;
    if (free > 0 && !this.noCollide)
      for (let d = 0.2; d <= wanted + 1e-6; d += 0.1) {
        const p = anchor.clone().addScaledVector(dir, -d);
        if (world.blocksPoint(p.x, p.y, p.z, 0.18)) {
          free = Math.max(0.35, d - 0.25);
          break;
        }
      }
    // rapprochement immédiat (ne jamais voir à travers un mur), recul progressif
    this.curDist = free < this.curDist ? free : this.curDist + (free - this.curDist) * Math.min(1, dt * 4);
    cam.position.copy(anchor).addScaledVector(dir, -this.curDist);
    cam.lookAt(anchor.clone().addScaledVector(dir, 4));
    // tout près du personnage, son corps masquerait la vue : il s'efface
    ch.root.visible = this.curDist > 0.55;
  }
}
