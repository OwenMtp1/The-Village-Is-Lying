/**
 * Réglages des personnages, regroupés ici pour être ajustés sans toucher au code.
 *
 * Échelle vérifiée : les modèles Rocketbox sont en mètres (squelette Biped, bassin à 0,90 m pour le squelette
 * des animations) et mis à la taille de chaque personnage (1,55 à 1,92 m) ; le village est aussi en mètres
 * (portes de 2,05 à 2,40 m, plafonds de 2,8 à 3,4 m).
 *
 * Vitesses sans glissement des clips (mesurées par le pipeline Rocketbox, squelette des animations, cadence 1) :
 *   femmes : marche lente 1,21 m/s · marche rapide 1,92 m/s · course 2,77 m/s
 *   hommes : marche lente 1,01 m/s · marche rapide 2,00 m/s · course 2,88 m/s
 * Elles sont mises à l'échelle de chaque personnage (longueur de jambes) ; la cadence des jambes est ensuite
 * calculée à chaque image à partir de la vitesse RÉELLE du personnage (pieds sans glissement).
 */
export const MOVE = {
  /** marche d'enquête : un peu plus vive qu'une flânerie (1,0 m/s), moins qu'une marche pressée (2,0 m/s) */
  walkSpeed: 1.45,
  /** petite course crédible : un peu au-dessus de la vitesse du clip de course, sans foulées irréalistes */
  runSpeed: 3.2,
  /** accélération au sol (m/s²) : la marche est atteinte en ≈ 0,3 s */
  accel: 5.0,
  /** accélération de la marche vers la course (m/s²) : ≈ 0,5 s pour passer de 1,45 à 3,2 m/s */
  runAccel: 3.6,
  /** freinage quand on relâche (m/s²) : arrêt en ≈ 0,25 s depuis la marche, ≈ 0,55 s depuis la course */
  decel: 6.0,
  /** freinage quand on repasse de la course à la marche (m/s²) */
  runDecel: 4.0,
  /** demi-tour : le personnage freine puis repart (au lieu de pivoter à pleine vitesse) */
  reverseDecel: 9.0,
  /** vitesse de rotation maximale du corps (rad/s), à l'arrêt et à pleine course */
  turnRateIdle: 9.0,
  turnRateRun: 5.5,
  /** lissage de l'orientation (1/s) */
  turnSmoothing: 14,
  /** rayon du personnage (m) pour les collisions */
  radius: 0.25,
  /** marche franchissable sans sauter (seuils, marches d'escalier) */
  stepUp: 0.36,
  /** descente « collée au sol » sans passer en chute (marches, pentes) */
  stepDown: 0.45,
  /** pas de simulation (s) : indépendant du nombre d'images par seconde */
  fixedStep: 1 / 120,
};

export const JUMP = {
  /** hauteur du saut (m) : un saut sur place crédible, pas un bond de super-héros */
  height: 0.5,
  /** gravité (m/s²) : un peu plus forte que la réalité, pour un saut net (≈ 0,45 s en l'air) */
  gravity: 20,
  /** vitesse de chute maximale (m/s) */
  maxFall: 22,
  /** part du contrôle horizontal conservée en l'air */
  airControl: 0.35,
  /** tolérance après avoir quitté un rebord (s) */
  coyoteTime: 0.1,
  /** appui sur Espace mémorisé juste avant l'atterrissage (s) */
  bufferTime: 0.12,
  /** délai minimal entre deux sauts (s) : pas de rebond en maintenant la touche */
  cooldown: 0.25,
};

export const ANIM = {
  /** vitesse sous laquelle les jambes reviennent à l'attente (fondu entre ces deux seuils, m/s) */
  idleBelow: 0.1,
  movingAbove: 0.45,
  /** réactivité du mélange des cycles de locomotion (1/s) */
  locomotionBlend: 9,
  /** lissage de la vitesse transmise aux jambes (1/s) : évite les à-coups quand on frôle un mur */
  speedSmoothing: 12,
  /** fondu vers l'attente / depuis l'attente (s) */
  idleFade: 0.25,
  /** préparation (accroupissement) au décollage et amorti à l'atterrissage (s) */
  takeoffTime: 0.12,
  landTime: 0.32,
  /** fondu de la pose aérienne (s) */
  airFade: 0.14,
  /** inclinaison du buste dans les virages (rad par rad/s de rotation, à pleine course) */
  turnLean: 0.045,
  /** enfoncement visuel max du bassin à l'atterrissage (m) */
  landDip: 0.09,
};

export const CAMERA = {
  /** troisième personne : distance, décalage d'épaule (droite), hauteur de visée relative à la taille */
  distance: 3.1,
  minDistance: 1.3,
  maxDistance: 6,
  shoulder: 0.55,
  aimHeight: 0.93,
  pitch: 0.22,
  minPitch: -0.6,
  maxPitch: 1.1,
  /** sensibilité de la souris (rad par pixel) */
  sensitivity: 0.0024,
  /** souris vers le haut = regarder vers le bas (réglage du joueur) */
  invertY: false as boolean,
  /** lissage du suivi (1/s) : la caméra suit sans rigidité excessive */
  follow: 18,
  /** première personne : limites du regard vertical */
  fpMinPitch: -1.35,
  fpMaxPitch: 1.35,
  fov: 62,
};
