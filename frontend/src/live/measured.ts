/**
 * How well DomoTwin's Bluetooth locating finds rooms (`docs/DECISIONS.md`, D-073), Bermuda's
 * figures beside: as `domotwin/locating/measure` gives them, shown in the Bluetooth settings and
 * copied as a table. Loaded with the settings, not with the first picture.
 */
import type { MessageKey } from "../i18n";

/** How well one way of locating found a device's rooms (M41), as `locating/measure` says. */
export interface MeasuredFigures {
  hours: number;
  changes_per_hour: number | null;
  storey_changes_per_hour: number | null;
  /** Stays shorter than half a minute, ended by another room. */
  short_stays: number;
  /** The share of the time in no room. */
  unknown_share: number | null;
  /** While a presence sensor alone said where the owner was: how long, and the share right. */
  witnessed_hours: number;
  right_share: number | null;
}

/** The measurements since they started: DomoTwin's figures for each device, Bermuda's beside. */
export interface LocatingMeasure {
  since: string;
  devices: Record<
    string,
    {
      domotwin: MeasuredFigures;
      /** DomoTwin's counted by area, as Bermuda's are; with Bermuda's. */
      domotwin_areas?: MeasuredFigures;
      bermuda?: MeasuredFigures;
      agreement?: number | null;
    }
  >;
}

/** What the measurements show for one way of locating, in this order (`measured.<row>`). */
export const MEASURED_ROWS = ["hours", "changes", "storeys", "short", "unknown", "right"] as const;
export type MeasuredRow = (typeof MEASURED_ROWS)[number];

/** A share as a percentage, or a dash when nothing says it. */
export function percent(share: number | null | undefined): string {
  return share === null || share === undefined ? "–" : `${Math.round(share * 100)} %`;
}

function figure(value: number | null): string {
  return value === null ? "–" : String(value);
}

/** One way of locating's figures as shown and copied, a cell for each of `MEASURED_ROWS`. */
export function measuredCells(f: MeasuredFigures): Record<MeasuredRow, string> {
  return {
    hours: String(f.hours),
    changes: figure(f.changes_per_hour),
    storeys: figure(f.storey_changes_per_hour),
    short: String(f.short_stays),
    unknown: percent(f.unknown_share),
    right: `${percent(f.right_share)} (${String(f.witnessed_hours)} h)`,
  };
}

/**
 * The measurements as a Markdown table to publish (`docs/bluetooth.md`): the devices by number,
 * no names, DomoTwin's row, then DomoTwin's by area and Bermuda's under it (the agreement on the
 * row by area, as it is reckoned).
 */
export function measureTable(
  measure: LocatingMeasure,
  t: (key: MessageKey, params?: Record<string, string | number>) => string,
): string {
  const head = [
    t("measured.device"),
    t("measured.way"),
    ...MEASURED_ROWS.map((row) => t(`measured.${row}`)),
    t("measured.agreement"),
  ];
  const rows = [`| ${head.join(" | ")} |`, `|${head.map(() => " --- ").join("|")}|`];
  Object.keys(measure.devices)
    .sort()
    .forEach((id, index) => {
      const shown = measure.devices[id];
      if (!shown) return;
      const device = t("measured.numbered", { n: index + 1 });
      const row = (way: string, f: MeasuredFigures, agreement: string): string => {
        const cells = measuredCells(f);
        return `| ${[device, way, ...MEASURED_ROWS.map((r) => cells[r]), agreement].join(" | ")} |`;
      };
      rows.push(row("DomoTwin", shown.domotwin, ""));
      if (shown.domotwin_areas) {
        rows.push(row(t("measured.by_area"), shown.domotwin_areas, percent(shown.agreement)));
      }
      if (shown.bermuda) rows.push(row("Bermuda", shown.bermuda, ""));
    });
  return rows.join("\n");
}
