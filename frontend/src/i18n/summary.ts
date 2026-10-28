/**
 * The messages of DomoTwin's summary cards (D-061), in both languages: loaded with the cards'
 * chunk, not with the first picture (their name and description are in the first), and added to
 * the others when this module is, by whichever needs them first.
 */
import { addMessages, type Widen } from "./index";

export const summaryEn = {
  summary: {
    kind: "Summary",
    open: "{title}: open it in 3D",
    titles: {
      people: "People",
      network: "Network",
      automations: "Automations",
      upkeep: "Upkeep",
      robots: "Robots",
    },
    people: {
      here: { one: "{count} here", other: "{count} here" },
      nobody_here: "Nobody here",
      home: { one: "{count} at home", other: "{count} at home" },
      nobody: "Nobody at home",
      in: "In {rooms}",
    },
    network: {
      admins: "For administrators",
      none: "No Zigbee network",
      reading: "Reading the network…",
      unreadable: "The network could not be read",
      devices: { one: "{count} device", other: "{count} devices" },
      weak: { one: "{count} weak link", other: "{count} weak links" },
      stale: { one: "{count} not heard from", other: "{count} not heard from" },
      fine: "Every link is fine",
    },
    automations: {
      none: "No automations",
      on: { one: "{count} on of {total}", other: "{count} on of {total}" },
      today: { one: "{count} ran today", other: "{count} ran today" },
    },
    upkeep: {
      none: "Not set up",
      unavailable: "Not known right now",
      due: { one: "{count} task due", other: "{count} tasks due" },
      nothing: "Nothing due",
      next: "{task} ({piece})",
    },
    robots: {
      none: "No robot vacuum",
      states: {
        cleaning: { one: "{count} cleaning", other: "{count} cleaning" },
        docked: { one: "{count} docked", other: "{count} docked" },
        returning: { one: "{count} going back", other: "{count} going back" },
        paused: { one: "{count} paused", other: "{count} paused" },
        idle: { one: "{count} idle", other: "{count} idle" },
        error: { one: "{count} in error", other: "{count} in error" },
        other: { one: "{count} other", other: "{count} other" },
      },
    },
  },
};

export const summaryFr: Widen<typeof summaryEn> = {
  summary: {
    kind: "Résumé",
    open: "{title} : l’ouvrir en 3D",
    titles: {
      people: "Personnes",
      network: "Réseau",
      automations: "Automatisations",
      upkeep: "Entretien",
      robots: "Robots",
    },
    people: {
      here: { one: "{count} présent", other: "{count} présents" },
      nobody_here: "Personne ici",
      home: { one: "{count} à la maison", other: "{count} à la maison" },
      nobody: "Personne à la maison",
      in: "Dans : {rooms}",
    },
    network: {
      admins: "Pour les administrateurs",
      none: "Pas de réseau Zigbee",
      reading: "Lecture du réseau…",
      unreadable: "Le réseau n’a pas pu être lu",
      devices: { one: "{count} appareil", other: "{count} appareils" },
      weak: { one: "{count} lien faible", other: "{count} liens faibles" },
      stale: { one: "{count} sans nouvelles", other: "{count} sans nouvelles" },
      fine: "Tous les liens vont bien",
    },
    automations: {
      none: "Aucune automatisation",
      on: { one: "{count} active sur {total}", other: "{count} actives sur {total}" },
      today: {
        one: "{count} lancée aujourd’hui",
        other: "{count} lancées aujourd’hui",
      },
    },
    upkeep: {
      none: "Pas en place",
      unavailable: "Inconnu pour l’instant",
      due: { one: "{count} tâche à faire", other: "{count} tâches à faire" },
      nothing: "Rien à faire",
      next: "{task} ({piece})",
    },
    robots: {
      none: "Aucun robot aspirateur",
      states: {
        cleaning: { one: "{count} en nettoyage", other: "{count} en nettoyage" },
        docked: { one: "{count} sur sa base", other: "{count} sur leur base" },
        returning: { one: "{count} en retour", other: "{count} en retour" },
        paused: { one: "{count} en pause", other: "{count} en pause" },
        idle: { one: "{count} à l’arrêt", other: "{count} à l’arrêt" },
        error: { one: "{count} en erreur", other: "{count} en erreur" },
        other: { one: "{count} autre", other: "{count} autres" },
      },
    },
  },
};

addMessages({ en: summaryEn, fr: summaryFr });
