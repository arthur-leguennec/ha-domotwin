/**
 * The messages of how well the rooms are found (M41, D-073) and of the pairing with Bermuda, in
 * both languages: loaded with the Bluetooth settings, not with the first picture.
 */
import type { Widen } from "./index";

export const measuredEn = {
  measured: {
    bermuda: "Bermuda's sensor of this device",
    bermuda_none: "No Bermuda",
    bermuda_sensor: "Bermuda: {name}",
    title: "How well the rooms are found",
    hint: "Since {since}. For each device followed: how often its room and its storey changed, the stays under half a minute, the time in no room and, while a presence sensor alone said where its owner was, how often the room found was that one. Bermuda's figures beside, for a device paired with its sensor.",
    none: "Nothing measured yet: the figures come as the devices are followed.",
    refresh: "Refresh",
    copy: "Copy as a table",
    copied: "Copied: a Markdown table, the devices numbered.",
    reset: "Start again",
    device: "Device",
    way: "Way",
    hours: "Hours measured",
    changes: "Room changes / h",
    storeys: "Storey changes / h",
    short: "Stays < 30 s",
    unknown: "Time in no room",
    right: "Right when witnessed",
    agreement: "Same as Bermuda",
    by_area: "DomoTwin (areas)",
    numbered: "Device {n}",
    reset_ask: "Clear the figures measured since {since}?",
    reset_keep: "Keep them",
    refresh_failed: "Not refreshed: {reason}",
  },
};

/** What every language gives of them: the English keys, any text. */
export type MeasuredDictionary = Widen<typeof measuredEn>;

/** The same, in French: every key of the English, as the main dictionaries. */
export const measuredFr: MeasuredDictionary = {
  measured: {
    bermuda: "Capteur Bermuda de cet appareil",
    bermuda_none: "Pas de Bermuda",
    bermuda_sensor: "Bermuda : {name}",
    title: "La justesse des pièces trouvées",
    hint: "Depuis le {since}. Pour chaque appareil suivi : combien de fois sa pièce et son étage ont changé, les séjours de moins d’une demi-minute, le temps sans pièce et, quand un capteur de présence seul disait où était son propriétaire, la part du temps où la pièce trouvée était celle-là. Les chiffres de Bermuda à côté, pour un appareil associé à son capteur.",
    none: "Rien de mesuré encore : les chiffres viennent à mesure que les appareils sont suivis.",
    refresh: "Actualiser",
    copy: "Copier en tableau",
    copied: "Copié : un tableau Markdown, les appareils numérotés.",
    reset: "Recommencer",
    device: "Appareil",
    way: "Méthode",
    hours: "Heures mesurées",
    changes: "Changements de pièce / h",
    storeys: "Changements d’étage / h",
    short: "Séjours < 30 s",
    unknown: "Temps sans pièce",
    right: "Juste quand vérifié",
    agreement: "Comme Bermuda",
    by_area: "DomoTwin (zones)",
    numbered: "Appareil {n}",
    reset_ask: "Effacer les chiffres mesurés depuis le {since} ?",
    reset_keep: "Les garder",
    refresh_failed: "Non actualisé : {reason}",
  },
};
