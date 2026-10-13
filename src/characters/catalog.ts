/**
 * Base de personnages : Microsoft Rocketbox Avatar Library (licence MIT, voir public/characters/README.md).
 * 40 adultes distincts (20 femmes, 20 hommes), chacun avec son propre maillage, ses vêtements, sa coiffure
 * et ses textures ; tous partagent le même squelette Biped (80 os) et les animations de leur sexe.
 * Données pures : utilisables par le client, les tests et plus tard le serveur (attribution des apparences).
 */

export type Sex = 'M' | 'F';

export interface CharacterVariant {
  /** identifiant stable du modèle (fichier public/characters/<id>.glb) */
  id: string;
  sex: Sex;
  firstName: string;
  /** taille du personnage (m) : le modèle est mis à cette échelle */
  heightM: number;
  /** avatar Rocketbox d'origine */
  source: string;
}

export const VARIANTS: CharacterVariant[] = [
  { id: 'f01', sex: 'F', firstName: 'Camille', heightM: 1.68, source: 'Female_Adult_01' },
  { id: 'f02', sex: 'F', firstName: 'Hélène', heightM: 1.64, source: 'Female_Adult_02' },
  { id: 'f03', sex: 'F', firstName: 'Maï', heightM: 1.6, source: 'Female_Adult_03' },
  { id: 'f04', sex: 'F', firstName: 'Solène', heightM: 1.72, source: 'Female_Adult_04' },
  { id: 'f05', sex: 'F', firstName: 'Inès', heightM: 1.66, source: 'Female_Adult_05' },
  { id: 'f06', sex: 'F', firstName: 'Yasmina', heightM: 1.63, source: 'Female_Adult_06' },
  { id: 'f07', sex: 'F', firstName: 'Claire', heightM: 1.7, source: 'Female_Adult_07' },
  { id: 'f08', sex: 'F', firstName: 'Julie', heightM: 1.67, source: 'Female_Adult_08' },
  { id: 'f09', sex: 'F', firstName: 'Sophie', heightM: 1.65, source: 'Female_Adult_09' },
  { id: 'f10', sex: 'F', firstName: 'Maëlle', heightM: 1.69, source: 'Female_Adult_11' },
  { id: 'f11', sex: 'F', firstName: 'Chloé', heightM: 1.62, source: 'Female_Adult_12' },
  { id: 'f12', sex: 'F', firstName: 'Anne-Sophie', heightM: 1.71, source: 'Female_Adult_13' },
  { id: 'f13', sex: 'F', firstName: 'Émilie', heightM: 1.66, source: 'Female_Adult_14' },
  { id: 'f14', sex: 'F', firstName: 'Margaux', heightM: 1.74, source: 'Female_Adult_15' },
  { id: 'f15', sex: 'F', firstName: 'Léa', heightM: 1.68, source: 'Female_Adult_17' },
  { id: 'f16', sex: 'F', firstName: 'Jessica', heightM: 1.7, source: 'Female_Party_01' },
  { id: 'f17', sex: 'F', firstName: 'Naomi', heightM: 1.67, source: 'Female_Party_02' },
  { id: 'f18', sex: 'F', firstName: 'Fatou', heightM: 1.75, source: 'Business_Female_01' },
  { id: 'f19', sex: 'F', firstName: 'Brigitte', heightM: 1.63, source: 'Business_Female_02' },
  { id: 'f20', sex: 'F', firstName: 'Valérie', heightM: 1.61, source: 'Business_Female_03' },
  { id: 'm01', sex: 'M', firstName: 'Thomas', heightM: 1.8, source: 'Male_Adult_01' },
  { id: 'm02', sex: 'M', firstName: 'Julien', heightM: 1.78, source: 'Male_Adult_02' },
  { id: 'm03', sex: 'M', firstName: 'Bernard', heightM: 1.76, source: 'Male_Adult_03' },
  { id: 'm04', sex: 'M', firstName: 'Samuel', heightM: 1.83, source: 'Male_Adult_04' },
  { id: 'm05', sex: 'M', firstName: 'Gérard', heightM: 1.77, source: 'Male_Adult_05' },
  { id: 'm06', sex: 'M', firstName: 'Hugo', heightM: 1.79, source: 'Male_Adult_06' },
  { id: 'm07', sex: 'M', firstName: 'Antoine', heightM: 1.75, source: 'Male_Adult_07' },
  { id: 'm08', sex: 'M', firstName: 'Maxime', heightM: 1.84, source: 'Male_Adult_08' },
  { id: 'm09', sex: 'M', firstName: 'Kenji', heightM: 1.74, source: 'Male_Adult_09' },
  { id: 'm10', sex: 'M', firstName: 'Minh', heightM: 1.71, source: 'Male_Adult_10' },
  { id: 'm11', sex: 'M', firstName: 'Ibrahima', heightM: 1.85, source: 'Male_Adult_12' },
  { id: 'm12', sex: 'M', firstName: 'Philippe', heightM: 1.78, source: 'Male_Adult_13' },
  { id: 'm13', sex: 'M', firstName: 'Karim', heightM: 1.76, source: 'Male_Adult_17' },
  { id: 'm14', sex: 'M', firstName: 'Moussa', heightM: 1.82, source: 'Male_Adult_18' },
  { id: 'm15', sex: 'M', firstName: 'Nicolas', heightM: 1.8, source: 'Male_Adult_20' },
  { id: 'm16', sex: 'M', firstName: 'Laurent', heightM: 1.77, source: 'Business_Male_04' },
  { id: 'm17', sex: 'M', firstName: 'Olivier', heightM: 1.81, source: 'Business_Male_05' },
  { id: 'm18', sex: 'M', firstName: 'Michel', heightM: 1.74, source: 'Business_Male_07' },
  { id: 'm19', sex: 'M', firstName: 'Arjun', heightM: 1.75, source: 'Wood_Male_01' },
  { id: 'm20', sex: 'M', firstName: 'Yann', heightM: 1.86, source: 'Delivery_Male_01' },
];

export const variantById = (id: string) => VARIANTS.find((v) => v.id === id);
export const variantsOf = (sex: Sex) => VARIANTS.filter((v) => v.sex === sex);
/**
 * Adresse d'une ressource publique, relative à la base de la page (`/` en temps normal, `./` pour la version
 * statique publiée sous un sous-chemin). Hors navigateur (serveur, tests), la base vaut `/`.
 */
export const asset = (path: string) => `${(import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'}${path}`;
/** Version de démonstration publiée (build `--mode static`) : modèles emballés en JSON (base64). */
export const PACKED = (import.meta as { env?: { MODE?: string } }).env?.MODE === 'static';
export const modelUrl = (id: string) => asset(`characters/${id}.glb`);
export const animsUrl = (sex: Sex) => asset(`characters/anims-${sex === 'F' ? 'f' : 'm'}.glb`);
export const cardUrl = (id: string) => asset(`characters/cards/${id}.jpg`);
