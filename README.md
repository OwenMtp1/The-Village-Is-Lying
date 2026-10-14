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
| Tueur | un **couteau** dans l'inventaire : le sortir (`2`), puis clic pour poignarder la personne devant soi (2,2 m), délai de 25 s propre à chaque tueur. Une lame sortie est visible de tous. | `2`, clic |
| Shérif | un **pistolet et 4 balles** : le sortir (`2`), viser au centre de l'écran (caméra sur l'épaule, viseur), clic pour tirer (25 m). Chaque tir part, touché ou manqué, et s'entend dans tout le village ; tuer un innocent coûte la vie au shérif | `2`, clic |
| Détective | une enquête : savoir si la personne proche est un tueur (résultat privé) | `R` |
| Tous | lampe (`1` ou `L`), signaler un corps (`T`), une réunion d'urgence par joueur (`U`), voter pendant les réunions (la souris est libérée automatiquement) | |

Le serveur vérifie chaque coup : arme réellement en main (un innocent ne peut pas exhiber d'arme), portée, ligne de vue,
cible devant soi (couteau) ou dans l'axe du regard (pistolet). Les joueurs proches voient le geste (coup de couteau,
recul et éclair du pistolet) ; la victime s'effondre là où elle se trouvait. Après un vote, le décompte est affiché
(« Le village a voté : X est éliminé (X 3 voix, Y 1 voix, personne 2 voix) », égalité, abstentions).

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

## Exploration solo

Le personnage se déplace seul dans le village, au milieu de quelques villageois ; le nom du lieu (rue, place,
bâtiment) s'affiche en haut de l'écran à chaque changement. **`N` : vol libre (noclip)** — on traverse murs,
planchers et toits dans la direction du regard (`Espace` / `C` pour monter / descendre, `Maj` pour aller plus vite) ;
`N` à nouveau pour atterrir. La caméra est centrée derrière le personnage.

## Jour, nuit et lampe de poche

- La partie commence à la tombée de la nuit : **5 minutes de nuit, puis 5 minutes de jour**, en boucle, avec une aube
  et un crépuscule progressifs, jusqu'à la victoire d'un camp (aucune limite de durée). En ligne, le serveur donne
  l'heure de départ : tous les joueurs voient le même moment de la journée. L'heure restante s'affiche en haut à droite.
- Chaque joueur a une **lampe de poche** dans son inventaire (emplacement en haut à droite, touche `L`) : un
  faisceau puissant qui suit le regard, avec ombres ; les lampes allumées des autres joueurs sont visibles.
  Réglages : `src/characters/flashlight.ts` et `DAY_CYCLE` dans `src/shared/rules.ts`.

## Mode Gunfight

**Menu principal → Mode Gunfight** : un autre jeu dans le même village. Tout le monde apparaît avec cinq armes
(touches `1` à `5` ou molette), chacune avec son chargeur (`R` pour recharger) ; chaque élimination rapporte un
point, on réapparaît au bout de 3 s loin des adversaires (1,5 s de protection). La partie s'arrête au score visé ou
à la fin du temps.

Chaque joueur choisit son **équipement** (touche `B`, ou depuis l'écran d'élimination) : une arme principale
(`1`), une secondaire (`2`), le couteau (`3`) ; le changement s'applique tout de suite pendant la protection
d'apparition, sinon à la réapparition suivante.

| Arme | Type | Corps (de près) | Tête | Cadence | Chargeur | Portée |
|---|---|---|---|---|---|---|
| Pistolet | secondaire | 28 | ×2 | coup par coup | 12 | 60 m |
| Revolver | secondaire | 55 | ×2 | lente | 6 | 70 m |
| Pistolet-mitrailleur | secondaire | 16 | ×1,5 | rafale très rapide | 20 | 40 m |
| Mitraillette | principale | 21 | ×1,6 | rafale rapide | 32 | 60 m |
| Carabine | principale | 24 | ×1,75 | rafale | 30 | 110 m |
| Fusil d'assaut | principale | 30 | ×1,8 | rafale, recul fort | 30 | 120 m |
| Fusil tactique | principale | 48 | ×2 | coup par coup, lunette ×2,4 | 15 | 200 m |
| Mitrailleuse | principale | 27 | ×1,6 | rafale, 5 s de rechargement | 100 | 120 m |
| Fusil à pompe | principale | 9 plombs × 13 | ×1,5 | lente | 6 | 30 m |
| Fusil de précision | principale | 110 (mort d'une balle) | ×2,5 | très lente, lunette | 5 | 450 m |
| Couteau | — | 60 | — | — | — | 2,3 m |

Les dégâts baissent avec la distance (sauf au fusil de précision).

**Équipement tactique** (option de la salle) : à chaque apparition, 2 grenades à fragmentation (`G` : jusqu'à 150
dégâts, 7 m, on est protégé derrière un mur ; sa propre grenade blesse aussi), 1 grenade aveuglante (`F` : écran
blanc jusqu'à 4 s, bien plus long si on regarde l'éclair) et 1 fumigène (`C` : nuage de 5,5 m pendant 15 s qui bouche
la vue, robots compris). La salle calcule la trajectoire (rebonds sur les murs et le sol) et les effets.

**Armes de la partie** (à la création) : *Armes au choix* (on coche celles qui sont permises) ou *Progression* :
tout le monde commence au couteau, puis pistolet, revolver, pistolet-mitrailleur, fusil à pompe, mitraillette,
carabine, fusil d'assaut, fusil tactique, mitrailleuse et fusil de précision, un palier tous les onzièmes du score visé (le serveur refuse toute autre arme). 2 s d'invincibilité à chaque apparition
(« Protégé »), perdue dès qu'on tire. Fin de partie : bannière « Partie terminée — Victoire ! / Défaite » avant
le tableau des scores.

**Nuit** (au choix à la création) : la carte est plongée dans la nuit et chaque arme porte une lampe sous le
canon (`L` pour l'éteindre ou la rallumer) et un laser (`O`). Le fil du laser n'est visible que par celui qui vise ;
les autres n'en voient que le point rouge, là où il touche (décor ou personnage). Les faisceaux des joueurs
proches éclairent la scène ; le serveur ne transmet lampes et lasers que dans une partie de nuit.

**Cartes** (au choix, avec aperçu du plan à la création de la salle ou en solo) : *Le Village* (tout), *Les Souterrains* (galeries et
salles à 8 m sous terre), *Le Quartier des Tisserands* (rues serrées entre les maisons), *La Place du Marché*
(petite arène), *L'Église et le Cimetière*, *La Ferme des Brumes* (grange, écuries, champs : longues distances),
*La Forêt de la Lisière* (sous-bois). Chacune a ses points d'apparition et une limite invisible (« Limite de la
carte ») ; le serveur refuse les positions hors carte. Définitions : `src/shared/gunfightMaps.ts`.

**Mini-carte** en bas à gauche (tournée selon le regard) : coéquipiers en blanc, adversaires en rouge seulement
pendant 3 s après un tir.

**Animations** : arme en main, le corps reste face au viseur et l'on se déplace dans tous les sens (les jambes et le
bassin partent dans le sens de la marche, de côté ou à reculons, le buste reste tourné vers la visée) ; mains
refermées sur l'arme ; rechargement (arme abaissée, la main gauche va chercher un chargeur ; cartouche par
cartouche au fusil à pompe), pompe et culasse réarmées après chaque coup, culasse du pistolet qui recule ; le recul
se rattrape en partie de lui-même.

**Visée** : le viseur est au centre de l'écran et l'arme pointe exactement sur ce qu'il désigne ; clic droit
maintenu pour épauler (zoom, caméra rapprochée, dispersion quasi nulle ; lunette noire au fusil de précision).
La dispersion s'ouvre en mouvement, en l'air et en tir soutenu (le viseur s'écarte d'autant), le recul relève
le canon. Les armes se tiennent à deux mains : l'arme est placée dans l'axe de la visée (bras tendus pour le
pistolet, crosse à l'épaule pour les armes longues) et les bras viennent la saisir par cinématique inverse
(`src/characters/armIk.ts`, modèles dans `src/characters/weapons.ts`).

**Tirs à la tête** : chaque personnage a une tête (sphère) et un corps (capsule) ; le navigateur n'envoie que le
rayon de chaque balle (origine, direction), le serveur cherche ce qu'il traverse — en tenant compte des positions
des 350 dernières ms pour compenser la latence — et applique le multiplicateur de la tête. Marqueur rouge,
« Tête ! », crâne dans le fil des éliminations, colonne « Tête » au tableau des scores.

| | |
|---|---|
| **Créer une salle** | mode, nombre de places (2 à 16), éliminations pour gagner, durée ; un code de 4 lettres à partager |
| **Rejoindre** | le code donné par l'hôte |
| **Solo (robots)** | 1 à 11 robots, difficulté facile / normale / difficile ; ils patrouillent, repèrent, se décalent, tirent, rechargent |
| **Chacun pour soi** | chaque joueur pour lui ; tableau des scores individuel |
| **Match à mort par équipe** | Équipe Rouge contre Équipe Bleue ; chacun choisit son équipe au salon (« Rejoindre cette équipe »), pas de tir allié, score d'équipe |

En combat : vie, barre d'armes et munitions, score et temps, fil des éliminations, viseur avec marqueur de touche,
écran d'élimination, `Tab` pour le tableau des scores, `Échap` pour la carte et les scores. Le serveur (ou la salle
locale en solo) recalcule chaque tir : arme en main, cadence, munitions, origine et direction du rayon, zone
touchée, portée, ligne de vue (depuis les yeux du tireur et depuis sa caméra), équipe. Les robots du mode solo
reçoivent une arme au hasard à chaque apparition et gardent la distance qui lui convient ; leurs balles passent
par le même calcul. La dispersion est tirée par le navigateur (le serveur ne la vérifie pas). Règles :
`src/shared/gunfight.ts`, salle : `src/shared/gunfightRoom.ts` (partagée par le serveur et le solo), tests :
`tests/gunfight.test.ts`, contrôle dans le navigateur : `scripts/gunfight-check.ts`.

## Souterrains

À 8 m sous le village, un réseau de galeries éclairées de lanternes, étayées de bois, relie huit salles :
**crypte des Aubin** (tombeaux, autel), **geôles oubliées** (douze cellules à barreaux, certaines ouvertes),
**salle du Conseil secret** (table ronde, bannières), **réserve des contrebandiers**, **laboratoire de l'alchimiste**,
**citerne** (bassin d'eau noire), **chapelle des Pénitents**, **ossuaire**. Deux boyaux étroits et obscurs doublent
le réseau : le tunnel d'évasion (d'une cellule des geôles jusqu'à la crypte) et le passage des contrebandiers
(de la citerne à la réserve).

Cinq entrées discrètes, éloignées les unes des autres, descendent par une échelle au fond d'un puits : un
**mausolée** à l'est du cimetière, un **puits asséché** dans le verger, une **trappe derrière les écuries** (entre
les bottes de foin), une **trappe dans le jardin de la maison abandonnée** et une ouverture **entre les rochers de la
lisière**. Sous terre, ni lune ni ciel : seules les lanternes éclairent ; le nom de la salle s'affiche.
Données : `src/village/underground.ts` (partagées avec le serveur, lignes de vue comprises), rendu :
`src/village/undergroundMesh.ts`, tests : `tests/underground.test.ts` (descente et remontée par chaque entrée avec
le vrai contrôleur, toutes les salles reliées).

La carte est bordée d'un **mur invisible** qui suit la lisière de la forêt, 35 m sous les arbres : on ne peut pas
en sortir, ni en sautant, ni en vol libre (pointillé rouge sur la carte).

## Carte et écran de pause

**Échap** (une seule pression, même souris capturée) ou **M** ouvre l'écran de pause, façon jeu en monde ouvert, avec trois onglets : **Carte**, Paramètres,
Commandes. L'onglet Carte montre le plan du village dessiné comme un vieux parchemin (rues, places, bâtiments,
champs, verger, cimetière, forêt, rose des vents) — molette pour zoomer, glisser pour se déplacer, survol pour lire
le nom du lieu, ◎ pour se recentrer — avec, à droite, **votre rôle et votre journal d'enquête** en partie (ou votre
personnage en solo). Vous n'y voyez que votre propre position. En **exploration solo**, un clic sur la carte vous
**téléporte** à l'endroit choisi ; la case « Souterrains » affiche les galeries et leurs entrées, où l'on peut aussi
se téléporter. En **exploration libre** (« Explorer la carte librement »), `M` ouvre la même carte et un clic y pose
la caméra, à hauteur d'homme.

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

**Accessibilité** (`npx tsx scripts/reach.ts`) : pour chaque bâtiment, on remplit depuis la rue tout ce qu'un
personnage (rayon 0,25 m) peut atteindre en suivant planchers, escaliers et échelles, avec les vraies collisions
(murs, cloisons, mobilier). 216 pièces sur 221 sont accessibles (les deux étages du clocher, aux échelles très
raides, sont praticables en jeu mais hors de portée de l'analyse). Pour cela les bâtiments ont été agrandis
automatiquement (jusqu'à +40 % tant qu'ils ne touchent ni voisin, ni rue, ni place), les portes intérieures
élargies à 1 m, les chaises, tabourets et bancs rendus franchissables et les paliers d'escalier dégagés.

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
