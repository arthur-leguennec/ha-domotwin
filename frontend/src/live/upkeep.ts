/**
 * Upkeep (`docs/DECISIONS.md`, D-033): what is needed to look after each piece, kept by the
 * integration by piece id (make, model, serial number, dates, a manual, notes, recurring tasks);
 * where each card stands today (the engine works the dates out, `upkeepStates`); the badges of
 * the pieces with a task due or a warranty ending; the list of tasks by date.
 */
import type { Badge } from "./devices";

export type UpkeepUnit = "days" | "months";

/** A recurring task: done `every` so many days or months, last on `last_done`. */
export interface UpkeepTask {
  id: string;
  name: string;
  every: number;
  unit: UpkeepUnit;
  last_done?: string;
}

/** A piece's card. Dates are `YYYY-MM-DD`; `service_life` in years. */
export interface UpkeepCard {
  make?: string;
  model?: string;
  serial?: string;
  installed?: string;
  warranty_end?: string;
  service_life?: number;
  manual?: string;
  notes?: string;
  tasks?: UpkeepTask[];
}

/** The upkeep of the home: how early a task is due, and the cards by piece id. */
export interface Upkeep {
  version: 1;
  lead_days: number;
  pieces: Record<string, UpkeepCard>;
}

export const NO_UPKEEP: Upkeep = { version: 1, lead_days: 14, pieces: {} };

export type UpkeepState = "fine" | "due" | "overdue";

/** Where a task stands: when it is due, and in how many days (negative once overdue). */
export interface TaskStanding {
  id: string;
  due: string;
  state: UpkeepState;
  days: number;
}

/** Where a card stands: its most urgent task's state (null without tasks), the days left on a
 * warranty ending within 30 days. */
export interface CardStanding {
  state: UpkeepState | null;
  warranty: number | null;
  tasks: TaskStanding[];
}

export type Standings = Record<string, CardStanding | undefined>;

/** Today's date (`YYYY-MM-DD`) where the home is (Home Assistant's time zone), else here. */
export function todayIn(timeZone: string | undefined, now = new Date()): string {
  const key = timeZone ?? "";
  let format = dayFormats.get(key);
  if (format === undefined) {
    try {
      format = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
    } catch {
      // An unknown time zone: the device's.
      format = null;
    }
    dayFormats.set(key, format);
  }
  if (format) {
    const parts = format.formatToParts(now);
    const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    return `${part("year")}-${part("month")}-${part("day")}`;
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The formatter of days of each time zone, made once (`null`: a zone this browser does not know). */
const dayFormats = new Map<string, Intl.DateTimeFormat | null>();

/** The standings the engine wrote (`upkeepStates`), or none. */
export function readStandings(text: string | undefined): Standings {
  if (!text) return {};
  try {
    return JSON.parse(text) as Standings;
  } catch {
    return {};
  }
}

/** The upkeep layer's shade of each piece with tasks, for the engine (`setUpkeep`). */
export function upkeepShades(standings: Standings): Record<string, UpkeepState> {
  const out: Record<string, UpkeepState> = {};
  for (const [piece, standing] of Object.entries(standings)) {
    if (standing?.state) out[piece] = standing.state;
  }
  return out;
}

/**
 * The badges of upkeep, by piece: a task overdue (urgent), due soon, a warranty ending; how many
 * tasks wait when more than one. They join the devices' badges (D-024), the most urgent first.
 */
export function upkeepBadges(standings: Standings): Map<string, Badge[]> {
  const out = new Map<string, Badge[]>();
  for (const [element, standing] of Object.entries(standings)) {
    if (!standing) continue;
    const badges: Badge[] = [];
    // How many of its tasks are due or overdue, said on its badge when more than one.
    const waiting = standing.tasks.filter((task) => task.state !== "fine").length;
    const count = waiting > 1 ? { text: String(waiting) } : {};
    if (standing.state === "overdue") {
      badges.push({ element, kind: "upkeep_overdue", tone: "danger", entity: "", ...count });
    } else if (standing.state === "due") {
      badges.push({ element, kind: "upkeep_due", tone: "warning", entity: "", ...count });
    }
    if (standing.warranty !== null) {
      badges.push({ element, kind: "warranty_ending", tone: "warning", entity: "" });
    }
    if (badges.length > 0) out.set(element, badges);
  }
  return out;
}

/** A line of the upkeep list: a task, or a warranty ending (no task). */
export interface UpkeepLine {
  piece: string;
  task?: UpkeepTask;
  /** When it is due (or the warranty ends), and in how many days. */
  due: string;
  days: number;
  state: UpkeepState | "warranty";
}

/**
 * Every task of the home, the soonest first, and the warranties ending soon; `name` gives a
 * piece's name, to order those due the same day.
 */
export function upkeepLines(
  upkeep: Upkeep,
  standings: Standings,
  name: (piece: string) => string,
): UpkeepLine[] {
  const lines: UpkeepLine[] = [];
  for (const [piece, card] of Object.entries(upkeep.pieces)) {
    const standing = standings[piece];
    if (!standing) continue;
    for (const task of card.tasks ?? []) {
      const at = standing.tasks.find((t) => t.id === task.id);
      if (at) lines.push({ piece, task, due: at.due, days: at.days, state: at.state });
    }
    if (standing.warranty !== null && card.warranty_end) {
      lines.push({
        piece,
        due: card.warranty_end,
        days: standing.warranty,
        state: "warranty",
      });
    }
  }
  return lines.sort(
    (a, b) =>
      a.due.localeCompare(b.due) ||
      name(a.piece).localeCompare(name(b.piece)) ||
      (a.task?.name ?? "").localeCompare(b.task?.name ?? ""),
  );
}

/** An id for a new task of a card: `task-1`, `task-2`… the first not taken. */
export function newTaskId(tasks: readonly UpkeepTask[]): string {
  const taken = new Set(tasks.map((t) => t.id));
  let n = 1;
  while (taken.has(`task-${n}`)) n += 1;
  return `task-${n}`;
}

/**
 * How a plan's piece ids changed when they were made the home's own (taken ids renamed, the
 * pieces kept in order): old id → new id, for those that changed.
 */
export function renamedPieces(
  before: { items?: unknown },
  after: { items?: unknown },
): Map<string, string> {
  const ids = (plan: { items?: unknown }): unknown[] =>
    Array.isArray(plan.items)
      ? plan.items.map((item: unknown) => (item as { id?: unknown } | null)?.id)
      : [];
  const old = ids(before);
  const now = ids(after);
  const out = new Map<string, string>();
  if (old.length !== now.length) return out;
  old.forEach((id, i) => {
    const next = now[i];
    if (typeof id === "string" && typeof next === "string" && id !== next) out.set(id, next);
  });
  return out;
}

/**
 * The cards an imported file brings (`found`, by piece id) laid over those kept: what a card
 * already says stays, what it lacks comes from the file; its tasks are kept. Only the pieces whose
 * card changes are returned.
 */
export function mergeCards(
  kept: Readonly<Record<string, UpkeepCard>>,
  found: Readonly<Record<string, UpkeepCard>>,
): Record<string, UpkeepCard> {
  const out: Record<string, UpkeepCard> = {};
  for (const [piece, card] of Object.entries(found)) {
    const before = kept[piece] ?? {};
    // Changed only where the file says something the card does not.
    const adds = (Object.keys(card) as (keyof UpkeepCard)[]).some(
      (key) => card[key] !== undefined && before[key] === undefined,
    );
    if (adds) out[piece] = { ...card, ...before };
  }
  return out;
}
