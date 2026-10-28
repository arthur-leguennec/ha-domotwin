/**
 * What a workplace used while closed (`docs/DECISIONS.md`, D-088), as the integration says it: in
 * the weekly report, and for the Home tab's opening hours.
 */

/**
 * What a workplace used while closed in a span, in kWh: its `share` of all the place used then
 * (percent), and each room's. Counted only `since` a moment (an ISO date) where Home Assistant's
 * history did not go back to the span's start.
 */
export interface ClosedEnergy {
  kwh: number;
  share?: number;
  since?: string;
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
  if (typeof raw.since === "string" && Number.isFinite(Date.parse(raw.since))) {
    found.since = raw.since;
  }
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

/**
 * A percentage, as the language writes it ("38%", "38 %"); with its sign when `signed` ("+40%",
 * "−16%"), the minus a true one.
 */
export function formatPercent(percent: number, language: string, signed = false): string {
  return new Intl.NumberFormat(language, {
    style: "percent",
    maximumFractionDigits: 0,
    signDisplay: signed ? "exceptZero" : "auto",
  })
    .format(percent / 100)
    .replace("-", "−");
}

/** A day of a moment (an ISO date) in `timeZone`: "16 October". */
export function sinceDay(at: string, language: string, timeZone?: string): string {
  const date = new Date(at);
  try {
    return new Intl.DateTimeFormat(language, { day: "numeric", month: "long", timeZone }).format(
      date,
    );
  } catch {
    return date.toISOString().slice(0, 10);
  }
}
