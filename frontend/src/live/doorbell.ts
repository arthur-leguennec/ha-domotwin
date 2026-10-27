/**
 * The doorbell (`docs/DECISIONS.md`, D-068). Home Assistant's doorbells are `event` entities of
 * the `doorbell` class (2023.8 and later), whose state is when they last rang. A ring is a newer
 * time, seen while DomoTwin shows, two minutes old at most by this device's clock (which Home
 * Assistant's own times take to be right): not the time Home Assistant gives back as it starts,
 * nor a ring heard while the page was asleep. Only this watch is in the first load; what the full
 * screen shows comes when a doorbell first rings.
 */
import { domainOf, nowOf, type HomeAssistant } from "../ha/types";

/** A ring older than this (ms) is not shown: the page was asleep, or the clock is wrong. */
export const RING_FRESH_MS = 120_000;
/** How long the full screen stays, unless closed or rung again (ms). */
export const RING_SHOWN_MS = 120_000;

/** Whether an entity is a doorbell: an event of the `doorbell` class, not hidden. */
export function isDoorbell(hass: HomeAssistant, id: string): boolean {
  if (domainOf(id) !== "event" || hass.entities?.[id]?.hidden === true) return false;
  return hass.states[id]?.attributes.device_class === "doorbell";
}

/** A doorbell rang: which, and when (ms). */
export interface Ring {
  entity: string;
  at: number;
}

/** When a doorbell's state says it rang (ms), if it says. */
export function rangAt(hass: HomeAssistant, id: string): number | undefined {
  const at = Date.parse(hass.states[id]?.state ?? "");
  return Number.isFinite(at) ? at : undefined;
}

/** Watches the home's doorbells through the states Home Assistant gives. */
export class DoorbellWatch {
  /**
   * The events that may be doorbells: those of the entity registry, read again when an entity
   * comes or goes (their state may come later); without a registry, those of the states.
   */
  private events: string[] = [];
  private foundFrom?: unknown;
  private statesSeen?: unknown;
  /** The latest ring each doorbell said, since first seen (`undefined`: none yet). */
  private readonly last = new Map<string, number | undefined>();

  /** The newest ring since the states seen last, if a doorbell rang. */
  check(hass: HomeAssistant): Ring | undefined {
    if (hass.states === this.statesSeen) return undefined;
    this.statesSeen = hass.states;
    const from = hass.entities ?? hass.states;
    if (from !== this.foundFrom) {
      this.foundFrom = from;
      this.events = Object.keys(from).filter((id) => domainOf(id) === "event");
    }
    let ring: Ring | undefined;
    for (const id of this.events) {
      if (!isDoorbell(hass, id)) continue;
      const at = rangAt(hass, id);
      const known = this.last.has(id);
      const before = this.last.get(id);
      // Unavailable while Home Assistant starts: the ring said before is kept.
      if (at === undefined) {
        if (!known) this.last.set(id, undefined);
        continue;
      }
      if (before !== undefined && at <= before) continue;
      this.last.set(id, at);
      if (known && nowOf(hass) - at <= RING_FRESH_MS && (!ring || at > ring.at)) {
        ring = { entity: id, at };
      }
    }
    return ring;
  }
}
