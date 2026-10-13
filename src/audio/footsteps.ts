/**
 * Pas et réceptions de saut, déduits du mouvement réel des personnages (aucune donnée en plus sur le réseau) :
 * un pas tous les ~0,75 m en marchant, ~1,1 m en courant. Les pas des autres joueurs proches sont entendus,
 * atténués avec la distance (rien au-delà de 18 m) et placés à gauche ou à droite selon la caméra.
 */
import * as THREE from 'three';
import { sfx } from './sfx';

export interface Walker {
  id: string;
  x: number;
  y: number;
  z: number;
  grounded: boolean;
  local: boolean;
}

const HEARING = 18;

export class Footsteps {
  private state = new Map<string, { x: number; z: number; acc: number; grounded: boolean; airTime: number }>();
  private right = new THREE.Vector3();

  update(dt: number, walkers: Walker[], camera: THREE.Camera) {
    camera.getWorldDirection(this.right);
    this.right.cross(camera.up).normalize();
    const seen = new Set<string>();
    for (const w of walkers) {
      seen.add(w.id);
      const s = this.state.get(w.id);
      if (!s) {
        this.state.set(w.id, { x: w.x, z: w.z, acc: 0, grounded: w.grounded, airTime: 0 });
        continue;
      }
      const d = Math.hypot(w.x - s.x, w.z - s.z);
      s.x = w.x;
      s.z = w.z;
      if (d > 3) continue; // téléportation, réapparition
      const dx = w.x - camera.position.x;
      const dz = w.z - camera.position.z;
      const dist = Math.hypot(dx, dz, w.y - camera.position.y);
      const gain = w.local ? 1 : Math.max(0, 1 - dist / HEARING) ** 2 * 0.8;
      const pan = w.local || dist < 0.5 ? 0 : (dx * this.right.x + dz * this.right.z) / dist;
      if (!w.grounded) s.airTime += dt;
      if (w.grounded && !s.grounded && s.airTime > 0.25 && gain > 0.02) w.local ? sfx.land(Math.min(1, s.airTime)) : sfx.step(gain, pan, true);
      if (w.grounded) s.airTime = 0;
      s.grounded = w.grounded;
      if (!w.grounded || gain < 0.02) continue;
      const speed = d / Math.max(dt, 1e-3);
      const run = speed > 2.4;
      s.acc += d;
      if (s.acc > (run ? 1.1 : 0.75)) {
        s.acc = 0;
        sfx.step(gain, pan, run);
      }
    }
    for (const id of this.state.keys()) if (!seen.has(id)) this.state.delete(id);
  }
}
