/**
 * Into Home Assistant's Overview (`docs/DECISIONS.md`, D-061). Where Home Assistant opens on its
 * own Overview (2026.2 and later, its `home` panel), each area has a page there, which a room tapped
 * in 3D opens. DomoTwin's summaries, in the Overview's manner, sum up what the 3D view shows: the
 * people at home, the radio mesh, the automations, the upkeep and the robots. Its Energy page is
 * opened rather than copied (D-069).
 */
import type { HomeAssistant } from "../ha/types";

/** The version from which the Overview is the page Home Assistant opens on. */
const OVERVIEW_SINCE: readonly [number, number] = [2026, 2];

/** Whether a Home Assistant version (`2026.2.0`, `2026.10.0b1`) is at least `[year, month]`. */
export function versionAtLeast(
  version: string | undefined,
  [year, month]: readonly [number, number],
): boolean {
  const match = /^(\d+)\.(\d+)/.exec(version ?? "");
  if (!match) return false;
  const [y, m] = [Number(match[1]), Number(match[2])];
  return y > year || (y === year && m >= month);
}

/**
 * The address of an area's page in Home Assistant's Overview, where it has one: never for the
 * demo house or the sandbox, whose areas are not the home's.
 */
export function areaPage(hass: HomeAssistant | undefined, area: string): string | undefined {
  if (!hass || hass.demo === true || hass.sandbox === true || hass.guest === true) return undefined;
  if (!hass.panels?.home || !versionAtLeast(hass.config?.version, OVERVIEW_SINCE)) return undefined;
  if (!hass.areas?.[area]) return undefined;
  return `/home/areas-${encodeURIComponent(area)}`;
}

/**
 * Whether Home Assistant's energy has something set up (`energy/get_prefs`' answer): a source, a
 * device, or water, as its Energy page asks before it shows more than its setup wizard (D-069).
 */
export function energySetUp(prefs: unknown): boolean {
  if (typeof prefs !== "object" || prefs === null) return false;
  const value = prefs as Record<string, unknown>;
  return ["energy_sources", "device_consumption", "device_consumption_water"].some(
    (key) => Array.isArray(value[key]) && (value[key] as unknown[]).length > 0,
  );
}

/**
 * The address of Home Assistant's Energy page (D-069), where it has one: its energy integration
 * makes it for every user (2025.1 and since); never for the demo house, the sandbox or a guest's
 * page. Its back
 * arrow (2025.10 and later, `historyBack`) leads to `back` (2026.2 and later, `backPath`), else back
 * where it came from; before 2025.10, the browser's back does.
 */
export function energyPage(hass: HomeAssistant | undefined, back?: string): string | undefined {
  if (!hass || hass.demo === true || hass.sandbox === true || hass.guest === true) return undefined;
  if (!hass.panels?.energy) return undefined;
  const params = new URLSearchParams({ historyBack: "1" });
  if (back) params.set("backPath", back);
  return `/energy?${params.toString()}`;
}

export const SUMMARIES = ["people", "network", "automations", "upkeep", "robots"] as const;
export type SummaryKind = (typeof SUMMARIES)[number];

export function isSummary(value: unknown): value is SummaryKind {
  return (SUMMARIES as readonly unknown[]).includes(value);
}

/** Where a summary opens DomoTwin: its 3D view, on the layer that shows what it sums up. */
export function summaryPath(kind: SummaryKind): string {
  const layer = kind === "network" || kind === "automations" || kind === "upkeep" ? kind : "";
  return layer ? `/domotwin/3d?layer=${layer}` : "/domotwin/3d";
}
