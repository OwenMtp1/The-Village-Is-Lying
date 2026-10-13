/**
 * Assemblage du village : bâtiments (extérieurs, intérieurs, toits), mobilier et décor instanciés, terrain,
 * végétation. La construction est découpée en étapes qui rendent la main au navigateur (barre de progression,
 * page réactive pendant le chargement).
 */
import * as THREE from 'three';
import { BUILDINGS } from './layout';
import { buildBuilding, type BuiltBuilding, type WorldLight } from './buildings';
import { buildDecor } from './decor';
import { PropSet } from './props';
import { buildTerrain, type Terrain } from './terrain';
import { buildVegetation } from './vegetation';

export interface Village {
  root: THREE.Group;
  buildings: BuiltBuilding[];
  lights: WorldLight[];
  terrain: Terrain;
  stats: { buildings: number; props: number; lights: number; rooms: number };
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
  terrain.setHoles(buildings.flatMap((b) => (b.cellarHole ? [b.cellarHole] : [])));
  progress(0.76, 'Forêt et végétation');
  await frame();
  const veg = buildVegetation();
  progress(0.92, 'Mobilier et objets');
  await frame();
  const propMesh = props.build();
  root.add(terrain.mesh, propMesh, decor.mesh, veg);
  const bgroup = new THREE.Group();
  bgroup.name = 'batiments';
  for (const b of buildings) bgroup.add(b.group);
  root.add(bgroup);
  const lights = [...buildings.flatMap((b) => b.lights), ...decor.lights];
  return {
    root,
    buildings,
    lights,
    terrain,
    stats: {
      buildings: buildings.length,
      props: props.count(),
      lights: lights.length,
      rooms: buildings.reduce((s, b) => s + b.plan.levels.reduce((n, l) => n + l.rooms.length, 0), 0),
    },
  };
}
