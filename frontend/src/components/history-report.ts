/**
 * `<domotwin-history>`: a report of Home Assistant's history (D-058): chosen entities over a
 * period, a row for each change or each hour, filtered by value and by how long, or the logbook
 * searched; as CSV. Read only, from Home Assistant's history, statistics and logbook commands;
 * nothing kept once closed. A chunk of its own, loaded the first time a report opens.
 */
import { mdiClose, mdiContentCopy, mdiOpenInNew, mdiPlus, mdiTrayArrowDown } from "@mdi/js";
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { live } from "lit/directives/live.js";

import { isHassError, nowOf, type HomeAssistant } from "../ha/types";
import { addMessages, translatorFor, type Translator } from "../i18n";
import { historyEn, historyFr } from "../i18n/history";
import { navigate } from "../live/actions";
import { areaOf, entityName } from "../live/bindings";
import {
  DAY_MS,
  HOUR,
  MAX_CHANGE_DAYS,
  MAX_REPORT_ENTITIES,
  NO_FILTER,
  SHOWN_ROWS,
  beyondKept,
  changeRows,
  filterProblem,
  filterRows,
  fromInputValue,
  haPagePath,
  hoursFromChanges,
  inputValue,
  logbookCsv,
  periodOf,
  periodProblem,
  readHistory,
  readLogbook,
  readStatistics,
  rowsCsv,
  searchLogbook,
  statisticsRows,
  totalTime,
  type Change,
  type Compare,
  type CsvNames,
  type LogEntry,
  type PeriodChoice,
  type ReportMode,
  type Row,
  type RowFilter,
} from "../live/history";
import { numberOf } from "../live/layers";
import { NOTHING_UNSEEN, seen, type Unseen } from "../live/privacy";
import { searchEntities } from "../live/rooms";
import { define, fire } from "./define";
import { fieldKeepsEscape } from "./dialog";
import { icon } from "./icon";
import { copyText, saveText } from "./save";
import { baseStyles } from "./styles";

addMessages({ en: historyEn, fr: historyFr });

const MODES: readonly ReportMode[] = ["changes", "hours", "logbook"];
const CHOICES: readonly PeriodChoice[] = ["day", "week", "month", "year", "custom"];
const COMPARES: readonly Compare[] = ["any", "above", "below", "equal", "not_equal"];
/** Entities a search offers at once. */
const FOUND = 8;

type Period = { start: number; end: number };

/**
 * What a report read: its rows (each hour's, with the entities that have no statistics: worked
 * out from their changes), or the logbook's entries.
 */
type ReportRead =
  | { mode: "changes"; period: Period; now: number; rows: Row[] }
  | { mode: "hours"; period: Period; now: number; rows: Row[]; worked: string[] }
  | { mode: "logbook"; period: Period; now: number; entries: LogEntry[] };

/**
 * Reads a report from Home Assistant: its history for the changes, its statistics for the hours
 * (its history for the entities that have none), its logbook.
 */
async function readReport(
  hass: HomeAssistant,
  mode: ReportMode,
  entities: string[],
  period: Period,
  now: number,
): Promise<ReportRead> {
  const connection = hass.connection;
  const span = {
    start_time: new Date(period.start).toISOString(),
    end_time: new Date(period.end).toISOString(),
  };
  if (mode === "logbook") {
    const answer = await connection.sendMessagePromise<unknown>({
      type: "logbook/get_events",
      ...span,
      entity_ids: entities,
    });
    return { mode, period, now, entries: readLogbook(answer) };
  }
  // The changes of `ids` from `start` to the period's end.
  const changesOf = async (ids: string[], start: number): Promise<Map<string, Change[]>> =>
    ids.length === 0
      ? new Map<string, Change[]>()
      : readHistory(
          await connection.sendMessagePromise<unknown>({
            type: "history/history_during_period",
            start_time: new Date(start).toISOString(),
            end_time: span.end_time,
            entity_ids: ids,
            include_start_time_state: true,
            significant_changes_only: true,
            minimal_response: true,
            no_attributes: true,
          }),
          start,
        );
  if (mode === "changes") {
    const changes = await changesOf(entities, period.start);
    const rows = entities.flatMap((id) => changeRows(id, changes.get(id) ?? [], period, now));
    return { mode, period, now, rows };
  }
  let statistics = readStatistics(undefined);
  try {
    statistics = readStatistics(
      await connection.sendMessagePromise<unknown>({
        type: "recorder/statistics_during_period",
        ...span,
        statistic_ids: entities,
        period: "hour",
        types: ["mean", "min", "max", "change"],
      }),
    );
  } catch {
    // No statistics (the recorder's are off): every hour is worked out from the history.
  }
  // Without statistics, the hours come from the changes: 31 days of them at most, as for the
  // changes themselves (a year of every state of a sensor is not asked for).
  const worked = entities.filter((id) => !statistics.has(id));
  const changes = await changesOf(
    worked,
    Math.max(period.start, period.end - MAX_CHANGE_DAYS * DAY_MS),
  );
  const rows = entities.flatMap((id) => {
    const hours = statistics.get(id);
    return hours
      ? statisticsRows(id, hours, period, now)
      : hoursFromChanges(id, changes.get(id) ?? [], period, now);
  });
  return { mode, period, now, rows, worked };
}

/** Why Home Assistant did not answer, in the viewer's words. */
function reasonOf(t: Translator, error: unknown): string {
  if (isHassError(error)) return error.message || t.error(error.code);
  return t.error(error instanceof Error ? error.name : "unknown");
}

/**
 * The decimals of an entity's means, lowest and highest: those Home Assistant shows it with
 * (`display_precision`), else those of its state as written now, one at least (a state of `22`
 * now does not round a mean of 21.6).
 */
function decimalsOf(hass: HomeAssistant, entity: string): number {
  const precision = hass.entities?.[entity]?.display_precision;
  if (typeof precision === "number") return precision;
  const match = /\.(\d+)$/.exec(hass.states[entity]?.state.trim() ?? "");
  return Math.min(3, Math.max(1, match?.[1]?.length ?? 0));
}

export class DomoTwinHistory extends LitElement {
  static override properties = {
    hass: { attribute: false },
    heading: { attribute: false },
    entities: { attribute: false },
    unseen: { attribute: false },
    opensOn: { attribute: false },
    chosen: { state: true },
    mode: { state: true },
    choice: { state: true },
    from: { state: true },
    to: { state: true },
    compare: { state: true },
    value: { state: true },
    of: { state: true },
    atLeast: { state: true },
    atLeastUnit: { state: true },
    query: { state: true },
    adding: { state: true },
    addQuery: { state: true },
    read: { state: true },
    loading: { state: true },
    error: { state: true },
    copied: { state: true },
  };

  hass?: HomeAssistant;
  /** What the report is of: a device's name, a room's. */
  heading = "";
  /** The entities it opens with. */
  entities: string[] = [];
  /** What the viewer may not see (D-039): the search leaves it out. */
  unseen: Unseen = NOTHING_UNSEEN;
  /** The period it opens on: a room's graphs' (D-069); the last day otherwise. */
  opensOn?: PeriodChoice;
  protected chosen: string[] = [];
  protected mode: ReportMode = "changes";
  protected choice: PeriodChoice = "day";
  /** The two dates and times, as their fields hold them (where the home is). */
  protected from = "";
  protected to = "";
  protected compare: Compare = "any";
  protected value = "";
  /** Whose rows a value filters, of several: one entity's (none chosen: the first), or all (`*`). */
  protected of = "";
  protected atLeast = "";
  protected atLeastUnit: "minutes" | "hours" = "minutes";
  /** The logbook's search. */
  protected query = "";
  protected adding = false;
  protected addQuery = "";
  protected read?: ReportRead;
  protected loading = false;
  protected error?: string;
  protected copied?: "done" | "manual";
  /** The text copied, shown to copy by hand where the clipboard was refused. */
  private copiedText = "";
  /** What was asked last, and which answer counts (one asked since makes it old). */
  private asked = "";
  private token = 0;
  /** The rows (or entries) the filter keeps, worked out when the answer or the filter change. */
  private kept?: { from: unknown[]; rows: Row[]; entries: LogEntry[] };

  static override styles = [
    baseStyles,
    css`
      :host {
        position: absolute;
        inset: 0;
        z-index: 5;
        display: flex;
        justify-content: center;
        /* At the top: it does not move while what it shows grows or shrinks. */
        align-items: flex-start;
        padding: 12px;
        box-sizing: border-box;
        pointer-events: none;
      }
      [role="dialog"] {
        pointer-events: auto;
        width: min(780px, 100%);
        max-height: 100%;
        display: flex;
        flex-direction: column;
        box-sizing: border-box;
      }
      header {
        flex: none;
        display: flex;
        align-items: center;
        gap: 8px;
        padding-block: 8px 0;
        padding-inline: 20px 8px;
      }
      h2 {
        flex: 1;
        min-width: 0;
        margin: 0;
        font-size: 1.1rem;
        font-weight: 600;
        overflow-wrap: anywhere;
      }
      button.round {
        width: 40px;
        height: 40px;
        display: grid;
        place-items: center;
        border: none;
        border-radius: 50%;
        background: transparent;
        color: inherit;
        cursor: pointer;
      }
      .scroll {
        overflow: auto;
        padding: 4px 20px 8px;
        font-size: 0.9rem;
      }
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin: 8px 0;
        padding: 0;
        list-style: none;
      }
      .chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        min-height: 36px;
        padding-block: 0;
        padding-inline: 12px 4px;
        border-radius: 18px;
        background: color-mix(in srgb, var(--primary-color, #03a9f4) 12%, transparent);
      }
      .chip button {
        width: 32px;
        height: 32px;
        display: grid;
        place-items: center;
        border: none;
        border-radius: 50%;
        background: transparent;
        color: inherit;
        cursor: pointer;
      }
      .chip svg.icon {
        width: 16px;
        height: 16px;
      }
      button.add {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        min-height: 36px;
        padding-block: 0;
        padding-inline: 8px 12px;
        border: 1px dashed var(--divider-color, rgba(0, 0, 0, 0.25));
        border-radius: 18px;
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }
      ul.found {
        margin: 4px 0 8px;
        padding: 0;
        list-style: none;
        display: grid;
        gap: 2px;
      }
      ul.found button {
        width: 100%;
        display: flex;
        align-items: baseline;
        gap: 8px;
        min-height: 40px;
        padding: 4px 8px;
        border: none;
        border-radius: 8px;
        background: transparent;
        color: inherit;
        font: inherit;
        text-align: start;
        cursor: pointer;
      }
      ul.found button:hover {
        background: color-mix(in srgb, var(--primary-color, #03a9f4) 10%, transparent);
      }
      small,
      .note {
        color: var(--secondary-text-color, #5f6368);
      }
      .row {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: 8px 12px;
        margin: 8px 0;
      }
      label.field {
        display: flex;
        flex-direction: column;
        gap: 2px;
        font-size: 0.8rem;
        color: var(--secondary-text-color, #5f6368);
      }
      label.field.wide {
        flex: 1 1 240px;
      }
      input,
      select {
        min-height: 36px;
        box-sizing: border-box;
        padding: 0 8px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.25));
        border-radius: 8px;
        background: var(--card-background-color, #fff);
        color: var(--primary-text-color, #1f2328);
        font-size: 0.9rem;
      }
      input.number {
        width: 6.5em;
      }
      .modes {
        display: inline-flex;
        flex-wrap: wrap;
        gap: 4px;
        padding: 3px;
        border-radius: 999px;
        background: color-mix(in srgb, var(--primary-text-color, #1f2328) 6%, transparent);
      }
      .modes button {
        min-height: 34px;
        padding: 0 14px;
        border: none;
        border-radius: 999px;
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }
      .modes button[aria-pressed="true"] {
        background: var(--primary-color, #03a9f4);
        color: var(--text-primary-color, #fff);
      }
      .summary {
        margin: 12px 0 4px;
        font-weight: 600;
      }
      .table {
        overflow-x: auto;
        margin: 4px 0;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-variant-numeric: tabular-nums;
      }
      th,
      td {
        padding: 6px 8px;
        border-bottom: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        text-align: start;
        vertical-align: top;
      }
      th {
        font-size: 0.75rem;
        font-weight: 600;
        letter-spacing: 0.03em;
        text-transform: uppercase;
        color: var(--secondary-text-color, #5f6368);
        background: var(--card-background-color, #fff);
        white-space: nowrap;
      }
      td.time {
        white-space: nowrap;
      }
      .error {
        color: var(--error-color, #db4437);
      }
      textarea {
        width: 100%;
        box-sizing: border-box;
        min-height: 7em;
        font:
          0.8rem/1.4 ui-monospace,
          monospace;
        resize: vertical;
      }
      .footer {
        flex: none;
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 8px;
        padding: 8px 20px 16px;
      }
    `,
  ];

  private get t(): Translator {
    return translatorFor(this.hass);
  }

  /** Escape closes it, as it closes a sheet, wherever the focus is but in a field. */
  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && !fieldKeepsEscape(event)) this.close();
  };

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("keydown", this.onKey);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("keydown", this.onKey);
  }

  /**
   * Only a change of language draws it again, not each new state of the home: what it shows was
   * read when it was asked for.
   */
  protected override shouldUpdate(changed: PropertyValues): boolean {
    if (changed.size === 1 && changed.has("hass")) {
      const before = changed.get("hass") as HomeAssistant | undefined;
      return !before || translatorFor(before).language !== this.t.language;
    }
    return true;
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has("entities")) this.chosen = this.entities.slice(0, MAX_REPORT_ENTITIES);
    if (changed.has("opensOn") && this.opensOn) this.choice = this.opensOn;
    // A room that turned private takes its entities away (D-039).
    const viewer = this.hass;
    if (viewer && (changed.has("unseen") || changed.has("entities"))) {
      const shown = this.chosen.filter((id) => seen(this.unseen, id, areaOf(viewer, id)));
      if (shown.length !== this.chosen.length) this.chosen = shown;
    }
    // What was copied is no longer what the table shows.
    if (
      ["compare", "value", "of", "atLeast", "atLeastUnit", "query"].some((key) => changed.has(key))
    ) {
      this.copied = undefined;
    }
    const hass = this.hass;
    if (!hass) return;
    if (this.choice === "custom" && (this.from === "" || this.to === "")) {
      // The dates start as the last 24 hours, where the home is.
      const now = nowOf(hass);
      const zone = hass.config?.time_zone;
      this.from ||= inputValue(now - DAY_MS, zone);
      this.to ||= inputValue(now, zone);
    }
    const asked = [this.mode, this.choice, this.from, this.to, ...this.chosen].join("\n");
    if (asked !== this.asked) {
      this.asked = asked;
      void this.ask();
    }
  }

  /** The period chosen, where the home is; none when its dates are not one. */
  private period(now: number): Period | undefined {
    const zone = this.hass?.config?.time_zone;
    return periodOf(
      this.choice,
      now,
      fromInputValue(this.from, zone),
      fromInputValue(this.to, zone),
    );
  }

  /** Asks Home Assistant for what is chosen; an answer to an older question is let go. */
  private async ask(): Promise<void> {
    const hass = this.hass;
    if (!hass) return;
    const token = ++this.token;
    this.read = undefined;
    this.error = undefined;
    this.copied = undefined;
    const now = nowOf(hass);
    const period = this.period(now);
    if (this.chosen.length === 0 || periodProblem(this.mode, period) || !period) {
      this.loading = false;
      return;
    }
    this.loading = true;
    try {
      const read = await readReport(hass, this.mode, [...this.chosen], period, now);
      if (token === this.token) this.read = read;
    } catch (error) {
      if (token === this.token) {
        this.error = this.t.t("report.failed", { reason: reasonOf(this.t, error) });
      }
    } finally {
      if (token === this.token) this.loading = false;
    }
  }

  /** The filter as set: its value, and how long at least (ms). */
  private filter(): RowFilter {
    if (this.mode === "logbook") return NO_FILTER;
    const amount = numberOf(this.atLeast.trim());
    const unit = this.atLeastUnit === "hours" ? HOUR : 60_000;
    return {
      compare: this.compare,
      value: this.value,
      atLeast: amount !== undefined && amount > 0 ? amount * unit : 0,
    };
  }

  /** The entity a value filters (none: every one). */
  private filtered(): string | undefined {
    if (this.compare === "any" || this.of === "*" || this.chosen.length < 2) return undefined;
    return this.chosen.includes(this.of) ? this.of : this.chosen[0];
  }

  /** The rows or entries the filter or the search keeps, oldest first. */
  private keptNow(): { rows: Row[]; entries: LogEntry[] } {
    const read = this.read;
    const filter = this.filter();
    const of = this.filtered();
    const from = [read, filter.compare, filter.value, filter.atLeast, this.query, of];
    const kept = this.kept;
    if (kept && from.every((value, i) => value === kept.from[i])) return kept;
    let rows: Row[] = [];
    let entries: LogEntry[] = [];
    if (read?.mode === "logbook") {
      entries = searchLogbook(read.entries, this.query, (entry) => this.entryWords(entry));
    } else if (read && !filterProblem(filter)) {
      const source = of === undefined ? read.rows : read.rows.filter((row) => row.entity === of);
      rows = filterRows(source, filter, (row) =>
        row.state === undefined ? undefined : this.stateText(row.entity, row.state),
      );
    }
    this.kept = { from, rows, entries };
    return this.kept;
  }

  private close(): void {
    fire(this, "domotwin-close", undefined);
  }

  /** A state as Home Assistant shows it, with its unit; as stored where it cannot. */
  private stateText(entity: string, state: string): string {
    const hass = this.hass;
    const shown = hass?.states[entity];
    if (hass?.formatEntityState && shown) {
      try {
        return hass.formatEntityState(shown, state);
      } catch {
        // As stored, below.
      }
    }
    if (state === "unavailable" || state === "unknown") return this.t.t("controls.unavailable");
    const unit = shown?.attributes.unit_of_measurement;
    const value = numberOf(state);
    if (value !== undefined) {
      const text = new Intl.NumberFormat(this.t.language, { maximumFractionDigits: 3 }).format(
        value,
      );
      return typeof unit === "string" ? `${text} ${unit}` : text;
    }
    return state;
  }

  /** A number of an entity (a mean, a lowest), as precisely as Home Assistant shows it. */
  private numberText(entity: string, value: number): string {
    const decimals = this.hass ? decimalsOf(this.hass, entity) : 1;
    return this.stateText(entity, value.toFixed(decimals));
  }

  /** How long, in two units at most: `2 d 3 h`, `1 h 20 min`, `45 min`, `30 s`. */
  private duration(ms: number): string {
    const t = this.t;
    const seconds = Math.max(0, Math.round(ms / 1000));
    const days = Math.floor(seconds / 86_400);
    const hours = Math.floor((seconds % 86_400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const parts: string[] = [];
    if (days > 0) {
      parts.push(t.t("report.duration.days", { count: days }));
      if (hours > 0) parts.push(t.t("report.duration.hours", { count: hours }));
    } else if (hours > 0) {
      parts.push(t.t("report.duration.hours", { count: hours }));
      if (minutes > 0) parts.push(t.t("report.duration.minutes", { count: minutes }));
    } else if (minutes > 0) {
      parts.push(t.t("report.duration.minutes", { count: minutes }));
    } else {
      parts.push(t.t("report.duration.seconds", { count: seconds }));
    }
    return parts.join(" ");
  }

  private time(ms: number): string {
    return new Intl.DateTimeFormat(this.t.language, {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: this.hass?.config?.time_zone,
    }).format(new Date(ms));
  }

  /** What a row shows in its Value column. */
  private valueText(row: Row): string {
    const t = this.t;
    const number = (value: number): string => this.numberText(row.entity, value);
    if (row.kind === "change")
      return row.state === undefined ? "" : this.stateText(row.entity, row.state);
    if (row.mean !== undefined && row.min !== undefined && row.max !== undefined) {
      if (row.kind === "period") {
        const [min, max] = [number(row.min), number(row.max)];
        return min === max ? min : t.t("report.range", { min, max });
      }
      const mean = number(row.mean);
      const [min, max] = [number(row.min), number(row.max)];
      return min === max ? mean : t.t("report.mean_range", { mean, min, max });
    }
    if (row.mean !== undefined) return number(row.mean);
    if (row.change !== undefined) return number(row.change);
    if (row.state === undefined) return "";
    const state = this.stateText(row.entity, row.state);
    return row.held === undefined
      ? state
      : t.t("report.held", { state, time: this.duration(row.held) });
  }

  /** What caused a logbook entry, in words. */
  private causeText(entry: LogEntry): string {
    const hass = this.hass;
    const cause = entry.cause;
    if (!hass || !cause) return "";
    if (cause.name) return cause.name;
    if (cause.entity) return entityName(hass, cause.entity);
    if (cause.user) {
      const person = Object.values(hass.states).find(
        (state) =>
          state?.entity_id.startsWith("person.") && state.attributes.user_id === cause.user,
      );
      return person ? entityName(hass, person.entity_id) : this.t.t("report.someone");
    }
    return cause.service ?? "";
  }

  /** What a logbook entry says: its state as shown, or its event's name and words. */
  private entryText(entry: LogEntry): string {
    if (entry.state !== undefined && entry.entity) return this.stateText(entry.entity, entry.state);
    return [entry.name, entry.message].filter(Boolean).join(" ");
  }

  /** Every word a search of the logbook looks through. */
  private entryWords(entry: LogEntry): string {
    const hass = this.hass;
    return [
      entry.entity && hass ? entityName(hass, entry.entity) : "",
      entry.entity ?? "",
      entry.state ?? "",
      this.entryText(entry),
      this.causeText(entry),
      entry.cause?.entity ?? "",
    ].join(" ");
  }

  private names(): CsvNames {
    const hass = this.hass;
    return {
      name: (entity) => (hass ? entityName(hass, entity) : entity),
      unit: (entity) => {
        const unit = hass?.states[entity]?.attributes.unit_of_measurement;
        return typeof unit === "string" ? unit : undefined;
      },
    };
  }

  /** What the CSV holds: every row or entry kept, not only those shown. */
  private csv(): string {
    const kept = this.keptNow();
    return this.read?.mode === "logbook"
      ? logbookCsv(kept.entries, this.names(), (entry) => this.causeText(entry))
      : rowsCsv(kept.rows, this.names());
  }

  /** The CSV, saved by the browser as Home Assistant's History saves its own. */
  private download(): void {
    const read = this.read;
    if (!read) return;
    const day = inputValue(read.period.end, this.hass?.config?.time_zone).slice(0, 10);
    saveText(`history-${read.mode}-${day}.csv`, this.csv(), "text/csv;charset=utf-8");
  }

  private async copy(): Promise<void> {
    this.copiedText = this.csv();
    // Some companion apps refuse the clipboard: the text is then selected to copy by hand.
    await copyText(this.copiedText, this, (copied) => (this.copied = copied));
  }

  private add(entity: string): void {
    if (this.chosen.includes(entity) || this.chosen.length >= MAX_REPORT_ENTITIES) return;
    this.chosen = [...this.chosen, entity];
    this.addQuery = "";
    this.adding = this.chosen.length < MAX_REPORT_ENTITIES;
  }

  private async takeAway(entity: string): Promise<void> {
    this.chosen = this.chosen.filter((id) => id !== entity);
    // Its cross is gone with it: the focus stays in the report, on the way to add one.
    await this.updateComplete;
    const root = this.renderRoot;
    (
      root.querySelector<HTMLElement>('[data-testid="history-add"]') ??
      root.querySelector<HTMLElement>('[role="dialog"]')
    )?.focus({ preventScroll: true });
  }

  protected override render(): TemplateResult | typeof nothing {
    const hass = this.hass;
    if (!hass) return nothing;
    const t = this.t;
    return html`<div
      class="glass"
      role="dialog"
      aria-labelledby="history-title"
      tabindex="-1"
      data-testid="history"
    >
      <header>
        <h2 id="history-title">${t.t("report.title", { name: this.heading })}</h2>
        <button
          class="round"
          data-cancel
          aria-label=${t.t("report.close")}
          @click=${() => {
            this.close();
          }}
        >
          ${icon(mdiClose)}
        </button>
      </header>
      <div class="scroll">
        ${this.renderEntities(hass, t)} ${this.renderQuery(t)} ${this.renderResult(hass, t)}
        ${
          this.copied === "manual"
            ? html`<p class="note">${t.t("report.copy_manual")}</p>
                <textarea readonly data-testid="history-text" .value=${this.copiedText}></textarea>`
            : nothing
        }
      </div>
      ${this.renderFooter(hass, t)}
    </div>`;
  }

  /** The entities chosen, each taken away with its cross, and the search that adds one. */
  private renderEntities(hass: HomeAssistant, t: Translator): TemplateResult {
    const full = this.chosen.length >= MAX_REPORT_ENTITIES;
    const found =
      this.adding && this.addQuery.trim() !== ""
        ? searchEntities(
            hass,
            this.addQuery,
            this.unseen,
            new Intl.Collator(t.language),
            FOUND + this.chosen.length,
          )
            .filter((id) => !this.chosen.includes(id))
            .slice(0, FOUND)
        : [];
    return html`<ul class="chips" aria-label=${t.t("report.entities")}>
        ${this.chosen.map((id) => {
          const name = entityName(hass, id);
          return html`<li class="chip" data-entity=${id}>
            ${name}
            <button
              aria-label=${t.t("report.remove", { name })}
              @click=${() => {
                void this.takeAway(id);
              }}
            >
              ${icon(mdiClose)}
            </button>
          </li>`;
        })}
        <li>
          ${
            full
              ? html`<small>${t.t("report.full")}</small>`
              : html`<button
                  class="add"
                  data-testid="history-add"
                  aria-expanded=${this.adding ? "true" : "false"}
                  @click=${async () => {
                    this.adding = !this.adding;
                    await this.updateComplete;
                    this.renderRoot.querySelector<HTMLElement>(".find")?.focus();
                  }}
                >
                  ${icon(mdiPlus)}${t.t("report.add")}
                </button>`
          }
        </li>
      </ul>
      ${
        this.adding && !full
          ? html`<input
                class="find"
                type="search"
                data-testid="history-find"
                aria-label=${t.t("report.search")}
                placeholder=${t.t("report.search")}
                .value=${live(this.addQuery)}
                @input=${(event: Event) => {
                  this.addQuery = (event.target as HTMLInputElement).value;
                }}
              />
              ${
                found.length > 0
                  ? html`<ul class="found" data-testid="history-found">
                      ${found.map(
                        (id) =>
                          html`<li>
                            <button
                              data-entity=${id}
                              @click=${() => {
                                this.add(id);
                              }}
                            >
                              ${entityName(hass, id)}<small>${id}</small>
                            </button>
                          </li>`,
                      )}
                    </ul>`
                  : this.addQuery.trim() !== ""
                    ? html`<p class="note">${t.t("report.no_match")}</p>`
                    : nothing
              }`
          : nothing
      }`;
  }

  /** The period, how to read it, and the filter or the search. */
  private renderQuery(t: Translator): TemplateResult {
    return html`<div class="row">
        <label class="field">
          <span>${t.t("report.period")}</span>
          <select
            data-testid="history-period"
            @change=${(event: Event) => {
              this.choice = (event.target as HTMLSelectElement).value as PeriodChoice;
            }}
          >
            ${CHOICES.map(
              (choice) =>
                html`<option value=${choice} ?selected=${choice === this.choice}>
                  ${t.t(`report.periods.${choice}`)}
                </option>`,
            )}
          </select>
        </label>
        ${
          this.choice === "custom"
            ? html`<label class="field">
                  <span>${t.t("report.from")}</span>
                  <input
                    type="datetime-local"
                    data-testid="history-from"
                    .value=${live(this.from)}
                    @change=${(event: Event) => {
                      this.from = (event.target as HTMLInputElement).value;
                    }}
                  />
                </label>
                <label class="field">
                  <span>${t.t("report.to")}</span>
                  <input
                    type="datetime-local"
                    data-testid="history-to"
                    .value=${live(this.to)}
                    @change=${(event: Event) => {
                      this.to = (event.target as HTMLInputElement).value;
                    }}
                  />
                </label>`
            : nothing
        }
      </div>
      <div class="row">
        <div class="modes" role="group" aria-label=${t.t("report.read_as")}>
          ${MODES.map(
            (mode) =>
              html`<button
                data-mode=${mode}
                aria-pressed=${mode === this.mode ? "true" : "false"}
                @click=${() => {
                  this.mode = mode;
                }}
              >
                ${t.t(`report.modes.${mode}`)}
              </button>`,
          )}
        </div>
      </div>
      ${this.mode === "logbook" ? this.renderSearch(t) : this.renderFilter(t)}`;
  }

  private renderSearch(t: Translator): TemplateResult {
    return html`<div class="row">
      <label class="field wide">
        <span>${t.t("report.search_logbook")}</span>
        <input
          type="search"
          data-testid="history-query"
          placeholder=${t.t("report.search_hint")}
          .value=${live(this.query)}
          @input=${(event: Event) => {
            this.query = (event.target as HTMLInputElement).value;
          }}
        />
      </label>
    </div>`;
  }

  private renderFilter(t: Translator): TemplateResult {
    return html`<div class="row">
      <label class="field">
        <span>${t.t("report.value")}</span>
        <select
          data-testid="history-compare"
          @change=${(event: Event) => {
            this.compare = (event.target as HTMLSelectElement).value as Compare;
          }}
        >
          ${COMPARES.map(
            (compare) =>
              html`<option value=${compare} ?selected=${compare === this.compare}>
                ${t.t(`report.compare.${compare}`)}
              </option>`,
          )}
        </select>
      </label>
      ${
        this.compare === "any"
          ? nothing
          : html`<input
              class="number"
              data-testid="history-value"
              aria-label=${t.t("report.value")}
              placeholder=${t.t("report.value_placeholder")}
              inputmode=${this.compare === "above" || this.compare === "below" ? "decimal" : "text"}
              .value=${live(this.value)}
              @input=${(event: Event) => {
                this.value = (event.target as HTMLInputElement).value;
              }}
            />`
      }
      ${this.compare !== "any" && this.chosen.length > 1 ? this.renderOf(t) : nothing}
      <label class="field">
        <span>${t.t("report.at_least")}</span>
        <input
          class="number"
          type="number"
          min="0"
          step="any"
          data-testid="history-at-least"
          .value=${live(this.atLeast)}
          @input=${(event: Event) => {
            this.atLeast = (event.target as HTMLInputElement).value;
          }}
        />
      </label>
      <select
        data-testid="history-unit"
        aria-label=${t.t("report.at_least")}
        @change=${(event: Event) => {
          this.atLeastUnit = (event.target as HTMLSelectElement).value as "minutes" | "hours";
        }}
      >
        <option value="minutes" ?selected=${this.atLeastUnit === "minutes"}>
          ${t.t("report.units.minutes")}
        </option>
        <option value="hours" ?selected=${this.atLeastUnit === "hours"}>
          ${t.t("report.units.hours")}
        </option>
      </select>
    </div>`;
  }

  /** Whose rows a value filters, of the entities chosen. */
  private renderOf(t: Translator): TemplateResult {
    const hass = this.hass;
    const of = this.filtered() ?? "*";
    return html`<label class="field">
      <span>${t.t("report.of")}</span>
      <select
        data-testid="history-of"
        @change=${(event: Event) => {
          this.of = (event.target as HTMLSelectElement).value;
        }}
      >
        ${this.chosen.map(
          (id) =>
            html`<option value=${id} ?selected=${id === of}>
              ${hass ? entityName(hass, id) : id}
            </option>`,
        )}
        <option value="*" ?selected=${of === "*"}>${t.t("report.of_all")}</option>
      </select>
    </label>`;
  }

  /** What was found: a line saying how much, then the table, newest first. */
  private renderResult(hass: HomeAssistant, t: Translator): TemplateResult {
    if (this.chosen.length === 0) return html`<p class="note">${t.t("report.no_entity")}</p>`;
    const now = nowOf(hass);
    const period = this.period(now);
    const problem = periodProblem(this.mode, period);
    if (problem) {
      return html`<p class="note" role="alert" data-testid="history-problem">
        ${t.t(problem === "too_long" ? "report.too_long" : "report.no_period")}
      </p>`;
    }
    const filter = this.filter();
    const wrong = filterProblem(filter);
    if (wrong) {
      return html`<p class="note" role="alert" data-testid="history-problem">
        ${t.t(wrong === "number_needed" ? "report.number_needed" : "report.value_needed")}
      </p>`;
    }
    if (this.error) {
      return html`<p class="error" role="alert" data-testid="history-error">${this.error}</p>`;
    }
    const read = this.read;
    if (this.loading || !read) {
      return html`<p class="note" role="status">${t.t("report.loading")}</p>`;
    }
    const notes: TemplateResult[] = [];
    if (hass.demo) notes.push(html`<p class="note">${t.t("report.demo")}</p>`);
    if (read.mode === "changes" && beyondKept(read.period, read.now)) {
      notes.push(html`<p class="note" data-testid="history-kept">${t.t("report.kept")}</p>`);
    }
    if (read.mode === "hours" && read.worked.length > 0 && beyondKept(read.period, read.now)) {
      const names = read.worked.map((id) => entityName(hass, id)).join(", ");
      notes.push(
        html`<p class="note" data-testid="history-kept">
          ${t.t("report.no_statistics", { names })}
        </p>`,
      );
    }
    if (read.mode === "logbook") {
      // Sensors with a unit: Home Assistant's logbook leaves them out.
      const left = this.chosen.filter(
        (id) =>
          id.startsWith("sensor.") &&
          typeof hass.states[id]?.attributes.unit_of_measurement === "string",
      );
      if (left.length > 0) {
        const names = left.map((id) => entityName(hass, id)).join(", ");
        notes.push(
          html`<p class="note" data-testid="history-left">
            ${t.t("report.measurements_out", { names })}
          </p>`,
        );
      }
    }
    const kept = this.keptNow();
    return html`${notes}${read.mode === "logbook" ? this.renderEntries(hass, t, kept.entries) : this.renderRows(hass, t, kept.rows, filter)}`;
  }

  private renderRows(
    hass: HomeAssistant,
    t: Translator,
    rows: Row[],
    filter: RowFilter,
  ): TemplateResult {
    const filtered = filter.compare !== "any" || filter.atLeast > 0;
    if (rows.length === 0) {
      return html`<p class="note" data-testid="history-summary">
        ${t.t(filtered ? "report.empty_filtered" : "report.empty")}
      </p>`;
    }
    const noun =
      filter.compare !== "any"
        ? t.tp("report.periods_found", rows.length)
        : this.mode === "hours"
          ? t.tp("report.hours", rows.length)
          : t.tp("report.changes", rows.length);
    const summary = filtered
      ? t.t("report.in_all", { rows: noun, time: this.duration(totalTime(rows)) })
      : noun;
    const many = this.chosen.length > 1;
    // Hours alone need no end nor length: an hour each.
    const hours = rows.every((row) => row.kind === "hour");
    const shown = rows.slice(-SHOWN_ROWS).reverse();
    return html`<p class="summary" data-testid="history-summary">${summary}</p>
      ${
        rows.length > SHOWN_ROWS
          ? html`<p class="note">${t.t("report.shown_first", { shown: SHOWN_ROWS })}</p>`
          : nothing
      }
      <div class="table">
        <table data-testid="history-table">
          <thead>
            <tr>
              <th scope="col">${t.t("report.columns.from")}</th>
              ${
                hours
                  ? nothing
                  : html`<th scope="col">${t.t("report.columns.to")}</th>
                      <th scope="col">${t.t("report.columns.lasted")}</th>`
              }
              ${many ? html`<th scope="col">${t.t("report.columns.entity")}</th>` : nothing}
              <th scope="col">${t.t("report.columns.value")}</th>
            </tr>
          </thead>
          <tbody>
            ${shown.map(
              (row) =>
                html`<tr data-entity=${row.entity} data-kind=${row.kind}>
                  <td class="time">${this.time(row.start)}</td>
                  ${
                    hours
                      ? nothing
                      : html`<td class="time">
                            ${row.ongoing ? t.t("report.now") : this.time(row.end)}
                          </td>
                          <td class="time">${this.duration(row.end - row.start)}</td>`
                  }
                  ${many ? html`<td>${entityName(hass, row.entity)}</td>` : nothing}
                  <td>${this.valueText(row)}</td>
                </tr>`,
            )}
          </tbody>
        </table>
      </div>`;
  }

  private renderEntries(hass: HomeAssistant, t: Translator, entries: LogEntry[]): TemplateResult {
    if (entries.length === 0) {
      return html`<p class="note" data-testid="history-summary">
        ${t.t(this.query.trim() ? "report.empty_filtered" : "report.empty")}
      </p>`;
    }
    const many = this.chosen.length > 1;
    const shown = entries.slice(-SHOWN_ROWS).reverse();
    return html`<p class="summary" data-testid="history-summary">
        ${t.tp("report.entries", entries.length)}
      </p>
      ${
        entries.length > SHOWN_ROWS
          ? html`<p class="note">${t.t("report.shown_first", { shown: SHOWN_ROWS })}</p>`
          : nothing
      }
      <div class="table">
        <table data-testid="history-table">
          <thead>
            <tr>
              <th scope="col">${t.t("report.columns.when")}</th>
              ${many ? html`<th scope="col">${t.t("report.columns.entity")}</th>` : nothing}
              <th scope="col">${t.t("report.columns.what")}</th>
              <th scope="col">${t.t("report.columns.by")}</th>
            </tr>
          </thead>
          <tbody>
            ${shown.map(
              (entry) =>
                html`<tr data-entity=${entry.entity ?? ""}>
                  <td class="time">${this.time(entry.when)}</td>
                  ${
                    many
                      ? html`<td>${entry.entity ? entityName(hass, entry.entity) : ""}</td>`
                      : nothing
                  }
                  <td>${this.entryText(entry)}</td>
                  <td>${this.causeText(entry)}</td>
                </tr>`,
            )}
          </tbody>
        </table>
      </div>`;
  }

  private renderFooter(hass: HomeAssistant, t: Translator): TemplateResult {
    const read = this.read;
    const ready = read !== undefined && !this.loading;
    return html`<div class="footer">
      ${
        // Home Assistant's own pages know the home's entities, not the demo's (D-050).
        read && !hass.demo
          ? html`<button
              class="action quiet"
              data-testid="history-open"
              @click=${() => {
                navigate(
                  haPagePath(
                    read.mode === "logbook" ? "logbook" : "history",
                    this.chosen,
                    read.period,
                  ),
                );
              }}
            >
              ${icon(mdiOpenInNew)}${t.t(read.mode === "logbook" ? "report.open_logbook" : "report.open_history")}
            </button>`
          : nothing
      }
      <button
        class="action quiet"
        data-testid="history-copy"
        ?disabled=${!ready}
        @click=${() => void this.copy()}
      >
        ${icon(mdiContentCopy)}${t.t(this.copied === "done" ? "report.copied" : "report.copy")}
      </button>
      <button
        class="action"
        data-testid="history-csv"
        ?disabled=${!ready}
        @click=${() => {
          this.download();
        }}
      >
        ${icon(mdiTrayArrowDown)}${t.t("report.csv")}
      </button>
    </div>`;
  }
}

define("domotwin-history", DomoTwinHistory);

declare global {
  interface HTMLElementTagNameMap {
    "domotwin-history": DomoTwinHistory;
  }
}
