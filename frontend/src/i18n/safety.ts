/**
 * The messages of the Safety tab and of a doorbell's full screen (D-064), in both languages:
 * loaded with the tabs' chunk and with the doorbell's, not with the first picture.
 */
import type { Widen } from "./index";

export const safetyEn = {
  safety: {
    alerts: "Alerts",
    no_alert: "No alert: all is calm.",
    alarm: "Alarm",
    doorbells: "Doorbells",
    rang: "Last rang {when}",
    not_rung: "Not rung yet",
    cameras: "Cameras",
    locks: "Locks",
    nothing: "No alarm, camera or doorbell in Home Assistant yet.",
    security_page: "Home Assistant's Security page",
    security_hint:
      "The locks, the doors and windows, the sensors and what happened, as Home Assistant shows them.",
  },
  doorbell: {
    title: "Someone is at the door",
    rang: "{name} · {when}",
    no_camera: "No camera at this door.",
    close: "Close",
  },
};

export const safetyFr: Widen<typeof safetyEn> = {
  safety: {
    alerts: "Alertes",
    no_alert: "Aucune alerte : tout est calme.",
    alarm: "Alarme",
    doorbells: "Sonnettes",
    rang: "Dernier coup de sonnette {when}",
    not_rung: "Pas encore sonné",
    cameras: "Caméras",
    locks: "Serrures",
    nothing: "Aucune alarme, caméra ni sonnette dans Home Assistant pour l’instant.",
    security_page: "La page Sécurité de Home Assistant",
    security_hint:
      "Les serrures, les portes et fenêtres, les capteurs et ce qui s’est passé, comme Home Assistant les montre.",
  },
  doorbell: {
    title: "Quelqu’un sonne à la porte",
    rang: "{name} · {when}",
    no_camera: "Pas de caméra à cette porte.",
    close: "Fermer",
  },
};
