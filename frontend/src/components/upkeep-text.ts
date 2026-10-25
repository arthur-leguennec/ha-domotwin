/** Upkeep in words (`DECISIONS.md`, D-033), for the card and the layer's list. */
import { DomoTwinClient } from "../ha/client";
import { isHassError, type HomeAssistant } from "../ha/types";
import type { Translator } from "../i18n";
import type { UpkeepTask } from "../live/upkeep";

/**
 * Runs an upkeep command; returns what went wrong, in words (nothing when it went through).
 */
export async function upkeepCall(
  hass: HomeAssistant,
  t: Translator,
  work: (client: DomoTwinClient) => Promise<unknown>,
): Promise<string | undefined> {
  try {
    await work(DomoTwinClient.for(hass));
    return undefined;
  } catch (error) {
    const reason = isHassError(error) ? error.message || t.error(error.code) : t.error("unknown");
    return t.t("upkeep.saved_error", { reason });
  }
}

/** A date (`YYYY-MM-DD`) as the user reads dates. */
export function shownDate(language: string, date: string): string {
  const time = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(time)) return date;
  return new Intl.DateTimeFormat(language, { dateStyle: "medium", timeZone: "UTC" }).format(time);
}

/** When something is due, `days` from today: in n days, today, or n days late. */
export function dueText(t: Translator, days: number): string {
  if (days > 0) return t.tp("upkeep.due_in", days);
  if (days === 0) return t.t("upkeep.due_today");
  return t.tp("upkeep.late", -days);
}

/** How often a task is done, in words. */
export function everyText(t: Translator, task: UpkeepTask): string {
  return t.tp(task.unit === "months" ? "upkeep.every_months" : "upkeep.every_days", task.every);
}
