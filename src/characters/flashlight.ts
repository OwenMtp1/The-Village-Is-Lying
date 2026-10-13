/**
 * Lampes de poche : chaque joueur en possède une dans son inventaire (touche L ou clic sur l'emplacement).
 *
 * Toutes les lumières sont créées une fois au démarrage, éteintes (intensité nulle) quand on ne s'en sert pas :
 * le nombre de lumières de la scène ne change jamais, donc aucun matériau n'est recompilé en cours de partie.
 *  - la lampe du joueur projette des ombres et suit son regard (là où vise la caméra) ;
 *  - trois faisceaux sans ombre servent aux lampes allumées des autres joueurs les plus proches.
 * Une petite lampe (corps + verre lumineux) apparaît dans la main droite du personnage quand elle est allumée.
 */
import * as THREE from 'three';

export const TORCH = {
  /** intensité (candela) : une lampe puissante, qui éclaire nettement une rue entière de nuit */
  intensity: 320,
  distance: 48,
  decay: 1.5,
  /** demi-angle du faisceau (rad) et adoucissement du bord */
  angle: 0.5,
  penumbra: 0.55,
  /** faisceaux des autres joueurs gérés simultanément */
  remoteBeams: 3,
};

function spot(shadow: boolean) {
  const l = new THREE.SpotLight('#fff3dc', 0, TORCH.distance, TORCH.angle, TORCH.penumbra, TORCH.decay);
  l.castShadow = shadow;
  if (shadow) {
    l.shadow.mapSize.set(1024, 1024);
    l.shadow.camera.near = 0.2;
    l.shadow.camera.far = TORCH.distance;
    l.shadow.bias = -0.0008;
    l.shadow.normalBias = 0.03;
  }
  return l;
}

let torchGeo: THREE.BufferGeometry | null = null;
let lensGeo: THREE.BufferGeometry | null = null;
const bodyMat = new THREE.MeshStandardMaterial({ color: '#2a2622', roughness: 0.45, metalness: 0.7 });
const lensMat = new THREE.MeshStandardMaterial({ color: '#fff6e0', emissive: '#fff3dc', emissiveIntensity: 4, roughness: 0.2 });

/** Petite lampe tenue en main (repère de la main droite Biped). */
export function torchModel(): THREE.Group {
  torchGeo ??= new THREE.CylinderGeometry(0.022, 0.018, 0.17, 10).rotateZ(Math.PI / 2);
  lensGeo ??= new THREE.CylinderGeometry(0.03, 0.026, 0.035, 12).rotateZ(Math.PI / 2);
  const g = new THREE.Group();
  g.name = 'lampe';
  const body = new THREE.Mesh(torchGeo, bodyMat);
  const lens = new THREE.Mesh(lensGeo, lensMat);
  lens.position.x = 0.1;
  g.add(body, lens);
  g.visible = false;
  return g;
}

export class Flashlights {
  readonly local: THREE.SpotLight;
  private remotes: THREE.SpotLight[] = [];
  private tmp = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.local = spot(true);
    scene.add(this.local, this.local.target);
    for (let i = 0; i < TORCH.remoteBeams; i++) {
      const l = spot(false);
      scene.add(l, l.target);
      this.remotes.push(l);
    }
  }

  /** Lampe du joueur : du point `from` (main ou yeux) vers la direction regardée. */
  setLocal(on: boolean, from: THREE.Vector3, dir: THREE.Vector3) {
    this.local.intensity = on ? TORCH.intensity : 0;
    if (!on) return;
    this.local.position.copy(from);
    this.local.target.position.copy(from).addScaledVector(dir, 10);
  }

  /** Lampes allumées des autres joueurs : les plus proches de `near` reçoivent un faisceau. */
  setRemotes(list: { from: THREE.Vector3; dir: THREE.Vector3 }[], near: THREE.Vector3) {
    const sorted = [...list].sort((a, b) => a.from.distanceToSquared(near) - b.from.distanceToSquared(near));
    this.remotes.forEach((l, i) => {
      const s = sorted[i];
      l.intensity = s ? TORCH.intensity * 0.85 : 0;
      if (!s) return;
      l.position.copy(s.from);
      l.target.position.copy(this.tmp.copy(s.from).addScaledVector(s.dir, 10));
    });
  }

  off() {
    this.local.intensity = 0;
    for (const l of this.remotes) l.intensity = 0;
  }
}

/** Direction du regard à partir du lacet et du tangage (mêmes conventions que la caméra). */
export const lookDir = (yaw: number, pitch: number, out = new THREE.Vector3()) => out.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
