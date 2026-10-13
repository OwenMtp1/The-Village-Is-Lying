# The Village Is Lying

Jeu d'enquête multijoueur en 3D (Three.js r170, TypeScript, Socket.IO) : cette nuit, l'un des villageois est un
tueur. Le village médiéval complet (52 bâtiments, 221 pièces meublées) sert de terrain de jeu.

## Lancer

```bash
npm install
npm run dev        # serveur de jeu (port 3001) + page (http://localhost:5173)
# ou, version compilée :
npm run build && npm start   # tout sur http://localhost:3001
```

La page construit le village (barre de progression ; en cas d'échec — WebGL absent, fichier manquant — un message
explique quoi faire), puis ouvre le **menu principal** sur une vue cinématique de nuit au-dessus des toits :

| Entrée | Contenu |
|---|---|
| **Jouer** | nom, sexe du personnage ; *partie en ligne* (composition des rôles, création du salon) ou *exploration solo* |
| **Rejoindre une partie** | code de 4 lettres donné par l'hôte (désactivé, avec explication, dans la démo sans serveur) |
| **Paramètres** | sensibilité et inversion de la souris, volumes (général, musique, effets, ambiance), qualité graphique, aide des commandes, réduction des animations — appliqués tout de suite, gardés dans le navigateur |
| **Crédits** | personnages, textures, sons, logiciels et licences |

Navigation à la souris ou au clavier (flèches, Entrée, Échap pour revenir). Pas de bouton « Quitter » : une page web
ne peut pas fermer son onglet ; en partie, **Échap** (ou ☰) ouvre le menu de pause : reprendre, paramètres,
commandes, *quitter la partie*. Le pied du menu indique l'état réel de la connexion au serveur de parties.
Le titre et les accroches se modifient dans `src/ui/brand.ts`. « Explorer la carte librement » ouvre l'outil
d'inspection (points de vue, vol libre, toits).

## Parties en ligne

- **Création** : nom, sexe du personnage (l'apparence est tirée au sort au lancement parmi les 20 modèles de ce
  sexe), et **composition des rôles** : tueurs, shérifs, détectives, villageois (boutons − / +), préréglages
  (classique 6 et 8, plusieurs tueurs 8, paranoïa 10). Le total est affiché en direct ; de 4 à 10 joueurs,
  au moins un tueur, plus d'innocents que de tueurs. Une composition invalide est expliquée, jamais corrigée.
- **Salon** : code à copier, places occupées et libres, « 6 / 8 joueurs connectés », « Il manque 2 joueurs pour
  commencer », arrivées, départs, déconnexions annoncés ; chaque joueur peut se dire **prêt** (indication pour
  l'hôte, ne bloque pas le lancement). L'hôte peut changer la composition jusqu'au lancement ; le bouton « Lancer »
  ne s'active qu'au complet. Si l'hôte part, le plus
  ancien joueur prend la main. Salon complet ou partie commencée : on ne peut plus entrer (sauf reconnexion).
- **Rôles** : distribués par le serveur dans les quantités exactes, chaque joueur ne reçoit que le sien ; les
  tueurs connaissent leurs complices. Tous les rôles sont révélés à la fin.

| Rôle | Capacité (individuelle) | Touche |
|---|---|---|
| Tueur | éliminer un innocent à portée (2,2 m), délai de 25 s propre à chaque tueur | `E` |
| Shérif | une balle : abattre la personne visée (14 m) ; s'il abat un innocent, il meurt aussi | `F` |
| Détective | une enquête : savoir si la personne proche est un tueur (résultat privé) | `R` |
| Tous | signaler un corps (`T`), une réunion d'urgence par joueur (`U`), voter pendant les réunions | |

**Pendant la partie** : carte du rôle secret (icône + nom + état des pouvoirs : délai d'élimination, balle,
enquête, réunion d'urgence), actions possibles affichées selon la situation, notifications (icône + texte,
jamais la couleur seule), **journal d'enquête** (`J` : vos enquêtes, habitants vivants ou morts, événements
publics — jamais la position de quiconque), écran d'élimination, réunion avec portraits, compte à rebours et
« a voté », puis **résultats** : camp gagnant et raison, victoire ou défaite pour vous, rôle et sort de chacun,
déroulé. « Retour au salon » efface la partie pour tous (les joueurs partis libèrent leur place) et l'hôte peut
relancer une manche.

Victoire recalculée après chaque mort, sur les vivants : les innocents gagnent quand tous les tueurs sont
éliminés, les tueurs quand ils sont au moins aussi nombreux que les innocents. Les éliminés ne votent plus.
Réglages : `src/shared/rules.ts`. Le serveur (`src/server/`) revérifie chaque action (rôle, portée, délais,
munitions, vivants, phase, **ligne de vue** à travers les murs, planchers et relief du village pour le tir,
l'élimination et l'enquête) et ignore les positions impossibles. Une réunion se tient au plus une fois par corps ;
un vote par vivant ; égalité ou majorité d'abstentions : personne n'est éliminé. Pas de limite de durée de partie
(choix demandé : on joue jusqu'à la victoire d'un camp) ; la limite de temps porte sur les votes (60 s).

## Jour, nuit et lampe de poche

- La partie commence à la tombée de la nuit : **5 minutes de nuit, puis 5 minutes de jour**, en boucle, avec une aube
  et un crépuscule progressifs, jusqu'à la victoire d'un camp (aucune limite de durée). En ligne, le serveur donne
  l'heure de départ : tous les joueurs voient le même moment de la journée. L'heure restante s'affiche en haut à droite.
- Chaque joueur a une **lampe de poche** dans son inventaire (emplacement en haut à droite, touche `L`) : un
  faisceau puissant qui suit le regard, avec ombres ; les lampes allumées des autres joueurs sont visibles.
  Réglages : `src/characters/flashlight.ts` et `DAY_CYCLE` dans `src/shared/rules.ts`.

## Son et vie du décor

- Tous les sons sont **synthétisés par le navigateur** (Web Audio, `src/audio/`) : vent, grillons et chouette la
  nuit, oiseaux le jour, nappe musicale du menu, battement de cœur pendant les réunions, pas (les vôtres et ceux des
  joueurs proches, atténués avec la distance), saut, lampe, cloche de réunion, coup de feu, vote, mort, victoire,
  défaite, sons d'interface. Aucun fichier sonore tiers, donc aucune licence à vérifier. Le son démarre au premier
  clic ou à la première touche (règle des navigateurs).
- Décor vivant (`src/village/life.ts`), sans géométrie recalculée : arbres, buissons et herbes ondulent au vent,
  lucioles la nuit dans les jardins et à la lisière, brume qui respire, lanternes qui vacillent ; chaque entrée de
  maison a sa lanterne pour repérer les portes de nuit.

## Mettre en ligne (Render)

Le dépôt contient `render.yaml` : sur https://render.com, **New → Blueprint**, choisir ce dépôt, valider.
Render installe, compile (`npm run build`) et lance `npm start` ; le jeu est servi à l'adresse du service
(`https://<nom>.onrender.com`), pages et serveur de parties ensemble.

## Personnages

Base **Microsoft Rocketbox** (MIT) : 40 personnages distincts (20 femmes, 20 hommes), même squelette Biped,
animations capturées partagées par sexe (`public/characters/`). Marche et course « en place » mélangées selon la
vitesse réelle, cadence calculée pour que les pieds ne glissent pas ; saut (Rocketbox n'a pas d'animation de
saut : impulsion et amorti avec le clip « accroupi », pose aérienne procédurale) ; caméra derrière l'épaule
droite, vue subjective avec `V`. Réglages : `src/characters/config.ts`.

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
npm test            # map, plans intérieurs, contrôleur des personnages, rôles et salons, serveur réel
npm run typecheck
npm run build
npm run build && npm start &         # puis, dans un autre terminal :
npx tsx scripts/ui-check.ts          # menu, paramètres, salon (arrivées/départ), partie, pause, réunion, tir, résultats, nouvelle manche
npx tsx scripts/solo-check.ts        # exploration solo, pause → menu, inspection, modèle de personnage manquant
npx tsx scripts/characters-check.ts   # 40 personnages, glissement des pieds, saut, captures
BASE=http://localhost:3001 npm run shots   # captures de tous les points de vue de la map
```

Les tests vérifient pour chaque bâtiment : escaliers et trémies à l'intérieur des murs, aucune cloison qui coupe
une volée ou son palier, aucun meuble qui traverse un mur, chevauche un autre meuble, se trouve au-dessus d'une
trémie ou dépasse le plafond, une porte d'entrée sur rue, un intérieur meublé.

## Organisation

```
src/
  main.ts                 point d'entrée : chargement, modes (menu, solo, en ligne, inspection), réglages, sons
  input.ts                gestionnaire unique du clavier et de la souris
  shared/                 roles.ts (composition, validation, préréglages), rules.ts, protocol.ts
  server/                 app.ts (Socket.IO, pages, lignes de vue), room.ts (salon et partie), index.ts
  client/                 net.ts (connexion), ui.ts (chef d'orchestre des écrans), online.ts (partie en ligne)
  ui/                     menu, salon, interface de partie et résultats, pause, paramètres, composition, icônes
  audio/                  moteur Web Audio, effets, ambiance et musique, pas
  styles/                 base (direction artistique), menu et salon, interface de jeu, inspection
  characters/             catalogue, apparence, chargement, animation, contrôleur, caméra, partie solo
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
    cinematic.ts          caméra du menu (travelling au-dessus des toits)
    life.ts               vent dans la végétation, lucioles, brume
    textures.ts           textures médiévales générées par code (pierre, pavés, enduit, colombages, tuiles…)
    geom.ts               murs percés, dalles à trémies, fusion des géométries par matériau
public/textures/          herbe, parquet, eau (exemples Three.js) et ciel HDR (Poly Haven, CC0)
tests/                    map, personnages, rôles et salons, règles de partie (lignes de vue, manches), serveur réel, réglages
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
