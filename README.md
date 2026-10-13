# Minuit au village

Environnement 3D du village médiéval de **Minuit au village**, jeu d'enquête multijoueur (Three.js r170).
Cette étape ne contient que le décor : le gameplay (personnage, rôles, réseau) viendra ensuite.

Le village est une seule zone continue d'environ 250 m × 250 m, entourée de forêt et de collines :

| Quartier | Contenu |
|---|---|
| **Place centrale** | puits couvert, étals de marché, bancs, lanternes, terrasse de la **Taverne du Corbeau Borgne**, six rues qui en partent |
| **Quartier commerçant** (Grand-Rue) | apothicairerie, forge (auvent, conduit), boulangerie (four), échoppes du tailleur, du cordonnier, du mercier, maisons de marchands, passages étroits |
| **Quartier résidentiel** | rue des Tisserands, ruelle des Jardins, rue du Puits : maisons mitoyennes ou isolées, 1 à 3 niveaux, chaumières, jardins clos et potagers, lavoir |
| **Quartier de l'église** | église Saint-Aubin (nef, chœur, clocher-porche avec cloche et flèche), parvis et calvaire, cimetière clos, **poste du shérif** (bureau, cellule grillagée, armurerie, archives), presbytère |
| **Abords** | écuries du relais (stalles, sellerie, fenil), grange aux dîmes, ferme et champs, **maison abandonnée** (toit crevé, fenêtres condamnées, cave, grenier), chemins vers la forêt |

**52 bâtiments, 221 pièces**, tous construits avec leurs intérieurs : planchers, cloisons et portes, escaliers avec
paliers et garde-corps, échelles vers les combles, caves, cheminées avec âtre, mobilier adapté à chaque pièce.
Les toits sont des groupes séparés (`toit`) : on peut les masquer pour voir l'étage depuis le dessus.

## Lancer

```bash
npm install
npm run dev        # http://localhost:5173
```

La page construit le village (quelques secondes, barre de progression), puis ouvre la visionneuse d'inspection.

| Commande | Effet |
|---|---|
| Panneau de gauche | points de vue (extérieurs et intérieurs), mode caméra, toits, qualité |
| `F` | bascule orbite / vol libre |
| Orbite | glisser : tourner · clic droit : déplacer · molette : zoom |
| Vol libre | `Z Q S D` (AZERTY) ou `W A S D` · glisser : regarder · `Espace` / `C` : monter / descendre · `Maj` : plus vite · molette : vitesse |
| `R` | toits : auto (masqué quand la caméra est dans le bâtiment) → masqués → visibles |
| `F3` | affiche / masque images par seconde, appels de dessin, triangles |

## Vérifier

```bash
npm test            # implantation (aucun chevauchement, aucun bâtiment sur une rue) et plans intérieurs
npm run typecheck
npm run build
npm run dev & npm run shots   # captures de tous les points de vue dans screenshots/ (Chromium headless)
```

Les tests vérifient pour chaque bâtiment : escaliers et trémies à l'intérieur des murs, aucune cloison qui coupe
une volée ou son palier, aucun meuble qui traverse un mur, chevauche un autre meuble, se trouve au-dessus d'une
trémie ou dépasse le plafond, une porte d'entrée sur rue, un intérieur meublé.

## Organisation

```
src/
  main.ts                 point d'entrée : chargement, visionneuse, panneau d'inspection
  village/
    layout.ts             plan : relief, rues, places, quartiers, fiche de chaque bâtiment (données pures)
    plans.ts              plans intérieurs : niveaux, pièces, cloisons, escaliers, fenêtres, mobilier (données pures)
    buildings.ts          construction 3D d'un bâtiment (extérieur, intérieur, toit séparé)
    props.ts              catalogue d'objets (mobilier, décor) modélisés une fois, instanciés partout
    decor.ts              décor extérieur : lanternes, place, jardins, cimetière, ferme, lavoir
    terrain.ts            terrain en relief, rues et places peintes dans le sol (shader de mélange)
    vegetation.ts         forêt, arbres isolés, buissons, rochers, herbe (instanciés)
    atmosphere.ts         ciel nocturne, lune et ombres, brouillard, lumières chaudes dynamiques
    village.ts            assemblage par étapes (chargement non bloquant)
    view.ts               visionneuse : rendu, post-traitement, caméras, points de vue, toits
    textures.ts           textures médiévales générées par code (pierre, pavés, enduit, colombages, tuiles…)
    geom.ts               murs percés, dalles à trémies, fusion des géométries par matériau
public/textures/          herbe, parquet, eau (exemples Three.js) et ciel HDR (Poly Haven, CC0)
tests/village.test.ts     cohérence de la map
scripts/                  captures de contrôle, vérification rapide de l'implantation
```

`layout.ts` et `plans.ts` n'utilisent pas Three.js : le futur serveur de jeu pourra s'en servir pour les
positions des portes, des pièces, des escaliers et du mobilier (fouilles, déplacements, visibilité).

## Rendu et performances

- Un appel de dessin par matériau et par bâtiment (géométries fusionnées), mobilier et végétation instanciés.
- Lumières chaudes : un groupe fixe de 16 lumières réaffecté aux sources les plus proches de la caméra
  (lanternes, âtres, bougies) ; les autres restent visibles par leurs matériaux lumineux et le halo.
- Une seule lumière à ombres (la lune), dont la carte suit la zone regardée. Brouillard plus dense au sol.
- Intérieurs masqués au-delà de 55 m ; façades fusionnées par quartier ; arbres du cœur de la forêt allégés et sans ombre ; terrain percé au droit des caves.
- Qualité **haute** (occlusion ambiante GTAO, ombres 4096), **moyenne** (halo, ombres 2048), **basse** (rendu direct, sans ombres).

## Ressources

Aucun pack d'assets 3D n'était présent dans le dépôt au moment de la construction : bâtiments, mobilier et décor
sont modélisés par code, avec des textures générées (pierre, pavés, enduit, colombages, tuiles, ardoise, chaume,
bardeaux, terre, dallage) et quelques textures photo libres. Pour remplacer un objet par un modèle (`.glb`),
il suffit de remplacer son entrée dans `props.ts` (même repère : posé au sol, devant vers +z).
