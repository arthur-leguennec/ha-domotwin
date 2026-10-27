/**
 * Into Home Assistant's Overview (`docs/DECISIONS.md`, D-061). Where Home Assistant opens on its
 * own Overview (2026.2 and later, its `home` panel), each area has a page there, which a room tapped
 * in 3D opens. DomoTwin's summaries, in the Overview's manner, sum up what the 3D view shows: the
 * people at home, the radio mesh, the automations, the upkeep and the robots.
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
