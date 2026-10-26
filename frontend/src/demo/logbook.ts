/**
 * The demo house's logbook (D-058): what its Home Assistant recorded, answered as Home
 * Assistant's `logbook/get_events` answers (`homeassistant/components/logbook`): a row per state
 * change and per run, each with where its context began (its first row, or its parent's when it
 * is that first row), the user of its context, and a run's context id. Kept in memory, the oldest
 * rows going first.
 */
import type { HassContext } from "../ha/types";
import type { LogbookEntry } from "../live/why";

/** A row the demo records: a state change, or an event (a run, an action called, the demo's own
 * clock moved). Times in seconds. */
export interface Recorded {
  when: number;
  context: HassContext;
  /** A state change: the entity and its new state. */
  entity?: string;
  state?: string;
  /** An event, and what it says: the run's entity, name and trigger, the action called. */
  event?: "automation_triggered" | "script_started" | "call_service" | "demo_day";
  name?: string;
  source?: string;
  domain?: string;
  service?: string;
}

/** What the demo's logbook is asked: as `logbook/get_events` (times in ms). */
export interface DemoLogbookQuery {
  start: number;
  end?: number;
  entities?: readonly string[];
  context?: string;
}

/** The rows kept: a few hours of the demo's day as it plays. */
const MAX_ROWS = 6_000;

export class DemoLogbook {
  private rows: Recorded[] = [];

  /** Records a row (in the order things happen). */
  record(row: Recorded): void {
    this.rows.push(row);
    if (this.rows.length > MAX_ROWS) this.rows.splice(0, this.rows.length - MAX_ROWS);
  }

  /** The rows kept, to put back later (a measure leaves the house as it was, D-053). */
  kept(): Recorded[] {
    return this.rows.slice();
  }

  /** Puts back the rows `kept` gave. */
  restore(rows: readonly Recorded[]): void {
    this.rows = rows.slice();
  }

  /** The rows Home Assistant's logbook would give for `query`. */
  events(query: DemoLogbookQuery): LogbookEntry[] {
    const start = query.start / 1000;
    const end = query.end === undefined ? Infinity : query.end / 1000;
    const within = (row: Recorded): boolean => row.when >= start && row.when <= end;
    let shown: Recorded[];
    let lookup: Recorded[];
    if (query.entities) {
      const ids = new Set(query.entities);
      shown = this.rows.filter(
        (row) => within(row) && row.entity !== undefined && ids.has(row.entity),
      );
      // The rows of the same contexts, wherever they are in time, say where those began.
      const contexts = new Set(shown.map((row) => row.context.id));
      lookup = this.rows.filter((row) => contexts.has(row.context.id));
    } else if (query.context !== undefined) {
      shown = this.rows.filter((row) => within(row) && row.context.id === query.context);
      lookup = shown;
    } else {
      shown = this.rows.filter(within);
      lookup = shown;
    }
    // The first row of each context, as the logbook memorises it.
    const first = new Map<string, Recorded>();
    for (const row of lookup) if (!first.has(row.context.id)) first.set(row.context.id, row);
    const out: LogbookEntry[] = [];
    for (const row of shown) {
      const entry = this.entry(row);
      if (!entry) continue;
      let origin = first.get(row.context.id);
      if (origin === row) {
        // The row began its context: what set it off is its parent's first row.
        const parent = row.context.parent_id;
        origin = parent ? first.get(parent) : undefined;
      }
      if (origin && origin !== row) augment(entry, origin);
      const user = row.context.user_id ?? this.parentUser(row, Boolean(query.entities));
      if (user) entry.context_user_id = user;
      out.push(entry);
    }
    return out;
  }

  /** A row as the logbook shows it; nothing for an action called (only ever a context). */
  private entry(row: Recorded): LogbookEntry | undefined {
    if (row.entity !== undefined && row.state !== undefined && row.event === undefined) {
      return { when: row.when, entity_id: row.entity, state: row.state };
    }
    if (row.event === "automation_triggered") {
      return {
        when: row.when,
        name: row.name ?? "",
        message: row.source ? `triggered by ${row.source}` : "triggered",
        ...(row.source ? { source: row.source } : {}),
        entity_id: row.entity ?? "",
        context_id: row.context.id,
        domain: "automation",
      };
    }
    if (row.event === "script_started") {
      return {
        when: row.when,
        name: row.name ?? "",
        message: "started",
        entity_id: row.entity ?? "",
        context_id: row.context.id,
        domain: "script",
      };
    }
    return undefined;
  }

  /** Since 2026, a run's rows carry the user of the context that set it off, when filtered by
   * entity (Home Assistant looks the parent up then). */
  private parentUser(row: Recorded, byEntity: boolean): string | undefined {
    const parent = row.context.parent_id;
    if (!byEntity || !parent) return undefined;
    return (
      this.rows.find((r) => r.context.id === parent && r.context.user_id)?.context.user_id ??
      undefined
    );
  }
}

/** Where a row's context began, as the logbook says it (`ContextAugmenter.augment`). */
function augment(entry: LogbookEntry, origin: Recorded): void {
  if (origin.entity !== undefined && origin.event === undefined) {
    entry.context_entity_id = origin.entity;
    if (origin.state !== undefined) entry.context_state = origin.state;
    return;
  }
  switch (origin.event) {
    case "call_service":
      entry.context_event_type = "call_service";
      if (origin.domain) entry.context_domain = origin.domain;
      if (origin.service) entry.context_service = origin.service;
      return;
    case "automation_triggered":
    case "script_started":
      entry.context_event_type = origin.event;
      entry.context_domain = origin.event === "script_started" ? "script" : "automation";
      if (origin.name) entry.context_name = origin.name;
      if (origin.event === "automation_triggered") {
        entry.context_message = origin.source ? `triggered by ${origin.source}` : "triggered";
        if (origin.source) entry.context_source = origin.source;
      } else {
        entry.context_message = "started";
      }
      if (origin.entity) entry.context_entity_id = origin.entity;
      return;
    case "demo_day":
      // An integration's own event, described by it: the demo's day.
      entry.context_event_type = "demo_day";
      entry.context_domain = "domotwin";
      if (origin.name) entry.context_name = origin.name;
      return;
    default:
  }
}
