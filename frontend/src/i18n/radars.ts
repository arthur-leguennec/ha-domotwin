/**
 * The messages of the presence radars (M43, D-080), in both languages: loaded with the Bluetooth
 * settings, not with the first picture.
 */
import type { Widen } from "./index";

export const radarsEn = {
  radars: {
    title: "Presence radars",
    hint: "A radar (an LD2450, an Everything Presence Lite, an LD2410) linked to a piece of the plan stands where the piece is and looks the way its front faces. Its targets show where people are; Bluetooth says who.",
    none: "No radar on the plan: link a piece to the radar's entities or its device (Link entities).",
    targets: "Where its targets are",
    distance: "How far its target is",
    in_room: "In {room}",
    no_room: "In no room: move its piece into one",
    seeing: { one: "Sees {count} person now", other: "Sees {count} people now" },
    nobody: "Sees nobody now",
    not_working: "Not working: its entities are unavailable",
    mirror: "Mirrored (targets on the wrong side)",
  },
};

/** What every language gives of them: the English keys, any text. */
export type RadarsDictionary = Widen<typeof radarsEn>;

/** The same, in French: every key of the English, as the main dictionaries. */
export const radarsFr: RadarsDictionary = {
  radars: {
    title: "Radars de présence",
    hint: "Un radar (un LD2450, un Everything Presence Lite, un LD2410) lié à un meuble du plan se tient là où est le meuble et regarde du côté de sa face avant. Ses cibles montrent où sont les gens ; le Bluetooth dit qui.",
    none: "Aucun radar sur le plan : liez un meuble aux entités du radar ou à son appareil (Lier des entités).",
    targets: "Où sont ses cibles",
    distance: "À quelle distance est sa cible",
    in_room: "Dans {room}",
    no_room: "Dans aucune pièce : déplacez son meuble dans l’une d’elles",
    seeing: { one: "Voit {count} personne", other: "Voit {count} personnes" },
    nobody: "Ne voit personne",
    not_working: "Hors service : ses entités sont indisponibles",
    mirror: "Inversé (cibles du mauvais côté)",
  },
};
