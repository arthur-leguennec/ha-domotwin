/**
 * The messages of Hydro-Québec's peaks (D-058), in both languages: loaded with the peak's chunk,
 * not with the first picture; the layer's name stays in the dictionaries.
 */
import type { Widen } from "./index";

export const peakEn = {
  peak: {
    now: "Peak until {end}",
    preheat: "Pre-heating, then the peak from {start} to {end}",
    next: "Next peak: {start} to {end}",
    preheat_from: "Pre-heating from {at}",
    none: "No peak announced",
    role_preheat: { one: "{count} room pre-heating", other: "{count} rooms pre-heating" },
    role_shed: { one: "{count} room shed", other: "{count} rooms shed" },
    role_heating: { one: "{count} room still heating", other: "{count} rooms still heating" },
    draw: "The rooms draw {power}",
  },
};

export const peakFr: Widen<typeof peakEn> = {
  peak: {
    now: "Pointe jusqu’à {end}",
    preheat: "Préchauffage, puis la pointe de {start} à {end}",
    next: "Prochaine pointe : {start} à {end}",
    preheat_from: "Préchauffage dès {at}",
    none: "Aucune pointe annoncée",
    role_preheat: { one: "{count} pièce en préchauffage", other: "{count} pièces en préchauffage" },
    role_shed: { one: "{count} pièce délestée", other: "{count} pièces délestées" },
    role_heating: { one: "{count} pièce chauffe encore", other: "{count} pièces chauffent encore" },
    draw: "Les pièces consomment {power}",
  },
};
