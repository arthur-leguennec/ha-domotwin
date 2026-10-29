/**
 * The messages of the guide to making an automation (D-093), in both languages, loaded with it,
 * not with the first picture.
 */
import type { Widen } from "./index";

export const guideEn = {
  guide: {
    title: "Make an automation",
    step: "Step {step} of {count}",
    back: "Back",
    next: "Next",
    done: "Done",
    intro_title: "An automation in three parts",
    intro:
      "An automation does something on its own when something happens in the home. Home Assistant writes it in three parts:",
    when: "When",
    when_about: "what starts it: a device that changes, a time, the sun, someone coming home.",
    only_if: "Only if",
    only_if_about: "what must be true then, if anything: someone home, after dark, a weekday.",
    then: "Then",
    then_about: "what it does: switch on a light, close the curtains, send a notification.",
    example_title: "In your home, for example",
    example_motion: "When {sensor} sees someone, only if the sun is down, then switch on {light}.",
    example_door: "When {sensor} opens, only if the sun is down, then switch on {light}.",
    example_none:
      "When the front door opens, only if the sun is down, then switch on the hall light.",
    when_title: "When: what starts it",
    when_state: "A device changes: a door opens, motion is seen, a temperature goes above 25 °C.",
    when_time: "A time: every day at 7:00, or on weekdays only.",
    when_sun: "The sun: at sunrise or sunset, earlier or later by some minutes.",
    when_people: "People: someone comes home, or the last one leaves.",
    when_tip: "An automation may have several of them: any one starts it.",
    if_title: "Only if: what must be true",
    if_state: "A device is in a state: the alarm is off, the TV is on.",
    if_time: "A time of day: between 22:00 and 6:00.",
    if_sun: "After sunset, or before sunrise.",
    if_people: "Someone is home, or nobody is.",
    if_tip: "They are optional; when there are some, all must be true for it to go on.",
    then_title: "Then: what it does",
    then_device: "Switch a device on or off, or set it: a light at 30 %, the heating at 19 °C.",
    then_scene: "Turn on a scene: several devices set at once.",
    then_notify: "Send a notification to a phone.",
    then_wait: "Wait, then do more: switch the light off again after 5 minutes.",
    then_tip: "They run one after the other, in their order.",
    make_title: "Make yours",
    make_editor: "Open Home Assistant's editor",
    make_editor_about:
      "In Settings, Automations & scenes, Create automation: add a When, an Only if and a Then, and save.",
    make_plain: "Write it in plain words",
    make_plain_about:
      "Say it in a sentence: DomoTwin drafts it with Home Assistant's AI task, for you to check.",
    make_sandbox: "Try them in the sandbox",
    make_sandbox_about:
      "Play a day on a copy of your home and see what its automations would do, without touching it.",
    make_check:
      "Once saved, it is in the 3D tab's Automations: its wires go from what starts it to what it does.",
    make_demo:
      "The demo house's automations cannot be changed: in your own home, Home Assistant's editor makes them.",
    make_not_admin: "Only an administrator of Home Assistant can make automations.",
  },
};

export const guideFr: Widen<typeof guideEn> = {
  guide: {
    title: "Créer une automatisation",
    step: "Étape {step} sur {count}",
    back: "Retour",
    next: "Suivant",
    done: "Terminé",
    intro_title: "Une automatisation en trois parties",
    intro:
      "Une automatisation agit toute seule quand quelque chose se passe dans le logement. Home Assistant l’écrit en trois parties :",
    when: "Quand",
    when_about:
      "ce qui la déclenche : un appareil qui change, une heure, le soleil, quelqu’un qui rentre.",
    only_if: "Seulement si",
    only_if_about:
      "ce qui doit être vrai à ce moment-là, s’il y a lieu : quelqu’un à la maison, la nuit, un jour de semaine.",
    then: "Alors",
    then_about:
      "ce qu’elle fait : allumer une lumière, fermer les rideaux, envoyer une notification.",
    example_title: "Chez vous, par exemple",
    example_motion:
      "Quand {sensor} détecte quelqu’un, seulement si le soleil est couché, alors allumer {light}.",
    example_door:
      "Quand {sensor} s’ouvre, seulement si le soleil est couché, alors allumer {light}.",
    example_none:
      "Quand la porte d’entrée s’ouvre, seulement si le soleil est couché, alors allumer la lumière de l’entrée.",
    when_title: "Quand : ce qui la déclenche",
    when_state:
      "Un appareil change : une porte s’ouvre, un mouvement est détecté, la température dépasse 25 °C.",
    when_time: "Une heure : chaque jour à 7 h, ou seulement en semaine.",
    when_sun: "Le soleil : à son lever ou à son coucher, quelques minutes avant ou après.",
    when_people: "Les personnes : quelqu’un rentre, ou le dernier s’en va.",
    when_tip: "Une automatisation peut en avoir plusieurs : n’importe lequel la déclenche.",
    if_title: "Seulement si : ce qui doit être vrai",
    if_state: "Un appareil est dans un état : l’alarme est désactivée, la télé est allumée.",
    if_time: "Une plage horaire : entre 22 h et 6 h.",
    if_sun: "Après le coucher du soleil, ou avant son lever.",
    if_people: "Quelqu’un est à la maison, ou personne.",
    if_tip:
      "Elles sont facultatives ; quand il y en a, toutes doivent être vraies pour qu’elle continue.",
    then_title: "Alors : ce qu’elle fait",
    then_device:
      "Allumer ou éteindre un appareil, ou le régler : une lumière à 30 %, le chauffage à 19 °C.",
    then_scene: "Activer une scène : plusieurs appareils réglés d’un coup.",
    then_notify: "Envoyer une notification sur un téléphone.",
    then_wait: "Attendre, puis faire autre chose : éteindre la lumière 5 minutes plus tard.",
    then_tip: "Elles s’enchaînent l’une après l’autre, dans leur ordre.",
    make_title: "Créer la vôtre",
    make_editor: "Ouvrir l’éditeur de Home Assistant",
    make_editor_about:
      "Dans Paramètres, Automatisations et scènes, Créer une automatisation : ajoutez un Quand, un Seulement si et un Alors, puis enregistrez.",
    make_plain: "L’écrire en langage courant",
    make_plain_about:
      "Dites-la en une phrase : DomoTwin en fait un brouillon avec la tâche d’IA de Home Assistant, à vérifier.",
    make_sandbox: "Les essayer dans le bac à sable",
    make_sandbox_about:
      "Faites passer une journée sur une copie de votre logement et voyez ce que feraient ses automatisations, sans y toucher.",
    make_check:
      "Une fois enregistrée, elle apparaît dans les automatisations de l’onglet 3D : ses fils vont de ce qui la déclenche à ce qu’elle fait.",
    make_demo:
      "Les automatisations de la maison de démo ne se modifient pas : chez vous, l’éditeur de Home Assistant les crée.",
    make_not_admin: "Seul un administrateur de Home Assistant peut créer des automatisations.",
  },
};
