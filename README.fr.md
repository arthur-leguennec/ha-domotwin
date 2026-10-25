<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-neon.png" alt="DomoTwin : un appartement fictif dans l’apparence néon, ses murs de verre soulignés de cyan, ses lampes allumées, le nom des pièces au sol" width="100%">
</p>

<p align="center"><b>Votre logement en jumeau 3D vivant dans Home Assistant.</b><br>
Touchez une lampe pour l’allumer, une pièce pour la piloter, et voyez vos capteurs s’animer sur le plan.<br>
Local, rapide, Rust + WebAssembly.</p>

<p align="center">
  <a href="https://my.home-assistant.io/redirect/hacs_repository/?owner=arthur-leguennec&repository=ha-domotwin&category=integration"><img src="https://my.home-assistant.io/badges/hacs_repository.svg" alt="Ouvrir votre Home Assistant et ajouter ce dépôt à HACS."></a>
</p>

<p align="center"><a href="https://github.com/arthur-leguennec/ha-domotwin/blob/main/README.md">Read in English</a></p>

> [!NOTE]
> **État : développement en cours.** DomoTwin se construit étape par étape ([feuille de
> route](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/ROADMAP.md), en anglais).
> L’intégration, le panneau, la carte, l’import du plan (IFC, Sweet Home 3D, DXF, scans de
> pièces), les vues 3D et 2D, le
> pilotage en direct (états, toucher, appui long, panneau de pièce, liaisons), le mode édition, vos
> propres modèles 3D, les calques, les appareils, l’éditeur de plan, les étages, les apparences,
> tous les étages à la fois, la promenade, le kiosque, la carte du réseau, les fils des
> automatisations, les fiches d’entretien, les personnes dans leurs pièces, la localisation
> Bluetooth, la voix et la finition (police, clavier, lecteurs d’écran) fonctionnent déjà ; une
> passe sur la taille et la vitesse arrive ensuite, puis la version 0.2.0. Les fonctionnalités
> ci-dessous décrivent la version 0.1.0 et ce qui a suivi.

## Fonctionnalités

- **Votre plan en 3D et en 2D.** Dessinez-le dans le panneau, ou importez-le : une maquette IFC
  (`*.ifc`, depuis Revit, ArchiCAD, Bonsai, FreeCAD…), une maison Sweet Home 3D (`*.sh3d`), un
  dessin DXF, une pièce scannée avec un iPhone ou un iPad à LiDAR (`*.usdz`, le JSON de RoomPlan)
  ou un plan DomoTwin (`*.domotwin.json`), un étage ou tous, et voyez-le en maquette 3D. Les
  murs face à la caméra s’abaissent automatiquement, comme une maison de poupée ouverte. Passez à un
  plan 2D net avec une transition fluide.
- **Cinq apparences.** **Néon** : des murs de verre soulignés d’une couleur d’accent lumineuse
  sur une grille, des lampes et des écrans qui brillent ; **plan d’architecte** : des traits blancs
  sur fond bleu ; **jour** : le logement tel qu’il est, à la lumière de l’heure ; **dessin animé** :
  des couleurs vives cernées d’encre noire, sous un ciel bleu ; **maquette d’argile** : le logement
  en argile mate, comme une maquette d’architecte. Automatique : néon en mode sombre. Voir [les
  apparences](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/looks.md) (en
  anglais).
- **Toucher pour piloter.** Touchez une lampe pour l’allumer ou l’éteindre, appuyez longuement pour
  la luminosité et la couleur, appuyez longuement sur une pièce pour retrouver ses lumières, scènes,
  volets, chauffage et lecteurs.
- **En direct.** Les lampes éclairent leur pièce dans leur vraie couleur et luminosité, la
  télévision s’illumine, volets et rideaux bougent, portes et fenêtres s’ouvrent avec leurs
  capteurs.
- **Calques.** Une carte de chaleur animée (température, humidité, CO₂ ou particules fines) tirée
  des capteurs de la zone de chaque pièce, des alertes de sécurité qui pulsent dans leur pièce
  (fumée, gaz, fuite d’eau, alarme, fenêtre ouverte sous la pluie), les pièces occupées, le vrai
  soleil qui entre par vos fenêtres, et ce que consomme chaque appareil.
- **Appareils.** Des badges sur vos appareils (l’état d’une serrure, une caméra qui enregistre, ce
  qui est en lecture, une batterie faible, le lave-linge en marche), et ce que voit chaque caméra,
  dessiné au sol de sa pièce, derrière les meubles, discret tant que vous ne touchez pas la
  caméra ; touchez pour l’image en direct.
- **Carte du réseau.** Votre maillage Zigbee dessiné sur le logement : chaque appareil sur son
  meuble, chaque lien en arc coloré selon sa qualité, une lumière qui court vers le coordinateur,
  et les pièces suspendues à un lien faible nommées, avec « un routeur ici aiderait ». Touchez un
  appareil ou un lien pour le détail, relancez un scan, placez les appareils que la carte ne trouve
  pas. Pour les administrateurs, avec ZHA. Voir [la carte du
  réseau](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/network.md) (en anglais).
- **Fils des automatisations.** Un appui long sur une lampe : son panneau liste les automatisations
  qui la concernent, avec leur interrupteur et leur dernier lancement. Montrez leurs fils, de ce
  qui les déclenche à ce qu’elles commandent, et voyez une impulsion les parcourir quand l’une se
  lance. Ou toutes les automatisations du logement à la fois. Voir [les fils des
  automatisations](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/automations.md)
  (en anglais).
- **Fiches d’entretien.** Chaque appareil et chaque meuble peut porter sa marque, son modèle, son
  numéro de série, sa garantie, sa notice et les tâches qui reviennent (changer le filtre tous les
  3 mois). Un badge en forme de clé montre ce qui est à faire, le calque Entretien colore les
  meubles en vert, orange ou rouge, et une liste par date a un bouton **Fait** pour tout le monde.
  Un fichier IFC remplit les fiches ; un seul capteur, `sensor.domotwin_upkeep_due`, sert à vos
  notifications. Voir [les fiches
  d’entretien](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/upkeep.md) (en
  anglais).
- **Les personnes dans leurs pièces.** Chaque personne à la maison se tient dans sa pièce, une
  silhouette à sa couleur, son nom au-dessus, et passe par les portes quand elle change de pièce.
  DomoTwin la place d’après ce qui dit déjà où elle est (les capteurs de pièce de Bermuda ou
  d’ESPresense, ou toute entité qui nomme une pièce) ; le panneau de la pièce dit qui s’y trouve,
  et Assist répond à « où est Alex ? ». Chacun peut se masquer. Voir [les personnes dans leurs
  pièces](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/people.md) (en anglais).
- **La localisation Bluetooth.** Pas de Bermuda ? DomoTwin trouve lui-même la pièce d’un
  téléphone, d’une montre ou d’une balise, d’après ce qu’entendent les récepteurs Bluetooth de Home
  Assistant (son adaptateur, les proxys ESPHome, les appareils Shelly). Il part du plan (distances,
  murs, portes, étages) et marche dès la première minute, puis apprend des pièces enseignées et des
  capteurs de présence. Les téléphones placent leur propriétaire ; les clés oubliées sont
  signalées ; « où sont mes clés ? » à la voix. Voir [la localisation
  Bluetooth](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/bluetooth.md) (en
  anglais).
- **Pièces privées.** Réservez une chambre ou un bureau à certaines personnes, toujours ou tant
  qu’un interrupteur « Invités » est allumé : les autres la voient fermée, son sol givré, rien ni
  personne à l’intérieur, aucune commande, et les réponses vocales disent « dans une pièce
  privée ». Voir [pièces
  privées](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/privacy.md) (en
  anglais).
- **Éditeur de plan.** Pas de plan à importer ? Dessinez-le dans le panneau : des pièces en
  polygones avec leurs longueurs, des cloisons, des portes et des fenêtres posées sur les murs, avec
  aimantation et annulation. Voir [l’éditeur de
  plan](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/plan-editor.md) (en anglais).
- **Étages.** Une cave, des étages, des combles : un plan chacun, un sélecteur dans la vue, un
  escalier qui vous fait monter d’une touche, et les alertes de chaque étage où que vous soyez. Ou
  tout le logement d’un coup, ses étages écartés sous un toit, chacun avec son étiquette et son
  image, en direct à chaque niveau. Voir [les étages](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/storeys.md) (en
  anglais).
- **Mode édition.** Déplacez, tournez et empilez les meubles avec aimantation, repères et
  annulation, ajoutez des meubles depuis un catalogue, liez n’importe quel objet à des entités (avec
  des suggestions tirées de vos pièces), et ajoutez votre propre meuble ou appareil avec son modèle
  3D (glTF/GLB, OBJ, STL ou 3MF). Voir [le mode édition](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/edit-mode.md) (en anglais).
- **Promenez-vous, accrochez-le au mur, demandez-le.** Promenez-vous dans votre logement à
  hauteur des yeux, de pièce en pièce par les portes. Sur une tablette murale, une carte revient à
  sa vue quand on la laisse, tourne lentement et s’assombrit la nuit. Dites « montre la cuisine » à
  Assist et vos écrans la montrent. Voir [la promenade, les kiosques et la
  voix](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/kiosk.md) (en anglais).
- **Votre voix.** Un bouton micro ouvre Assist de Home Assistant déjà à l’écoute, sur une
  tablette murale comme sur un téléphone. Quand Assist n’entend pas encore, DomoTwin installe la
  voix en local avec votre accord : Whisper ou Speech-to-Phrase et Piper, installés par le
  Supervisor, sans que rien ne quitte votre logement. Les blueprints vocaux s’ajoutent d’un geste.
  Voir [votre voix](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/voice.md) (en
  anglais).
- **Léger et fluide.** Rust compilé en WebAssembly, un rendu seulement quand quelque chose change,
  des préréglages de qualité pour les vieilles tablettes murales. Le premier chargement est limité à
  1,2 Mo, vérifié par l’intégration continue.
- **À vous.** Anglais et français, suit le thème de Home Assistant, fonctionne dans les applications
  mobiles. Sa propre police (Inter, servie par votre Home Assistant), et tout à portée du clavier
  et des lecteurs d’écran : les pièces et leurs commandes, les menus, les dialogues.

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/demo.gif" alt="L’appartement de démonstration : la vue tourne autour du logement, puis le montre en plan 2D et revient en 3D" width="480">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-looks.png" alt="L’appartement de démonstration le soir dans trois apparences : néon, plan d’architecte et jour" width="100%">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-cartoon-clay.png" alt="L’appartement de démonstration en journée dans l’apparence dessin animé, ses meubles et ses habitants cernés de noir sur des sols vifs sous un ciel bleu, et en maquette d’argile, tout d’une même argile mate et chaude" width="100%">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-3d.png" alt="L’appartement fictif de démonstration en 3D : les murs face à la caméra sont abaissés, des meubles dans chaque pièce" width="49%">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-plan.png" alt="Le même appartement en plan 2D vu du dessus" width="49%">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-edit.png" alt="Le mode édition : un meuble glissé sur le plan 2D s’aimante contre un mur, avec les distances aux autres murs ; le catalogue des meubles à ajouter" width="100%">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-live.png" alt="Le pilotage en direct, le soir : un appui long sur une lampe ouvre ses commandes, un appui long sur le sol d’une pièce ouvre le panneau de la pièce" width="100%">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-layers.png" alt="Les calques : la température de chaque pièce en carte de chaleur avec sa légende, la consommation des appareils, une alerte de fumée qui pulse dans la cuisine, et le soleil qui entre par les fenêtres" width="100%">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-devices.png" alt="Les appareils : des badges sur la porte d’entrée, la télévision, la caméra et le lave-linge, et ce que voit la caméra du séjour, un éventail avec un anneau par mètre au sol du plan 2D" width="100%">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-network.png" alt="La carte du réseau : les appareils Zigbee de l’appartement de démonstration sur leurs meubles, reliés par des arcs verts, orange et rouges, et une fiche avec le détail d’un routeur, la santé du réseau et un capteur pas placé dans le logement" width="100%">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-automations.png" alt="Les fils des automatisations : toutes les automatisations de l’appartement de démonstration tirées de la télévision et de la porte d’entrée jusqu’aux lampes et aux rideaux, avec des étiquettes au-dessus du logement pour le soleil, une heure, une notification et ce qu’un modèle décide" width="100%">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-people.png" alt="Les personnes dans leurs pièces : l’appartement de démonstration dans l’apparence néon, Sam en silhouette bleue lumineuse dans le séjour et Alex en rose dans la cuisine, chacun avec son nom au-dessus" width="100%">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-bluetooth.png" alt="La localisation Bluetooth : les réglages par-dessus l’appartement de démonstration, trois récepteurs et comment chacun est placé, le téléphone et les clés d’Alex suivis dans la cuisine, une montre entendue qui peut être suivie" width="100%">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-upkeep.png" alt="Le calque Entretien : le lave-linge de l’appartement de démonstration en rouge car son filtre est en retard, le réfrigérateur en orange car ses grilles sont bientôt à nettoyer, le ventilateur et la plaque en vert, à côté de la liste des tâches par date avec leurs boutons Fait" width="100%">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-plan-editor.png" alt="L’éditeur de plan : un coin du séjour déplacé avec les longueurs de ses côtés, et une pièce dessinée à côté du logement" width="100%">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-storeys.png" alt="Les étages : l’étage au-dessus de l’appartement de démonstration avec son escalier et le sélecteur d’étage, et la fenêtre qui liste les étages avec leur nom et leur hauteur" width="100%">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-home.png" alt="Tous les étages à la fois : les deux étages de l’appartement de démonstration écartés sous un toit de verre dans l’apparence néon, chacun avec son étiquette (pièces, lumières allumées) et une image de chaque étage à gauche" width="100%">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-walk.png" alt="Promenade dans le séjour de l’appartement de démonstration à hauteur des yeux, le soir, ses lampes allumées, avec le pavé de marche dans le coin" width="100%">
</p>

## Démarrage rapide

1. **Installer.** Utilisez le bouton ci-dessus, ou ajoutez dans HACS
   `https://github.com/arthur-leguennec/ha-domotwin` comme dépôt personnalisé de type *Intégration*,
   installez **DomoTwin** et redémarrez Home Assistant.
2. **Ajouter l’intégration.** Paramètres → Appareils et services → Ajouter une intégration →
   **DomoTwin**. Aucun YAML.
3. **Dessiner ou importer votre plan.** Ouvrez **DomoTwin** dans la barre latérale → **Dessiner un
   plan**, ou **Importer un plan** et choisissez un plan DomoTwin (`*.domotwin.json`), un fichier
   IFC (`*.ifc`, voir [l’import
   IFC](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/ifc-import.md), en anglais),
   une maison Sweet Home 3D, un dessin DXF ou le scan d’une pièce (voir [les plans d’autres
   applications](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/imports.md), en
   anglais).
   Pas encore de plan ? Essayez l’appartement fictif
   [`examples/demo-apartment.domotwin.json`](https://github.com/arthur-leguennec/ha-domotwin/blob/main/examples/demo-apartment.domotwin.json)
   ou
   [`examples/demo-apartment.ifc`](https://github.com/arthur-leguennec/ha-domotwin/blob/main/examples/demo-apartment.ifc),
   ou **Dessiner un plan** dans l’application.

Ajoutez ensuite la carte **DomoTwin** à n’importe quel tableau de bord depuis le sélecteur de
cartes.

## Configuration

Tout se règle depuis l’interface : les options de l’intégration et l’éditeur visuel de la carte. Le
YAML n’est jamais nécessaire. Pour référence, les options de la carte :

| Option        | Valeurs                             | Défaut     | Description                                   |
| ------------- | ----------------------------------- | ---------- | --------------------------------------------- |
| `type`        | `custom:domotwin-card`              | requis     |                                               |
| `title`       | texte                               | aucun      | En-tête de la carte.                          |
| `view`        | `3d`, `2d`                          | `3d`       | Vue à l’ouverture de la carte.                |
| `height`      | longueur CSS (`400px`, `60vh`…)     | ratio 4:3  | Hauteur fixe ; en sections, la grille décide. |
| `quality`     | `auto`, `eco`, `balanced`, `high`   | `auto`     | Qualité du rendu ; `auto` s’adapte à l’appareil. |
| `cutaway`     | `auto`, `always`, `off`             | `auto`     | Abaissement des murs face à la caméra.        |
| `lighting`    | `auto`, `morning`, `day`, `evening`, `night` | `auto` | Lumière de la scène. `auto` suit le soleil de votre Home Assistant (`sun.sun`), ou l’horloge à défaut. |
| `storey`      | un identifiant d’étage (`storey-2`…), `all` | rez-de-chaussée | Étage affiché à l’ouverture de la carte, `all` pour tous les étages à la fois ; le sélecteur le change. |
| `spread`      | `true`, `false`                     | `true`     | Tous les étages à la fois : écartés, ou empilés. |
| `roof`        | `true`, `false`                     | `true`     | Tous les étages à la fois : le toit sur le dernier. |
| `room`        | un identifiant de pièce du plan     | aucun      | Pièce à cadrer à l’ouverture de la carte.     |
| `layer`       | `off`, `temperature`, `humidity`, `co2`, `pm25`, `power`, `network`, `automations`, `upkeep` | `off` | Calque affiché à l’ouverture ; le menu des calques le change. `network` ne s’affiche qu’aux administrateurs, avec ZHA ; `automations` aux administrateurs. |
| `alerts`      | `true`, `false`                     | `true`     | Alertes de sécurité des pièces (fumée, gaz, eau, alarme, fenêtre ouverte sous la pluie). |
| `presence`    | `true`, `false`                     | `true`     | Les pièces occupées s’illuminent doucement.   |
| `people`      | `true`, `false`                     | `true`     | Les personnes dans leurs pièces, en silhouettes. |
| `sun`         | `fixed`, `real`                     | `fixed`    | `real` : le soleil éclaire depuis sa vraie position (`sun.sun`), par les fenêtres. |
| `badges`      | `true`, `false`                     | `true`     | Badges des appareils : serrures, caméras, lecture, batteries faibles, appareils en marche. |
| `cameras`     | `true`, `false`                     | `true`     | Ce que voient les caméras liées, dessiné au sol. |
| `theme`       | `auto`, `day`, `neon`, `blueprint`, `cartoon`, `clay` | celle du logement | L’apparence ; `auto` : néon en mode sombre. |
| `accent`      | une couleur `#rrggbb`               | celle du logement | Couleur d’accent (les contours lumineux du néon). |
| `names`       | `true`, `false`                     | `true`     | Le nom des pièces au sol.                     |
| `idle`        | secondes (0 à 86400)                | `0`        | Kiosque : revenir à cette vue après ce temps sans contact (0 : jamais). |
| `orbit`       | `true`, `false`                     | `false`    | Kiosque : tourner lentement autour du logement entre-temps. |
| `night_dim`   | `true`, `false`                     | `false`    | Kiosque : assombri la nuit entre-temps (sauf alerte). |
| `tools`       | `true`, `false`                     | `true`     | Les boutons de la vue.                        |
| `voice`       | `true`, `false`                     | `true`     | Le bouton micro, quand Assist est là.         |
| `screen`      | un nom (`hallway`…)                 | aucun      | Le nom de cet écran, pour `domotwin.show`.    |
| `font_family` | une famille de police, `theme`      | incluse    | Police des textes de la carte ; `theme` : celle de votre thème. |

Options de l’intégration (Paramètres → Appareils et services → DomoTwin → Configurer) : afficher le
panneau dans la barre latérale, et le réserver aux administrateurs. Seuls les administrateurs
peuvent importer un plan, le modifier et lier des entités. Les réglages du panneau (la roue
dentée) indiquent où se trouve le nord sur le plan, pour le vrai soleil.

**Les calques lisent vos zones.** La valeur d’une pièce sur la carte de chaleur est la moyenne des
capteurs de température, d’humidité, de CO₂ ou de PM2,5 de sa zone Home Assistant (la zone liée à
la pièce, ou celle qui porte son nom) ; ses alertes et sa présence viennent des détecteurs de
fumée, de gaz, de monoxyde de carbone, d’humidité, de sécurité, d’occupation, de mouvement et de
présence de cette zone, et de son alarme. Le calque de consommation utilise les capteurs de
puissance liés à chaque meuble. La carte du réseau place chaque appareil Zigbee sur le meuble lié à
son appareil ou à l’une de ses entités.

## Fonctionnement

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/architecture.png" alt="Architecture de DomoTwin : l’intégration Home Assistant, l’interface et le moteur WebAssembly" width="100%">
</p>

Une intégration Python légère enregistre votre plan, vos modifications et vos liaisons dans Home
Assistant et sert l’interface. L’interface (TypeScript) dialogue avec Home Assistant ; le moteur
(Rust compilé en WebAssembly) lit le plan, construit la géométrie et la dessine en WebGL2. Détails
dans
[`docs/ARCHITECTURE.md`](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/ARCHITECTURE.md)
(en anglais).

## FAQ

**Quels formats de plan DomoTwin lit-il ?** Son propre format de plan, décrit dans
[`docs/plan-format.md`](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/plan-format.md)
avec son schéma JSON ; les fichiers IFC (ISO 16739, exportés par FreeCAD, Blender avec Bonsai,
ArchiCAD ou Revit), un étage ou tous à la fois : voir [l’import
IFC](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/ifc-import.md) (en anglais) ;
les maisons Sweet Home 3D, les dessins DXF et les scans de pièces faits avec RoomPlan d’Apple
(USDZ ou JSON) : voir [les plans d’autres
applications](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/imports.md) (en
anglais). Les fichiers DWG, l’USD binaire et les scans en maillage (OBJ) ne sont pas lus.

**Puis-je le mettre sur une tablette murale, ou demander une pièce à la voix ?** Oui : les options
`idle`, `orbit`, `night_dim` et `tools` font d’une carte un kiosque, et l’action `domotwin.show`
(avec un blueprint pour Assist) montre une pièce sur vos écrans. Voir [la promenade, les kiosques
et la voix](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/kiosk.md) (en anglais).

**Mon logement a plusieurs niveaux.** Chaque niveau est un étage avec son propre plan : **Étages**
dans le panneau en ajoute un (importé ou dessiné), le nomme et règle sa hauteur ; la vue passe de
l’un à l’autre ou les montre tous à la fois, et une carte peut s’ouvrir sur n’importe lequel ou sur
tout le logement. Voir [les
étages](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/storeys.md) (en anglais).

**Puis-je dessiner mon logement sans autre logiciel ?** Oui : **Dessiner un plan** dans le
panneau (ou **Modifier le plan** pour en changer un), voir [l’éditeur de
plan](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/plan-editor.md) (en anglais).

**Puis-je utiliser mes propres meubles ?** Oui : en mode édition, **Importer un modèle 3D** accepte
un fichier glTF/GLB, OBJ, STL ou 3MF de 8 Mo au plus. Donnez sa taille réelle ; il se place,
s’empile et se lie comme n’importe quel meuble, est gardé par Home Assistant et inclus dans
**Exporter le plan**.

**Faut-il une connexion Internet ?** Non. Voir
[Confidentialité](https://github.com/arthur-leguennec/ha-domotwin/blob/main/README.fr.md#confidentialité).

**Est-ce que ça tourne sur ma tablette murale ?** Il faut WebGL2, présent dans les navigateurs
actuels et dans les applications mobiles Home Assistant. Sur les appareils anciens, DomoTwin choisit
le préréglage Éco et ne dessine que quand quelque chose change : une vue au repos ne coûte presque
rien.

**Qui peut modifier le plan ?** Tout le monde peut voir et utiliser DomoTwin ; seuls les
administrateurs peuvent importer un plan, le modifier et changer les liaisons.

**Que deviennent mes données si je supprime l’intégration ?** Le plan, les modifications, les
liaisons et les fichiers des modèles 3D enregistrés sont supprimés. Utilisez d’abord **Exporter le
plan** pour en garder une copie (elle contient les fichiers 3D).

## Confidentialité

DomoTwin ne communique qu’avec votre propre Home Assistant. Aucun autre appel réseau : pas de CDN,
pas de télémétrie, pas de statistiques, pas de polices web. Tous les fichiers utilisés (JavaScript,
WebAssembly, polices, matériaux) sont servis par l’intégration. Les diagnostics ne contiennent que
des comptes, jamais de noms, d’identifiants d’entités ou d’appareils, d’adresses Zigbee ou de
géométrie.

## Contribuer

Les contributions sont les bienvenues : voir
[`CONTRIBUTING.md`](https://github.com/arthur-leguennec/ha-domotwin/blob/main/CONTRIBUTING.md) (en
anglais). Problèmes de sécurité : voir
[`SECURITY.md`](https://github.com/arthur-leguennec/ha-domotwin/blob/main/SECURITY.md).

## Licence

[MIT](https://github.com/arthur-leguennec/ha-domotwin/blob/main/LICENSE). La spécification du format
de plan et son schéma sont réutilisés sous licence MIT, et les composants tiers inclus sont listés
dans
[`THIRD_PARTY_NOTICES.md`](https://github.com/arthur-leguennec/ha-domotwin/blob/main/THIRD_PARTY_NOTICES.md).
