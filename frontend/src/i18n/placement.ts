/**
 * The messages of the radio coverage and its advice (D-066), in both languages: loaded with its
 * chunk, not with the first picture.
 */
import type { Widen } from "./index";

export const placementEn = {
  placement: {
    title: "Radio coverage",
    radio: "Radio",
    bluetooth: "Bluetooth",
    zigbee: "Zigbee",
    wifi: "Wi-Fi",
    model:
      "A model from the plan's walls, doors and floors, said to be one: what was measured comes first.",
    good: "Good",
    fair: "Fair",
    weak: "Weak",
    out: "Out of reach",
    working: "Working it out…",
    failed: "The coverage could not be worked out: {reason}",
    unanalysed: "The coverage could not be worked out. Close it and open it again in a moment.",
    rooms: "Rooms",
    measured: "Measured by {name}",
    measured_signal: "Measured by {name}: {signal}",
    predicted: "Predicted: {signal}",
    nothing: "Out of reach: no radio of this kind is placed.",
    dbm: "{value} dBm",
    on_storey: "{room} ({storey})",
    next_bluetooth: "Where the next receiver helps most",
    next_zigbee: "Where the next router helps most",
    next_wifi: "Where the next access point helps most",
    spot: "In {room}",
    spot_near: "In {room}, by {piece}",
    spot_marker: "Spot {n}: {place}",
    change: "{room}: {from} → {to}",
    alone: "Each spot is for the next one alone, not one of three to add.",
    covered: "Every room is covered well: no spot would help much.",
    reach_zigbee: "Spots the mesh already reaches fairly: a router joins through its neighbours.",
    reach_wifi:
      "Spots the access points already reach fairly, for one without a cable: one with a cable can go farther.",
    check: {
      one: "Checked against {count} measurement: {error} dB off.",
      other:
        "Checked against {count} measurements: moved by {offset} dB, {error} dB off on average.",
    },
    agreement: {
      one: "Measured and predicted agree in {same} of {count} room.",
      other: "Measured and predicted agree in {same} of {count} rooms.",
    },
    radios_bluetooth: "Receivers",
    radios_zigbee: "Coordinator and routers",
    radios_wifi: "Access points",
    radio_marker: "{name}, placed",
    unplaced: "Not placed: {names}",
    no_bluetooth: "Home Assistant has no Bluetooth: there is nothing to cover yet.",
    no_receiver: "No receiver is placed: place them in the Bluetooth settings.",
    bluetooth_settings: "Bluetooth settings",
    no_router: "No coordinator or router is placed: place them from the Zigbee network map.",
    no_access_point:
      "No access point is placed: place where each one stands, and the rooms are coloured.",
    readings: {
      one: "{count} device placed in the home reports its Wi-Fi signal.",
      other: "{count} devices placed in the home report their Wi-Fi signal.",
    },
    no_readings: "No device placed in the home reports its Wi-Fi signal: nothing is measured.",
    access_point: "Access point {n}",
    place: "Place an access point",
    place_hint: "Tap the floor where the access point stands.",
    place_cancel: "Cancel",
    place_full: "16 access points at most.",
    remove: "Remove {name}",
    save_failed: "The access points were not saved: {reason}",
    one_storey: "Show one storey to see the spots on it.",
  },
};

/** What every language gives of them: the English keys, any text. */
export type PlacementDictionary = Widen<typeof placementEn>;

/** The same, in French: every key of the English, as the main dictionaries. */
export const placementFr: PlacementDictionary = {
  placement: {
    title: "Couverture radio",
    radio: "Radio",
    bluetooth: "Bluetooth",
    zigbee: "Zigbee",
    wifi: "Wi-Fi",
    model:
      "Un modèle tiré des murs, des portes et des étages du plan, et dit comme tel : ce qui a été mesuré passe en premier.",
    good: "Bonne",
    fair: "Moyenne",
    weak: "Faible",
    out: "Hors de portée",
    working: "Calcul en cours…",
    failed: "La couverture n’a pas pu être calculée : {reason}",
    unanalysed: "La couverture n’a pas pu être calculée. Fermez-la et rouvrez-la dans un instant.",
    rooms: "Pièces",
    measured: "Mesurée par {name}",
    measured_signal: "Mesurée par {name} : {signal}",
    predicted: "Prévue : {signal}",
    nothing: "Hors de portée : aucune radio de ce type n’est placée.",
    dbm: "{value} dBm",
    on_storey: "{room} ({storey})",
    next_bluetooth: "Où le prochain récepteur aide le plus",
    next_zigbee: "Où le prochain routeur aide le plus",
    next_wifi: "Où le prochain point d’accès aide le plus",
    spot: "Dans la pièce {room}",
    spot_near: "Dans la pièce {room}, près de : {piece}",
    spot_marker: "Emplacement {n} : {place}",
    change: "{room} : {from} → {to}",
    alone: "Chaque emplacement vaut pour le prochain seul, pas pour trois à ajouter.",
    covered: "Toutes les pièces sont bien couvertes : aucun emplacement n’aiderait beaucoup.",
    reach_zigbee:
      "Des emplacements que le réseau atteint déjà assez bien : un routeur s’y joint par ses voisins.",
    reach_wifi:
      "Des emplacements que les points d’accès atteignent déjà assez bien, pour un point sans câble : un point câblé peut aller plus loin.",
    check: {
      one: "Vérifié par {count} mesure : {error} dB d’écart.",
      other: "Vérifié par {count} mesures : décalé de {offset} dB, {error} dB d’écart en moyenne.",
    },
    agreement: {
      one: "Mesure et prévision s’accordent dans {same} pièce sur {count}.",
      other: "Mesure et prévision s’accordent dans {same} pièces sur {count}.",
    },
    radios_bluetooth: "Récepteurs",
    radios_zigbee: "Coordinateur et routeurs",
    radios_wifi: "Points d’accès",
    radio_marker: "{name}, placé",
    unplaced: "Pas placés : {names}",
    no_bluetooth: "Home Assistant n’a pas de Bluetooth : il n’y a rien à couvrir pour l’instant.",
    no_receiver: "Aucun récepteur n’est placé : placez-les dans les réglages Bluetooth.",
    bluetooth_settings: "Réglages Bluetooth",
    no_router:
      "Aucun coordinateur ni routeur n’est placé : placez-les depuis la carte du réseau Zigbee.",
    no_access_point:
      "Aucun point d’accès n’est placé : placez chacun là où il se trouve, et les pièces se colorent.",
    readings: {
      one: "{count} appareil placé dans le logement donne son signal Wi-Fi.",
      other: "{count} appareils placés dans le logement donnent leur signal Wi-Fi.",
    },
    no_readings:
      "Aucun appareil placé dans le logement ne donne son signal Wi-Fi : rien n’est mesuré.",
    access_point: "Point d’accès {n}",
    place: "Placer un point d’accès",
    place_hint: "Touchez le sol là où se trouve le point d’accès.",
    place_cancel: "Annuler",
    place_full: "16 points d’accès au plus.",
    remove: "Retirer {name}",
    save_failed: "Les points d’accès n’ont pas été enregistrés : {reason}",
    one_storey: "Affichez un seul étage pour y voir les emplacements.",
  },
};
