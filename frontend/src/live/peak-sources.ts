/**
 * Where Hydro-Québec's peaks are read (D-058): the integrations that read them, hydroqc (Flex D
 * and the winter credit, its sensors or the calendar it writes its peaks in) and HydroPeak
 * (Hydro-Québec's open data). Their entities are found by their integration and their kind
 * (`platform`, `translation_key`), never by their id, which each home names in its own language.
 * Only whether they are there is in the first load; the peak itself comes with its chunk.
 */
import type { HassEntity, HomeAssistant } from "../ha/types";

/** hydroqc pre-heats this long before a peak unless told otherwise (its default, minutes). */
export const HYDROQC_PREHEAT = 120;

/** The kinds of entities a source reads: a peak's start and end, and its pre-heating's start. */
export interface Kinds {
  platform: string;
  start: string;
  end: string;
  preheat?: string;
  /**
   * The start the pre-heating sensor goes with, when it is not the peak's own: the pre-heating
   * is this peak's only while that start is this peak's.
   */
  preheatFor?: string;
  /** Pre-heating when its sensor says nothing (minutes): the integration's own default. */
  lead: number;
}

/**
 * What each integration says of the next announced peak. Every peak of Flex D is one; the
 * winter credit's announced ones are its critical peaks, its daily windows are not shown.
 */
export const SOURCES: readonly Kinds[] = [
  {
    platform: "hydroqc",
    start: "dpc_next_peak_start",
    end: "dpc_next_peak_end",
    preheat: "dpc_next_pre_heat_start",
    lead: HYDROQC_PREHEAT,
  },
  {
    platform: "hydroqc",
    start: "wc_next_critical_peak_start",
    end: "wc_next_critical_peak_end",
    // The winter credit's pre-heating is its next peak's, daily windows included.
    preheat: "wc_next_pre_heat_start",
    preheatFor: "wc_next_peak_start",
    lead: HYDROQC_PREHEAT,
  },
  {
    platform: "hydropeak",
    start: "event_start",
    end: "event_end",
    preheat: "preheat_start",
    // HydroPeak's own default, though its sensor is always there.
    lead: 180,
  },
];

/**
 * hydroqc's *Refresh peak data* button, which it makes only for a contract on Flex D or the
 * winter credit whose peaks it writes in a calendar: its peaks are read, even while none is
 * announced and its calendar has no event to show.
 */
const HYDROQC_BUTTON = "hydroqc.button";

/** The entities of the integrations, by `<platform>.<kind>`, found once per entity registry. */
const found = new WeakMap<object, Map<string, string[]>>();

export function entitiesOf(hass: HomeAssistant): Map<string, string[]> {
  const registry = hass.entities ?? {};
  let byKind = found.get(registry);
  if (byKind) return byKind;
  byKind = new Map();
  for (const entry of Object.values(registry)) {
    if (entry?.platform !== "hydroqc" && entry?.platform !== "hydropeak") continue;
    const kind = entry.translation_key
      ? `${entry.platform}.${entry.translation_key}`
      : entry.platform === "hydroqc" && entry.entity_id.startsWith("button.")
        ? HYDROQC_BUTTON
        : undefined;
    if (kind) byKind.set(kind, [...(byKind.get(kind) ?? []), entry.entity_id]);
  }
  found.set(registry, byKind);
  return byKind;
}

/**
 * Whether a calendar's current or next event is a peak hydroqc wrote: its description bears
 * hydroqc's mark (`ID: hydroqc_…`); only critical peaks are written, one said not to be is not.
 */
export function hydroqcEvent(entity: HassEntity): boolean {
  const description = entity.attributes.description;
  return (
    typeof description === "string" &&
    description.includes("ID: hydroqc_") &&
    !/Critique:\s*Non/i.test(description)
  );
}

/** The calendars whose event is hydroqc's peak, found once per update. */
const calendars = new WeakMap<object, string[]>();

export function peakCalendars(hass: HomeAssistant): string[] {
  let ids = calendars.get(hass.states);
  if (!ids) {
    ids = Object.entries(hass.states)
      .filter(([id, entity]) => id.startsWith("calendar.") && !!entity && hydroqcEvent(entity))
      .map(([id]) => id);
    calendars.set(hass.states, ids);
  }
  return ids;
}

/**
 * Whether an integration reads Hydro-Québec's peaks here: its sensors, hydroqc's button for the
 * peaks it writes in a calendar, or such a calendar's event. The peak's layer is offered only
 * then.
 */
export function peaksAvailable(hass: HomeAssistant | undefined): boolean {
  if (!hass) return false;
  const byKind = entitiesOf(hass);
  return (
    SOURCES.some((kinds) => byKind.has(`${kinds.platform}.${kinds.start}`)) ||
    byKind.has(HYDROQC_BUTTON) ||
    peakCalendars(hass).length > 0
  );
}
