/**
 * Objets du village (mobilier, décor de rue, cimetière, ferme) : chaque type est modélisé une seule fois puis
 * instancié (un appel de dessin par type et par matériau pour tout le village).
 * Repère d'un objet : posé au sol en y = 0, centré, son « devant » vers +z (dimensions de `FURN` pour le mobilier).
 */
import * as THREE from 'three';
import { Batch, type V3 } from './geom';
import { VM } from './textures';
import { FURN } from './plans';
import type { Obb } from './collision';

// ───────────────────────── matériaux partagés ─────────────────────────

const M = {
  wood: () => VM.planks('#b8946c'),
  woodDark: () => VM.timber(),
  woodRed: () => VM.planks('#9a6a4a'),
  iron: () => VM.iron(),
  stone: () => VM.stone('#d8d0c2'),
  stoneDark: () => VM.stoneDark(),
  hay: () => VM.hay(),
  cloth: (c: string) => VM.paint(c, 0.95),
  wax: () => VM.paint('#efe4c8', 0.55),
  flame: () => VM.glow('#ffb347', 7),
  ember: () => VM.glow('#ff4d0f', 5),
  ceramic: (c: string) => VM.paint(c, 0.45),
  glass: (c: string) => VM.paint(c, 0.15, 0.1),
  water: () => VM.water(),
  soil: () => VM.dirtFloor(),
  leaf: (c: string) => VM.paint(c, 0.9),
  paper: () => VM.paint('#d9cfb2', 0.95),
  lanternGlass: () => VM.glow('#ffc874', 4.5),
};

type Build = (b: P) => void;

/** Petit atelier de modélisation : primitives posées dans le repère de l'objet. */
class P {
  constructor(readonly batch: Batch) {}
  box(mat: THREE.Material, size: V3, pos: V3, rot: V3 = [0, 0, 0]) {
    this.batch.box(mat, size, pos, { rot, uv: 'local' });
  }
  cyl(mat: THREE.Material, rTop: number, rBot: number, h: number, pos: V3, rot: V3 = [0, 0, 0], seg = 12) {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg);
    scaleUV(g, Math.PI * (rTop + rBot), h);
    this.batch.geo(g, mat, pos, { rot });
    g.dispose();
  }
  sphere(mat: THREE.Material, r: number, pos: V3, scale: V3 = [1, 1, 1], seg = 10) {
    const g = new THREE.SphereGeometry(r, seg, Math.max(6, seg - 3));
    scaleUV(g, Math.PI * 2 * r, Math.PI * r);
    this.batch.geo(g, mat, pos, { scale });
    g.dispose();
  }
  geo(g: THREE.BufferGeometry, mat: THREE.Material, pos: V3, rot: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]) {
    this.batch.geo(g, mat, pos, { rot, scale });
  }
  /** Poutre entre deux points (section carrée). */
  beam(mat: THREE.Material, a: V3, b: V3, s: number) {
    const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = d.length();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    const e = new THREE.Euler().setFromQuaternion(q);
    this.box(mat, [s, len, s], [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], [e.x, e.y, e.z]);
  }
}

function scaleUV(g: THREE.BufferGeometry, su: number, sv: number) {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
}

/** Tonneau bombé (profil de révolution). */
function barrelGeo(r: number, h: number) {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    pts.push(new THREE.Vector2(r * (0.82 + 0.18 * Math.sin(t * Math.PI)), t * h));
  }
  const g = new THREE.LatheGeometry(pts, 14);
  scaleUV(g, Math.PI * 2 * r, h);
  return g;
}

function bellGeo() {
  const pts = [
    [0.02, 0.9],
    [0.18, 0.88],
    [0.3, 0.78],
    [0.34, 0.55],
    [0.4, 0.3],
    [0.52, 0.08],
    [0.56, 0],
    [0.5, 0.02],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  return new THREE.LatheGeometry(pts, 18);
}

// ───────────────────────── mobilier ─────────────────────────

const legs = (b: P, w: number, d: number, h: number, s = 0.07, mat = M.woodDark()) => {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(mat, [s, h, s], [sx * (w / 2 - s), h / 2, sz * (d / 2 - s)]);
};

const BUILDERS: Record<string, Build> = {
  table: (b) => {
    b.box(M.wood(), [1.7, 0.07, 0.85], [0, 0.745, 0]);
    legs(b, 1.6, 0.75, 0.71, 0.08);
    b.box(M.woodDark(), [1.4, 0.06, 0.06], [0, 0.18, 0]);
    // vaisselle : pichet, écuelles, chandelle
    b.cyl(M.ceramic('#8a6a4a'), 0.06, 0.08, 0.22, [0.45, 0.89, 0.1]);
    b.cyl(M.ceramic('#c9bca0'), 0.11, 0.08, 0.04, [-0.4, 0.8, 0.15]);
    b.cyl(M.ceramic('#c9bca0'), 0.11, 0.08, 0.04, [0.05, 0.8, -0.2]);
    b.cyl(M.wax(), 0.025, 0.025, 0.16, [-0.1, 0.86, 0.05]);
    b.sphere(M.flame(), 0.018, [-0.1, 0.96, 0.05], [1, 1.8, 1], 6);
  },
  tableRound: (b) => {
    b.cyl(M.wood(), 0.55, 0.55, 0.06, [0, 0.73, 0], [0, 0, 0], 20);
    b.cyl(M.woodDark(), 0.08, 0.1, 0.7, [0, 0.35, 0]);
    b.cyl(M.woodDark(), 0.35, 0.35, 0.05, [0, 0.025, 0], [0, 0, 0], 16);
    b.cyl(M.ceramic('#6e5a44'), 0.05, 0.07, 0.18, [0.15, 0.85, 0.1]);
    b.cyl(M.ceramic('#6e5a44'), 0.05, 0.07, 0.18, [-0.2, 0.85, -0.05]);
  },
  tableSmall: (b) => {
    b.box(M.wood(), [0.8, 0.05, 0.6], [0, 0.715, 0]);
    legs(b, 0.74, 0.54, 0.69, 0.06);
    b.cyl(M.wax(), 0.03, 0.03, 0.12, [0.2, 0.8, 0.1]);
    b.sphere(M.flame(), 0.02, [0.2, 0.88, 0.1], [1, 1.8, 1], 6);
    b.box(M.woodDark(), [0.22, 0.04, 0.16], [-0.15, 0.76, -0.05]);
  },
  chair: (b) => {
    b.box(M.wood(), [0.46, 0.05, 0.44], [0, 0.46, 0]);
    legs(b, 0.42, 0.4, 0.44, 0.05);
    for (const sx of [-1, 1]) b.box(M.woodDark(), [0.05, 0.5, 0.05], [sx * 0.19, 0.72, -0.19]);
    for (const y of [0.62, 0.8, 0.94]) b.box(M.woodDark(), [0.4, 0.06, 0.03], [0, y, -0.19]);
  },
  stool: (b) => {
    b.cyl(M.wood(), 0.19, 0.19, 0.05, [0, 0.455, 0], [0, 0, 0], 12);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      b.box(M.woodDark(), [0.04, 0.46, 0.04], [Math.cos(a) * 0.12, 0.22, Math.sin(a) * 0.12], [Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12]);
    }
  },
  bench: (b) => {
    b.box(M.wood(), [1.5, 0.06, 0.34], [0, 0.43, 0]);
    for (const sx of [-1, 1]) {
      b.box(M.woodDark(), [0.06, 0.4, 0.3], [sx * 0.6, 0.2, 0]);
    }
    b.box(M.woodDark(), [1.2, 0.05, 0.05], [0, 0.15, 0]);
  },
  bed: (b) => {
    b.box(M.woodDark(), [1.0, 0.25, 2.0], [0, 0.25, 0]);
    legs(b, 1.0, 2.0, 0.2, 0.08);
    b.box(M.woodDark(), [1.0, 0.85, 0.08], [0, 0.45, -0.98]);
    b.box(M.cloth('#d8ccb0'), [0.9, 0.16, 1.85], [0, 0.45, 0.04]);
    b.box(M.cloth('#7a2e2a'), [0.94, 0.06, 1.2], [0, 0.55, 0.35]);
    b.sphere(M.cloth('#e6dcc4'), 0.22, [0, 0.6, -0.7], [1.6, 0.45, 0.8]);
  },
  bedDouble: (b) => {
    b.box(M.woodDark(), [1.5, 0.3, 2.05], [0, 0.27, 0]);
    legs(b, 1.5, 2.05, 0.2, 0.09);
    b.box(M.woodDark(), [1.5, 1.1, 0.09], [0, 0.55, -1.0]);
    for (const sx of [-1, 1]) b.box(M.woodDark(), [0.08, 1.25, 0.08], [sx * 0.72, 0.62, -1.0]);
    b.box(M.cloth('#d8ccb0'), [1.4, 0.18, 1.9], [0, 0.5, 0.05]);
    b.box(M.cloth('#2f4a5a'), [1.45, 0.07, 1.25], [0, 0.62, 0.36]);
    for (const sx of [-1, 1]) b.sphere(M.cloth('#e6dcc4'), 0.2, [sx * 0.34, 0.66, -0.72], [1.5, 0.45, 0.8]);
  },
  chest: (b) => {
    b.box(M.woodRed(), [0.95, 0.42, 0.5], [0, 0.21, 0]);
    b.box(M.woodRed(), [0.97, 0.12, 0.52], [0, 0.48, 0]);
    for (const sx of [-0.32, 0.32]) b.box(M.iron(), [0.06, 0.56, 0.54], [sx, 0.275, 0]);
    b.box(M.iron(), [0.12, 0.14, 0.03], [0, 0.4, 0.26]);
  },
  wardrobe: (b) => {
    b.box(M.woodDark(), [1.1, 1.85, 0.58], [0, 0.95, 0]);
    b.box(M.woodDark(), [1.16, 0.08, 0.62], [0, 1.91, 0]);
    b.box(M.wood(), [0.5, 1.6, 0.03], [-0.27, 0.95, 0.3]);
    b.box(M.wood(), [0.5, 1.6, 0.03], [0.27, 0.95, 0.3]);
    for (const sx of [-0.04, 0.04]) b.box(M.iron(), [0.025, 0.12, 0.03], [sx, 1.0, 0.32]);
  },
  cupboard: (b) => {
    b.box(M.woodDark(), [1.3, 0.85, 0.5], [0, 0.425, 0]);
    b.box(M.wood(), [0.6, 0.7, 0.03], [-0.32, 0.45, 0.26]);
    b.box(M.wood(), [0.6, 0.7, 0.03], [0.32, 0.45, 0.26]);
    b.box(M.woodDark(), [1.3, 0.9, 0.06], [0, 1.3, -0.22]);
    for (const sx of [-1, 1]) b.box(M.woodDark(), [0.05, 0.9, 0.3], [sx * 0.62, 1.3, -0.1]);
    for (const y of [1.15, 1.5]) b.box(M.woodDark(), [1.25, 0.04, 0.3], [0, y, -0.1]);
    for (let k = 0; k < 4; k++) b.cyl(M.ceramic(k % 2 ? '#d9cdb2' : '#8c6e4e'), 0.12, 0.12, 0.02, [-0.42 + k * 0.28, 1.27, -0.18], [Math.PI / 2 - 0.15, 0, 0], 14);
    for (let k = 0; k < 3; k++) b.cyl(M.ceramic('#6d5a48'), 0.06, 0.07, 0.16, [-0.3 + k * 0.3, 1.6, -0.1]);
  },
  shelf: (b) => {
    for (const sx of [-1, 1]) b.box(M.woodDark(), [0.05, 1.9, 0.36], [sx * 0.62, 0.95, 0]);
    for (const y of [0.1, 0.55, 1.0, 1.45, 1.88]) b.box(M.wood(), [1.24, 0.04, 0.34], [0, y, 0]);
    const r = seeded(3);
    for (const y of [0.12, 0.57, 1.02, 1.47]) {
      let x = -0.55;
      while (x < 0.5) {
        const k = r();
        if (k < 0.35) {
          b.cyl(M.ceramic(['#7a5c40', '#5b6a52', '#8e7a5a'][Math.floor(r() * 3)]), 0.07, 0.08, 0.2, [x + 0.08, y + 0.12, 0]);
          x += 0.2;
        } else if (k < 0.7) {
          b.box(M.cloth(['#5a2a20', '#2c3a4a', '#4a3a20'][Math.floor(r() * 3)]), [0.06, 0.26, 0.22], [x + 0.03, y + 0.15, 0], [0, 0, (r() - 0.5) * 0.2]);
          x += 0.08;
        } else {
          b.box(M.wood(), [0.2, 0.16, 0.2], [x + 0.1, y + 0.1, 0]);
          x += 0.26;
        }
      }
    }
  },
  jarShelf: (b) => {
    for (const sx of [-1, 1]) b.box(M.woodDark(), [0.05, 2.0, 0.36], [sx * 0.67, 1.0, 0]);
    const r = seeded(9);
    for (const y of [0.1, 0.5, 0.9, 1.3, 1.7, 1.98]) b.box(M.wood(), [1.34, 0.04, 0.34], [0, y, 0]);
    for (const y of [0.12, 0.52, 0.92, 1.32, 1.72])
      for (let x = -0.56; x < 0.6; x += 0.16 + r() * 0.06) {
        const h = 0.1 + r() * 0.14;
        b.cyl(M.glass(['#5f8a6a', '#8a6a3a', '#6a5a8a', '#3a5a6a', '#a07a4a'][Math.floor(r() * 5)]), 0.055, 0.06, h, [x, y + h / 2 + 0.02, (r() - 0.5) * 0.08]);
        b.cyl(M.cloth('#d8ccb0'), 0.058, 0.058, 0.02, [x, y + h + 0.03, 0]);
      }
  },
  barrel: (b) => {
    b.geo(barrelGeo(0.31, 0.9), M.wood(), [0, 0, 0]);
    b.cyl(M.woodDark(), 0.26, 0.26, 0.02, [0, 0.89, 0], [0, 0, 0], 14);
    for (const y of [0.12, 0.3, 0.6, 0.78]) b.cyl(M.iron(), 0.305 * (0.88 + 0.12 * Math.sin((y / 0.9) * Math.PI)) + 0.012, 0.305 * (0.88 + 0.12 * Math.sin((y / 0.9) * Math.PI)) + 0.012, 0.035, [0, y, 0], [0, 0, 0], 14);
  },
  barrelRack: (b) => {
    for (const sx of [-0.9, 0.9]) b.box(M.woodDark(), [0.1, 0.4, 0.9], [sx, 0.2, 0]);
    for (const sz of [-0.3, 0.3]) b.box(M.woodDark(), [2.0, 0.08, 0.08], [0, 0.32, sz]);
    for (const x of [-0.62, 0, 0.62]) {
      b.geo(barrelGeo(0.29, 0.86), M.wood(), [x, 0.68, 0.43], [Math.PI / 2, 0, 0]);
      b.cyl(M.woodDark(), 0.24, 0.24, 0.02, [x, 0.68, 0.44], [Math.PI / 2, 0, 0], 12);
      b.cyl(M.iron(), 0.03, 0.03, 0.08, [x, 0.55, 0.47], [Math.PI / 2, 0, 0], 6);
    }
  },
  wineRack: (b) => {
    for (const sx of [-1, 1]) b.box(M.woodDark(), [0.06, 1.9, 0.44], [sx * 0.87, 0.95, 0]);
    for (let y = 0.1; y < 1.9; y += 0.3) b.box(M.wood(), [1.74, 0.04, 0.42], [0, y, 0]);
    for (let y = 0.25; y < 1.8; y += 0.3) for (let x = -0.75; x <= 0.76; x += 0.15) b.cyl(M.glass('#1d2a1a'), 0.04, 0.04, 0.32, [x, y, 0.02], [Math.PI / 2, 0, 0], 8);
  },
  crate: (b) => crate(b, 0.7, 0.62, [0, 0, 0]),
  crates: (b) => {
    crate(b, 0.62, 0.55, [-0.32, 0, 0]);
    crate(b, 0.6, 0.55, [0.34, 0, 0.05], 0.15);
    crate(b, 0.55, 0.5, [-0.15, 0.55, 0], -0.2);
  },
  sacks: (b) => {
    b.sphere(M.cloth('#a89270'), 0.3, [-0.2, 0.26, 0], [0.9, 0.85, 0.75]);
    b.sphere(M.cloth('#9b8566'), 0.28, [0.24, 0.24, 0.05], [0.85, 0.85, 0.75]);
    b.sphere(M.cloth('#b09c78'), 0.24, [0.0, 0.52, 0], [0.9, 0.7, 0.75]);
  },
  counter: (b) => {
    b.box(M.woodDark(), [2.6, 0.08, 0.7], [0, 1.01, 0]);
    b.box(M.wood(), [2.5, 0.97, 0.05], [0, 0.49, 0.3]);
    for (const sx of [-1, 1]) b.box(M.woodDark(), [0.06, 0.97, 0.6], [sx * 1.27, 0.49, 0]);
    b.box(M.woodDark(), [2.5, 0.04, 0.55], [0, 0.45, -0.02]);
    for (const sx of [-0.4, 0.1, 0.7]) b.cyl(M.ceramic('#6d5a48'), 0.05, 0.06, 0.15, [sx, 1.12, 0.05]);
    b.box(M.cloth('#8a7a5a'), [0.5, 0.01, 0.3], [-0.9, 1.055, 0]);
  },
  workbench: (b) => {
    b.box(M.wood(), [1.8, 0.09, 0.8], [0, 0.84, 0]);
    legs(b, 1.7, 0.7, 0.8, 0.1);
    b.box(M.woodDark(), [1.5, 0.05, 0.6], [0, 0.25, 0]);
    b.box(M.iron(), [0.3, 0.03, 0.06], [0.4, 0.9, 0.1], [0, 0.4, 0]);
    b.box(M.woodDark(), [0.4, 0.05, 0.25], [-0.5, 0.91, 0]);
    b.cyl(M.ceramic('#8c6e4e'), 0.14, 0.1, 0.12, [0.1, 0.94, -0.15]);
  },
  anvil: (b) => {
    b.cyl(M.woodDark(), 0.26, 0.28, 0.5, [0, 0.25, 0], [0, 0, 0], 10);
    b.box(M.iron(), [0.3, 0.14, 0.24], [0, 0.57, 0]);
    b.box(M.iron(), [0.55, 0.14, 0.22], [0, 0.71, 0]);
    b.cyl(M.iron(), 0.02, 0.1, 0.3, [0.42, 0.72, 0], [0, 0, Math.PI / 2], 8);
  },
  forgeHearth: (b) => {
    b.box(M.stoneDark(), [2.2, 0.9, 1.4], [0, 0.45, 0]);
    b.box(M.ember(), [1.2, 0.08, 0.7], [0, 0.92, 0.1]);
    for (let k = 0; k < 9; k++) b.sphere(M.ember(), 0.08, [-0.45 + (k % 3) * 0.45, 0.95, -0.15 + Math.floor(k / 3) * 0.25], [1, 0.5, 1], 6);
    // hotte de pierre jusqu'au plafond
    b.box(M.stoneDark(), [2.0, 0.5, 1.1], [0, 2.05, -0.1]);
    b.box(M.stoneDark(), [1.2, 1.4, 0.8], [0, 2.95, -0.25]);
    b.box(M.iron(), [0.04, 0.6, 0.04], [0.8, 1.2, 0.55], [0.4, 0, 0]);
  },
  quench: (b) => {
    b.box(M.wood(), [1.2, 0.6, 0.05], [0, 0.3, 0.28]);
    b.box(M.wood(), [1.2, 0.6, 0.05], [0, 0.3, -0.28]);
    for (const sx of [-1, 1]) b.box(M.wood(), [0.05, 0.6, 0.6], [sx * 0.58, 0.3, 0]);
    b.box(M.wood(), [1.15, 0.05, 0.55], [0, 0.05, 0]);
    b.box(M.water(), [1.1, 0.02, 0.5], [0, 0.5, 0]);
  },
  grindstone: (b) => {
    for (const sx of [-1, 1]) b.box(M.woodDark(), [0.06, 0.75, 0.5], [sx * 0.25, 0.375, 0]);
    b.cyl(M.stone(), 0.35, 0.35, 0.12, [0, 0.72, 0], [0, 0, Math.PI / 2], 18);
    b.cyl(M.iron(), 0.03, 0.03, 0.7, [0, 0.72, 0], [0, 0, Math.PI / 2], 6);
    b.box(M.iron(), [0.05, 0.2, 0.05], [0.37, 0.62, 0]);
  },
  toolRack: (b) => {
    b.box(M.woodDark(), [1.5, 1.2, 0.04], [0, 1.1, -0.1]);
    const r = seeded(5);
    for (let k = 0; k < 6; k++) {
      const x = -0.6 + k * 0.24;
      b.box(M.woodDark(), [0.035, 0.7, 0.035], [x, 1.05, -0.04]);
      if (k % 2) b.box(M.iron(), [0.16, 0.12, 0.03], [x, 0.72 + r() * 0.05, -0.04]);
      else b.box(M.iron(), [0.05, 0.25, 0.04], [x, 1.4, -0.04]);
    }
  },
  bellows: (b) => {
    b.box(M.woodDark(), [0.5, 0.06, 0.8], [0, 0.55, 0], [0.12, 0, 0]);
    b.box(M.woodDark(), [0.5, 0.06, 0.8], [0, 0.3, 0]);
    b.box(M.cloth('#4a3424'), [0.46, 0.22, 0.7], [0, 0.42, 0.02]);
    b.cyl(M.iron(), 0.03, 0.05, 0.3, [0, 0.38, -0.5], [Math.PI / 2, 0, 0], 8);
    legs(b, 0.5, 0.8, 0.28, 0.05);
  },
  coal: (b) => {
    b.sphere(VM.paint('#141210', 1), 0.55, [0, 0, 0], [1, 0.75, 0.9], 10);
    b.sphere(VM.paint('#1c1915', 1), 0.3, [0.35, 0.1, 0.2], [1, 0.6, 1], 8);
  },
  pew: (b) => {
    b.box(M.woodDark(), [3.0, 0.06, 0.42], [0, 0.45, 0.05]);
    b.box(M.woodDark(), [3.0, 0.5, 0.05], [0, 0.72, -0.18], [-0.1, 0, 0]);
    for (const sx of [-1, 1]) b.box(M.woodDark(), [0.07, 0.95, 0.6], [sx * 1.47, 0.47, 0]);
    b.box(M.woodDark(), [2.9, 0.12, 0.05], [0, 0.85, -0.3]);
  },
  altar: (b) => {
    b.box(M.stone(), [2.2, 1.0, 0.95], [0, 0.5, 0]);
    b.box(M.cloth('#efe8d6'), [2.24, 0.02, 0.99], [0, 1.01, 0]);
    b.box(M.cloth('#6a1e22'), [1.2, 0.6, 0.02], [0, 0.72, 0.49]);
    for (const sx of [-0.7, 0.7]) {
      b.cyl(M.iron(), 0.06, 0.08, 0.06, [sx, 1.04, -0.2]);
      b.cyl(M.wax(), 0.035, 0.035, 0.38, [sx, 1.26, -0.2]);
      b.sphere(M.flame(), 0.025, [sx, 1.49, -0.2], [1, 1.8, 1], 6);
    }
    b.box(VM.paint('#b08a3a', 0.35, 0.8), [0.06, 0.6, 0.04], [0, 1.32, -0.3]);
    b.box(VM.paint('#b08a3a', 0.35, 0.8), [0.34, 0.06, 0.04], [0, 1.45, -0.3]);
  },
  lectern: (b) => {
    b.cyl(M.woodDark(), 0.06, 0.08, 1.05, [0, 0.52, 0]);
    b.cyl(M.woodDark(), 0.22, 0.25, 0.06, [0, 0.03, 0]);
    b.box(M.woodDark(), [0.55, 0.05, 0.42], [0, 1.12, 0], [0.45, 0, 0]);
    b.box(M.paper(), [0.42, 0.04, 0.3], [0, 1.16, 0.02], [0.45, 0, 0]);
  },
  font: (b) => {
    b.cyl(M.stone(), 0.18, 0.28, 0.7, [0, 0.35, 0], [0, 0, 0], 8);
    b.cyl(M.stone(), 0.5, 0.36, 0.3, [0, 0.85, 0], [0, 0, 0], 8);
    b.cyl(M.water(), 0.42, 0.42, 0.02, [0, 0.97, 0], [0, 0, 0], 16);
  },
  candelabra: (b) => {
    b.cyl(M.iron(), 0.18, 0.2, 0.05, [0, 0.025, 0]);
    b.cyl(M.iron(), 0.025, 0.025, 1.4, [0, 0.72, 0], [0, 0, 0], 6);
    b.box(M.iron(), [0.5, 0.03, 0.03], [0, 1.4, 0]);
    for (const sx of [-0.24, 0, 0.24]) {
      b.cyl(M.wax(), 0.03, 0.03, 0.18, [sx, 1.5 + (sx === 0 ? 0.06 : 0), 0]);
      b.sphere(M.flame(), 0.022, [sx, 1.62 + (sx === 0 ? 0.06 : 0), 0], [1, 1.8, 1], 6);
    }
  },
  desk: (b) => {
    b.box(M.woodDark(), [1.5, 0.06, 0.8], [0, 0.77, 0]);
    b.box(M.woodDark(), [0.45, 0.72, 0.72], [0.5, 0.37, 0]);
    for (const y of [0.25, 0.55]) b.box(M.wood(), [0.4, 0.22, 0.02], [0.5, y, 0.37]);
    for (const sz of [-1, 1]) b.box(M.woodDark(), [0.07, 0.74, 0.07], [-0.68, 0.37, sz * 0.33]);
    b.box(M.paper(), [0.42, 0.01, 0.3], [-0.2, 0.805, 0.05], [0, 0.2, 0]);
    b.box(M.paper(), [0.3, 0.01, 0.22], [-0.45, 0.81, -0.12], [0, -0.3, 0]);
    b.cyl(M.ceramic('#202020'), 0.04, 0.04, 0.06, [0.2, 0.83, -0.2]);
    b.cyl(M.wax(), 0.03, 0.03, 0.14, [0.55, 0.87, -0.25]);
    b.sphere(M.flame(), 0.02, [0.55, 0.96, -0.25], [1, 1.8, 1], 6);
  },
  weaponRack: (b) => {
    for (const sx of [-1, 1]) b.box(M.woodDark(), [0.08, 1.8, 0.25], [sx * 0.7, 0.9, 0]);
    for (const y of [0.3, 1.5]) b.box(M.woodDark(), [1.4, 0.08, 0.2], [0, y, 0]);
    for (let k = 0; k < 5; k++) {
      const x = -0.5 + k * 0.25;
      if (k % 2 === 0) {
        b.box(M.woodDark(), [0.035, 1.75, 0.035], [x, 0.95, 0.04]);
        b.box(M.iron(), [0.06, 0.2, 0.02], [x, 1.9, 0.04]);
      } else {
        b.box(M.iron(), [0.05, 0.85, 0.015], [x, 0.85, 0.04]);
        b.box(M.iron(), [0.2, 0.03, 0.04], [x, 1.3, 0.04]);
        b.box(M.cloth('#3a2a1a'), [0.04, 0.16, 0.04], [x, 1.4, 0.04]);
      }
    }
  },
  noticeBoard: (b) => {
    b.box(M.woodDark(), [1.3, 0.9, 0.05], [0, 0.45, 0]);
    const r = seeded(7);
    for (let k = 0; k < 5; k++) b.box(M.paper(), [0.22 + r() * 0.1, 0.28 + r() * 0.1, 0.01], [-0.45 + k * 0.23, 0.45 + (r() - 0.5) * 0.3, 0.03], [0, 0, (r() - 0.5) * 0.2]);
  },
  cot: (b) => {
    b.box(M.woodDark(), [0.8, 0.12, 1.9], [0, 0.32, 0]);
    legs(b, 0.8, 1.9, 0.3, 0.06);
    b.box(M.hay(), [0.72, 0.1, 1.8], [0, 0.42, 0]);
    b.box(M.cloth('#5a5040'), [0.74, 0.04, 0.9], [0, 0.48, 0.3]);
  },
  bucket: (b) => {
    b.cyl(M.wood(), 0.18, 0.14, 0.32, [0, 0.16, 0], [0, 0, 0], 12);
    b.cyl(M.iron(), 0.185, 0.185, 0.03, [0, 0.27, 0], [0, 0, 0], 12);
    b.cyl(M.water(), 0.16, 0.16, 0.01, [0, 0.28, 0], [0, 0, 0], 12);
  },
  hayBale: (b) => {
    b.box(M.hay(), [1.2, 0.5, 0.6], [0, 0.25, 0]);
    for (const sx of [-0.35, 0.35]) b.box(VM.paint('#5a4a2a', 1), [0.03, 0.52, 0.62], [sx, 0.25, 0]);
  },
  hayPile: (b) => {
    b.sphere(M.hay(), 1, [0, 0, 0], [1, 0.95, 0.9], 12);
    b.sphere(M.hay(), 0.6, [0.6, 0, 0.3], [1, 0.8, 1], 10);
  },
  trough: (b) => {
    b.box(M.wood(), [1.6, 0.45, 0.06], [0, 0.25, 0.22]);
    b.box(M.wood(), [1.6, 0.45, 0.06], [0, 0.25, -0.22]);
    for (const sx of [-1, 1]) b.box(M.wood(), [0.06, 0.45, 0.5], [sx * 0.77, 0.25, 0]);
    b.box(M.wood(), [1.55, 0.05, 0.42], [0, 0.05, 0]);
    b.box(M.hay(), [1.5, 0.12, 0.38], [0, 0.35, 0]);
  },
  saddleRack: (b) => {
    for (const sx of [-1, 1]) b.box(M.woodDark(), [0.06, 1.0, 0.06], [sx * 0.5, 0.5, 0]);
    b.box(M.woodDark(), [1.06, 0.08, 0.1], [0, 0.95, 0]);
    b.sphere(M.cloth('#5a3220'), 0.3, [0, 1.0, 0], [1.2, 0.5, 0.9], 10);
    b.box(M.cloth('#3a2418'), [0.04, 0.5, 0.06], [0.2, 0.7, 0.2]);
  },
  cart: (b) => {
    b.box(M.wood(), [1.4, 0.06, 2.4], [0, 0.72, 0]);
    for (const sx of [-1, 1]) b.box(M.wood(), [0.05, 0.4, 2.4], [sx * 0.68, 0.95, 0]);
    b.box(M.wood(), [1.4, 0.4, 0.05], [0, 0.95, -1.18]);
    for (const sx of [-1, 1]) {
      b.cyl(M.woodDark(), 0.55, 0.55, 0.08, [sx * 0.78, 0.55, -0.2], [0, 0, Math.PI / 2], 16);
      b.cyl(M.iron(), 0.08, 0.08, 0.14, [sx * 0.78, 0.55, -0.2], [0, 0, Math.PI / 2], 8);
      b.box(M.woodDark(), [0.06, 0.06, 1.6], [sx * 0.45, 0.62, 1.8], [0.12, 0, 0]);
    }
    b.sphere(M.hay(), 0.5, [0, 0.9, -0.3], [1.2, 0.5, 1.6], 10);
    b.box(M.woodDark(), [0.08, 0.3, 0.08], [0, 0.15, 2.4]);
  },
  mortarTable: (b) => {
    b.box(M.wood(), [1.0, 0.06, 0.6], [0, 0.82, 0]);
    legs(b, 0.95, 0.55, 0.79, 0.06);
    b.cyl(M.stone(), 0.09, 0.07, 0.1, [0.2, 0.9, 0]);
    b.cyl(M.woodDark(), 0.015, 0.025, 0.18, [0.24, 0.98, 0.02], [0.4, 0, 0.3], 6);
    for (let k = 0; k < 4; k++) b.cyl(M.glass(['#5f8a6a', '#8a3a3a', '#6a5a8a', '#a07a4a'][k]), 0.04, 0.05, 0.14, [-0.35 + k * 0.12, 0.92, -0.15]);
    b.box(M.paper(), [0.3, 0.01, 0.22], [-0.15, 0.86, 0.12], [0, 0.3, 0]);
  },
  herbRack: (b) => {
    b.box(M.woodDark(), [1.3, 0.05, 0.05], [0, 0.78, 0]);
    for (const sx of [-1, 1]) b.box(M.iron(), [0.03, 0.1, 0.2], [sx * 0.6, 0.75, -0.1]);
    const r = seeded(11);
    for (let k = 0; k < 8; k++) {
      const x = -0.55 + k * 0.157;
      b.box(M.cloth('#c8b890'), [0.01, 0.1, 0.01], [x, 0.7, 0]);
      b.sphere(M.leaf(['#5a6a3a', '#7a6a3a', '#4a5a3a', '#6a4a5a'][Math.floor(r() * 4)]), 0.07, [x, 0.55, 0], [0.8, 1.8, 0.8], 7);
    }
  },
  rug: (b) => {
    b.box(M.cloth('#6a2e22'), [2.0, 0.012, 1.3], [0, 0.006, 0]);
    b.box(M.cloth('#b08a4a'), [1.7, 0.014, 1.0], [0, 0.007, 0]);
    b.box(M.cloth('#4a2018'), [1.4, 0.016, 0.7], [0, 0.008, 0]);
  },
  spinningWheel: (b) => {
    const ring = new THREE.TorusGeometry(0.32, 0.025, 6, 20);
    b.geo(ring, M.wood(), [0.15, 0.62, 0], [0, Math.PI / 2, 0]);
    ring.dispose();
    b.box(M.woodDark(), [0.8, 0.06, 0.2], [0, 0.3, 0]);
    for (const sx of [-0.3, 0.3]) b.box(M.woodDark(), [0.04, 0.3, 0.04], [sx, 0.15, 0]);
    b.box(M.woodDark(), [0.04, 0.45, 0.04], [0.15, 0.5, 0.06]);
    b.box(M.woodDark(), [0.04, 0.45, 0.04], [0.15, 0.5, -0.06]);
    b.cyl(M.cloth('#d8ccb0'), 0.05, 0.05, 0.14, [-0.28, 0.5, 0], [0, 0, Math.PI / 2], 8);
  },
  oven: (b) => {
    b.box(M.stone(), [1.6, 0.8, 1.4], [0, 0.4, 0]);
    b.sphere(M.stone(), 0.75, [0, 0.8, -0.05], [1, 0.9, 0.9], 12);
    b.box(M.ember(), [0.5, 0.3, 0.05], [0, 0.98, 0.62]);
    b.box(M.stoneDark(), [0.7, 0.45, 0.04], [0, 1.0, 0.66]);
    b.cyl(M.stoneDark(), 0.15, 0.18, 0.9, [0, 1.85, -0.3]);
  },
  breadRack: (b) => {
    for (const sx of [-1, 1]) b.box(M.woodDark(), [0.05, 1.6, 0.45], [sx * 0.67, 0.8, 0]);
    for (const y of [0.3, 0.7, 1.1, 1.5]) {
      b.box(M.wood(), [1.3, 0.04, 0.42], [0, y, 0]);
      for (let x = -0.5; x <= 0.5; x += 0.25) b.sphere(VM.paint('#a66a2c', 0.75), 0.11, [x, y + 0.08, 0], [1.3, 0.6, 1], 8);
    }
  },
  tub: (b) => {
    b.geo(barrelGeo(0.5, 0.55), M.wood(), [0, 0, 0]);
    b.cyl(M.water(), 0.44, 0.44, 0.01, [0, 0.45, 0], [0, 0, 0], 16);
    b.cyl(M.iron(), 0.5, 0.5, 0.03, [0, 0.4, 0], [0, 0, 0], 16);
  },
  debris: (b) => {
    const r = seeded(13);
    for (let k = 0; k < 6; k++) b.box(M.wood(), [0.9 + r() * 0.4, 0.04, 0.14], [(r() - 0.5) * 0.8, 0.03 + k * 0.03, (r() - 0.5) * 0.7], [0, r() * 3, (r() - 0.5) * 0.2]);
    for (let k = 0; k < 5; k++) b.sphere(M.stone(), 0.08 + r() * 0.08, [(r() - 0.5) * 1.0, 0.05, (r() - 0.5) * 0.8], [1, 0.7, 1], 6);
    b.box(M.cloth('#4a4036'), [0.6, 0.02, 0.5], [0.2, 0.01, -0.1], [0, 0.4, 0]);
  },
  stallDivider: (b) => {
    b.box(M.wood(), [0.08, 1.3, 2.3], [0, 0.7, 0]);
    b.box(M.woodDark(), [0.14, 1.5, 0.14], [0, 0.75, 1.15]);
    b.box(M.woodDark(), [0.12, 0.08, 2.3], [0, 1.38, 0]);
  },
  firewood: (b) => {
    for (let row = 0; row < 3; row++)
      for (let k = 0; k < 5 - row; k++) b.cyl(M.woodDark(), 0.09, 0.09, 0.48, [-0.42 + k * 0.2 + row * 0.1, 0.09 + row * 0.16, 0], [Math.PI / 2, 0, 0], 7);
  },
  bedroll: (b) => {
    b.box(M.cloth('#6a5a44'), [0.8, 0.08, 1.9], [0, 0.04, 0]);
    b.cyl(M.cloth('#5a4a36'), 0.12, 0.12, 0.8, [0, 0.12, -0.8], [0, 0, Math.PI / 2], 10);
  },
  pallet: (b) => b.box(M.hay(), [1.6, 0.1, 1.0], [0, 0.05, 0]),

  // ───────────── décor extérieur ─────────────

  lanternPost: (b) => {
    b.box(M.stone(), [0.5, 0.25, 0.5], [0, 0.12, 0]);
    b.box(M.woodDark(), [0.16, 3.0, 0.16], [0, 1.6, 0]);
    b.box(M.woodDark(), [0.08, 0.08, 0.7], [0, 3.0, 0.3]);
    b.beam(M.woodDark(), [0, 2.55, 0.06], [0, 2.98, 0.45], 0.06);
    lantern(b, [0, 2.58, 0.6]);
  },
  wallLantern: (b) => {
    b.box(M.iron(), [0.06, 0.06, 0.45], [0, 0.4, 0.22]);
    b.box(M.iron(), [0.12, 0.2, 0.04], [0, 0.33, 0.02]);
    lantern(b, [0, 0.0, 0.42]);
  },
  well: (b) => {
    const ring = new THREE.CylinderGeometry(1.25, 1.3, 0.95, 20, 1, true);
    scaleUV(ring, 8, 1);
    b.geo(ring, M.stone(), [0, 0.47, 0]);
    ring.dispose();
    const inner = new THREE.CylinderGeometry(0.95, 0.95, 0.95, 20, 1, true);
    inner.scale(-1, 1, 1);
    b.geo(inner, M.stoneDark(), [0, 0.47, 0]);
    inner.dispose();
    const top = new THREE.RingGeometry(0.95, 1.32, 20, 1);
    b.geo(top, M.stone(), [0, 0.95, 0], [-Math.PI / 2, 0, 0]);
    top.dispose();
    b.cyl(M.water(), 0.95, 0.95, 0.02, [0, 0.15, 0], [0, 0, 0], 20);
    for (const sx of [-1, 1]) b.box(M.woodDark(), [0.16, 2.3, 0.16], [sx * 1.05, 1.9, 0]);
    b.cyl(M.woodDark(), 0.09, 0.09, 2.3, [0, 2.45, 0], [0, 0, Math.PI / 2], 8);
    b.box(M.iron(), [0.05, 0.3, 0.05], [1.25, 2.3, 0.15]);
    b.box(M.woodDark(), [2.6, 0.12, 0.12], [0, 3.05, 0]);
    for (const sz of [-1, 1]) b.box(M.woodDark(), [2.9, 0.08, 1.35], [0, 3.38, sz * 0.62], [sz * -0.62, 0, 0]);
    b.box(VM.woodShingles(), [3.0, 0.06, 1.4], [0, 3.45, -0.64], [0.62, 0, 0]);
    b.box(VM.woodShingles(), [3.0, 0.06, 1.4], [0, 3.45, 0.64], [-0.62, 0, 0]);
    b.box(M.iron(), [0.01, 1.2, 0.01], [0, 1.85, 0]);
    b.cyl(M.wood(), 0.15, 0.12, 0.25, [0, 1.15, 0]);
  },
  stall: (b) => {
    b.box(M.wood(), [2.6, 0.08, 1.1], [0, 0.88, 0]);
    b.box(M.wood(), [2.6, 0.84, 0.05], [0, 0.44, 0.52]);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(M.woodDark(), [0.1, sz < 0 ? 2.5 : 2.2, 0.1], [sx * 1.25, sz < 0 ? 1.25 : 1.1, sz * 0.5]);
    // auvent de toile rayée
    for (let k = 0; k < 6; k++) b.box(M.cloth(k % 2 ? '#e2d6b6' : '#8a2a22'), [0.48, 0.03, 1.5], [-1.2 + k * 0.48, 2.35, 0.12], [0.22, 0, 0]);
    // marchandises
    const r = seeded(17);
    for (let k = 0; k < 7; k++) b.sphere(M.leaf(['#a8442a', '#c8a03a', '#5a7a2a', '#7a2a3a'][Math.floor(r() * 4)]), 0.1, [-1.0 + k * 0.33, 0.99, 0.1 + (r() - 0.5) * 0.4], [1, 0.9, 1], 8);
    crate(b, 0.5, 0.45, [-0.7, 0.92, -0.2], 0.2);
    b.geo(barrelGeo(0.25, 0.7), M.wood(), [1.6, 0, 0.2]);
  },
  tavernSign: (b) => {
    b.box(M.iron(), [0.05, 0.05, 1.0], [0, 0.6, 0.5]);
    b.beam(M.iron(), [0, 0.15, 0.02], [0, 0.58, 0.6], 0.03);
    b.box(M.woodDark(), [0.06, 0.7, 0.85], [0, 0.18, 0.62]);
    b.box(VM.paint('#c8a040', 0.4, 0.6), [0.07, 0.36, 0.5], [0, 0.2, 0.62]);
  },
  shopSign: (b) => {
    b.box(M.iron(), [0.04, 0.04, 0.8], [0, 0.5, 0.4]);
    b.box(M.wood(), [0.05, 0.45, 0.6], [0, 0.22, 0.5]);
  },
  fence: (b) => {
    // segment de 2 m (le long de x)
    for (const sx of [-1, 1]) b.box(M.woodDark(), [0.1, 1.1, 0.1], [sx * 0.95, 0.55, 0], [0, 0, sx * 0.03]);
    b.box(M.wood(), [2.05, 0.08, 0.05], [0, 0.85, 0.05], [0, 0, 0.02]);
    b.box(M.wood(), [2.05, 0.08, 0.05], [0, 0.42, 0.05], [0, 0, -0.015]);
  },
  picket: (b) => {
    for (let k = 0; k < 9; k++) b.box(M.wood(), [0.09, 0.95 + ((k * 37) % 7) * 0.02, 0.03], [-0.92 + k * 0.23, 0.48, 0]);
    b.box(M.woodDark(), [2.0, 0.07, 0.05], [0, 0.65, -0.04]);
    b.box(M.woodDark(), [2.0, 0.07, 0.05], [0, 0.28, -0.04]);
  },
  stoneWall: (b) => {
    // muret de 2 m (le long de x)
    b.box(M.stone(), [2.0, 0.85, 0.5], [0, 0.42, 0]);
    b.box(M.stoneDark(), [2.04, 0.12, 0.56], [0, 0.88, 0]);
  },
  gravestone: (b) => {
    const s = new THREE.Shape();
    s.moveTo(-0.28, 0);
    s.lineTo(0.28, 0);
    s.lineTo(0.28, 0.7);
    s.absarc(0, 0.7, 0.28, 0, Math.PI, false);
    s.lineTo(-0.28, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: false }).translate(0, 0, -0.06);
    scaleUV(g, 1, 1);
    b.geo(g, M.stone(), [0, 0, 0]);
    g.dispose();
    b.box(M.soil(), [0.6, 0.12, 1.7], [0, 0.03, 0.95]);
  },
  graveCross: (b) => {
    b.box(M.stone(), [0.14, 1.1, 0.12], [0, 0.55, 0]);
    b.box(M.stone(), [0.6, 0.12, 0.12], [0, 0.82, 0]);
    b.box(M.stone(), [0.4, 0.15, 0.3], [0, 0.07, 0]);
    b.box(M.soil(), [0.6, 0.12, 1.7], [0, 0.03, 1.0]);
  },
  woodCross: (b) => {
    b.box(M.woodDark(), [0.1, 1.0, 0.08], [0, 0.45, 0], [0, 0, 0.08]);
    b.box(M.woodDark(), [0.45, 0.08, 0.08], [0.03, 0.72, 0], [0, 0, 0.08]);
    b.sphere(M.soil(), 0.5, [0, 0, 0.9], [1.1, 0.3, 1.8], 8);
  },
  tomb: (b) => {
    b.box(M.stone(), [1.0, 0.6, 2.1], [0, 0.3, 0]);
    b.box(M.stoneDark(), [1.1, 0.12, 2.2], [0, 0.66, 0]);
  },
  haystack: (b) => {
    b.sphere(M.hay(), 1.6, [0, 0.6, 0], [1, 1.2, 1], 12);
    b.cyl(M.woodDark(), 0.05, 0.05, 0.9, [0, 2.4, 0], [0, 0, 0], 6);
  },
  woodpile: (b) => {
    for (let row = 0; row < 4; row++)
      for (let k = 0; k < 9 - row; k++) b.cyl(M.woodDark(), 0.1, 0.1, 0.55, [-0.85 + k * 0.21 + row * 0.1, 0.1 + row * 0.18, 0], [Math.PI / 2, 0, 0], 7);
    b.box(VM.woodShingles(), [2.2, 0.05, 0.9], [0, 1.0, 0.05], [0.25, 0, 0]);
    for (const sx of [-1, 1]) b.box(M.woodDark(), [0.08, 1.0, 0.08], [sx * 1.0, 0.5, 0.4]);
  },
  scarecrow: (b) => {
    b.box(M.woodDark(), [0.08, 1.9, 0.08], [0, 0.95, 0]);
    b.box(M.woodDark(), [1.2, 0.07, 0.07], [0, 1.45, 0]);
    b.box(M.cloth('#5a4a30'), [0.5, 0.6, 0.22], [0, 1.3, 0]);
    b.sphere(M.cloth('#c8b080'), 0.16, [0, 1.8, 0]);
    b.cyl(M.hay(), 0.05, 0.3, 0.22, [0, 1.98, 0]);
  },
  signPost: (b) => {
    b.box(M.woodDark(), [0.1, 2.2, 0.1], [0, 1.1, 0]);
    b.box(M.wood(), [0.8, 0.18, 0.03], [0.3, 1.9, 0], [0, 0, 0.05]);
    b.box(M.wood(), [0.7, 0.18, 0.03], [-0.2, 1.6, 0.04], [0, 0.4, -0.04]);
  },
  cabbages: (b) => {
    b.box(M.soil(), [2.4, 0.18, 0.7], [0, 0.04, 0]);
    for (let k = 0; k < 6; k++) b.sphere(M.leaf(k % 2 ? '#4a6a32' : '#5a7a3a'), 0.17, [-1.0 + k * 0.4, 0.2, 0], [1, 0.8, 1], 8);
  },
  vegRow: (b) => {
    b.box(M.soil(), [2.4, 0.16, 0.6], [0, 0.03, 0]);
    for (let k = 0; k < 10; k++) b.cyl(M.leaf('#4f6f34'), 0.02, 0.09, 0.32, [-1.1 + k * 0.24, 0.24, 0], [0, k, 0.1], 5);
  },
  bell: (b) => {
    b.geo(bellGeo(), VM.paint('#7a5a2a', 0.35, 0.9), [0, 0, 0]);
    b.box(M.woodDark(), [1.6, 0.2, 0.2], [0, 1.0, 0]);
  },
  banner: (b) => {
    b.box(M.iron(), [0.04, 0.04, 0.9], [0, 0.9, 0.45]);
    b.box(M.cloth('#2a3a5a'), [0.03, 1.3, 0.7], [0, 0.2, 0.55]);
    b.box(VM.paint('#c8a040', 0.5, 0.4), [0.035, 0.3, 0.3], [0, 0.4, 0.55]);
  },
  pillory: (b) => {
    b.box(M.woodDark(), [0.2, 1.9, 0.2], [0, 0.95, 0]);
    b.box(M.wood(), [1.2, 0.3, 0.14], [0, 1.55, 0]);
    b.box(M.stone(), [1.6, 0.3, 1.6], [0, 0.15, 0]);
  },
  rockSmall: (b) => {
    const g = new THREE.DodecahedronGeometry(0.5, 0);
    b.geo(g, M.stone(), [0, 0.2, 0], [0.3, 0.6, 0.1], [1.2, 0.7, 1]);
    g.dispose();
  },
};

function crate(b: P, s: number, h: number, pos: V3, rot = 0) {
  b.box(M.wood(), [s, h, s], [pos[0], pos[1] + h / 2, pos[2]], [0, rot, 0]);
  const c = Math.cos(rot);
  const sn = Math.sin(rot);
  for (const sz of [-1, 1]) {
    const lz = sz * (s / 2 + 0.01);
    b.box(M.woodDark(), [s, 0.07, 0.02], [pos[0] + lz * sn, pos[1] + h * 0.85, pos[2] + lz * c], [0, rot, 0]);
    b.box(M.woodDark(), [s, 0.07, 0.02], [pos[0] + lz * sn, pos[1] + h * 0.15, pos[2] + lz * c], [0, rot, 0]);
  }
}

function lantern(b: P, at: V3) {
  const [x, y, z] = at;
  b.box(M.iron(), [0.26, 0.04, 0.26], [x, y + 0.42, z]);
  b.cyl(M.iron(), 0.02, 0.17, 0.14, [x, y + 0.5, z], [0, Math.PI / 4, 0], 4);
  b.box(M.lanternGlass(), [0.2, 0.3, 0.2], [x, y + 0.24, z]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(M.iron(), [0.025, 0.36, 0.025], [x + sx * 0.11, y + 0.24, z + sz * 0.11]);
  b.box(M.iron(), [0.24, 0.04, 0.24], [x, y + 0.06, z]);
}

function seeded(seed: number) {
  let s = seed * 9301 + 49297;
  return () => ((s = (s * 9301 + 49297) % 233280) / 233280);
}

/** Emprise (largeur, profondeur, hauteur) des objets d'extérieur qui bloquent le passage. */
const OUTDOOR_SOLIDS: Record<string, readonly [number, number, number]> = {
  lanternPost: [0.3, 0.3, 3.2],
  well: [2.6, 2.6, 1.0],
  stall: [2.7, 1.2, 2.4],
  fence: [2.0, 0.14, 1.1],
  picket: [2.0, 0.12, 1.0],
  stoneWall: [2.0, 0.5, 0.95],
  gravestone: [0.6, 0.16, 1.0],
  graveCross: [0.6, 0.3, 1.1],
  tomb: [1.0, 2.1, 0.72],
  haystack: [2.8, 2.8, 2.6],
  woodpile: [2.2, 0.7, 1.05],
  signPost: [0.14, 0.14, 2.2],
  pillory: [1.6, 1.6, 1.9],
};

/** Point de fixation de la flamme des lanternes, dans le repère de l'objet (pour les lumières). */
export const LANTERN_LIGHT: Record<string, V3> = { lanternPost: [0, 2.82, 0.6], wallLantern: [0, 0.24, 0.42] };

// ───────────────────────── instanciation ─────────────────────────

const geoCache = new Map<string, Map<THREE.Material, THREE.BufferGeometry>>();
function geometriesOf(type: string) {
  let g = geoCache.get(type);
  if (!g) {
    const build = BUILDERS[type];
    if (!build) throw new Error(`objet inconnu : ${type}`);
    const batch = new Batch();
    build(new P(batch));
    g = batch.geometries();
    geoCache.set(type, g);
  }
  return g;
}

export const hasProp = (type: string) => type in BUILDERS;

/**
 * Collecte des objets à poser (matrice monde par instance), puis création d'un InstancedMesh par type et par
 * matériau. Les objets d'intérieur ne projettent pas d'ombre (la lune n'entre pas dans les maisons).
 */
export class PropSet {
  private list = new Map<string, THREE.Matrix4[]>();

  add(type: string, m: THREE.Matrix4, outdoor: boolean) {
    const key = `${type}|${outdoor ? 'o' : 'i'}`;
    let l = this.list.get(key);
    if (!l) this.list.set(key, (l = []));
    l.push(m.clone());
  }

  /** Pose un objet au point (x, y, z) monde, tourné de `rot` autour de y (et penché de `tilt`). */
  place(type: string, x: number, y: number, z: number, rot: number, outdoor: boolean, o: { tilt?: number; scale?: number } = {}) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(o.tilt ?? 0, rot, (o.tilt ?? 0) * 0.3, 'YXZ'));
    const s = o.scale ?? 1;
    this.add(type, new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s, s)), outdoor);
  }

  /**
   * Emprises des objets d'extérieur qui gênent le passage (les meubles d'intérieur sont pris dans les plans).
   * Une clôture étirée garde son étirement.
   */
  obstacles(): Obb[] {
    const out: Obb[] = [];
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const e = new THREE.Euler();
    for (const [key, list] of this.list) {
      const [type, where] = key.split('|');
      if (where !== 'o') continue;
      const dims = OUTDOOR_SOLIDS[type] ?? (type in FURN && !['rug', 'pallet', 'bedroll', 'debris'].includes(type) ? FURN[type as keyof typeof FURN] : null);
      if (!dims) continue;
      for (const m of list) {
        m.decompose(p, q, s);
        e.setFromQuaternion(q, 'YXZ');
        out.push({ x: p.x, z: p.z, hx: (dims[0] / 2) * s.x, hz: (dims[1] / 2) * s.z, rot: e.y, y0: p.y - 0.3, y1: p.y + dims[2] * s.y, tag: type });
      }
    }
    return out;
  }

  count() {
    let n = 0;
    for (const l of this.list.values()) n += l.length;
    return n;
  }

  build(): THREE.Group {
    const g = new THREE.Group();
    g.name = 'objets';
    for (const [key, mats] of this.list) {
      const [type, where] = key.split('|');
      for (const [mat, geo] of geometriesOf(type)) {
        const im = new THREE.InstancedMesh(geo, mat, mats.length);
        mats.forEach((m, i) => im.setMatrixAt(i, m));
        im.instanceMatrix.needsUpdate = true;
        im.castShadow = where === 'o';
        im.receiveShadow = true;
        im.computeBoundingSphere();
        im.name = `${type}${where === 'i' ? ' (intérieur)' : ''}`;
        g.add(im);
      }
    }
    return g;
  }
}
