/**
 * Armes modélisées par code (aucun fichier externe). Repère de chaque arme à feu : origine sur la poignée, à
 * l'endroit où se referme la main droite ; le canon suit +x, le dessus de l'arme +y, +z est à droite du tireur.
 * Chaque arme indique où se placent les poignets (main droite sur la poignée, main gauche en soutien sous la
 * poignée ou sur le garde-main) et où sort la balle ; l'animation y amène les bras (cinématique inverse).
 * Le couteau se tient dans la main droite (lame suivant +x de la main, comme la lampe de poche).
 */
import * as THREE from 'three';

export type GunKind = 'pistolet' | 'revolver' | 'pm' | 'mitraillette' | 'fusil' | 'assaut' | 'tactique' | 'mitrailleuse' | 'pompe' | 'precision';
/** armes de poing (tenues bras tendus) */
const HANDGUNS: GunKind[] = ['pistolet', 'revolver', 'pm'];

export interface GunRig {
  kind: GunKind;
  group: THREE.Group;
  /** bouche du canon (départ de la balle, éclair) */
  muzzle: THREE.Vector3;
  /** poignets (repère de l'arme) */
  rightWrist: THREE.Vector3;
  leftWrist: THREE.Vector3;
  /** arme d'épaule (crosse contre l'épaule) ou de poing (bras tendus) */
  long: boolean;
  /** recul : recul de l'arme (m) et relèvement du canon (rad) au départ du coup */
  kickBack: number;
  kickUp: number;
  /** rechargement : où la main gauche engage le chargeur (ou les cartouches) */
  magazine: THREE.Vector3;
  /** réarmement après chaque coup : pompe (main gauche) ou culasse (main droite) */
  cycle: 'pompe' | 'culasse' | null;
  /** pièces mobiles (pompe, culasse) */
  moving: THREE.Object3D[];
  /** accessoires de nuit : lampe sous le canon et module laser (visibles quand ils sont montés) */
  torch: THREE.Object3D;
  laser: THREE.Object3D;
  /** sorties du faisceau et du laser (repère de l'arme) */
  torchFrom: THREE.Vector3;
  laserFrom: THREE.Vector3;
}

const mat = {
  steel: new THREE.MeshStandardMaterial({ color: '#c9ccd2', roughness: 0.25, metalness: 0.95 }),
  dark: new THREE.MeshStandardMaterial({ color: '#25272b', roughness: 0.38, metalness: 0.85 }),
  black: new THREE.MeshStandardMaterial({ color: '#15161a', roughness: 0.6, metalness: 0.3 }),
  wood: new THREE.MeshStandardMaterial({ color: '#5a3820', roughness: 0.62, metalness: 0 }),
  darkWood: new THREE.MeshStandardMaterial({ color: '#3b2414', roughness: 0.7, metalness: 0 }),
  brass: new THREE.MeshStandardMaterial({ color: '#b08a3e', roughness: 0.35, metalness: 0.9 }),
  glass: new THREE.MeshStandardMaterial({ color: '#22384a', roughness: 0.05, metalness: 0.6, emissive: '#0b1822' }),
};
const lensMat = new THREE.MeshStandardMaterial({ color: '#fff6e0', emissive: '#fff3dc', emissiveIntensity: 4, roughness: 0.2 });
const laserMat = new THREE.MeshBasicMaterial({ color: '#ff2a1a' });
const flashMat = new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });

/** géométrie, matériau, nom éventuel (pièces animées : pompe, culasse) */
type Part = [THREE.BufferGeometry, THREE.Material, string?];
const box = (w: number, h: number, d: number, x: number, y: number, z = 0, rz = 0): THREE.BufferGeometry => new THREE.BoxGeometry(w, h, d).rotateZ(rz).translate(x, y, z);
/** cylindre couché le long de +x, de x0 à x1 */
const tube = (r: number, x0: number, x1: number, y: number, z = 0, seg = 12): THREE.BufferGeometry =>
  new THREE.CylinderGeometry(r, r, x1 - x0, seg).rotateZ(Math.PI / 2).translate((x0 + x1) / 2, y, z);

const cache = new Map<GunKind, { parts: Part[]; muzzle: THREE.Vector3 }>();

function parts(kind: GunKind): { parts: Part[]; muzzle: THREE.Vector3 } {
  const hit = cache.get(kind);
  if (hit) return hit;
  let p: Part[];
  let muzzle: THREE.Vector3;
  if (kind === 'pistolet') {
    // pistolet semi-automatique : culasse, carcasse, pontet, détente, poignée inclinée, organes de visée, chargeur
    p = [
      [box(0.19, 0.03, 0.026, 0.065, 0.05), mat.dark, 'culasse'], // culasse
      [box(0.006, 0.008, 0.006, 0.155, 0.068), mat.black], // guidon
      [box(0.01, 0.008, 0.022, -0.02, 0.068), mat.black], // hausse
      [box(0.012, 0.01, 0.027, 0.03, 0.05, 0.0), mat.steel], // fenêtre d'éjection
      [tube(0.0065, 0.155, 0.168, 0.05), mat.black], // bout du canon
      [box(0.15, 0.022, 0.024, 0.05, 0.024), mat.black], // carcasse
      [box(0.035, 0.105, 0.03, -0.012, -0.03, 0, -0.22), mat.black], // poignée
      [box(0.036, 0.012, 0.032, -0.024, -0.082, 0, -0.22), mat.dark], // talon du chargeur
      [new THREE.TorusGeometry(0.019, 0.003, 6, 14, Math.PI).rotateZ(Math.PI).translate(0.03, 0.012, 0), mat.black], // pontet
      [box(0.004, 0.018, 0.006, 0.026, 0.006, 0, 0.3), mat.steel], // détente
    ];
    muzzle = new THREE.Vector3(0.17, 0.05, 0);
  } else if (kind === 'revolver') {
    // revolver : long canon, barillet, carcasse, crosse en bois
    p = [
      [tube(0.011, 0.04, 0.2, 0.052), mat.steel], // canon
      [box(0.012, 0.012, 0.012, 0.19, 0.068), mat.steel], // guidon
      [box(0.09, 0.045, 0.028, 0.0, 0.045), mat.steel], // carcasse
      [new THREE.CylinderGeometry(0.022, 0.022, 0.05, 10).rotateZ(Math.PI / 2).translate(0.01, 0.042, 0), mat.dark], // barillet
      [box(0.034, 0.1, 0.028, -0.025, -0.025, 0, -0.32), mat.wood], // crosse
      [new THREE.TorusGeometry(0.018, 0.003, 6, 14, Math.PI).rotateZ(Math.PI).translate(0.01, 0.018, 0), mat.steel],
      [box(0.012, 0.016, 0.01, -0.04, 0.072, 0, 0.5), mat.steel, 'culasse'], // chien
    ];
    muzzle = new THREE.Vector3(0.205, 0.052, 0);
  } else if (kind === 'pm') {
    // pistolet-mitrailleur : carcasse compacte, long chargeur droit, cache-flamme
    p = [
      [box(0.17, 0.035, 0.03, 0.05, 0.048), mat.black, 'culasse'],
      [box(0.13, 0.026, 0.028, 0.035, 0.02), mat.black],
      [tube(0.009, 0.135, 0.17, 0.048), mat.dark],
      [box(0.03, 0.2, 0.026, -0.012, -0.075, 0, -0.12), mat.dark], // poignée et long chargeur
      [new THREE.TorusGeometry(0.018, 0.003, 6, 14, Math.PI).rotateZ(Math.PI).translate(0.03, 0.008, 0), mat.black],
    ];
    muzzle = new THREE.Vector3(0.175, 0.048, 0);
  } else if (kind === 'mitraillette') {
    // mitraillette : boîte compacte, canon court ajouré, chargeur droit, crosse repliable en fil d'acier
    p = [
      [box(0.24, 0.06, 0.045, 0.06, 0.035), mat.black],
      [tube(0.017, 0.18, 0.36, 0.04), mat.dark], // manchon ajouré
      [tube(0.008, 0.36, 0.4, 0.04), mat.black],
      [box(0.035, 0.15, 0.03, 0.11, -0.07), mat.dark], // chargeur droit
      [box(0.034, 0.085, 0.03, -0.01, -0.03, 0, -0.3), mat.black], // poignée
      [box(0.18, 0.008, 0.008, -0.14, 0.05, 0.016), mat.steel], // crosse filaire
      [box(0.18, 0.008, 0.008, -0.14, 0.05, -0.016), mat.steel],
      [box(0.012, 0.06, 0.04, -0.23, 0.025), mat.steel],
      [box(0.03, 0.02, 0.02, 0.0, 0.075), mat.black], // hausse
    ];
    muzzle = new THREE.Vector3(0.4, 0.04, 0);
  } else if (kind === 'assaut') {
    // fusil d'assaut : boîte de culasse, garde-main et crosse en bois, chargeur très courbé, guidon haut
    p = [
      [box(0.26, 0.055, 0.045, 0.07, 0.035), mat.dark],
      [box(0.2, 0.05, 0.05, 0.3, 0.03), mat.wood], // garde-main
      [tube(0.009, 0.4, 0.62, 0.045), mat.dark], // canon
      [tube(0.007, 0.25, 0.48, 0.07), mat.dark], // tube emprunt des gaz
      [box(0.012, 0.045, 0.012, 0.58, 0.07), mat.dark], // guidon
      [tube(0.013, 0.6, 0.64, 0.045), mat.black], // frein de bouche
      [box(0.045, 0.1, 0.034, 0.13, -0.045, 0, 0.3), mat.dark], // chargeur (haut)
      [box(0.045, 0.08, 0.034, 0.16, -0.12, 0, 0.6), mat.dark], // chargeur (bas, courbé)
      [box(0.034, 0.085, 0.03, -0.01, -0.035, 0, -0.3), mat.wood], // poignée
      [box(0.24, 0.055, 0.038, -0.17, 0.0, 0, 0.12), mat.wood], // crosse
      [box(0.012, 0.012, 0.03, 0.06, 0.068, 0.02), mat.steel, 'culasse'], // levier d'armement
    ];
    muzzle = new THREE.Vector3(0.64, 0.045, 0);
  } else if (kind === 'tactique') {
    // fusil tactique : long canon, garde-main ajouré, chargeur droit, lunette moyenne, crosse réglable
    p = [
      [box(0.28, 0.06, 0.045, 0.07, 0.035), mat.black],
      [box(0.3, 0.05, 0.05, 0.35, 0.035), mat.dark],
      [tube(0.01, 0.5, 0.74, 0.04), mat.dark],
      [tube(0.015, 0.72, 0.77, 0.04), mat.black],
      [box(0.04, 0.09, 0.032, 0.13, -0.04), mat.black],
      [box(0.035, 0.09, 0.03, -0.01, -0.035, 0, -0.3), mat.black],
      [box(0.22, 0.06, 0.04, -0.17, 0.015), mat.black],
      [box(0.03, 0.11, 0.044, -0.27, 0.0), mat.dark],
      [tube(0.019, -0.01, 0.24, 0.105), mat.dark], // lunette
      [tube(0.025, 0.18, 0.25, 0.105), mat.dark],
      [tube(0.024, 0.25, 0.252, 0.105), mat.glass],
      [box(0.03, 0.03, 0.02, 0.03, 0.075), mat.black],
      [box(0.03, 0.03, 0.02, 0.18, 0.075), mat.black],
    ];
    muzzle = new THREE.Vector3(0.77, 0.04, 0);
  } else if (kind === 'mitrailleuse') {
    // mitrailleuse : grosse boîte de culasse, canon lourd ventilé, boîte à bande, bipied, poignée de transport
    p = [
      [box(0.32, 0.08, 0.06, 0.07, 0.04), mat.dark],
      [tube(0.016, 0.23, 0.7, 0.045), mat.dark], // canon lourd
      [tube(0.024, 0.23, 0.45, 0.045), mat.black], // manchon de refroidissement
      [tube(0.018, 0.68, 0.73, 0.045), mat.black],
      [box(0.1, 0.1, 0.07, 0.1, -0.06, -0.01), mat.brass], // boîte à bande
      [box(0.034, 0.085, 0.03, -0.03, -0.035, 0, -0.3), mat.black],
      [box(0.26, 0.065, 0.045, -0.2, 0.01, 0, 0.08), mat.black], // crosse
      [box(0.12, 0.012, 0.012, 0.22, 0.11), mat.black], // poignée de transport
      [box(0.012, 0.03, 0.012, 0.17, 0.095), mat.black],
      [box(0.012, 0.03, 0.012, 0.27, 0.095), mat.black],
      [box(0.2, 0.01, 0.01, 0.58, -0.01, 0.02, 0.15), mat.black], // bipied replié
      [box(0.2, 0.01, 0.01, 0.58, -0.01, -0.02, 0.15), mat.black],
    ];
    muzzle = new THREE.Vector3(0.73, 0.045, 0);
  } else if (kind === 'fusil') {
    // carabine : boîte de culasse, canon et garde-main, chargeur courbe, poignée pistolet, crosse, lunette courte
    p = [
      [box(0.26, 0.06, 0.045, 0.07, 0.035), mat.black], // boîte de culasse
      [box(0.2, 0.05, 0.05, 0.3, 0.035), mat.dark], // garde-main
      [tube(0.009, 0.4, 0.58, 0.04), mat.dark], // canon
      [tube(0.014, 0.56, 0.6, 0.04), mat.black], // cache-flamme
      [box(0.045, 0.13, 0.034, 0.13, -0.05, 0, 0.25), mat.black], // chargeur
      [box(0.035, 0.09, 0.03, -0.01, -0.035, 0, -0.3), mat.black], // poignée
      [box(0.2, 0.05, 0.038, -0.16, 0.02), mat.black], // crosse
      [box(0.03, 0.1, 0.042, -0.265, 0.0), mat.dark], // plaque de couche
      [tube(0.016, 0.02, 0.15, 0.095), mat.dark], // lunette
      [box(0.03, 0.03, 0.02, 0.08, 0.07), mat.black], // embase
      [tube(0.018, 0.15, 0.17, 0.095), mat.glass],
      [box(0.006, 0.03, 0.006, 0.52, 0.065), mat.black], // guidon
    ];
    muzzle = new THREE.Vector3(0.6, 0.04, 0);
  } else if (kind === 'pompe') {
    // fusil à pompe : long canon, magasin tubulaire, pompe en bois, crosse en bois
    p = [
      [box(0.2, 0.06, 0.042, 0.06, 0.03), mat.dark], // carcasse
      [tube(0.012, 0.16, 0.68, 0.05), mat.dark], // canon
      [tube(0.011, 0.16, 0.6, 0.02), mat.dark], // magasin
      [tube(0.022, 0.26, 0.44, 0.022, 0, 10), mat.wood, 'pompe'], // pompe
      [box(0.035, 0.085, 0.03, -0.03, -0.035, 0, -0.35), mat.wood], // poignée
      [box(0.24, 0.055, 0.04, -0.18, 0.0, 0, 0.08), mat.wood], // crosse
      [box(0.03, 0.11, 0.044, -0.3, -0.02), mat.darkWood], // talon
      [box(0.006, 0.012, 0.006, 0.66, 0.066), mat.brass], // guidon (bille)
      [new THREE.TorusGeometry(0.02, 0.003, 6, 14, Math.PI).rotateZ(Math.PI).translate(0.02, 0.0, 0), mat.dark], // pontet
    ];
    muzzle = new THREE.Vector3(0.69, 0.05, 0);
  } else {
    // fusil de précision : long canon, lunette, levier de culasse, crosse en bois, bipied replié
    p = [
      [box(0.24, 0.055, 0.04, 0.07, 0.035), mat.dark], // boîte de culasse
      [tube(0.011, 0.19, 0.84, 0.045), mat.dark], // canon
      [tube(0.016, 0.8, 0.86, 0.045), mat.black], // frein de bouche
      [box(0.42, 0.05, 0.05, 0.25, 0.005), mat.wood], // fût
      [box(0.03, 0.09, 0.034, -0.02, -0.04, 0, -0.3), mat.wood], // poignée
      [box(0.26, 0.06, 0.042, -0.17, 0.005, 0, 0.06), mat.wood], // crosse
      [box(0.03, 0.12, 0.046, -0.3, -0.01), mat.darkWood], // talon
      [tube(0.017, -0.02, 0.28, 0.115), mat.black], // lunette
      [tube(0.024, 0.2, 0.3, 0.115), mat.black], // objectif
      [tube(0.022, -0.06, -0.01, 0.115), mat.black], // oculaire
      [tube(0.02, 0.3, 0.302, 0.115), mat.glass],
      [box(0.03, 0.04, 0.02, 0.03, 0.08), mat.black],
      [box(0.03, 0.04, 0.02, 0.19, 0.08), mat.black], // colliers
      [box(0.012, 0.012, 0.05, 0.02, 0.05, 0.035), mat.steel, 'culasse'], // levier
      [new THREE.SphereGeometry(0.01, 8, 6).translate(0.02, 0.05, 0.06), mat.steel, 'culasse'],
      [box(0.14, 0.008, 0.008, 0.48, -0.03, 0.015), mat.black], // bipied replié
      [box(0.14, 0.008, 0.008, 0.48, -0.03, -0.015), mat.black],
    ];
    muzzle = new THREE.Vector3(0.86, 0.045, 0);
  }
  const out = { parts: p, muzzle };
  cache.set(kind, out);
  return out;
}

/** Arme à feu prête à tenir : maillages, éclair de bouche et points de prise. */
export function gunRig(kind: GunKind): GunRig {
  const { parts: p, muzzle } = parts(kind);
  const g = new THREE.Group();
  g.name = kind;
  for (const [geo, m, name] of p) {
    const mesh = new THREE.Mesh(geo, m);
    if (name) mesh.name = name;
    mesh.castShadow = true;
    g.add(mesh);
  }
  const small = HANDGUNS.includes(kind);
  const flash = new THREE.Mesh(new THREE.SphereGeometry(small ? 0.05 : kind === 'mitrailleuse' ? 0.09 : 0.07, 8, 6).scale(1.8, 1, 1), flashMat.clone());
  flash.position.copy(muzzle).add(new THREE.Vector3(small ? 0.06 : 0.09, 0, 0));
  flash.name = 'eclair';
  g.add(flash);
  g.visible = false;
  const long = !small;
  // lampe sous le canon (près de la bouche), laser sur le flanc droit
  const ax = long ? muzzle.x * 0.62 : 0.1;
  const torch = new THREE.Group();
  torch.add(new THREE.Mesh(tube(0.016, ax - 0.06, ax + 0.04, 0), mat.black), new THREE.Mesh(tube(0.017, ax + 0.04, ax + 0.05, 0), lensMat));
  torch.position.y = long ? 0.0 : 0.012;
  torch.visible = false;
  const laser = new THREE.Group();
  laser.add(new THREE.Mesh(box(0.05, 0.016, 0.016, ax - 0.02, 0), mat.dark), new THREE.Mesh(box(0.004, 0.008, 0.008, ax + 0.007, 0), laserMat));
  laser.position.set(0, long ? 0.035 : 0.03, 0.022);
  laser.visible = false;
  g.add(torch, laser);
  return {
    kind,
    group: g,
    muzzle: muzzle.clone(),
    // poignet droit derrière et sous la poignée ; poignet gauche sous la main droite (pistolet) ou sous le garde-main
    rightWrist: new THREE.Vector3(-0.07, -0.015, 0.03),
    leftWrist: long ? new THREE.Vector3(kind === 'mitraillette' ? 0.17 : kind === 'pompe' ? 0.28 : kind === 'mitrailleuse' ? 0.3 : 0.24, -0.045, -0.015) : new THREE.Vector3(-0.065, -0.045, -0.04),
    long,
    kickBack: { pistolet: 0.05, revolver: 0.07, pm: 0.03, mitraillette: 0.02, fusil: 0.025, assaut: 0.03, tactique: 0.045, mitrailleuse: 0.025, pompe: 0.07, precision: 0.08 }[kind],
    kickUp: { pistolet: 0.22, revolver: 0.4, pm: 0.12, mitraillette: 0.05, fusil: 0.07, assaut: 0.09, tactique: 0.12, mitrailleuse: 0.06, pompe: 0.2, precision: 0.16 }[kind],
    magazine: {
      pistolet: new THREE.Vector3(-0.03, -0.1, 0),
      revolver: new THREE.Vector3(0.01, 0.03, -0.04),
      pm: new THREE.Vector3(-0.03, -0.17, 0),
      mitraillette: new THREE.Vector3(0.11, -0.14, 0),
      fusil: new THREE.Vector3(0.12, -0.12, 0),
      assaut: new THREE.Vector3(0.15, -0.14, 0),
      tactique: new THREE.Vector3(0.13, -0.09, 0),
      mitrailleuse: new THREE.Vector3(0.1, -0.1, -0.03),
      pompe: new THREE.Vector3(0.08, -0.03, 0.01),
      precision: new THREE.Vector3(0.07, -0.04, 0),
    }[kind],
    cycle: kind === 'pompe' ? 'pompe' : kind === 'precision' ? 'culasse' : null,
    moving: g.children.filter((o) => o.name === 'pompe' || o.name === 'culasse'),
    torch,
    laser,
    torchFrom: new THREE.Vector3(ax + 0.06, torch.position.y, 0),
    laserFrom: new THREE.Vector3(ax + 0.01, laser.position.y, laser.position.z),
  };
}

let knifeGeo: { blade: THREE.BufferGeometry; guard: THREE.BufferGeometry; grip: THREE.BufferGeometry } | null = null;

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
  g.add(new THREE.Mesh(knifeGeo.blade, mat.steel), new THREE.Mesh(knifeGeo.guard, mat.brass), new THREE.Mesh(knifeGeo.grip, mat.wood));
  g.visible = false;
  return g;
}
