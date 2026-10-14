/**
 * Armes tenues en main (modélisées par code, repère de la main droite Biped : la lame / le canon suivent +x,
 * comme la lampe de poche) : couteau des tueurs, pistolet des shérifs, et l'éclair de la bouche du canon.
 */
import * as THREE from 'three';

const steel = new THREE.MeshStandardMaterial({ color: '#c9ccd2', roughness: 0.25, metalness: 0.95 });
const darkSteel = new THREE.MeshStandardMaterial({ color: '#2b2d31', roughness: 0.4, metalness: 0.85 });
const wood = new THREE.MeshStandardMaterial({ color: '#4a2f1d', roughness: 0.7, metalness: 0 });
const brass = new THREE.MeshStandardMaterial({ color: '#b08a3e', roughness: 0.35, metalness: 0.9 });
const flashMat = new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });

let knifeGeo: { blade: THREE.BufferGeometry; guard: THREE.BufferGeometry; grip: THREE.BufferGeometry } | null = null;
let gunGeo: { barrel: THREE.BufferGeometry; frame: THREE.BufferGeometry; cyl: THREE.BufferGeometry; grip: THREE.BufferGeometry; flash: THREE.BufferGeometry } | null = null;

/** Couteau : lame effilée de 18 cm, garde, manche de bois. */
export function knifeModel(): THREE.Group {
  if (!knifeGeo) {
    const shape = new THREE.Shape();
    shape.moveTo(0, -0.012);
    shape.lineTo(0.15, -0.006);
    shape.lineTo(0.185, 0.012);
    shape.lineTo(0, 0.014);
    shape.closePath();
    knifeGeo = {
      blade: new THREE.ExtrudeGeometry(shape, { depth: 0.004, bevelEnabled: false }).translate(0.035, 0, -0.002),
      guard: new THREE.BoxGeometry(0.012, 0.05, 0.016).translate(0.03, 0, 0),
      grip: new THREE.CylinderGeometry(0.012, 0.014, 0.1, 8).rotateZ(Math.PI / 2).translate(-0.02, 0, 0),
    };
  }
  const g = new THREE.Group();
  g.name = 'couteau';
  g.add(new THREE.Mesh(knifeGeo.blade, steel), new THREE.Mesh(knifeGeo.guard, brass), new THREE.Mesh(knifeGeo.grip, wood));
  g.visible = false;
  return g;
}

/** Pistolet à barillet : canon, carcasse, barillet, crosse de bois ; éclair au bout du canon. */
export function gunModel(): THREE.Group {
  if (!gunGeo) {
    gunGeo = {
      barrel: new THREE.CylinderGeometry(0.009, 0.009, 0.16, 10).rotateZ(Math.PI / 2).translate(0.12, 0.035, 0),
      frame: new THREE.BoxGeometry(0.09, 0.04, 0.026).translate(0.03, 0.03, 0),
      cyl: new THREE.CylinderGeometry(0.019, 0.019, 0.045, 12).rotateZ(Math.PI / 2).translate(0.03, 0.03, 0),
      grip: new THREE.BoxGeometry(0.03, 0.09, 0.024).rotateZ(-0.35).translate(-0.02, -0.02, 0),
      flash: new THREE.SphereGeometry(0.05, 8, 6).scale(1.8, 1, 1).translate(0.24, 0.035, 0),
    };
  }
  const g = new THREE.Group();
  g.name = 'pistolet';
  const flash = new THREE.Mesh(gunGeo.flash, flashMat.clone());
  flash.name = 'eclair';
  g.add(new THREE.Mesh(gunGeo.barrel, darkSteel), new THREE.Mesh(gunGeo.frame, darkSteel), new THREE.Mesh(gunGeo.cyl, steel), new THREE.Mesh(gunGeo.grip, wood), flash);
  g.visible = false;
  return g;
}
