/**
 * What a workplace used while closed (`docs/DECISIONS.md`, D-088), as the integration says it: in
 * the weekly report, and for the Home tab's opening hours.
 */

/** What a workplace used while closed in a span, in kWh: its `share` of all the place used then
 * (percent), and each room's. */
export interface ClosedEnergy {
  kwh: number;
  share?: number;
  rooms?: Record<string, number>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** What a workplace used while closed in a span, read leniently. */
export function readClosed(raw: unknown): ClosedEnergy | undefined {
  if (!isObject(raw)) return undefined;
  const kwh = number(raw.kwh);
  if (kwh === undefined) return undefined;
  const found: ClosedEnergy = { kwh };
  const share = number(raw.share);
  if (share !== undefined) found.share = share;
  if (isObject(raw.rooms)) {
    found.rooms = Object.fromEntries(
      Object.entries(raw.rooms).filter(([, value]) => number(value) !== undefined),
    ) as Record<string, number>;
  }
  return found;
}

/** A quantity of energy, as the language writes it: "12.4 kWh". */
export function formatKwh(kwh: number, language: string): string {
  const digits = Math.abs(kwh) < 10 ? 1 : 0;
  return `${new Intl.NumberFormat(language, { maximumFractionDigits: digits }).format(kwh)} kWh`;
}
