/**
 * Rendu des souterrains (géométries fusionnées par matériau, objets instanciés du catalogue).
 * Les données (salles, galeries, puits, cellules) viennent de `underground.ts` et `boundary.ts`.
 */
import * as THREE from 'three';
import { Batch } from './geom';
import { VM } from './textures';
import { LANTERN_LIGHT, type PropSet } from './props';
import type { WorldLight } from './buildings';
import { CELLS, CISTERN_POOL, ROOMS, SHAFTS, TUNNELS, UNDER, entranceRocks, lanterns, roomItems, slabRects, wallBoxes } from './underground';

const LAMP = { color: '#ffa04a', intensity: 6, distance: 11 };

export function buildUnderground(props: PropSet): { group: THREE.Group; lights: WorldLight[] } {
  const F = UNDER.floor;
  const H = UNDER.height;
  const b = new Batch();
  const wall = VM.stoneDark('#9a8d7c');
  const vault = VM.stoneDark('#6e665c');
  const floor = VM.flagstone();
  const timber = VM.timber();
  const iron = new THREE.MeshStandardMaterial({ color: '#2a2724', roughness: 0.55, metalness: 0.8 });
  const stone = VM.stone('#c7bba8');
  const planks = VM.planks('#7a5a3e');
  const cloth = new THREE.MeshStandardMaterial({ color: '#6e1f1c', roughness: 0.9 });
  const lights: WorldLight[] = [];
  const light = (x: number, y: number, z: number, o: Partial<typeof LAMP> = {}) => lights.push({ x, y, z, ...LAMP, ...o, flicker: true, indoor: true, building: 'souterrain' });

  for (const w of wallBoxes()) b.box(wall, [w.x1 - w.x0, w.y1 - w.y0, w.z1 - w.z0], [(w.x0 + w.x1) / 2, (w.y0 + w.y1) / 2, (w.z0 + w.z1) / 2]);
  for (const r of slabRects(false)) b.box(floor, [r.x1 - r.x0, 0.3, r.z1 - r.z0], [(r.x0 + r.x1) / 2, F - 0.15, (r.z0 + r.z1) / 2]);
  for (const r of slabRects(true)) b.box(vault, [r.x1 - r.x0, 0.4, r.z1 - r.z0], [(r.x0 + r.x1) / 2, F + H + 0.2, (r.z0 + r.z1) / 2]);

  // étais de bois dans les galeries principales : deux montants et un chapeau tous les 3,5 m ; boyaux : rondins bas
  for (const t of TUNNELS)
    for (let k = 0; k < t.pts.length - 1; k++) {
      const [ax, az] = t.pts[k];
      const [bx, bz] = t.pts[k + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const ux = (bx - ax) / len;
      const uz = (bz - az) / len;
      const rot = Math.atan2(ux, uz);
      const step = t.secret ? 2.5 : 3.5;
      for (let d = 1.5; d < len - 1; d += step) {
        const x = ax + ux * d;
        const z = az + uz * d;
        const hw = t.w / 2 - 0.1;
        const top = t.secret ? F + 1.9 : F + H - 0.15;
        for (const s of [-1, 1]) b.box(timber, [0.2, top - F, 0.2], [x - uz * hw * s, F + (top - F) / 2, z + ux * hw * s], { rot: [0, rot, 0] });
        b.box(timber, [t.w, 0.25, 0.25], [x, top, z], { rot: [0, rot + Math.PI / 2, 0] });
      }
      // boyau secret : plafond bas (on y passe courbé), rien n'éclaire
      if (t.secret) b.box(vault, [t.w + 0.1, H - 2.05, len], [(ax + bx) / 2, F + 2.05 + (H - 2.05) / 2, (az + bz) / 2], { rot: [0, rot, 0] });
    }

  // lanternes murales et chandeliers allumés
  for (const l of lanterns()) {
    const y = F + 2.1;
    props.place('wallLantern', l.x, y, l.z, l.rot, false);
    const o = LANTERN_LIGHT.wallLantern;
    light(l.x + Math.sin(l.rot) * o[2], y + o[1], l.z + Math.cos(l.rot) * o[2]);
  }
  for (const it of roomItems()) {
    if (it.type === 'tombeau') {
      b.box(stone, [1.0, 0.8, 2.2], [it.x, F + 0.4, it.z]);
      b.box(stone, [1.15, 0.12, 2.35], [it.x, F + 0.86, it.z]);
      continue;
    }
    props.place(it.type, it.x, F + (it.y ?? 0), it.z, it.rot, false);
    if (it.type === 'candelabra') light(it.x, F + 1.55, it.z, { intensity: 4, distance: 8 });
  }

  // geôles : grilles (barreaux tous les 14 cm, porte ouverte sur certaines), murs entre cellules
  for (const c of CELLS) {
    const door = c.open ? [c.x0 + 0.5, c.x0 + 1.4] : null;
    for (let x = c.x0 + 0.07; x < c.x1; x += 0.14) if (!door || x < door[0] || x > door[1]) b.box(iron, [0.035, H, 0.035], [x, F + H / 2, c.bars]);
    for (const y of [0.12, 1.1, H - 0.2]) {
      if (door) {
        b.box(iron, [door[0] - c.x0, 0.06, 0.05], [(c.x0 + door[0]) / 2, F + y, c.bars]);
        b.box(iron, [c.x1 - door[1], 0.06, 0.05], [(door[1] + c.x1) / 2, F + y, c.bars]);
      } else b.box(iron, [c.x1 - c.x0, 0.06, 0.05], [(c.x0 + c.x1) / 2, F + y, c.bars]);
    }
    if (door) {
      // porte de cellule entrebâillée
      const g = new THREE.Group();
      void g;
      for (let k = 0; k < 6; k++) b.box(iron, [0.035, H - 0.2, 0.035], [door[0] + 0.05, F + (H - 0.2) / 2, c.bars + 0.14 + k * 0.14], {});
    }
    b.box(wall, [0.24, H, Math.abs(c.z1 - c.z0)], [c.x1, F + H / 2, (c.z0 + c.z1) / 2]);
  }

  // salle du conseil : bannières ; chapelle : vitrail aveugle (tenture) derrière l'autel
  for (const r of ROOMS) {
    const cx = (r.x0 + r.x1) / 2;
    if (r.kind === 'conseil') for (const dx of [-3, 3]) b.box(cloth, [1.1, 2.0, 0.04], [cx + dx, F + 1.7, r.z1 - 0.05]);
    if (r.kind === 'chapelle') b.box(cloth, [2.6, 2.4, 0.04], [cx, F + 1.8, r.z0 + 0.05]);
  }

  // citerne : parapet de pierre et eau sombre
  const P = CISTERN_POOL;
  b.box(stone, [P.x1 - P.x0 + 0.6, 0.6, 0.3], [(P.x0 + P.x1) / 2, F + 0.3, P.z0 - 0.15]);
  b.box(stone, [P.x1 - P.x0 + 0.6, 0.6, 0.3], [(P.x0 + P.x1) / 2, F + 0.3, P.z1 + 0.15]);
  b.box(stone, [0.3, 0.6, P.z1 - P.z0], [P.x0 - 0.15, F + 0.3, (P.z0 + P.z1) / 2]);
  b.box(stone, [0.3, 0.6, P.z1 - P.z0], [P.x1 + 0.15, F + 0.3, (P.z0 + P.z1) / 2]);
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(P.x1 - P.x0, P.z1 - P.z0).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: '#0b1d26', roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0.92 }),
  );
  water.position.set((P.x0 + P.x1) / 2, F + 0.42, (P.z0 + P.z1) / 2);
  water.name = 'citerne:eau';

  // puits d'accès : parois, échelle ; en surface, le déguisement de chaque entrée
  const h = UNDER.shaft / 2;
  for (const s of SHAFTS) {
    const top = s.ground;
    const sh = top - (F + H);
    const midY = F + H + sh / 2;
    const n = UNDER.niche;
    b.box(wall, [0.4, sh, UNDER.shaft + n + 0.8], [s.x - h - 0.2, midY, s.z - n / 2]);
    b.box(wall, [0.4, sh, UNDER.shaft + n + 0.8], [s.x + h + 0.2, midY, s.z - n / 2]);
    b.box(wall, [UNDER.shaft, sh, 0.4], [s.x, midY, s.z - h - n - 0.2]);
    b.box(wall, [UNDER.shaft, sh, 0.4], [s.x, midY, s.z + h + 0.2]);
    // voûte de la niche (sous le terrain, qui n'est pas visible par-dessous)
    b.box(vault, [UNDER.shaft, 0.3, n], [s.x, top - 0.45, s.z - h - n / 2]);
    // échelle : deux montants le long de la rampe, un barreau tous les 30 cm
    const z0 = s.z - h - 0.6;
    const z1 = s.z + h + 0.2;
    const rise = top - F;
    const run = z1 - z0;
    const len = Math.hypot(rise, run);
    const tilt = Math.atan2(run, rise);
    for (const dx of [-0.3, 0.3]) b.box(timber, [0.07, len, 0.07], [s.x + dx, F + rise / 2, (z0 + z1) / 2], { rot: [tilt, 0, 0] });
    for (let y = 0.3; y < rise; y += 0.3) b.box(timber, [0.66, 0.05, 0.05], [s.x, F + y, z0 + (y / rise) * run]);
    if (s.look === 'puits') {
      for (const [w, d, x, z] of [
        [0.35, UNDER.shaft + 0.7, s.x - h - 0.175, s.z],
        [0.35, UNDER.shaft + 0.7, s.x + h + 0.175, s.z],
        [UNDER.shaft, 0.35, s.x, s.z - h - 0.175],
      ] as const)
        b.box(stone, [w, 1.15, d], [x, top + 0.85 - 0.575, z]);
      b.box(stone, [UNDER.shaft, 0.4, 0.35], [s.x, top - 0.05, s.z + h + 0.175]);
      for (const dx of [-1.15, 1.15]) b.box(timber, [0.14, 2.2, 0.14], [s.x + dx, top + 1.1, s.z]);
      b.box(timber, [2.5, 0.14, 0.14], [s.x, top + 2.2, s.z]);
    } else if (s.look === 'mausolee') {
      const m = 2.2;
      const mat = stone;
      b.box(mat, [0.4, 3.5, 2 * m + 1.2], [s.x - m - 0.2, top + 1.45, s.z + 0.6]);
      b.box(mat, [0.4, 3.5, 2 * m + 1.2], [s.x + m + 0.2, top + 1.45, s.z + 0.6]);
      b.box(mat, [2 * m + 0.8, 3.5, 0.4], [s.x, top + 1.45, s.z - m - 0.2]);
      b.box(mat, [m - 0.25, 3.5, 0.4], [s.x - (m + 0.65) / 2 - 0.2, top + 1.45, s.z + m + 1.4]);
      b.box(mat, [m - 0.25, 3.5, 0.4], [s.x + (m + 0.65) / 2 + 0.2, top + 1.45, s.z + m + 1.4]);
      b.box(mat, [1.3, 0.8, 0.4], [s.x, top + 2.8, s.z + m + 1.4]);
      b.box(VM.stoneDark('#8a8174'), [2 * m + 1.4, 0.35, 2 * m + 2.2], [s.x, top + 3.35, s.z + 0.6]);
      b.box(VM.stoneDark('#8a8174'), [2 * m + 0.6, 0.5, 2 * m + 1.4], [s.x, top + 3.7, s.z + 0.6]);
      for (const [w, d, x, z] of [
        [0.3, UNDER.shaft + 0.3, s.x - h - 0.15, s.z - 0.15],
        [0.3, UNDER.shaft + 0.3, s.x + h + 0.15, s.z - 0.15],
        [UNDER.shaft, 0.3, s.x, s.z - h - 0.15],
      ] as const)
        b.box(stone, [w, 0.5, d], [x, top + 0.25, z]);
      // grille de la porte, ouverte contre le mur
      for (let k = 0; k < 9; k++) b.box(iron, [0.03, 2.3, 0.03], [s.x + 0.65 + 0.06, top + 1.15, s.z + m + 1.65 + k * 0.13]);
      light(s.x, top + 2.4, s.z + 0.5, { intensity: 2.5, distance: 6 });
    } else {
      // trappe de bois ouverte, posée contre le bord, et margelle plate
      b.box(stone, [UNDER.shaft + 0.7, 0.25, 0.35], [s.x, top + 0.07, s.z - h - 0.175]);
      b.box(stone, [0.35, 0.25, UNDER.shaft], [s.x - h - 0.175, top + 0.07, s.z]);
      b.box(stone, [0.35, 0.25, UNDER.shaft], [s.x + h + 0.175, top + 0.07, s.z]);
      b.box(planks, [UNDER.shaft, 0.07, UNDER.shaft], [s.x, top + 0.7, s.z - h - 0.45], { rot: [-1.25, 0, 0] });
      if (s.look === 'trappe-foin') {
        props.place('hayPile', s.x - 3, top, s.z - 1, 0.4, true);
        props.place('hayBale', s.x + 2.6, top, s.z - 0.5, 1.2, true);
        props.place('hayBale', s.x + 2.4, top, s.z - 2.2, 0.2, true);
      }
      if (s.look === 'trappe-jardin') {
        props.place('firewood', s.x - 2.6, top, s.z, Math.PI / 2, true);
        props.place('debris', s.x + 2.5, top, s.z - 1.5, 0.6, true);
      }
    }
  }
  for (const r of entranceRocks()) b.box(VM.stoneDark('#8d8a80'), [r.w, r.h + 1, r.d], [r.x, (r as unknown as { y: number }).y + r.h / 2 - 0.4, r.z], { rot: [0.08, r.rot, -0.06] });

  const group = b.build('souterrains');
  group.add(water);
  group.name = 'souterrains';
  return { group, lights };
}
