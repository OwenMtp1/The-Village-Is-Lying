/**
 * Monde de référence du Gunfight : bâtiments, terrain, souterrains, mur d'enceinte et végétation (troncs, rochers),
 * sans le petit mobilier des rues que seul le navigateur connaît. Le serveur et le navigateur en tirent les mêmes
 * couverts (`mapProps`) ; le serveur s'en sert aussi pour les lignes de vue et les rebonds des grenades.
 */
import { buildCollisionWorld, type CollisionWorld } from '../village/collision';
import { vegetationObstacles } from '../village/vegetation';
import { mapOf } from './gunfightMaps';
import { mapProps, type GFProp } from './gunfightProps';

let world: CollisionWorld | null = null;

export function gunfightWorld(): CollisionWorld {
  if (!world) {
    world = buildCollisionWorld();
    for (const o of vegetationObstacles()) world.addObstacle(o);
  }
  return world;
}

/** Couverts d'une carte, calculés sur le monde de référence (identiques côté serveur et navigateur). */
export function gunfightProps(mapId: string): GFProp[] {
  const w = gunfightWorld();
  return mapProps(mapOf(mapId), (x, y, z) => w.blocksPoint(x, y, z, 0.1));
}
