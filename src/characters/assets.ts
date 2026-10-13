/**
 * Chargement des personnages : un GLB par modèle et un fichier d'animations par sexe, chargés une seule fois
 * et partagés (géométries, textures, matériaux, clips). Chaque personnage en jeu est un clone (SkeletonUtils)
 * qui ne possède que son squelette et son mixeur d'animation.
 *
 * Contrôles à l'ouverture : chaque piste d'animation doit trouver son os dans le modèle (même squelette Biped),
 * sinon le clip est écarté et signalé — jamais de clip forcé sur un squelette incompatible.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PACKED, animsUrl, modelUrl, variantById, type CharacterVariant, type Sex } from './catalog';

/** Clips de locomotion « en place » utilisés (la translation horizontale a été retirée par le pipeline). */
export const LOCOMOTION = ['walk_slow', 'walk', 'run'] as const;
export type LocoClip = (typeof LOCOMOTION)[number];

interface AnimSet {
  clips: Map<string, THREE.AnimationClip>;
  /** vitesse (m/s) sans glissement à cadence 1, squelette des animations */
  speed: Record<string, number>;
  hipHeight: number;
  phase?: Record<string, number>;
}

export interface CharacterBase {
  variant: CharacterVariant;
  scene: THREE.Group;
  /** hauteur du modèle source (m) */
  height: number;
  clips: Map<string, THREE.AnimationClip>;
  /** vitesses sans glissement à l'échelle du modèle source */
  speed: Record<LocoClip, number>;
  /** décalage de phase des cycles (0 = pied gauche le plus en avant) : cycles mélangés en phase */
  phase: Record<string, number>;
  /** rapport bassin du modèle / bassin du squelette des animations */
  stride: number;
  /** problèmes relevés au chargement (pistes sans os…) */
  warnings: string[];
}

const loader = new GLTFLoader();

/** Charge un GLB (ou sa version emballée en JSON dans la démonstration publiée). */
async function loadGlb(url: string) {
  if (!PACKED) return loader.loadAsync(url);
  const res = await fetch(`${url}.json`);
  if (!res.ok) throw new Error(`${url} : ${res.status}`);
  const { data } = (await res.json()) as { data: string };
  const bin = atob(data);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return loader.parseAsync(buf.buffer, '');
}
const animSets = new Map<Sex, Promise<AnimSet>>();
const bases = new Map<string, Promise<CharacterBase>>();

function loadAnims(sex: Sex): Promise<AnimSet> {
  let p = animSets.get(sex);
  if (!p) {
    p = loadGlb(animsUrl(sex)).then((gltf) => {
      const extras = (gltf.parser.json.extras ?? {}) as { hipHeight?: number; clips?: Record<string, { speed?: number }> };
      const speed: Record<string, number> = {};
      for (const [k, v] of Object.entries(extras.clips ?? {})) if (v.speed) speed[k] = v.speed;
      return { clips: new Map(gltf.animations.map((a) => [a.name, a])), speed, hipHeight: extras.hipHeight ?? 0.92 };
    });
    animSets.set(sex, p);
    p.catch(() => animSets.delete(sex));
  }
  return p;
}

/**
 * Mesure (une fois par sexe) l'instant de chaque cycle où le pied gauche est le plus en avant : les cycles
 * de marche lente, marche et course sont mélangés en phase (pas de pieds qui se croisent pendant un fondu).
 */
function measurePhases(scene: THREE.Object3D, clips: Map<string, THREE.AnimationClip>): Record<string, number> {
  const saved: [THREE.Object3D, THREE.Vector3, THREE.Quaternion][] = [];
  let left: THREE.Object3D | undefined;
  let right: THREE.Object3D | undefined;
  scene.traverse((o) => {
    saved.push([o, o.position.clone(), o.quaternion.clone()]);
    if (o.name === 'L_Foot') left = o;
    if (o.name === 'R_Foot') right = o;
  });
  const out: Record<string, number> = {};
  if (!left || !right) return out;
  const mixer = new THREE.AnimationMixer(scene);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  for (const name of LOCOMOTION) {
    const clip = clips.get(name);
    if (!clip) continue;
    const action = mixer.clipAction(clip);
    action.play();
    let best = -Infinity;
    const N = 60;
    for (let i = 0; i < N; i++) {
      mixer.setTime((i / N) * clip.duration);
      scene.updateMatrixWorld(true);
      left.getWorldPosition(a);
      right.getWorldPosition(b);
      if (a.z - b.z > best) {
        best = a.z - b.z;
        out[name] = i / N;
      }
    }
    action.stop();
    mixer.uncacheAction(clip);
  }
  mixer.uncacheRoot(scene);
  for (const [o, p, q] of saved) {
    o.position.copy(p);
    o.quaternion.copy(q);
  }
  scene.updateMatrixWorld(true);
  return out;
}

/** Charge (une fois) un personnage et les animations de son sexe. */
export function loadCharacter(id: string): Promise<CharacterBase> {
  let p = bases.get(id);
  if (p) return p;
  const variant = variantById(id);
  if (!variant) return Promise.reject(new Error(`personnage inconnu : ${id}`));
  p = (async () => {
    const [gltf, anims] = await Promise.all([loadGlb(modelUrl(id)), loadAnims(variant.sex)]);
    const scene = gltf.scene;
    const warnings: string[] = [];
    let rootBone: THREE.Object3D | null = null;
    const names = new Set<string>();
    scene.traverse((o) => {
      names.add(o.name);
      if (o.name === 'Bip01') rootBone = o;
      const m = o as THREE.SkinnedMesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
      const mat = m.material as THREE.MeshStandardMaterial;
      if (mat.name === 'hair') {
        mat.alphaToCoverage = true;
        mat.alphaTest = 0.35;
        mat.side = THREE.DoubleSide;
      }
      // sphère englobante généreuse : le maillage animé sort de sa pose de repos (bras, saut)
      m.geometry.computeBoundingSphere();
      m.boundingSphere = m.geometry.boundingSphere!.clone();
      m.boundingSphere.radius *= 1.4;
    });
    if (!rootBone) throw new Error(`${id} : squelette Biped introuvable (os Bip01)`);
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene);
    const hip = (rootBone as THREE.Object3D).position.y;
    // translation verticale du bassin mise à la longueur de jambes du modèle
    const k = hip / anims.hipHeight;
    const clips = new Map<string, THREE.AnimationClip>();
    for (const [name, clip] of anims.clips) {
      const missing = clip.tracks.filter((t) => !names.has(t.name.split('.')[0]));
      if (missing.length) {
        warnings.push(`${name} : ${missing.length} piste(s) sans os (${missing[0].name})`);
        continue;
      }
      const c = clip.clone();
      for (const t of c.tracks) if (t.name === 'Bip01.position') for (let i = 0; i < t.values.length; i++) t.values[i] *= k;
      clips.set(name, c);
    }
    for (const n of LOCOMOTION) if (!clips.has(n)) throw new Error(`${id} : clip de locomotion « ${n} » inutilisable`);
    anims.phase ??= measurePhases(scene, clips);
    if (warnings.length) console.warn(`Personnage ${id} :`, warnings.join(' ; '));
    return {
      variant,
      scene,
      height: Math.max(0.5, box.max.y - box.min.y),
      clips,
      speed: { walk_slow: anims.speed.walk_slow, walk: anims.speed.walk, run: anims.speed.run },
      phase: anims.phase,
      stride: k,
      warnings,
    };
  })();
  bases.set(id, p);
  p.catch(() => bases.delete(id));
  return p;
}

/** Libère un modèle qui n'est plus utilisé par aucun personnage (fin de partie). */
export async function releaseCharacter(id: string) {
  const p = bases.get(id);
  if (!p) return;
  bases.delete(id);
  const base = await p.catch(() => null);
  base?.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    const mat = m.material as THREE.MeshStandardMaterial;
    for (const t of [mat.map, mat.normalMap, mat.alphaMap]) t?.dispose();
    mat.dispose();
  });
}
