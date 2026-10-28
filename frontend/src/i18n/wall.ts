/**
 * The messages of the wall screens (D-076): their screen saver and the dialog that sets them, in
 * both languages, loaded with them, not with the first picture.
 */
import type { Widen } from "./index";

export const wallEn = {
  wall: {
    saver: "Screen saver: touch the screen to wake it",
    title: "Wall screens",
    hint: "A device left on a wall: it opens on its tab, and once nothing is touched and nobody moves, it shows the time, the weather and photos. Each device chooses the screen it is in Your choices.",
    none: "No wall screen yet.",
    add: "Add a screen",
    new_name: "screen",
    name: "Name",
    name_hint: "Letters, digits, - and _, as a card's screen.",
    bad_name: "A name is made of letters, digits, - and _.",
    taken: "Another screen has this name.",
    start: "Opens on",
    start_same: "The device's own tab, else the user's",
    voice: "Voice on this screen",
    voice_hint: "Off: no microphone button on it, whatever its device says.",
    saver_title: "Screen saver",
    after: "Comes after",
    never: "Never",
    minutes: { one: "{count} minute", other: "{count} minutes" },
    wake: "Woken by",
    wake_hint:
      "While one of these is on, the screen saver stays away; touching the screen wakes it too.",
    no_wake:
      "No motion, occupancy or presence sensor in Home Assistant: touching the screen wakes it.",
    weather: "The weather",
    photos: "Photos",
    photos_none: "No photos",
    photos_folder: "From {name}",
    photos_pick: "Choose a folder…",
    photos_up: "Up",
    photos_use: "Use this folder",
    photos_count: { one: "{count} photo here", other: "{count} photos here" },
    photos_empty: "No photo here.",
    photos_media: "Home Assistant's media",
    photos_failed: "Home Assistant's media could not be read: {reason}",
    every: "Each photo for",
    seconds: { one: "{count} second", other: "{count} seconds" },
    dim: "At night, the clock alone, dimmed",
    save: "Save",
    remove: "Remove",
    remove_ask: "Remove the screen {name}? The devices that are it become ordinary again.",
    cancel: "Cancel",
    close: "Close",
    saved: "{name} is saved.",
    removed: "{name} is removed.",
    failed: "Not saved: {reason}",
    demo: "The demo house has no wall screens.",
  },
};

/** What every language gives of them: the English keys, any text. */
export type WallDictionary = Widen<typeof wallEn>;

/** The same, in French: every key of the English, as the main dictionaries. */
export const wallFr: WallDictionary = {
  wall: {
    saver: "Économiseur d’écran : touchez l’écran pour le réveiller",
    title: "Écrans muraux",
    hint: "Un appareil laissé au mur : il s’ouvre sur son onglet et, quand rien n’est touché et que personne ne bouge, il montre l’heure, la météo et des photos. Chaque appareil choisit l’écran qu’il est dans Vos choix.",
    none: "Pas encore d’écran mural.",
    add: "Ajouter un écran",
    new_name: "ecran",
    name: "Nom",
    name_hint: "Des lettres, des chiffres, - et _, comme l’écran d’une carte.",
    bad_name: "Un nom est fait de lettres, de chiffres, de - et de _.",
    taken: "Un autre écran porte ce nom.",
    start: "S’ouvre sur",
    start_same: "L’onglet de l’appareil, sinon celui de l’utilisateur",
    voice: "La voix sur cet écran",
    voice_hint: "Désactivée : pas de bouton micro sur l’écran, quoi qu’en dise son appareil.",
    saver_title: "Économiseur d’écran",
    after: "Vient après",
    never: "Jamais",
    minutes: { one: "{count} minute", other: "{count} minutes" },
    wake: "Réveillé par",
    wake_hint:
      "Tant que l’un d’eux est allumé, l’économiseur reste à l’écart ; toucher l’écran le réveille aussi.",
    no_wake:
      "Aucun capteur de mouvement, d’occupation ou de présence dans Home Assistant : toucher l’écran le réveille.",
    weather: "La météo",
    photos: "Photos",
    photos_none: "Pas de photos",
    photos_folder: "De {name}",
    photos_pick: "Choisir un dossier…",
    photos_up: "Remonter",
    photos_use: "Prendre ce dossier",
    photos_count: { one: "{count} photo ici", other: "{count} photos ici" },
    photos_empty: "Pas de photo ici.",
    photos_media: "Les médias de Home Assistant",
    photos_failed: "Les médias de Home Assistant n’ont pas pu être lus : {reason}",
    every: "Chaque photo pendant",
    seconds: { one: "{count} seconde", other: "{count} secondes" },
    dim: "La nuit, l’horloge seule, assombrie",
    save: "Enregistrer",
    remove: "Supprimer",
    remove_ask:
      "Supprimer l’écran {name} ? Les appareils qui le sont redeviennent des appareils ordinaires.",
    cancel: "Annuler",
    close: "Fermer",
    saved: "{name} est enregistré.",
    removed: "{name} est supprimé.",
    failed: "Non enregistré : {reason}",
    demo: "La maison de démonstration n’a pas d’écrans muraux.",
  },
};
