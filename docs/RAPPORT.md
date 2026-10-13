# Rapport : audit, corrections, interface, validation

## A. Audit (état trouvé)

| Domaine | Constat |
|---|---|
| Serveur | autoritaire et testé (rôles, délais, munitions, votes, victoire) ; **pas de ligne de vue** : on pouvait tirer, éliminer ou enquêter à travers un mur |
| Fin de partie | la salle restait en phase « fin » : impossible d'accueillir de nouveaux joueurs, un joueur parti bloquait la relance, aucun effacement de l'état ; résultats sans raison lisible |
| Horloge | délais du tueur et compte à rebours des votes calculés avec l'heure du navigateur (faux dès que l'horloge du serveur diffère, ex. Render) |
| Chargements | personnages chargés de façon asynchrone sans annulation (pouvaient réapparaître après la fin d'une partie) ; échec du chargement du village = écran figé |
| Interface | menu = simple fenêtre sur l'outil d'inspection ; pas de paramètres, pas de crédits, pas de pause, pas de journal, pas d'écran d'élimination ; couleurs seules pour les rôles |
| Son | aucun |
| Décor | lanternes vacillantes ; végétation immobile ; deux tiers des maisons sans lumière à la porte |

## B. Corrections

- Lignes de vue vérifiées par le serveur (murs, planchers, relief du vrai village, ~80 ms de construction au démarrage) pour le tir, l'élimination et l'enquête. Un tir refusé ne consomme pas la balle.
- Fin de partie : raison de la victoire, survivants ; **retour au salon** qui efface tout l'état (rôles, corps, votes, journal, délais), libère les places des joueurs partis, transmet l'hôte si besoin ; « prêt » remis à zéro.
- Horloge du serveur utilisée pour tous les délais affichés.
- Chargements annulés au changement de partie ; message d'erreur si un modèle manque, si WebGL est indisponible ou si le village ne se construit pas.
- État de connexion réel (« connecté » seulement si le socket l'est).

## C–F. Interface, carte, son

Voir le README (menu cinématique, salon, interface de partie, pause, résultats, paramètres, sons synthétisés, vie du décor, lanternes d'entrée).

## G. Plan de test et résultats

Automatisé (`npm test` : 97 tests ; `scripts/ui-check.ts`, `scripts/solo-check.ts` dans Chromium) :

| Cas | Résultat |
|---|---|
| Joueur qui quitte le salon avant le lancement | place libérée, « Il manque 1 joueur », notification de départ — OK |
| Composition minimale (4) et plusieurs tueurs (2 sur 8) | OK |
| Shérif qui tire juste / qui rate (meurt avec l'innocent) / tir à travers un mur / sans balle | OK |
| Tueur : délai, pas de double élimination, pas à travers un mur | OK |
| Joueur éliminé : plus aucune action (tir, réunion, signalement, vote) | OK |
| Réunion sans majorité, égalité, vote unique, un seul signalement par corps, fin des votes à 60 s | OK |
| Victoire recalculée, raison affichée, rôles révélés | OK |
| Manches successives sans état résiduel (navigateur + serveur) | OK |
| Reconnexion avec jeton | OK (serveur) |
| Redimensionnement de la fenêtre, largeur téléphone (390 px) | OK (captures) |
| Ressource manquante (modèle de personnage 404) | message clair, retour possible — OK |
| Réglages : bornes, stockage corrompu, sensibilité appliquée | OK |

Limite de temps : il n'y a **pas** de limite de durée de partie (demande précédente : la partie dure jusqu'à la victoire) ; la limite de temps testée est celle des votes.

### Non testé ou non mesurable ici

- **Images par seconde** : l'environnement de test n'a pas de carte graphique (rendu logiciel SwiftShader, ~3 images/s, sans rapport avec un vrai poste). Mesures disponibles : vue du menu ≈ 1 335 appels de dessin, 6,8 M triangles (qualité moyenne). Aucune valeur d'images/s n'est donc annoncée ; `F3` affiche la mesure réelle sur votre machine.
- Sons : générés sans erreur, mais **non écoutés** (pas de sortie audio dans l'environnement de test).
- Plusieurs vrais navigateurs en même temps : les autres joueurs des tests sont des robots Socket.IO ; un seul navigateur réel.
- Écrans tactiles : la mise en page s'adapte, mais il n'y a pas de commandes tactiles de déplacement.
- La ligne de vue du serveur ignore les objets du décor (étals, arbres) : seuls murs, planchers et relief bloquent.
