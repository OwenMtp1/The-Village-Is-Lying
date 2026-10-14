/**
 * Rendu des couverts du Gunfight (dans le style du village : bois, fer, foin, pierre) et leurs boîtes de collision.
 * Un groupe par carte, construit à la première partie sur cette carte.
 */
import * as THREE from 'three';
import type { GFProp } from '../shared/gunfightProps';
import type { Obb } from './collision';

const M = {
  plank: new THREE.MeshStandardMaterial({ color: '#8a6440', roughness: 0.85 }),
  plankDark: new THREE.MeshStandardMaterial({ color: '#5e4128', roughness: 0.9 }),
  iron: new THREE.MeshStandardMaterial({ color: '#3a3836', roughness: 0.5, metalness: 0.7 }),
  hay: new THREE.MeshStandardMaterial({ color: '#c9a95a', roughness: 1 }),
  stone: new THREE.MeshStandardMaterial({ color: '#8d867b', roughness: 0.95 }),
  bark: new THREE.MeshStandardMaterial({ color: '#4d3b2a', roughness: 1 }),
  rock: new THREE.MeshStandardMaterial({ color: '#77736b', roughness: 1, flatShading: true }),
  moss: new THREE.MeshStandardMaterial({ color: '#4f6436', roughness: 1 }),
};

const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
};

/** Caisse en planches cerclée (côté s, posée à y). */
function crate(s: number, y: number, x = 0, z = 0, rot = 0) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(s, s, s), M.plank, 0, s / 2, 0));
  for (const [dx, dz, w, d] of [[0, s / 2, s + 0.02, 0.06], [0, -s / 2, s + 0.02, 0.06], [s / 2, 0, 0.06, s + 0.02], [-s / 2, 0, 0.06, s + 0.02]] as const) {
    g.add(mesh(new THREE.BoxGeometry(w, 0.1, d), M.plankDark, dx, 0.06, dz));
    g.add(mesh(new THREE.BoxGeometry(w, 0.1, d), M.plankDark, dx, s - 0.06, dz));
  }
  g.add(mesh(new THREE.BoxGeometry(s * 1.3, 0.08, 0.06), M.plankDark, 0, s / 2, s / 2 + 0.01).rotateZ(0.75));
  g.position.set(x, y, z);
  g.rotation.y = rot;
  return g;
}

function barrel(x: number, z: number, h: number) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.34, 0.3, h, 14), M.plank, 0, h / 2, 0));
  for (const y of [0.15, h / 2, h - 0.15]) g.add(mesh(new THREE.TorusGeometry(y === h / 2 ? 0.345 : 0.315, 0.025, 4, 16).rotateX(Math.PI / 2), M.iron, 0, y, 0));
  g.position.set(x, 0, z);
  return g;
}

function propGroup(p: GFProp): THREE.Group {
  const g = new THREE.Group();
  const { w, d, h } = p;
  switch (p.kind) {
    case 'caisse':
      g.add(crate(w, 0));
      break;
    case 'caisses':
      g.add(crate(w, 0), crate(w * 0.82, w, 0.06, -0.05, 0.3));
      break;
    case 'tonneaux':
      g.add(barrel(-0.36, -0.3, 1.0), barrel(0.38, -0.25, 1.0), barrel(0, 0.38, 1.1));
      break;
    case 'charrette': {
      g.add(mesh(new THREE.BoxGeometry(w * 0.82, 0.12, d * 0.9), M.plank, -0.15, 0.75, 0));
      for (const s of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(w * 0.82, 0.45, 0.07), M.plankDark, -0.15, 1.02, s * d * 0.43));
      g.add(mesh(new THREE.BoxGeometry(0.07, 0.45, d * 0.9), M.plankDark, -0.15 - w * 0.41, 1.02, 0));
      for (const s of [-1, 1]) g.add(mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.1, 16).rotateX(Math.PI / 2), M.plankDark, 0.05, 0.62, s * (d / 2 - 0.02)));
      g.add(mesh(new THREE.BoxGeometry(1.4, 0.08, 0.08), M.plankDark, w * 0.42, 0.62, 0.2), mesh(new THREE.BoxGeometry(1.4, 0.08, 0.08), M.plankDark, w * 0.42, 0.62, -0.2));
      // chargement : sacs et une caisse
      g.add(crate(0.6, 0.81, -0.6, 0.1, 0.2));
      g.add(mesh(new THREE.SphereGeometry(0.32, 10, 8).scale(1.3, 0.6, 1), M.hay, 0.25, 1.0, 0));
      break;
    }
    case 'foin':
      g.add(mesh(new THREE.BoxGeometry(w, h, d), M.hay, 0, h / 2, 0));
      for (const x of [-w / 4, w / 4]) g.add(mesh(new THREE.BoxGeometry(0.04, h + 0.02, d + 0.02), M.plankDark, x, h / 2, 0));
      break;
    case 'muret': {
      g.add(mesh(new THREE.BoxGeometry(w, h, d), M.stone, 0, h / 2, 0));
      g.add(mesh(new THREE.BoxGeometry(w + 0.1, 0.12, d + 0.12), M.stone, 0, h + 0.03, 0));
      g.add(mesh(new THREE.BoxGeometry(w * 0.6, 0.06, d + 0.02), M.moss, -w * 0.15, h + 0.1, 0));
      break;
    }
    case 'barricade': {
      for (let i = 0; i < 4; i++) g.add(mesh(new THREE.BoxGeometry(w, 0.3, 0.1), i % 2 ? M.plank : M.plankDark, 0, 0.25 + i * 0.36, 0));
      for (const x of [-w / 2 + 0.2, w / 2 - 0.2]) g.add(mesh(new THREE.BoxGeometry(0.14, h, 0.14), M.plankDark, x, h / 2, -0.12));
      for (const x of [-w / 2 + 0.2, w / 2 - 0.2]) g.add(mesh(new THREE.BoxGeometry(0.1, 1.5, 0.1), M.plankDark, x, 0.6, -0.5).rotateX(-0.7));
      break;
    }
    case 'tronc': {
      g.add(mesh(new THREE.CylinderGeometry(d / 2, d / 2 * 1.1, w, 12).rotateZ(Math.PI / 2), M.bark, 0, d / 2, 0));
      g.add(mesh(new THREE.CylinderGeometry(d / 2 * 0.95, d / 2 * 0.95, 0.04, 12).rotateZ(Math.PI / 2), M.plank, w / 2, d / 2, 0));
      g.add(mesh(new THREE.BoxGeometry(w * 0.5, 0.06, d * 0.5), M.moss, -w * 0.1, d - 0.02, 0));
      break;
    }
    case 'rocher': {
      const geo = new THREE.DodecahedronGeometry(1, 1);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const k = 0.8 + 0.4 * Math.abs(Math.sin(i * 12.9898 + p.x * 0.1) * 43758.5453 % 1);
        pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k);
      }
      geo.computeVertexNormals();
      g.add(mesh(geo.scale(w / 2, h / 2, d / 2), M.rock, 0, h * 0.42, 0));
      break;
    }
  }
  g.position.set(p.x, p.y, p.z);
  g.rotation.y = p.rot;
  return g;
}

/** Maillages des couverts d'une carte. */
export function buildPropsGroup(props: GFProp[]): THREE.Group {
  const g = new THREE.Group();
  g.name = 'couverts-gunfight';
  for (const p of props) g.add(propGroup(p));
  return g;
}

/** Boîtes de collision des couverts (même rotation que les maillages). */
export function propObstacles(props: GFProp[]): Obb[] {
  // même convention que les maillages (rotation.y = rot)
  return props.map((p) => ({ x: p.x, z: p.z, hx: p.w / 2, hz: p.d / 2, rot: p.rot, y0: p.y - 0.2, y1: p.y + p.h, tag: `gf-${p.kind}` }));
}
