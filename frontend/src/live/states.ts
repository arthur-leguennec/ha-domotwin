/**
 * The states sent to the engine: only bound entities, only what changed, and only the
 * attributes the 3D view uses.
 */
import type { HassEntity, HomeAssistant } from "../ha/types";

const ATTRIBUTES = [
  "brightness",
  "rgb_color",
  "color_temp_kelvin",
  "current_position",
  "device_class",
] as const;

/** The compact state the engine reads, as JSON text (compared to find changes). */
function compact(entity: HassEntity | undefined): string | null {
  if (!entity) return null;
  const attributes: Record<string, unknown> = {};
  for (const name of ATTRIBUTES) {
    if (entity.attributes[name] !== undefined) attributes[name] = entity.attributes[name];
  }
  return JSON.stringify({ state: entity.state, attributes });
}

/** Remembers what the engine was sent, to send only changes. */
export class StateSync {
  private sent = new Map<string, string | null>();
  /** The state objects last compared: Home Assistant keeps the object of an unchanged entity. */
  private seen = new Map<string, HassEntity | undefined>();

  /** Forget everything (a new engine). */
  reset(): void {
    this.sent.clear();
    this.seen.clear();
  }

  /**
   * The changes since the last call for `ids`, as the JSON the engine's `setStates` reads, or
   * `undefined` when nothing changed. Entities no longer bound are forgotten (`null`).
   */
  changes(hass: HomeAssistant, ids: Set<string>): string | undefined {
    const parts: string[] = [];
    for (const id of ids) {
      const entity = hass.states[id];
      if (this.sent.has(id) && this.seen.get(id) === entity) continue;
      this.seen.set(id, entity);
      const now = compact(entity);
      if (this.sent.has(id) && this.sent.get(id) === now) continue;
      this.sent.set(id, now);
      parts.push(`${JSON.stringify(id)}:${now ?? "null"}`);
    }
    for (const id of [...this.sent.keys()]) {
      if (!ids.has(id)) {
        this.sent.delete(id);
        this.seen.delete(id);
        parts.push(`${JSON.stringify(id)}:null`);
      }
    }
    return parts.length > 0 ? `{${parts.join(",")}}` : undefined;
  }
}
