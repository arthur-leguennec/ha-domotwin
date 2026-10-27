/**
 * The messages of an iPhone's or a watch's identity key (M45, D-074), in both languages: loaded
 * with the Bluetooth settings, not with the first picture.
 */
import type { Widen } from "./index";

export const iphoneEn = {
  iphone: {
    title: "An iPhone or an Apple Watch",
    hint: "An iPhone changes its Bluetooth address every few minutes; its identity key (IRK) finds it again. With a Mac: Keychain Access. Without one: an ESP32 for ten minutes, with irk-capture or ESPresense's Enroll.",
    guide: "How to get the key",
    field: "Identity key",
    placeholder: "32 hex digits, irk:… or a Mac's base64",
    add: "Add",
    adding: "Adding…",
    kept: "The key goes to Home Assistant's Private BLE Device, which keeps it; DomoTwin keeps nothing of it. Keep the phone unlocked near a receiver while adding it.",
    added: "{name} added: choose its kind and its owner, then save.",
    known: "{name} was already in Private BLE Device: it is followed now, save to keep it.",
    followed: "{name} is already followed.",
    unnamed: "iPhone",
    full: "At most {count} devices are followed: remove one first.",
  },
};

/** What every language gives of them: the English keys, any text. */
export type IphoneDictionary = Widen<typeof iphoneEn>;

/** The same, in French: every key of the English, as the main dictionaries. */
export const iphoneFr: IphoneDictionary = {
  iphone: {
    title: "Un iPhone ou une Apple Watch",
    hint: "Un iPhone change d’adresse Bluetooth toutes les quelques minutes ; sa clé d’identité (IRK) le retrouve. Avec un Mac : le Trousseau d’accès. Sans Mac : un ESP32 pendant dix minutes, avec irk-capture ou l’Enroll d’ESPresense.",
    guide: "Comment obtenir la clé",
    field: "Clé d’identité",
    placeholder: "32 chiffres hexadécimaux, irk:… ou le base64 d’un Mac",
    add: "Ajouter",
    adding: "Ajout…",
    kept: "La clé va au Private BLE Device de Home Assistant, qui la garde ; DomoTwin n’en garde rien. Gardez le téléphone déverrouillé près d’un récepteur pendant l’ajout.",
    added: "{name} ajouté : choisissez son type et son propriétaire, puis enregistrez.",
    known:
      "{name} était déjà dans Private BLE Device : il est suivi maintenant, enregistrez pour le garder.",
    followed: "{name} est déjà suivi.",
    unnamed: "iPhone",
    full: "Au plus {count} appareils sont suivis : retirez-en un d’abord.",
  },
};
