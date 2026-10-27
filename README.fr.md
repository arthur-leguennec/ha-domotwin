<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-phone-wall.png" alt="DomoTwin sur un téléphone et sur un écran mural : sur le téléphone, l’onglet Accueil de la maison de démo fictive, qui est là, ses commandes (éteindre toutes les lumières avec 6 allumées, fermer les rideaux, bonne nuit, le chauffage, la batterie de la maison) et ses favoris ; au mur, la même maison en 3D le soir, dans l’apparence néon, ses lampes allumées et ses habitants dans leurs pièces" width="100%">
</p>

<h1 align="center">DomoTwin</h1>

<p align="center"><b>Votre logement dans Home Assistant : sous la main sur votre téléphone, vivant en 3D au mur.</b><br>
Vos commandes et chaque pièce à portée de doigt, et un jumeau 3D de votre logement, en direct, à toucher, regarder et parcourir.<br>
Local, gratuit, sans compte. Rust + WebAssembly.</p>

<p align="center">
  <a href="https://my.home-assistant.io/redirect/hacs_repository/?owner=arthur-leguennec&repository=ha-domotwin&category=integration"><img src="https://my.home-assistant.io/badges/hacs_repository.svg" alt="Ouvrir votre Home Assistant et ajouter ce dépôt à HACS."></a>
</p>

<p align="center"><a href="https://github.com/arthur-leguennec/ha-domotwin/blob/main/README.md">Read in English</a></p>

> [!NOTE]
> **État : en développement, version 0.5.0.** DomoTwin se construit étape par étape
> ([feuille de route](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/ROADMAP.md), en anglais), et
> tout ce que décrit *Fonctionnalités* marche déjà. La proposition à la liste par défaut de HACS
> attend des mesures sur de vrais appareils.

## Sur votre téléphone, au mur

| Sur votre téléphone, le côté pratique | Au mur, le jumeau 3D |
| --- | --- |
| DomoTwin s’ouvre sur **Accueil** : qui est là, les lampes allumées, ce qui est ouvert, la météo, et **vos commandes** : éteindre toutes les lumières, fermer les volets, bonne nuit, le chauffage, la batterie de la voiture. Elles sont suggérées d’après vos propres appareils et se règlent en quelques touches. **Pièces** donne les appareils de chaque pièce en cartes de Home Assistant, avec une recherche ; **Sécurité**, l’alarme, la sonnette et les caméras. La 3D est à un onglet, jamais dans le chemin. | Une tablette près de la porte s’ouvre sur **3D** : votre logement tel qu’il est, ses lampes allumées de leur couleur, chacun dans sa pièce, la pluie sur le toit. Touchez une lampe, une télé, une pièce. Quand personne n’est là, un économiseur de vos photos, réveillé par un mouvement ou la sonnette. Dessinez le plan depuis les zones de Home Assistant en cinq minutes, ou importez-le de Revit, ArchiCAD, Sweet Home 3D ou de la carte d’un robot. |

Chaque appareil peut s’ouvrir sur son onglet : un téléphone sur *Accueil* (par défaut), un écran mural sur *3D*.

## Ce qui le distingue

- **Votre vrai plan.** Importez une maquette IFC (Revit, ArchiCAD, FreeCAD…) ou une maison Sweet
  Home 3D, tous les étages d’un coup, au lieu de redessiner votre logement.
- **Entièrement gratuit.** Tout est dans le code sous licence MIT : rien à acheter, aucun compte.
- **La carte du réseau.** Votre maillage Zigbee dessiné sur le plan : qui passe par qui, les liens
  faibles, et les pièces qui manquent d’un routeur.
- **Le bac à sable.** Une journée de vos automatisations jouée sur une copie de la maison, pour voir
  ce qu’elles font avant qu’elles le fassent, et une automatisation dite avec vos mots jouée là
  avant d’être enregistrée.

## Fonctionnalités

### Au quotidien

Ce qu’on cherche du doigt : le côté pratique, sur un téléphone comme sur un ordinateur.

- **Commandes.** De gros boutons en haut d’*Accueil*, à vous, qui agissent sur plusieurs appareils
  d’un appui et affichent leur état : *Éteindre toutes les lumières · 3 allumées*, *Fermer les
  volets · 2 ouverts*, *Bonne nuit*, *Chauffage à 19 °C · 20,5 °C*, *Voiture : batterie · 78 %*.
  **Ajouter une commande** les suggère d’après vos appareils (les lampes du logement ou d’un étage,
  les volets, les serrures, l’alarme, le chauffage, la batterie d’une voiture, la musique, les
  robots, vos scènes) ; ajoutez-en une telle quelle, ou ajustez-la : où (le logement, un étage, une
  pièce, les appareils que vous choisissez), ce qu’elle fait (éteindre, allumer à 30 %, ouvrir à
  moitié, 19 °C), et avec *Plus d’options* ce qui est laissé de côté, plusieurs étapes à la suite,
  ce que le bouton affiche, une question avant d’agir. Gardées pour vous, sur chaque appareil, et
  n’agissant que sur ce que vos droits vous laissent utiliser. Voir
  [les commandes](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/shortcuts.md) (en anglais).
- **Accueil, Pièces, Sécurité et 3D.** L’onglet *Accueil* du panneau montre la maison d’un coup
  d’œil (qui est là, les lampes allumées, les portes et fenêtres ouvertes, la météo), vos scènes
  favorites en grands boutons et vos favoris ; *Pièces* liste les étages et pièces de Home
  Assistant, les appareils de chaque pièce en cartes tuiles de Home Assistant, avec une
  recherche ; *Sécurité* réunit l’alarme et les caméras côte à côte ; *3D* est la vue en 3D, où
  toucher une pièce ouvre sa page. Les alertes s’affichent au-dessus de chaque onglet. Mettez en
  favori ce qui vous sert le plus ; choisissez l’onglet sur lequel DomoTwin s’ouvre, pour vous ou
  pour un écran, et un agenda ou une liste pour votre onglet Accueil.
- **Sécurité.** Les alertes de chaque pièce (fumée, eau, l’alarme…) et celles choisies dans la page
  Sécurité de Home Assistant, au-dessus de chaque onglet, à un toucher de la pièce en 3D.
  L’onglet *Sécurité* réunit le clavier de l’alarme, les sonnettes et toutes les caméras côte à
  côte, celle de la sonnette d’abord, et la page Sécurité de Home Assistant à un toucher. Quand
  on sonne, la sonnette s’affiche en plein écran, quel que soit l’onglet : sa caméra en direct et
  la serrure de la porte. Voir
  [la sécurité](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/safety.md) (en
  anglais).
- **Les graphiques de chaque pièce, l’énergie de la maison.** *Graphiques*, sur la page d’une
  pièce ou son panneau en 3D : ce que ses capteurs ont mesuré sur le dernier jour ou la dernière
  semaine (température, humidité, CO₂, puissance, les compteurs heure par heure, les portes et
  fenêtres, la présence) en graphiques de Home Assistant, la même chose en tableau ou dans
  l’historique de Home Assistant à portée de doigt. *Énergie* ouvre la page Énergie de Home
  Assistant, dont la flèche de retour ramène à DomoTwin. Voir
  [graphiques](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/graphs.md) (en
  anglais).
- **Plus tard.** « Allume la lanterne demain à 6 h 30 jusqu’à 6 h 45 » : depuis la fiche d’une
  lampe, une automatisation (`domotwin.schedule`) ou un assistant vocal, DomoTwin le fait à
  l’heure, même après un redémarrage, et montre une horloge sur la lampe en attendant. Voir [les
  actions faites plus tard](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/later.md)
  (en anglais).
- **Votre voix.** Un bouton micro ouvre Assist de Home Assistant déjà à l’écoute, sur une
  tablette murale comme sur un téléphone. Quand Assist n’entend pas encore, DomoTwin installe la
  voix en local avec votre accord : Whisper ou Speech-to-Phrase et Piper, installés par le
  Supervisor, sans que rien ne quitte votre logement. Les blueprints vocaux s’ajoutent d’un geste.
  Voir [votre voix](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/voice.md) (en
  anglais).
- **Les pointes d’Hydro-Québec.** Pour un logement au tarif Flex D ou au crédit hivernal, avec
  [hydroqc](https://github.com/hydroqc/hydroqc-ha) ou
  [HydroPeak](https://github.com/Beat-YT/hydropeak-ha) installé : la prochaine pointe et son
  préchauffage dans l’onglet Accueil, en 3D les pièces qui préchauffent, sont délestées ou
  chauffent encore pendant la pointe, avec ce qu’elles consomment, et la pointe annoncée pour
  demain jouée d’abord dans le bac à sable. Rien sans eux.

### Votre logement en 3D

Le jumeau : votre plan, vos appareils, en direct, dans l’apparence que vous aimez.

- **Votre logement en cinq minutes.** Pas de plan sous la main ? **Le dessiner depuis les zones de
  Home Assistant** : une pièce pour chaque zone de chaque étage, côte à côte, reliées par des portes,
  ses appareils placés dedans et liés (lampes, télés, enceintes, thermostats, la base du robot,
  capteurs), meublée si vous voulez ; puis *Premiers pas* liste ce qui reste (les vraies dimensions
  des pièces, les personnes, l’énergie), chaque étape à un clic. Voir [le premier
  lancement](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/first-launch.md) (en
  anglais).
- **Une maison de démo à essayer d’abord.** Avant de dessiner quoi que ce soit, ouvrez DomoTwin et
  choisissez **Essayer la maison de démo** : une maison familiale fictive sur deux niveaux, avec ses
  lampes, rideaux, télés, thermostats, capteurs, un aspirateur robot, des panneaux solaires et une
  batterie, trois personnes et huit automatisations, qui vit une journée de printemps à une minute
  par seconde. Allez au matin, à midi, au soir ou à la nuit, touchez à tout, modifiez-la : rien ne
  touche votre maison. Une carte avec `demo: true` la montre sur un tableau de bord.
- **Votre plan en 3D et en 2D.** Dessinez-le dans le panneau, ou importez-le : une maquette IFC
  (`*.ifc`, depuis Revit, ArchiCAD, Bonsai, FreeCAD…), une maison Sweet Home 3D (`*.sh3d`), un
  dessin DXF, une pièce scannée avec un iPhone ou un iPad à LiDAR (`*.usdz`, le JSON de RoomPlan),
  un plan Floorplanner (`*.fml`), un scan en maillage (OBJ, PLY, GLB, STL de Polycam, Scaniverse,
  Matterport…), la carte de votre robot aspirateur (celle de Valetudo, directement depuis Home
  Assistant, sa base liée) ou un plan DomoTwin (`*.domotwin.json`), un étage ou tous, et voyez-le en
  maquette 3D. Les murs face à la caméra s’abaissent automatiquement, comme une maison de poupée
  ouverte. Passez à un plan 2D net avec une transition fluide.
- **Des meubles qui ont l’air vrais, toute une bibliothèque.** Des plantes feuille à feuille, des
  canapés et des lits aux bords arrondis, sans rien perdre en vitesse ; 195 meubles et objets en
  117 sortes et leurs styles, aux tailles habituelles des vrais : un Chesterfield, un piano, un
  poêle à bois, une thermopompe, un chauffe-eau, une borne de recharge et une voiture, des
  enceintes, un thermostat, un détecteur de fumée, des caméras, un routeur, des appliques et des
  rubans LED, un tapis de course, un arbre à chat. Tous dessinés par DomoTwin, rien de téléchargé.
- **Cinq apparences.** **Néon** : le logement au crépuscule dans un violet profond, le haut de ses
  murs éclairé d’ambre, des lampes et des écrans qui brillent ; **plan d’architecte** : des traits blancs
  sur fond bleu ; **jour** : le logement tel qu’il est, à la lumière de l’heure ; **dessin animé** :
  des couleurs vives cernées d’encre noire, sous un ciel bleu ; **maquette d’argile** : le logement
  en argile mate, comme une maquette d’architecte. Automatique : néon en mode sombre. Voir [les
  apparences](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/looks.md) (en
  anglais).
- **Toucher pour piloter.** Touchez une lampe pour l’allumer ou l’éteindre ; une bulle au-dessus dit
  ce qui s’est passé, montre sa luminosité et mène au reste. Touchez la télé pour l’allumer et
  monter le son, l’aspirateur robot pour lancer le ménage. Touchez une pièce pour ses lumières, ses
  volets et ses propres boutons (une scène, un script) ; appuyez longuement pour retrouver ses
  lumières, scènes, volets, chauffage et lecteurs, et programmer ses lumières. Quand vous liez un
  appareil, DomoTwin propose en toutes lettres ce qu’il sait faire (monter le son, ouvrir, baisser
  la lumière), avec un mode avancé pour toute action.
- **En direct.** Les lampes éclairent leur pièce dans leur vraie couleur et luminosité, la
  télévision s’illumine, volets et rideaux bougent, portes et fenêtres s’ouvrent avec leurs
  capteurs.
- **La météo autour du logement.** Pluie, neige, grêle, brouillard, ciel gris et éclairs d’orage,
  d’après votre entité météo, dessinés en 3D : autour d’un appartement et jamais dedans, sur le
  toit d’une maison, penchés par le vent. Voir [la
  météo](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/weather.md) (en anglais).
- **Le jardin aussi.** Dessinez un jardin, une terrasse, un balcon et son garde-corps, une allée :
  des lieux extérieurs, avec leur pelouse, leur terrasse en bois, leur dallage ou leur gravier, et
  les objets du jardin (arbres, haies, piscine, abri, lampes de jardin, portail). La pelouse est
  dessinée aussi haute qu’elle a poussé depuis la dernière tonte, selon la saison là où est le
  logement ; votre tondeuse robot en fait le tour, jamais à travers la maison. Les toits suivent
  la forme de la maison, avec la forme, la pente et la couleur que vous choisissez. Voir
  [l’extérieur](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/outdoors.md) (en
  anglais).
- **Calques.** Une carte de chaleur animée (température, humidité, CO₂ ou particules fines) tirée
  des capteurs de la zone de chaque pièce, des alertes de sécurité qui pulsent dans leur pièce
  (fumée, gaz, fuite d’eau, alarme, fenêtre ouverte sous la pluie), les pièces occupées, le vrai
  soleil qui entre par vos fenêtres, et ce que consomme chaque appareil, avec l’énergie du
  logement : le soleil, le réseau et la batterie autour de la maison, l’électricité qui circule
  entre eux.
- **Aspirateurs robots.** Votre robot quitte sa base quand il nettoie, passe les pièces une à une et
  rentre, sur le plan.
- **Appareils.** Des badges sur vos appareils (l’état d’une serrure, une caméra qui enregistre, ce
  qui est en lecture, une batterie faible, le lave-linge en marche), et ce que voit chaque caméra,
  dessiné au sol de sa pièce, derrière les meubles, discret tant que vous ne touchez pas la
  caméra ; touchez pour l’image en direct.
- **Étages.** Une cave, des étages, des combles : un plan chacun, un sélecteur dans la vue, un
  escalier qui vous fait monter d’une touche, et les alertes de chaque étage où que vous soyez. Ou
  tout le logement d’un coup, ses étages écartés sous un toit, chacun avec son étiquette et son
  image, en direct à chaque niveau. Les demi-niveaux et les sous-sols ouverts sur le jardin aussi :
  des demi-niveaux nommés comme tels, un plancher compté par la localisation Bluetooth là seulement
  où un niveau est au-dessus de l’autre, le jardin d’un sous-sol de son côté. Voir [les étages](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/storeys.md) (en
  anglais).
- **Promenez-vous, accrochez-le au mur, demandez-le.** Promenez-vous dans votre logement à
  hauteur des yeux, de pièce en pièce par les portes. Sur une tablette murale, une carte revient à
  sa vue quand on la laisse, tourne lentement et s’assombrit la nuit. Dites « montre la cuisine » à
  Assist et vos écrans la montrent. Voir [la promenade, les kiosques et la
  voix](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/kiosk.md) (en anglais).
- **Éditeur de plan.** Pas de plan à importer ? Dessinez-le dans le panneau : des pièces en
  polygones avec leurs longueurs, des cloisons, des portes et des fenêtres posées sur les murs, avec
  aimantation et annulation. Voir [l’éditeur de
  plan](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/plan-editor.md) (en anglais).
- **Mode édition.** Déplacez, tournez et empilez les meubles avec aimantation, repères et
  annulation, ajoutez des meubles depuis une bibliothèque avec une image de chacun, par pièce et
  usage, cherchés dans votre langue, liez n’importe quel objet à des entités (avec des suggestions
  tirées de vos pièces), et ajoutez votre propre meuble ou appareil avec son modèle 3D (glTF/GLB,
  OBJ, STL ou 3MF). Voir [le mode édition](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/edit-mode.md) (en anglais).

### Qui est où

Chacun dans sa pièce, trouvé avec ce que votre logement a déjà.

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
  capteurs de présence ; dans la pièce, où, sur une grille de cellules d’un demi-mètre, et un autre
  étage par son escalier seulement. Les téléphones placent leur propriétaire ; les clés oubliées sont
  signalées ; « où sont mes clés ? » à la voix. La justesse des pièces trouvées est mesurée, les
  chiffres de Bermuda à côté là où il tourne, et se copie en tableau à partager. La clé d’identité
  d’un iPhone, lue sans Mac par un ESP32 en dix minutes, se colle dans DomoTwin telle que l’outil la
  donne. Les radars de présence (un LD2450, un Everything Presence Lite, un LD2410) placés sur le
  plan s’y ajoutent : le Bluetooth dit qui, le radar dit où, au demi-mètre et vite, et toute autre
  personne est quelqu’un, une silhouette grise. Voir [la localisation
  Bluetooth](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/bluetooth.md) (en
  anglais).
- **Pièces privées.** Réservez une chambre ou un bureau à certaines personnes, toujours ou tant
  qu’un interrupteur « Invités » est allumé : les autres la voient fermée, son sol givré, rien ni
  personne à l’intérieur, aucune commande, et les réponses vocales disent « dans une pièce
  privée ». Voir [pièces
  privées](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/privacy.md) (en
  anglais).

### Comprendre votre logement

Ce qu’il fait, pourquoi, et ce qui demande un coup d’œil.

- **Carte du réseau.** Votre maillage Zigbee dessiné sur le logement : chaque appareil sur son
  meuble, chaque lien en arc coloré selon sa qualité, une lumière qui court vers le coordinateur, et
  les pièces qui ne tiennent qu’à un lien faible sont nommées, avec « un routeur ici aiderait ».
  Touchez un appareil ou un lien pour le détail, relancez un scan, placez les appareils que la carte
  ne trouve pas. Pour les administrateurs, avec ZHA. Voir [la carte du
  réseau](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/network.md) (en anglais).
- **La couverture radio.** Où le prochain proxy Bluetooth, routeur Zigbee ou point d’accès Wi-Fi
  aide le plus : chaque pièce colorée selon ce que vos récepteurs, votre réseau ou vos points
  d’accès y portent, et les meilleurs emplacements numérotés sur le plan, chacun avec les pièces
  qu’il améliore. Calculée d’après les murs, les portes et les étages du plan, et vérifiée par ce
  que vos radios ont mesuré, qui passe en premier. Pour les administrateurs. Voir [la couverture
  radio](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/placement.md) (en
  anglais).
- **Un bac à sable pour vos automatisations.** Choisissez une journée, sa météo, qui sort et qui
  rentre quand, et regardez vos automatisations, scripts et scènes la jouer sur une copie de votre
  maison, en 3D et sur une frise, une heure par seconde si vous voulez. Un rapport dit ce que
  chacune a fait et quand, ce qui ne s’est jamais exécuté et pourquoi, lesquelles se contredisent,
  et ce qui n’a pas pu être joué. Rien dans le bac à sable n’atteint un appareil. Voir [le bac à
  sable](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/sandbox.md) (en anglais).
- **Des automatisations dites avec vos mots.** Dites ce qui doit se passer (« quand la dernière
  personne part, éteindre les lumières et verrouiller la porte ») : la tâche IA de Home Assistant,
  celle que vous avez configurée, écrit l’automatisation ; DomoTwin vous la redit en mots simples,
  la fait vérifier par Home Assistant, la joue dans le bac à sable les jours que vous choisissez,
  et seulement ensuite l’enregistre, l’éditeur de Home Assistant à portée de main. Pour les
  administrateurs, avec une tâche IA dans Home Assistant (2025.8 et après) : DomoTwin n’appelle
  lui-même aucun modèle. Voir [les automatisations avec vos
  mots](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/plain-words.md) (en
  anglais).
- **Fils des automatisations.** Un appui long sur une lampe : son panneau liste les automatisations
  qui la concernent, avec leur interrupteur et leur dernier lancement. Montrez leurs fils, de ce
  qui les déclenche à ce qu’elles commandent, et voyez une impulsion les parcourir quand l’une se
  lance. Ou toutes les automatisations du logement à la fois. Voir [les fils des
  automatisations](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/automations.md)
  (en anglais).
- **Pourquoi ?** Appuyez longuement sur une lampe et demandez qui ou quoi l’a changée :
  l’automatisation qui l’a allumée, le mouvement qui a déclenché l’automatisation, la personne qui
  l’a fait dans l’application, ou personne (son propre interrupteur), comme Home Assistant l’a
  noté. Dessiné dans le logement comme un fil depuis là où tout a commencé, avec la trace du
  lancement pour les administrateurs et l’Activité de Home Assistant à portée de doigt. Voir
  [Pourquoi ?](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/why.md) (en
  anglais).
- **L’historique en rapports.** « Quand la chambre a-t-elle dépassé 24 °C plus d’une heure ? »
  Un appui long sur un appareil ou une pièce donne son **Historique** : celui de Home Assistant en
  tableau, une ligne par changement ou par heure, filtré par valeur et par durée, ou son journal
  cherché par valeur ; en CSV. En lecture seule, depuis l’historique, les statistiques et le
  journal de Home Assistant. Voir [l’historique en
  rapports](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/history.md) (en
  anglais).
- **Historique de la configuration.** Chaque changement d’une automatisation, d’un script, d’une
  scène ou d’un tableau de bord est gardé, par élément et par date, dans Home Assistant : ce qui a
  changé, en mots (« Déclencheur 1 › offset : -00:30:00 → -00:20:00 », « Ajout · Action 2 »), et un
  élément remis comme il était, par les commandes qu’utilisent les éditeurs de Home Assistant.
  Pour les administrateurs ; sans module complémentaire ni Git. Voir [l’historique de la
  configuration](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/config-history.md) (en
  anglais).
- **Le bilan de la semaine.** Une fois par semaine, ce qui est à surveiller : les piles faibles
  (avec la pile à acheter, d’après Battery Notes), les appareils indisponibles, les mises à jour et
  les réparations en attente (celles de Spook, et ce que Watchman trouve manquant), l’entretien à
  faire, les automatisations en échec ou qui n’ont jamais tourné, les appareils Zigbee sur un lien
  faible, l’énergie de la semaine face à la précédente et les pointes d’Hydro-Québec ; pièce par
  pièce sur les plans, ce qui est nouveau et ce qui a été fait. La notification de Home Assistant
  le dit, résumé par votre tâche d’IA si vous en choisissez une ; le panneau le montre. Voir [le
  bilan de la semaine](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/report.md)
  (en anglais).
- **Fiches d’entretien.** Chaque appareil et chaque meuble peut porter sa marque, son modèle, son
  numéro de série, sa garantie, sa notice et les tâches qui reviennent (changer le filtre tous les
  3 mois). Un badge en forme de clé montre ce qui est à faire, le calque Entretien colore les
  meubles en vert, orange ou rouge, et une liste par date a un bouton **Fait** pour tout le monde.
  Un fichier IFC remplit les fiches ; un seul capteur, `sensor.domotwin_upkeep_due`, sert à vos
  notifications. Voir [les fiches
  d’entretien](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/upkeep.md) (en
  anglais).

### Le partager

Avec les invités, les enfants, les écrans muraux et les pages de Home Assistant.

- **L’écran mural.** Une tablette près de la porte ou dans la cuisine s’ouvre sur son propre
  onglet et, quand personne n’est là, montre l’heure, la météo et vos photos des médias de Home
  Assistant, partis dès que quelqu’un la touche, qu’un capteur de mouvement le voit ou que la
  sonnette retentit. La mise en page de chaque écran est réglée une fois par un administrateur et
  suivie par l’appareil qui l’est, quel que soit le compte connecté. Voir [l’écran
  mural](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/wall-screen.md) (en
  anglais).
- **Le Wi-Fi des invités.** Donnez votre Wi-Fi une fois, et DomoTwin dessine le code QR que
  l’appareil photo d’un téléphone rejoint, dans la page ; ou montre le code de votre box. Pour les
  administrateurs, et sur les écrans muraux que vous choisissez ; le mot de passe reste dans le
  stockage privé de DomoTwin. Voir [le Wi-Fi des
  invités](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/wifi.md) (en anglais).
- **L’accès invités.** Un pass ouvre des pièces et des appareils choisis à vos invités pour
  quelques jours : son lien ou son code QR les ouvre sur leur téléphone, en 3D, sans compte Home
  Assistant, avec le Wi-Fi si vous voulez, et se termine tout seul. Par défaut il ne s’ouvre que sur
  le réseau du logement ; DomoTwin vérifie chaque requête d’après le pass. Voir [l’accès
  invités](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/guests.md) (en anglais).
- **Les droits.** Ce dont chaque personne se sert, ce qu’elle voit seulement ou ne voit pas dans
  DomoTwin, pièce par pièce et appareil par appareil, réglé en un seul endroit : la tablette des
  enfants allume leurs lampes et montre seulement celles du salon. Les vues, commandes et services
  de DomoTwin les suivent ; Home Assistant laisse encore chaque utilisateur se servir de chaque
  entité ailleurs, comme le dit la fenêtre. Voir [les
  droits](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/rights.md) (en anglais).
- **Dans la Vue d’ensemble de Home Assistant.** Une pièce touchée en 3D ouvre la page de sa zone
  dans la Vue d’ensemble (2026.2 et après). La page de chaque zone dit qui est dans la pièce et
  l’entretien à faire, et les cartes de résumé de DomoTwin (les personnes, le réseau, les
  automatisations, l’entretien, les robots) ouvrent la vue 3D sur ce qu’elles résument. Voir
  [DomoTwin et la Vue
  d’ensemble](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/overview.md) (en
  anglais).

### Sous le capot

- **Léger et fluide.** Rust compilé en WebAssembly, un rendu seulement quand quelque chose change,
  des préréglages de qualité pour les vieilles tablettes murales. Le premier chargement est limité à
  1,2 Mo, vérifié par l’intégration continue.
- **À vous.** Dans la langue de votre Home Assistant : anglais, français, allemand, espagnol,
  italien, néerlandais, portugais (du Portugal et du Brésil), arabe (de droite à gauche), chinois,
  japonais et coréen, chacune chargée seulement si c’est la vôtre. Suit le thème de Home Assistant,
  fonctionne dans les applications mobiles. Sa propre police (Inter, servie par votre Home Assistant), et tout à portée du clavier
  et des lecteurs d’écran : les pièces et leurs commandes, les menus, les dialogues.

<details>
<summary><b>Plus d’images</b></summary>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/demo.gif" alt="L’appartement de démonstration : la vue tourne autour du logement, puis le montre en plan 2D et revient en 3D" width="480">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-demo.png" alt="La maison de démo : le matin, son aspirateur robot nettoie le salon pendant que Sam travaille dans le bureau et que le soleil charge la batterie, montrés avec le calque de consommation et l’énergie de la maison ; le soir, ses lampes sont allumées dans le salon, où la famille regarde la télé" width="100%">
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
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-edit.png" alt="Le mode édition : un meuble glissé sur le plan 2D s’aimante contre un mur, avec les distances aux autres murs ; la bibliothèque des meubles à ajouter, chacun avec son image" width="100%">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-live.png" alt="Le pilotage en direct, le soir : un appui long sur une lampe ouvre ses commandes, un appui long sur le sol d’une pièce ouvre le panneau de la pièce" width="100%">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-layers.png" alt="Les calques : la température de chaque pièce en carte de chaleur avec sa légende, la consommation des appareils avec l'énergie de la maison, du soleil vers la maison, la batterie et le réseau, une alerte de fumée qui pulse dans la cuisine, et le soleil qui entre par les fenêtres" width="100%">
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
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-placement.png" alt="La couverture radio : le Wi-Fi par-dessus l’appartement de démonstration depuis le point d’accès de la cuisine, la salle de bains en orange, l’entrée en jaune, trois emplacements numérotés pour le prochain point d’accès, et la fiche avec ce que chacun change" width="100%">
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
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-home.png" alt="Tous les étages à la fois : les deux étages de l’appartement de démonstration écartés sous un toit de verre dans l’apparence plan d’architecte, chacun avec son étiquette (pièces, lumières allumées) et une image de chaque étage à gauche" width="100%">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-walk.png" alt="Promenade dans le séjour de l’appartement de démonstration à hauteur des yeux, le soir, ses lampes allumées, avec le pavé de marche dans le coin" width="100%">
</p>

</details>

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
   une maison Sweet Home 3D, un dessin DXF, le scan d’une pièce, un plan Floorplanner ou un scan
   en maillage (voir [les plans d’autres
   applications](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/imports.md), en
   anglais) ; un robot aspirateur sous Valetudo donne sa carte avec **Importer la carte d’un
   robot**. Pas de fichier de plan ? **Le dessiner depuis les zones de Home Assistant** : une pièce
   par zone, ses appareils placés et liés, en quelques clics ([le premier
   lancement](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/first-launch.md), en
   anglais). Juste pour voir ? **Essayez la maison de démo** dans le panneau, ou importez l’appartement
   fictif
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
| `layer`       | `off`, `temperature`, `humidity`, `co2`, `pm25`, `power`, `peak`, `network`, `coverage`, `automations`, `upkeep` | `off` | Calque affiché à l’ouverture ; le menu des calques le change. `peak` s’affiche là où hydroqc ou HydroPeak lit les pointes d’Hydro-Québec, `network` aux administrateurs avec ZHA seulement, `coverage` et `automations` aux administrateurs. |
| `alerts`      | `true`, `false`                     | `true`     | Alertes de sécurité des pièces (fumée, gaz, eau, alarme, fenêtre ouverte sous la pluie). |
| `presence`    | `true`, `false`                     | `true`     | Les pièces occupées s’illuminent doucement.   |
| `people`      | `true`, `false`                     | `true`     | Les personnes dans leurs pièces, en silhouettes. |
| `sun`         | `fixed`, `real`                     | `fixed`    | `real` : le soleil éclaire depuis sa vraie position (`sun.sun`), par les fenêtres. |
| `weather`     | `true`, `false`                     | `true`     | La météo autour du logement : pluie, neige, brouillard et orages. |
| `badges`      | `true`, `false`                     | `true`     | Badges des appareils : serrures, caméras, lecture, batteries faibles, appareils en marche. |
| `cameras`     | `true`, `false`                     | `true`     | Ce que voient les caméras liées, dessiné au sol. |
| `theme`       | `auto`, `day`, `neon`, `blueprint`, `cartoon`, `clay` | celle du logement | L’apparence ; `auto` : néon en mode sombre. |
| `accent`      | une couleur `#rrggbb`               | celle du logement | Couleur d’accent (le haut des murs éclairé du néon) ; sinon celle de l’apparence. |
| `names`       | `true`, `false`                     | `true`     | Le nom des pièces au sol.                     |
| `small_rooms` | `true`, `false`                     | `false`    | Le nom des petites pièces aussi (placards, pièces de moins de 2,5 m²). |
| `idle`        | secondes (0 à 86400)                | `0`        | Kiosque : revenir à cette vue après ce temps sans contact (0 : jamais). |
| `orbit`       | `true`, `false`                     | `false`    | Kiosque : tourner lentement autour du logement entre-temps. |
| `night_dim`   | `true`, `false`                     | `false`    | Kiosque : assombri la nuit entre-temps (sauf alerte). |
| `tools`       | `true`, `false`                     | `true`     | Les boutons de la vue.                        |
| `voice`       | `true`, `false`                     | `true`     | Le bouton micro, quand Assist est là.         |
| `screen`      | un nom (`hallway`…)                 | aucun      | Le nom de cet écran, pour `domotwin.show`.    |
| `font_family` | une famille de police, `theme`      | incluse    | Police des textes de la carte ; `theme` : celle de votre thème. |
| `demo`        | `true`, `false`                     | `false`    | La maison de démo et sa journée au lieu de votre maison ; rien de votre maison n’est touché. |

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

## Comment ça marche

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/architecture.png" alt="Comment marche DomoTwin : l’intégration Home Assistant, l’interface et le moteur WebAssembly" width="100%">
</p>

Une intégration Python légère enregistre votre plan, vos modifications et vos liaisons dans Home
Assistant et sert l’interface. L’interface (TypeScript) dialogue avec Home Assistant ; le moteur
(Rust compilé en WebAssembly) lit le plan, construit la géométrie et la dessine en WebGL2. Détails
dans
[`docs/ARCHITECTURE.md`](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/ARCHITECTURE.md)
(en anglais).

## Comment DomoTwin est fait

DomoTwin est écrit avec [Claude Code](https://claude.com/claude-code), un assistant de
programmation à base d’IA. Son mainteneur décide de ce qui se fait et dans quel ordre, et l’essaie
à la maison. Chaque changement du code passe par une pull request, où il est vérifié par :

- ses tests, lancés par l’intégration continue : environ 260 tests Python face à un vrai Home
  Assistant, 340 tests unitaires de l’interface, 320 tests Rust et 210 tests de bout en bout dans un
  navigateur ;
- deux revues de code automatiques, chaque remarque corrigée ou justifiée dans la pull request ;
- `clippy` avec chaque avertissement traité comme une erreur, et le fuzzing de chaque lecteur de
  fichiers venus d’ailleurs (plans, IFC, plans des autres logiciels, modèles 3D, arrangements,
  automatisations, fiches d’entretien) quand l’un d’eux change ;
- CodeQL sur le code Python, TypeScript et Rust, `cargo deny` sur la licence et la provenance de
  chaque dépendance, et gitleaks sur chaque commit ;
- un budget de taille : la compilation échoue si ce qu’un navigateur charge d’abord dépasse 1,2 Mo.

Certaines règles ne bougent pas : aucun appel réseau en dehors de votre Home Assistant, et pas de
boutique, pas de clé de licence, pas de version payante, jamais. Les décisions et leurs raisons sont
dans
[`docs/DECISIONS.md`](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/DECISIONS.md)
(en anglais).

## FAQ

**Quels formats de plan DomoTwin lit-il ?** Son propre format de plan, décrit dans
[`docs/plan-format.md`](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/plan-format.md)
avec son schéma JSON ; les fichiers IFC (ISO 16739, exportés par FreeCAD, Blender avec Bonsai,
ArchiCAD ou Revit), un étage ou tous à la fois : voir [l’import
IFC](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/ifc-import.md) (en anglais) ;
les maisons Sweet Home 3D, les dessins DXF, les scans de pièces faits avec RoomPlan d’Apple (USDZ
ou JSON), les cartes de robots aspirateurs (celles de Valetudo, depuis Home Assistant ou un
fichier ; celles de Roborock), les plans Floorplanner (FML) et les scans en maillage (OBJ, PLY,
GLB, STL) : voir [les plans d’autres
applications](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/imports.md) (en
anglais). Les fichiers DWG, l’USD binaire, le FBX et les nuages de points ne sont pas lus.

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
[Vie privée](https://github.com/arthur-leguennec/ha-domotwin/blob/main/README.fr.md#vie-privée).

**Est-ce que ça tourne sur ma tablette murale ?** Il faut WebGL2, présent dans les navigateurs
actuels et dans les applications mobiles Home Assistant. Sur les appareils anciens, DomoTwin choisit
le préréglage Éco et ne dessine que quand quelque chose change : une vue au repos ne coûte presque
rien.

**Qui peut modifier le plan ?** Tout le monde peut voir et utiliser DomoTwin ; seuls les
administrateurs peuvent importer un plan, le modifier et changer les liaisons.

**Que deviennent mes données si je supprime l’intégration ?** Le plan, les modifications, les
liaisons et les fichiers des modèles 3D enregistrés sont supprimés. Utilisez d’abord **Exporter le
plan** pour en garder une copie (elle contient les fichiers 3D).

## Vie privée

DomoTwin ne communique qu’avec votre propre Home Assistant. Aucun autre appel réseau : pas de CDN,
pas de télémétrie, pas de statistiques, pas de polices web. Tous les fichiers utilisés (JavaScript,
WebAssembly, polices, matériaux) sont servis par l’intégration. Les diagnostics ne contiennent que
des comptes, jamais de noms, d’identifiants d’entités ou d’appareils, d’adresses Zigbee ou de
géométrie. Une automatisation demandée avec vos mots est écrite par la tâche IA de Home Assistant,
celle que vous avez configurée : DomoTwin lui confie votre demande et les noms de vos pièces et
entités, jamais leurs états, et où elle les envoie ensuite relève de cette tâche IA.

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
