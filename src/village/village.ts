/**
 * Assemblage du village : bâtiments (extérieurs, intérieurs, toits), mobilier et décor instanciés, terrain,
 * végétation. La construction est découpée en étapes qui rendent la main au navigateur (barre de progression,
 * page réactive pendant le chargement).
 */
import { SHAFTS, UNDER } from './underground';
import { buildUnderground } from './undergroundMesh';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BUILDINGS } from './layout';
import { buildBuilding, type BuiltBuilding, type WorldLight } from './buildings';
import { buildDecor } from './decor';
import { PropSet } from './props';
import { buildTerrain, type Terrain } from './terrain';
import { buildVegetation } from './vegetation';
import { buildCollisionWorld, type CollisionWorld } from './collision';

export interface Village {
  root: THREE.Group;
  buildings: BuiltBuilding[];
  lights: WorldLight[];
  /** galeries souterraines (masquées quand la caméra est loin d'elles) */
  underground: THREE.Group;
  terrain: Terrain;
  /** collisions (murs, portes, planchers, escaliers, mobilier, décor, troncs) */
  collision: CollisionWorld;
  stats: { buildings: number; props: number; lights: number; rooms: number };
}

/**
 * Façades fusionnées par quartier et par matériau : quelques dizaines d'appels de dessin au lieu de plusieurs
 * centaines. Les intérieurs et les toits restent par bâtiment (masquables individuellement).
 */
function mergeFacades(buildings: BuiltBuilding[]): THREE.Group {
  const chunks = new Map<string, Map<THREE.Material, THREE.BufferGeometry[]>>();
  for (const b of buildings) {
    const ext = b.group.getObjectByName('exterieur');
    if (!ext) continue;
    let byMat = chunks.get(b.spec.district);
    if (!byMat) chunks.set(b.spec.district, (byMat = new Map()));
    for (const o of ext.children) {
      const m = o as THREE.Mesh;
      const g = m.geometry.clone().applyMatrix4(b.matrix);
      const mat = m.material as THREE.Material;
      let list = byMat.get(mat);
      if (!list) byMat.set(mat, (list = []));
      list.push(g);
      m.geometry.dispose();
    }
    b.group.remove(ext);
  }
  const g = new THREE.Group();
  g.name = 'facades';
  for (const [district, byMat] of chunks)
    for (const [mat, list] of byMat) {
      const merged = mergeGeometries(list, false);
      for (const l of list) l.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.name = `facades:${district}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
    }
  return g;
}

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

export async function buildVillage(progress: (f: number, label: string) => void = () => {}): Promise<Village> {
  const root = new THREE.Group();
  root.name = 'village';
  const props = new PropSet();
  const buildings: BuiltBuilding[] = [];
  progress(0.02, 'Tracé des rues et des quartiers');
  await frame();
  for (let i = 0; i < BUILDINGS.length; i++) {
    buildings.push(buildBuilding(BUILDINGS[i], props));
    if (i % 4 === 3) {
      progress(0.05 + (0.5 * i) / BUILDINGS.length, `Construction : ${BUILDINGS[i].name}`);
      await frame();
    }
  }
  progress(0.58, 'Décor des rues, jardins et cimetière');
  await frame();
  const decor = buildDecor(buildings, props);
  progress(0.66, 'Terrain et chemins');
  await frame();
  const terrain = buildTerrain(buildings.flatMap((b) => b.doors));
  // terrain percé au droit des caves et des puits d'accès aux souterrains
  terrain.setHoles([...buildings.flatMap((b) => (b.cellarHole ? [b.cellarHole] : [])), ...SHAFTS.map((s) => ({ x: s.x, z: s.z, rot: 0, hw: UNDER.shaft / 2, hd: UNDER.shaft / 2 }))]);
  progress(0.7, 'Souterrains');
  await frame();
  const under = buildUnderground(props);
  progress(0.76, 'Forêt et végétation');
  await frame();
  const veg = buildVegetation();
  progress(0.88, 'Collisions');
  await frame();
  const collision = buildCollisionWorld();
  for (const o of [...props.obstacles(), ...decor.obstacles, ...veg.obstacles]) collision.addObstacle(o);
  progress(0.92, 'Mobilier et objets');
  await frame();
  const propMesh = props.build();
  root.add(terrain.mesh, propMesh, decor.mesh, veg.group, under.group);
  const bgroup = new THREE.Group();
  bgroup.name = 'batiments';
  for (const b of buildings) bgroup.add(b.group);
  root.add(bgroup, mergeFacades(buildings));
  const lights = [...buildings.flatMap((b) => b.lights), ...decor.lights, ...under.lights];
  return {
    underground: under.group,
    root,
    buildings,
    lights,
    terrain,
    collision,
    stats: {
      buildings: buildings.length,
      props: props.count(),
      lights: lights.length,
      rooms: buildings.reduce((s, b) => s + b.plan.levels.reduce((n, l) => n + l.rooms.length, 0), 0),
    },
  };
}
