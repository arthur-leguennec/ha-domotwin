/**
 * The messages of the Wi-Fi for guests (D-062), in both languages: loaded with its chunk, not
 * with the first picture.
 */
import type { Widen } from "./index";

export const wifiEn = {
  wifi: {
    title: "Wi-Fi for guests",
    scan: "Point a phone's camera at the code to join the network.",
    network: "Network",
    password: "Password",
    open: "An open network: no password.",
    hidden_note: "A hidden network: the code joins it all the same.",
    show_password: "Show the password",
    hide_password: "Hide the password",
    router: "The code your router gives",
    too_long: "This network's name and password are too long for a QR code.",
    unreadable: "The code could not be drawn. Try again in a moment.",
    none: "No Wi-Fi given yet.",
    change: "Change",
    close: "Close",
    form: {
      title: "The Wi-Fi for guests",
      privacy:
        "Kept in DomoTwin's private storage on your Home Assistant: never in the plan, the diagnostics or an export.",
      source: "What to show",
      typed: "A network I type",
      image: "My router's own code",
      image_entity: "The router's QR code (an image entity)",
      image_none: "No image entity in this home.",
      name: "Network name",
      password: "Password",
      password_kept: "Kept as it is when left empty",
      security: "Security",
      security_WPA: "WPA, WPA2 or WPA3",
      security_WEP: "WEP (old)",
      security_nopass: "None (open network)",
      hidden: "Hidden network",
      screens: "Screens that show it",
      screens_hint:
        "The `screen` of the DomoTwin cards that show it to anyone before them (a wall screen in the hall), separated by commas. Administrators always see it.",
      bad_screen: "A screen's name is letters, digits, _ and - only: {name}",
      save: "Save",
      cancel: "Cancel",
      forget: "Forget it",
    },
    errors: {
      no_name: "Give the network's name.",
      long_name: "A network's name is at most 32 bytes (fewer letters with accents).",
      bad_wpa: "A WPA password is 8 to 63 characters (letters, digits, signs), or 64 hexadecimal.",
      bad_wep: "A WEP key is 5 or 13 characters, or 10 or 26 hexadecimal.",
      invalid: "This cannot be saved: {reason}",
    },
  },
};

export const wifiFr: Widen<typeof wifiEn> = {
  wifi: {
    title: "Wi-Fi des invités",
    scan: "Visez le code avec l’appareil photo d’un téléphone pour rejoindre le réseau.",
    network: "Réseau",
    password: "Mot de passe",
    open: "Un réseau ouvert : pas de mot de passe.",
    hidden_note: "Un réseau masqué : le code le rejoint quand même.",
    show_password: "Afficher le mot de passe",
    hide_password: "Masquer le mot de passe",
    router: "Le code que donne votre box",
    too_long: "Le nom et le mot de passe de ce réseau sont trop longs pour un code QR.",
    unreadable: "Le code n’a pas pu être dessiné. Réessayez dans un instant.",
    none: "Aucun Wi-Fi donné pour l’instant.",
    change: "Modifier",
    close: "Fermer",
    form: {
      title: "Le Wi-Fi des invités",
      privacy:
        "Gardé dans le stockage privé de DomoTwin sur votre Home Assistant : jamais dans le plan, les diagnostics ou un export.",
      source: "Quoi montrer",
      typed: "Un réseau que je saisis",
      image: "Le code de ma box",
      image_entity: "Le code QR de la box (une entité image)",
      image_none: "Aucune entité image dans ce logement.",
      name: "Nom du réseau",
      password: "Mot de passe",
      password_kept: "Gardé tel quel s’il reste vide",
      security: "Sécurité",
      security_WPA: "WPA, WPA2 ou WPA3",
      security_WEP: "WEP (ancien)",
      security_nopass: "Aucune (réseau ouvert)",
      hidden: "Réseau masqué",
      screens: "Écrans qui le montrent",
      screens_hint:
        "Le `screen` des cartes DomoTwin qui le montrent à qui se tient devant (un écran mural dans l’entrée), séparés par des virgules. Les administrateurs le voient toujours.",
      bad_screen: "Le nom d’un écran ne contient que des lettres, des chiffres, _ et - : {name}",
      save: "Enregistrer",
      cancel: "Annuler",
      forget: "L’oublier",
    },
    errors: {
      no_name: "Donnez le nom du réseau.",
      long_name: "Le nom d’un réseau fait au plus 32 octets (moins de lettres avec des accents).",
      bad_wpa:
        "Un mot de passe WPA fait de 8 à 63 caractères (lettres, chiffres, signes), ou 64 en hexadécimal.",
      bad_wep: "Une clé WEP fait 5 ou 13 caractères, ou 10 ou 26 en hexadécimal.",
      invalid: "Ceci ne peut pas être enregistré : {reason}",
    },
  },
};
