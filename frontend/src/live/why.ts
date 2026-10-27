/**
 * Why a device is as it is (`DECISIONS.md`, D-059): who or what last changed its state, as a
 * chain from what started it to the change. Read as Home Assistant's own Activity reads it: the
 * state's context, the logbook's rows of that context (`logbook/get_events`), the automation or
 * script that ran in it and what set that off, followed back through the state changes that set
 * off automations; for administrators, the traces of the runs (`trace/contexts`). Only what Home
 * Assistant recorded: a change it did not attribute says so. Loaded with the device's sheet.
 */
import { isEntityId, type HassContext, type HassMessage, type HomeAssistant } from "../ha/types";

/** A row of Home Assistant's logbook, as `logbook/get_events` gives it (`when` in seconds). */
export interface LogbookEntry {
  when: number;
  entity_id?: string;
  state?: string;
  name?: string;
  message?: string;
  domain?: string;
  /** What set an automation off, in Home Assistant's words (`state of binary_sensor.hall`). */
  source?: string;
  /** Only on the rows of runs (an automation triggered, a script started). */
  context_id?: string;
  context_user_id?: string;
  /** Where the row's context began, when it was not the row itself. */
  context_event_type?: string;
  context_domain?: string;
  context_service?: string;
  context_entity_id?: string;
  context_state?: string;
  context_name?: string;
  context_source?: string;
  context_message?: string;
}

/** What one step of a chain is. */
export type WhyKind =
  /** Someone signed in to Home Assistant (`user`), with the action they called (`service`). */
  | "person"
  /** An entity's state changed (`entity`, `state`). */
  | "change"
  /** An automation or a script ran (`entity`, `context`). */
  | "automation"
  | "script"
  /** An action called with nobody signed in (`service`). */
  | "action"
  /** A time, or a time pattern, set an automation off. */
  | "time"
  /** The sun set an automation off (`text`: `sunrise`, `sunset` or another of its events). */
  | "sun"
  /** Home Assistant starting or stopping (`text`: `starting`, `stopping`). */
  | "start"
  /** An event set an automation off (`text`: its type). */
  | "event"
  /** Another trigger, in Home Assistant's words (`text`). */
  | "trigger"
  /** An integration's event (`text`: its name, `service`: its domain). */
  | "integration"
  /** The change began with itself: on the device itself, or by its integration. */
  | "unattributed"
  /** Something set it off that the logbook does not have (any more). */
  | "lost";

export interface WhyStep {
  kind: WhyKind;
  entity?: string;
  state?: string;
  /** When it happened (ms). */
  when?: number;
  user?: string;
  service?: string;
  text?: string;
  /** The context a run ran in: its trace, for administrators. */
  context?: string;
}

/** Why a device is as it is: from what started it to the device's change (the last step). */
export interface WhyChain {
  steps: WhyStep[];
  /** The logbook could not be read: the chain is what the state alone says. */
  unread?: boolean;
  /** Followed back as far as DomoTwin goes: what came before is not looked for. */
  cut?: boolean;
}

/** What is asked of the logbook: a time span (ms), and entities or a context. */
export interface LogbookQuery {
  start: number;
  end?: number;
  entities?: string[];
  context?: string;
}

export type LogbookReader = (query: LogbookQuery) => Promise<LogbookEntry[]>;

/** A delayed run can start long before what it changes: how far back it is looked for (ms). */
const LOOKBACK_MS = 24 * 3_600_000;
/** Two rows of the logbook at the same time (s), as Home Assistant compares them. */
const SAME_WHEN = 0.001;
/** A state's `last_changed` (to the millisecond) and its row of the logbook (s). */
const SAME_CHANGE = 1;
/** The runs of an automation looked at to find the one a change happened in. */
const RUN_CANDIDATES = 3;
/** The changes followed back, the device's included. */
const MAX_CHANGES = 6;

const TEXT_FIELDS = [
  "entity_id",
  "state",
  "name",
  "message",
  "domain",
  "source",
  "context_id",
  "context_user_id",
  "context_event_type",
  "context_domain",
  "context_service",
  "context_entity_id",
  "context_state",
  "context_name",
  "context_source",
  "context_message",
] as const;

/** A row of the logbook read leniently: its time, and the texts it has; else nothing. */
export function readEntry(value: unknown): LogbookEntry | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.when !== "number" || !Number.isFinite(raw.when)) return undefined;
  const entry: LogbookEntry = { when: raw.when };
  for (const field of TEXT_FIELDS) {
    const text = raw[field];
    if (typeof text === "string") entry[field] = text;
  }
  return entry;
}

/** A context id as Home Assistant writes them (a ULID): any other, it reads as none, and would
 * answer every row of the time asked. */
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

/** The logbook of `hass`, through Home Assistant's `logbook/get_events` (open to every user). */
export function logbookReader(hass: HomeAssistant): LogbookReader {
  return async (query) => {
    // The demo house's ids are its own (D-059); its logbook knows them.
    if (query.context !== undefined && !hass.demo && !ULID.test(query.context)) return [];
    const message: HassMessage = {
      type: "logbook/get_events",
      start_time: new Date(query.start).toISOString(),
    };
    if (query.end !== undefined) message.end_time = new Date(query.end).toISOString();
    if (query.entities) message.entity_ids = query.entities;
    if (query.context) message.context_id = query.context;
    const answer = await hass.connection.sendMessagePromise<unknown>(message);
    if (!Array.isArray(answer)) return [];
    return answer.map(readEntry).filter((e): e is LogbookEntry => e !== undefined);
  };
}

/** A run: an automation triggered or a script started (not a state change of theirs). */
export function isRun(row: LogbookEntry): boolean {
  return (
    row.state === undefined &&
    row.entity_id !== undefined &&
    (row.domain === "automation" || row.domain === "script")
  );
}

/** What set an automation off, from Home Assistant's words for its trigger. */
export function readSource(source: string | undefined): {
  kind: "state" | "time" | "sun" | "start" | "event" | "other";
  entity?: string;
  text?: string;
} {
  if (!source) return { kind: "other" };
  // Home Assistant's words (`homeassistant/triggers`), the longest first.
  for (const phrase of ["numeric state of", "state of"]) {
    if (source.startsWith(phrase)) {
      const rest = source.slice(phrase.length).trim();
      return isEntityId(rest) ? { kind: "state", entity: rest } : { kind: "other", text: source };
    }
  }
  if (source.startsWith("time")) return { kind: "time" };
  // `sunset with offset` before 2026, `sun event sunset` since.
  const sun = /^(?:sun event )?(\w+?)(?: with offset)?$/.exec(source);
  if (sun?.[1] && (source.startsWith("sun event ") || /^sun(?:rise|set)$/.test(sun[1]))) {
    return { kind: "sun", text: sun[1] };
  }
  if (source.startsWith("Home Assistant starting")) return { kind: "start", text: "starting" };
  if (source.startsWith("Home Assistant stopping")) return { kind: "start", text: "stopping" };
  const event = /^event '(.+)'$/.exec(source);
  if (event?.[1]) return { kind: "event", text: event[1] };
  return { kind: "other", text: source };
}

/** The action a row's context began with, when it was one. */
function serviceOf(row: LogbookEntry | undefined): string | undefined {
  if (row?.context_event_type !== "call_service" || !row.context_domain) return undefined;
  return row.context_service ? `${row.context_domain}.${row.context_service}` : row.context_domain;
}

/** A change to explain: an entity's state, when, and what the logbook or the state says of it. */
interface Change {
  entity: string;
  state?: string;
  /** In seconds, as the logbook's rows. */
  when: number;
  /** The context the state was written in, when it is still the state shown. */
  context?: HassContext;
  /** Its row of the logbook, when already found. */
  row?: LogbookEntry;
}

/** The row of `rows` that is `change`: its entity at its time, the nearest. */
function rowOf(rows: readonly LogbookEntry[], change: Change): LogbookEntry | undefined {
  let best: LogbookEntry | undefined;
  for (const row of rows) {
    if (row.entity_id !== change.entity || row.state === undefined) continue;
    if (change.state !== undefined && row.state !== change.state) continue;
    const off = Math.abs(row.when - change.when);
    if (off <= SAME_CHANGE && (!best || off < Math.abs(best.when - change.when))) best = row;
  }
  return best;
}

function sameRow(a: LogbookEntry, b: LogbookEntry): boolean {
  return (
    Math.abs(a.when - b.when) <= SAME_WHEN && a.entity_id === b.entity_id && a.state === b.state
  );
}

/** A run as a step of the chain. */
function runStep(run: LogbookEntry): WhyStep {
  return {
    kind: run.domain === "script" ? "script" : "automation",
    ...(run.entity_id ? { entity: run.entity_id } : {}),
    when: run.when * 1000,
    ...(run.context_id ? { context: run.context_id } : {}),
  };
}

/** The runs of `rows` up to `when` (s), in time: what ran after a change did not make it. */
function runsUntil(rows: readonly LogbookEntry[], when: number): LogbookEntry[] {
  return rows.filter((r) => isRun(r) && r.when <= when + SAME_WHEN).sort((a, b) => a.when - b.when);
}

/** Follows a change back to what started it. */
class Walker {
  /** Stopped at `MAX_CHANGES`. */
  cut = false;

  constructor(
    private readonly hass: HomeAssistant,
    private readonly read: LogbookReader,
  ) {}

  /** The steps from what started `change` to it (included). */
  async chainTo(change: Change, depth: number): Promise<WhyStep[]> {
    const step: WhyStep = {
      kind: "change",
      entity: change.entity,
      ...(change.state !== undefined ? { state: change.state } : {}),
      when: change.when * 1000,
    };
    const at = change.when * 1000;
    let context = change.context;
    let rows = context ? await this.read({ start: at - LOOKBACK_MS, context: context.id }) : [];
    let own = change.row ?? rowOf(rows, change);
    if (!own) {
      // Not found by its context (no context, or another write's since): by its entity. Its row
      // then says what made the change, not the context the state shows.
      own = rowOf(
        await this.read({ start: at - 1000, end: at + 1000, entities: [change.entity] }),
        change,
      );
      if (own) {
        rows = [];
        context = undefined;
      }
    }
    let ran = runsUntil(rows, change.when);
    const runBy = own?.context_event_type;
    if (
      ran.length === 0 &&
      own?.context_entity_id &&
      (runBy === "automation_triggered" || runBy === "script_started")
    ) {
      rows = await this.runRows(own, change);
      ran = runsUntil(rows, change.when);
      // The run's own row not found: what the change's row says of it stands for it.
      if (ran.length === 0) {
        ran = [
          {
            when: change.when,
            entity_id: own.context_entity_id,
            domain: runBy === "script_started" ? "script" : "automation",
            ...(own.context_source ? { source: own.context_source } : {}),
          },
        ];
      }
    }
    const run = ran[0];
    const user = run?.context_user_id ?? own?.context_user_id ?? context?.user_id ?? undefined;
    if (run) {
      // The run's parent, while the state shown is still the one written in that run.
      const parent =
        context && run.context_id === context.id ? (context.parent_id ?? undefined) : undefined;
      const before = await this.causeOfRun(run, user, parent, depth);
      return [...before, ...ran.map(runStep), step];
    }
    const service = serviceOf(own);
    if (user) return [{ kind: "person", user, ...(service ? { service } : {}) }, step];
    // Written in a context of another's doing (a thermostat switching its heater): that one.
    const parent = context?.parent_id ?? undefined;
    const before = parent ? await this.fromParent(parent, change.when, depth) : undefined;
    if (before && before.length > 0) return [...before, step];
    if (service) return [{ kind: "action", service }, step];
    const by = own?.context_entity_id;
    if (by && own?.context_state !== undefined && by !== change.entity) {
      // Another entity's change in the same context set it off (a group, a template, a helper).
      return [...(await this.changeOf(by, change.when, own.context_state, depth)), step];
    }
    if (own?.context_event_type) {
      const text = own.context_name ?? own.context_domain ?? own.context_event_type;
      return [
        {
          kind: "integration",
          text,
          ...(own.context_domain ? { service: own.context_domain } : {}),
        },
        step,
      ];
    }
    // Something set it off that the logbook does not have.
    if (parent) return [{ kind: "lost" }, step];
    // Further back, a change that began with itself is where the chain starts (a sensor that
    // sensed): only the device's own is said to be nobody's doing, or not in the logbook.
    if (depth > 0) return [step];
    return [{ kind: !own && rows.length === 0 ? "lost" : "unattributed" }, step];
  }

  /**
   * What a parent context holds, followed back: a run (another automation, a script) and what
   * set it off, else the change written in it. Nothing when the logbook has none of it.
   */
  private async fromParent(
    parent: string,
    before: number,
    depth: number,
  ): Promise<WhyStep[] | undefined> {
    if (depth + 1 >= MAX_CHANGES) {
      this.cut = true;
      return undefined;
    }
    const rows = await this.read({ start: before * 1000 - LOOKBACK_MS, context: parent });
    const ran = runsUntil(rows, before);
    const run = ran[0];
    if (run) {
      const cause = await this.causeOfRun(run, run.context_user_id, undefined, depth + 1);
      return [...cause, ...ran.map(runStep)];
    }
    let row: LogbookEntry | undefined;
    for (const r of rows) {
      if (r.entity_id && r.state !== undefined && r.when <= before + SAME_WHEN) row = r;
    }
    if (!row?.entity_id) return undefined;
    return this.chainTo(
      { entity: row.entity_id, state: row.state, when: row.when, row, context: { id: parent } },
      depth + 1,
    );
  }

  /** The rows of the run `own` happened in: its automation's or script's runs of late, checked
   * one by one (a state's row has no context id, a run's has). */
  private async runRows(own: LogbookEntry, change: Change): Promise<LogbookEntry[]> {
    const at = change.when * 1000;
    const runs = (
      await this.read({
        start: at - LOOKBACK_MS,
        end: at + 1000,
        entities: [own.context_entity_id ?? ""],
      })
    )
      .filter((r) => r.context_id && isRun(r) && r.when <= own.when + SAME_WHEN)
      .sort((a, b) => b.when - a.when)
      .slice(0, RUN_CANDIDATES);
    for (const run of runs) {
      const rows = await this.read({ start: at - LOOKBACK_MS, context: run.context_id });
      if (rows.some((r) => sameRow(r, own))) return rows;
    }
    return [];
  }

  /** What set a run off: the change of a state trigger followed back, someone, a time… */
  private async causeOfRun(
    run: LogbookEntry,
    user: string | undefined,
    parent: string | undefined,
    depth: number,
  ): Promise<WhyStep[]> {
    // Where Home Assistant gave the state change that set it off, that; else its words.
    const by = run.context_entity_id;
    const source =
      by && run.context_state !== undefined && by !== run.entity_id
        ? { kind: "state" as const, entity: by }
        : readSource(run.source);
    if (source.kind === "state" && source.entity) {
      return this.changeOf(source.entity, run.when, undefined, depth, parent);
    }
    if (user) return [{ kind: "person", user }];
    if (source.kind === "other") {
      // Run by another run, or by a change its words do not name (a template): its parent.
      const before = parent ? await this.fromParent(parent, run.when, depth) : undefined;
      if (before && before.length > 0) return before;
      // Run by hand: its row asked by its automation carries the user who did (Home Assistant
      // 2026.10 looks the parent up then).
      if (!source.text && run.entity_id && run.context_id) {
        const at = run.when * 1000;
        const rows = await this.read({
          start: at - 1000,
          end: at + 1000,
          entities: [run.entity_id],
        });
        const by = rows.find((r) => r.context_id === run.context_id)?.context_user_id;
        if (by) return [{ kind: "person", user: by }];
      }
    }
    switch (source.kind) {
      case "time":
        return [{ kind: "time" }];
      case "sun":
      case "start":
      case "event":
        return [{ kind: source.kind, ...(source.text ? { text: source.text } : {}) }];
      default:
        return source.text ? [{ kind: "trigger", text: source.text }] : [{ kind: "lost" }];
    }
  }

  /** The change of `entity` at or before `before` (s), followed back. */
  private async changeOf(
    entity: string,
    before: number,
    state: string | undefined,
    depth: number,
    parent?: string,
  ): Promise<WhyStep[]> {
    if (depth + 1 >= MAX_CHANGES) {
      this.cut = true;
      return [{ kind: "change", entity, ...(state !== undefined ? { state } : {}) }];
    }
    // Still the state written then: its context is known.
    const live = this.hass.states[entity];
    if (live?.context && parent !== undefined && live.context.id === parent) {
      return this.chainTo(
        {
          entity,
          state: live.state,
          when: Date.parse(live.last_updated) / 1000,
          context: live.context,
        },
        depth + 1,
      );
    }
    const at = before * 1000;
    const rows = await this.read({ start: at - LOOKBACK_MS, end: at + 1000, entities: [entity] });
    let row: LogbookEntry | undefined;
    for (const r of rows) {
      if (r.entity_id !== entity || r.state === undefined || r.when > before + SAME_WHEN) continue;
      if (state !== undefined && r.state !== state) continue;
      if (!row || r.when >= row.when) row = r;
    }
    // Not in the logbook (a sensor it leaves out): named, not followed.
    if (!row) return [{ kind: "change", entity, ...(state !== undefined ? { state } : {}) }];
    return this.chainTo({ entity, state: row.state, when: row.when, row }, depth + 1);
  }
}

/** What the state alone says, without the logbook: someone signed in, or nothing more. */
function stateOnly(change: Change): WhyStep[] {
  const step: WhyStep = {
    kind: "change",
    entity: change.entity,
    ...(change.state !== undefined ? { state: change.state } : {}),
    when: change.when * 1000,
  };
  const user = change.context?.user_id;
  return user ? [{ kind: "person", user }, step] : [step];
}

/** Domains Home Assistant's logbook always leaves out: what they say changes all the time. */
const CONTINUOUS = ["counter", "image", "proximity"];
/** The kinds of sensors whose state is not a number (`NON_NUMERIC_DEVICE_CLASSES`). */
const NOT_NUMBERS = ["date", "enum", "timestamp", "uptime"];

/**
 * Whether the logbook can say why `entity` is as it is: Home Assistant has its logbook (not a
 * home without it, nor the sandbox's copy), and it is not a sensor that measures (with a unit, a
 * state class or, since 2026, a kind that is a number), which the logbook leaves out, as it does
 * counters.
 */
export function explainable(hass: HomeAssistant, entity: string): boolean {
  const components = hass.config?.components;
  if (components && !components.includes("logbook")) return false;
  const domain = entity.slice(0, entity.indexOf("."));
  if (CONTINUOUS.includes(domain)) return false;
  if (domain !== "sensor") return true;
  const attributes = hass.states[entity]?.attributes ?? {};
  const kind = attributes.device_class;
  return (
    attributes.unit_of_measurement === undefined &&
    attributes.state_class === undefined &&
    (kind === undefined || (typeof kind === "string" && NOT_NUMBERS.includes(kind)))
  );
}

/**
 * Why `entity` is in the state it is: who or what made its last change of state, followed back
 * to what started it. The logbook is read through `read`; without Home Assistant's logbook, or
 * when it cannot be read, the chain is what the state's context alone says.
 */
export async function explain(
  hass: HomeAssistant,
  entity: string,
  read: LogbookReader = logbookReader(hass),
): Promise<WhyChain> {
  const state = hass.states[entity];
  if (!state) return { steps: [] };
  const change: Change = {
    entity,
    state: state.state,
    when: Date.parse(state.last_changed) / 1000,
    // The context is the change's while nothing was written since (an attribute alone).
    ...(state.context && state.last_updated === state.last_changed
      ? { context: state.context }
      : {}),
  };
  if (!Number.isFinite(change.when)) return { steps: [] };
  const components = hass.config?.components;
  if (components && !components.includes("logbook")) {
    return { steps: stateOnly(change), unread: true };
  }
  const walker = new Walker(hass, read);
  try {
    const steps = await walker.chainTo(change, 0);
    return { steps, ...(walker.cut ? { cut: true } : {}) };
  } catch {
    return { steps: stateOnly(change), unread: true };
  }
}

/** A trace's address in Home Assistant, by the context of its run (as its Activity links them). */
export interface TraceContext {
  run_id: string;
  domain: string;
  item_id: string;
}

/**
 * The traces of the runs Home Assistant keeps, by the context each ran in, as the paths of its
 * trace pages: for administrators only (`trace/contexts` is theirs), never in the demo house.
 */
export async function traceLinks(hass: HomeAssistant): Promise<Map<string, string>> {
  const links = new Map<string, string>();
  if (hass.user?.is_admin !== true || hass.demo) return links;
  try {
    const answer = await hass.connection.sendMessagePromise<unknown>({ type: "trace/contexts" });
    if (typeof answer !== "object" || answer === null) return links;
    for (const [context, value] of Object.entries(answer as Record<string, unknown>)) {
      const trace = value as Partial<TraceContext> | null;
      const { run_id: run, domain, item_id: item } = trace ?? {};
      if (typeof run !== "string" || typeof domain !== "string" || typeof item !== "string")
        continue;
      if (domain !== "automation" && domain !== "script") continue;
      links.set(
        context,
        `/config/${domain}/trace/${encodeURIComponent(item)}?run_id=${encodeURIComponent(run)}`,
      );
    }
  } catch {
    // An older or a stricter Home Assistant: no links.
  }
  return links;
}

/** The entities a chain goes through, each once, but those `hidden`: what Home Assistant's
 * Activity is opened on. */
export function chainEntities(
  chain: WhyChain,
  hidden: (entity: string) => boolean = () => false,
): string[] {
  const ids: string[] = [];
  for (const step of chain.steps) {
    if (step.entity && !ids.includes(step.entity) && !hidden(step.entity)) ids.push(step.entity);
  }
  return ids;
}

/**
 * Home Assistant's Activity on the entities of a chain (but those `hidden`), from a minute before
 * its first step to a minute after the change: the same chain as a list (a row opens its whole
 * story since 2026.9).
 */
export function activityPath(
  chain: WhyChain,
  hidden?: (entity: string) => boolean,
): string | undefined {
  const ids = chainEntities(chain, hidden);
  const times = chain.steps.flatMap((s) => (s.when !== undefined ? [s.when] : []));
  if (ids.length === 0 || times.length === 0) return undefined;
  const query = new URLSearchParams({
    entity_id: ids.join(","),
    start_date: new Date(Math.min(...times) - 60_000).toISOString(),
    end_date: new Date(Math.max(...times) + 60_000).toISOString(),
  });
  return `/logbook?${query.toString()}`;
}

/**
 * The names of the users of a chain: the person each one is, the user viewing, and, for an
 * administrator, Home Assistant's users (`config/auth/list`, theirs only).
 */
export async function userNames(
  hass: HomeAssistant,
  users: readonly string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (const state of Object.values(hass.states)) {
    const user = state?.attributes.user_id;
    const name = state?.attributes.friendly_name;
    if (
      state?.entity_id.startsWith("person.") &&
      typeof user === "string" &&
      typeof name === "string"
    ) {
      names.set(user, name);
    }
  }
  if (hass.user?.name && !names.has(hass.user.id)) names.set(hass.user.id, hass.user.name);
  if (users.every((u) => names.has(u)) || hass.user?.is_admin !== true || hass.demo) return names;
  try {
    const list = await hass.connection.sendMessagePromise<unknown>({ type: "config/auth/list" });
    for (const user of Array.isArray(list) ? list : []) {
      const { id, name } = (user ?? {}) as { id?: unknown; name?: unknown };
      if (typeof id === "string" && typeof name === "string" && !names.has(id)) {
        names.set(id, name);
      }
    }
  } catch {
    // Not given: "someone".
  }
  return names;
}

/** A wire of the chain in the home: from one step to the next that has a place, through the
 * automations and scripts that ran between them. */
export interface WhyHop {
  from: WhyStep;
  to: WhyStep;
  through: WhyStep[];
}

/**
 * The hops of a chain. Automations and scripts are what a wire goes through, not places; a step
 * nothing recorded is a place only before a run (the run's wire starts from it).
 */
export function hopsOf(chain: WhyChain): WhyHop[] {
  const hops: WhyHop[] = [];
  let from: WhyStep | undefined;
  let through: WhyStep[] = [];
  for (const step of chain.steps) {
    if (step.kind === "automation" || step.kind === "script") {
      through.push(step);
      continue;
    }
    if (step.kind === "unattributed") {
      from = undefined;
      through = [];
      continue;
    }
    if (from && (from.kind !== "lost" || through.length > 0))
      hops.push({ from, to: step, through });
    from = step;
    through = [];
  }
  return hops;
}
