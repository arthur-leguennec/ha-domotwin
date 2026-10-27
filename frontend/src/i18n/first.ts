/**
 * The messages of the first launch (D-083), in both languages: loaded with its dialog, not with the
 * first picture. The empty plan's button and the menu item's own are in the dictionaries.
 */
import type { Widen } from "./index";

export const firstEn = {
  first: {
    title: "Your home from Home Assistant",
    intro:
      "DomoTwin draws a first plan from your floors and areas: a room for each area, side by side, with its devices in it, linked. You shape it afterwards: the rooms' real sizes, the doors, where each piece stands.",
    home: "Home",
    none: "Home Assistant has no area yet: add your rooms as areas in its settings, or import a plan.",
    floor_all: "All of {floor}",
    devices_in: { one: "{count} device", other: "{count} devices" },
    devices: "Place their devices",
    devices_hint:
      "Lights, televisions, speakers, thermostats, the robot vacuum, sensors…, each in its room, linked.",
    furnish: "Furnish the rooms",
    furnish_hint: "A bed in each bedroom, a sofa in the living room, a table in the dining room…",
    pick: "Pick at least one area.",
    build: "Draw my home",
    building: "Drawing your home…",
    cancel: "Cancel",
    built: "Your home is drawn: {rooms}, {devices}.",
    built_rooms: { one: "{count} room", other: "{count} rooms" },
    built_devices: { one: "{count} device placed", other: "{count} devices placed" },
    built_left: {
      one: "{count} device found no space: place it in Arrange.",
      other: "{count} devices found no space: place them in Arrange.",
    },
    failed: "Your home could not be drawn: {reason}",
    steps: {
      title: "Getting started",
      intro: "A few steps to make DomoTwin your home's. Each opens where it is done.",
      done: "Done",
      plan: "A plan of your home",
      plan_hint: "Drawn from your areas, imported, or drawn by hand.",
      shape: "Shape the rooms",
      shape_hint: "Drag their corners to their real size; move the doors and windows.",
      shape_go: "Edit the plan",
      areas: "Each room linked to its area",
      areas_left: {
        one: "{count} room has no area yet.",
        other: "{count} rooms have no area yet.",
      },
      areas_done: "Every room has its area.",
      areas_go: "Link",
      devices: "Their devices placed",
      devices_left: {
        one: "{count} device of their areas is not placed yet.",
        other: "{count} devices of their areas are not placed yet.",
      },
      devices_done: "Every device DomoTwin draws is placed.",
      devices_go: "Place them",
      arrange: "Each piece where it stands",
      arrange_hint: "Drag the pieces in Arrange, turn them, add your own.",
      arrange_go: "Arrange",
      people: "People in their rooms",
      people_hint: "Choose what says where each person is: a room sensor, Bluetooth, a radar.",
      people_go: "People",
      energy: "The energy",
      energy_hint: "Choose the sensors of the home's power, its solar panels and its battery.",
      energy_go: "Settings",
      placed: { one: "{count} device placed.", other: "{count} devices placed." },
      placed_none: "No device left to place.",
      close: "Close",
    },
  },
};

export const firstFr: Widen<typeof firstEn> = {
  first: {
    title: "Votre logement depuis Home Assistant",
    intro:
      "DomoTwin dessine un premier plan à partir de vos étages et de vos pièces : une pièce pour chaque zone, côte à côte, avec ses appareils dedans, liés. Vous le façonnez ensuite : les vraies dimensions des pièces, les portes, la place de chaque objet.",
    home: "Logement",
    none: "Home Assistant n’a pas encore de pièce : ajoutez vos pièces comme zones dans ses paramètres, ou importez un plan.",
    floor_all: "Tout {floor}",
    devices_in: { one: "{count} appareil", other: "{count} appareils" },
    devices: "Placer leurs appareils",
    devices_hint:
      "Lampes, téléviseurs, enceintes, thermostats, l’aspirateur robot, capteurs…, chacun dans sa pièce, lié.",
    furnish: "Meubler les pièces",
    furnish_hint:
      "Un lit dans chaque chambre, un canapé dans le salon, une table dans la salle à manger…",
    pick: "Choisissez au moins une zone.",
    build: "Dessiner mon logement",
    building: "Dessin de votre logement…",
    cancel: "Annuler",
    built: "Votre logement est dessiné : {rooms}, {devices}.",
    built_rooms: { one: "{count} pièce", other: "{count} pièces" },
    built_devices: { one: "{count} appareil placé", other: "{count} appareils placés" },
    built_left: {
      one: "{count} appareil n’a pas trouvé de place : placez-le dans Aménager.",
      other: "{count} appareils n’ont pas trouvé de place : placez-les dans Aménager.",
    },
    failed: "Votre logement n’a pas pu être dessiné : {reason}",
    steps: {
      title: "Premiers pas",
      intro:
        "Quelques étapes pour que DomoTwin soit celui de votre logement. Chacune ouvre l’endroit où elle se fait.",
      done: "Fait",
      plan: "Un plan de votre logement",
      plan_hint: "Dessiné depuis vos pièces, importé, ou dessiné à la main.",
      shape: "Façonner les pièces",
      shape_hint: "Tirez leurs coins à leur vraie taille ; déplacez les portes et les fenêtres.",
      shape_go: "Modifier le plan",
      areas: "Chaque pièce liée à sa zone",
      areas_left: {
        one: "{count} pièce n’a pas encore de zone.",
        other: "{count} pièces n’ont pas encore de zone.",
      },
      areas_done: "Chaque pièce a sa zone.",
      areas_go: "Lier",
      devices: "Leurs appareils placés",
      devices_left: {
        one: "{count} appareil de leurs zones n’est pas encore placé.",
        other: "{count} appareils de leurs zones ne sont pas encore placés.",
      },
      devices_done: "Chaque appareil que DomoTwin dessine est placé.",
      devices_go: "Les placer",
      arrange: "Chaque objet à sa place",
      arrange_hint: "Faites glisser les objets dans Aménager, tournez-les, ajoutez les vôtres.",
      arrange_go: "Aménager",
      people: "Les personnes dans leurs pièces",
      people_hint:
        "Choisissez ce qui dit où est chacun : un capteur de pièce, le Bluetooth, un radar.",
      people_go: "Personnes",
      energy: "L’énergie",
      energy_hint:
        "Choisissez les capteurs de la puissance du logement, de ses panneaux solaires et de sa batterie.",
      energy_go: "Paramètres",
      placed: { one: "{count} appareil placé.", other: "{count} appareils placés." },
      placed_none: "Plus aucun appareil à placer.",
      close: "Fermer",
    },
  },
};
