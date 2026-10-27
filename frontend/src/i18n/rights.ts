/**
 * The messages of per-person rights (D-070), in both languages: the administrators' dialog,
 * loaded with it, not with the first picture.
 */
import type { Widen } from "./index";

export const rightsEn = {
  rights: {
    title: "Rights",
    intro:
      "What each person uses, only sees or does not see in DomoTwin, room by room and device by device. Administrators see and use everything.",
    for: "For",
    everyone: "Everyone",
    everyone_hint:
      "Everyone without rights of their own (a shared screen's user too), and what a person's own leave as they are.",
    person_hint: "Their own rights; left as they are, everyone's apply.",
    admin: "An administrator: sees and uses everything, whatever is set here.",
    no_user:
      "No Home Assistant user: nobody signs in as this person. Their rights apply once they have one.",
    levels: {
      use: "Uses",
      see: "Only sees",
      hidden: "Does not see",
    },
    default: "As it is ({level})",
    rooms: "Rooms",
    devices_count: { one: "{count} device", other: "{count} devices" },
    no_devices: "Nothing linked to this room, nor in its area.",
    room_hides: "Not seen with its room, whatever its own level.",
    private: "Private",
    private_hint: "A private room: closed to whoever it is not kept for, whatever the rights.",
    other: "Other devices",
    other_hint: "A scene, a script, a device in no room.",
    other_none: "None set apart.",
    add: "Add",
    add_label: "A device (its entity id)",
    bad_entity: "“{entity}” is not an entity id.",
    summary:
      "Of {rooms} rooms: uses {use}, only sees {see}, does not see {hidden}. {devices} set apart.",
    devices_apart: { one: "{count} device", other: "{count} devices" },
    limit:
      "DomoTwin hides and refuses in its own views, controls and services (its schedules, “where is”). Home Assistant still lets every user use every entity in its other dashboards, its API and its voice assistants: this keeps a shared screen or a child's tablet to what is theirs, not behind a security barrier.",
    save: "Save",
    cancel: "Cancel",
  },
};

export const rightsFr: Widen<typeof rightsEn> = {
  rights: {
    title: "Droits",
    intro:
      "Ce dont chaque personne se sert, ce qu’elle voit seulement ou ne voit pas dans DomoTwin, pièce par pièce et appareil par appareil. Les administrateurs voient tout et se servent de tout.",
    for: "Pour",
    everyone: "Tout le monde",
    everyone_hint:
      "Tous ceux qui n’ont pas de droits à eux (l’utilisateur d’un écran partagé aussi), et ce que les droits d’une personne laissent tel quel.",
    person_hint: "Ses propres droits ; laissés tels quels, ceux de tout le monde s’appliquent.",
    admin: "Un administrateur : voit tout et se sert de tout, quoi qu’on règle ici.",
    no_user:
      "Pas d’utilisateur Home Assistant : personne ne se connecte en tant que cette personne. Ses droits s’appliquent dès qu’elle en a un.",
    levels: {
      use: "Se sert",
      see: "Voit seulement",
      hidden: "Ne voit pas",
    },
    default: "Tel quel ({level})",
    rooms: "Pièces",
    devices_count: { one: "{count} appareil", other: "{count} appareils" },
    no_devices: "Rien n’est lié à cette pièce, ni dans sa zone.",
    room_hides: "Pas vu avec sa pièce, quel que soit son propre niveau.",
    private: "Privée",
    private_hint:
      "Une pièce privée : fermée à ceux pour qui elle n’est pas gardée, quels que soient les droits.",
    other: "Autres appareils",
    other_hint: "Une scène, un script, un appareil d’aucune pièce.",
    other_none: "Aucun mis à part.",
    add: "Ajouter",
    add_label: "Un appareil (son identifiant d’entité)",
    bad_entity: "« {entity} » n’est pas un identifiant d’entité.",
    summary:
      "Sur {rooms} pièces : se sert de {use}, en voit seulement {see}, n’en voit pas {hidden}. {devices} à part.",
    devices_apart: { one: "{count} appareil", other: "{count} appareils" },
    limit:
      "DomoTwin cache et refuse dans ses propres vues, commandes et services (ses programmations, « où est »). Home Assistant laisse encore chaque utilisateur se servir de chaque entité dans ses autres tableaux de bord, son API et ses assistants vocaux : cela garde un écran partagé ou la tablette d’un enfant à ce qui est à eux, pas derrière une barrière de sécurité.",
    save: "Enregistrer",
    cancel: "Annuler",
  },
};
