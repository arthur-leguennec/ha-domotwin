/**
 * The sandbox's day (D-057): the home's own automations, scripts and scenes played over a copy
 * of its states, from midnight to midnight, faster than real time and all at once. Home
 * Assistant's way is kept where it matters: a trigger sets an automation off after the change
 * that fires it, conditions first, then its mode; `for` waits; delays and waits take their
 * time; what an action changes can set off another. Nothing leaves the page: a call changes the
 * copy, or is said not to be known.
 */
import type { HassEntity } from "../ha/types";
import {
  actionsOf,
  automationConditions,
  conditionKind,
  conditionsOf,
  disabled,
  idsOf,
  isRecord,
  listOf,
  modeOf,
  serviceOf,
  stepsOf,
  textsOf,
  triggerKind,
  triggersOf,
  type Config,
  type RunMode,
} from "./config";
import { QUIET_SERVICES, SAYING_DOMAINS, effectOn } from "./effects";
import { sunDay, type SunDay } from "./sun";
import {
  Unplayable,
  isTemplate,
  pythonText,
  render,
  renderCondition,
  renderTruth,
  renderDeep,
  stateValue,
  type TemplateScope,
} from "./templates";
import { isoIn, moment, parseClock, parseDuration, parseMoment, zoned } from "./time";

/** An automation of the home, as read. */
export interface PlayedAutomation {
  id: string;
  /** Its configuration, or `undefined` when Home Assistant would not give it. */
  config?: Config;
}

/** A script of the home. */
export interface PlayedScript {
  id: string;
  config?: Config;
}

/** A scene of the home: what it sets, if that could be read. */
export interface PlayedScene {
  id: string;
  entities?: Record<string, { state: string; attributes: Record<string, unknown> }>;
}

/** The home the day is played on. */
export interface World {
  /** The states at the start (a copy, changed by the day). */
  states: Record<string, HassEntity>;
  areaOf(id: string): string | undefined;
  areaName(area: string): string | undefined;
  deviceOf(id: string): string | undefined;
  /** The entities of a device, an area (its devices' too), a floor, a label. */
  entitiesOfDevice(device: string): string[];
  entitiesOfArea(area: string): string[];
  areasOfFloor(floor: string): string[];
  entitiesOfLabel(label: string): string[];
  /** An entity id from the id of its registry entry (devices' triggers name entities so). */
  entityFromRegistryId(id: string): string | undefined;
  automations: PlayedAutomation[];
  scripts: PlayedScript[];
  scenes: PlayedScene[];
  zone: string;
  latitude?: number;
  longitude?: number;
}

/** A change the day makes to the home from outside its automations. */
export interface Happening {
  at: number;
  entity: string;
  state: string;
  attributes?: Record<string, unknown>;
}

/** Something done by hand during the day (a tap in the sandbox). */
export interface HandCall {
  at: number;
  domain: string;
  service: string;
  data?: Record<string, unknown>;
  target?: Record<string, unknown>;
}

/** What made a change. */
export type Cause =
  { kind: "automation" | "script"; id: string; run: number } | { kind: "day" } | { kind: "you" };

/** A change of the day: the entity after it, and what made it. */
export interface Change {
  at: number;
  entity: HassEntity;
  before?: string;
  cause: Cause;
}

/** What set a run off. */
export interface FiredBy {
  /** The trigger's place in its automation, its kind and entity, its id. */
  index?: number;
  kind: string;
  entity?: string;
  id?: string;
  /** For a script, or an automation set off by `automation.trigger`: who called it. */
  by?: string;
}

/** The day's log. */
export type Entry =
  | {
      kind: "fired";
      at: number;
      owner: string;
      by: FiredBy;
      outcome: "ran" | "condition" | "busy" | "queued";
      run?: number;
    }
  | { kind: "call"; at: number; owner: string; run: number; service: string; changed: string[] }
  | { kind: "said"; at: number; owner: string; run: number; service: string; message?: string }
  | {
      kind: "stopped";
      at: number;
      owner: string;
      run: number;
      why: "condition" | "stop" | "error" | "restart" | "off";
    }
  | { kind: "done"; at: number; owner: string; run: number }
  | { kind: "unplayable"; at: number; owner: string; run?: number; reason: string; detail: string }
  | { kind: "loop"; at: number; owner: string };

/** The day played. */
export interface DayPlayed {
  start: number;
  end: number;
  sun: SunDay;
  /** The states at midnight, then every change in order. */
  initial: Record<string, HassEntity>;
  changes: Change[];
  log: Entry[];
  /** The day stopped early because too much happened. */
  cutShort?: number;
}

/** Triggers that nothing in the day sets off: they come from outside the home's states. */
export const OUTSIDE_TRIGGERS = new Set([
  "homeassistant",
  "mqtt",
  "webhook",
  "tag",
  "calendar",
  "conversation",
  "geo_location",
  "persistent_notification",
  "event",
  "device",
  "update",
  "time_pattern_outside",
]);

const MINUTE = 60_000;
/** At most this many runs of one automation a minute: more is a loop. */
const LOOP_RUNS = 60;
/** At most this many things happen in a day, and a repeat goes round this many times. */
const MAX_EVENTS = 400_000;
const MAX_REPEAT = 1000;
const MAX_DEPTH = 30;

type Wait =
  | { kind: "sleep"; until: number }
  | { kind: "check"; check: () => boolean; until?: number }
  | { kind: "trigger"; triggers: Config[]; until?: number }
  | { kind: "join"; runs: Run[] };

interface Run {
  id: number;
  owner: string;
  kind: "automation" | "script";
  gen: Generator<Wait, void, unknown>;
  done: boolean;
  cancelled: boolean;
  children: Set<Run>;
  onDone: (() => void)[];
  /** What it waits for, to be woken when it comes. */
  waiting?: Wait;
  token: number;
  parent?: Run;
  /** A branch of `parallel`: it ends with its run, and is not one of its owner's. */
  branch?: boolean;
}

interface Owner {
  kind: "automation" | "script";
  id: string;
  config: Config;
  mode: RunMode;
  active: Run[];
  queue: (() => void)[];
  starts: number[];
  looping: boolean;
}

/** A trigger listening, and whose it is (what it cannot play is said to be theirs). */
interface Watcher<T> {
  who: string;
  fn: (value: T) => void;
}

/** An event of the day's queue. */
interface Queued {
  at: number;
  seq: number;
  fn: () => void;
}

class Heap {
  private items: Queued[] = [];
  get size(): number {
    return this.items.length;
  }
  peek(): Queued | undefined {
    return this.items[0];
  }
  push(item: Queued): void {
    const a = this.items;
    a.push(item);
    let k = a.length - 1;
    while (k > 0) {
      const parent = (k - 1) >> 1;
      if (!before(a[k] as Queued, a[parent] as Queued)) break;
      [a[k], a[parent]] = [a[parent] as Queued, a[k] as Queued];
      k = parent;
    }
  }
  pop(): Queued | undefined {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0 && last) {
      a[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let best = k;
        if (l < a.length && before(a[l] as Queued, a[best] as Queued)) best = l;
        if (r < a.length && before(a[r] as Queued, a[best] as Queued)) best = r;
        if (best === k) break;
        [a[k], a[best]] = [a[best] as Queued, a[k] as Queued];
        k = best;
      }
    }
    return top;
  }
}

function before(a: Queued, b: Queued): boolean {
  return a.at < b.at || (a.at === b.at && a.seq < b.seq);
}

class Stop extends Error {
  constructor(readonly why: "condition" | "stop" | "error") {
    super(why);
  }
}

/** A value of a configuration as a text, as Home Assistant writes it. */
const text = (value: unknown): string => pythonText(value);

/** The domains that have `turn_on`, `turn_off` and `toggle`: Home Assistant's own pass over
 * the others silently. */
const SWITCHED_DOMAINS = new Set([
  "light",
  "switch",
  "fan",
  "input_boolean",
  "automation",
  "script",
  "siren",
  "remote",
  "humidifier",
  "water_heater",
  "media_player",
  "climate",
  "group",
  "vacuum",
]);

/** What a service's data may say about its targets, read by `targets` with the target's. */
const TARGET_KEYS = ["entity_id", "device_id", "area_id", "floor_id", "label_id"];

/** An attribute an entity does not have, as Home Assistant tells it from any value. */
const MISSING = Symbol("missing");

/** A state trigger's or condition's value: one, any of a list, or anything (`null`). */
function matches(wanted: unknown, value: unknown): boolean {
  if (wanted === undefined) return true;
  if (wanted === null) return true;
  if (value === MISSING) return false;
  if (Array.isArray(wanted)) return wanted.some((w) => matches(w, value));
  return text(wanted) === text(value);
}

/** Whether a run is over, read again after it ran (what it did may have ended it). */
const ended = (run: Run): boolean => run.done;

/** Plays a day. */
export class Day {
  readonly states: Record<string, HassEntity>;
  now: number;
  readonly start: number;
  readonly end: number;
  readonly sun: SunDay;
  readonly log: Entry[] = [];
  readonly changes: Change[] = [];
  private readonly initial: Record<string, HassEntity>;
  private readonly queue = new Heap();
  private seq = 0;
  private events = 0;
  private runCount = 0;
  private cutShort?: number;
  private readonly owners = new Map<string, Owner>();
  private readonly scenes = new Map<string, PlayedScene>();
  /** State triggers and conditions waiting, by entity. */
  private readonly watchers = new Map<string, Watcher<HassEntity | undefined>[]>();
  /** Templates (triggers) read again after each change and each minute. */
  private readonly templateWatchers: Watcher<void>[] = [];
  /** Runs waiting on a check or a trigger, read again after each change. */
  private readonly waiting = new Set<Run>();
  /** The runs (their ids) that ended, branches and all. */
  private readonly ended = new Set<number>();
  private recheckQueued = false;
  /** Event triggers, by event type. */
  private readonly eventWatchers = new Map<string, Watcher<Config>[]>();
  /** Timers' generations: a timer started again or cancelled does not finish as before. */
  private readonly timers = new Map<string, number>();
  /** Once per automation and reason: what could not be played is said once. */
  private readonly said = new Set<string>();

  constructor(
    private readonly world: World,
    start: number,
    end: number,
  ) {
    this.start = start;
    this.end = end;
    this.now = start;
    this.states = world.states;
    this.sun =
      world.latitude !== undefined && world.longitude !== undefined
        ? sunDay(start, end, world.latitude, world.longitude)
        : this.sunFromEntity();
    for (const scene of world.scenes) this.scenes.set(scene.id, scene);
    this.initial = structuredClone(this.states);
  }

  /** The sun's times from `sun.sun`'s next rising and setting, when the home's place is not known. */
  private sunFromEntity(): SunDay {
    const sun = this.states["sun.sun"];
    const timeOfDay = (iso: unknown): number | undefined => {
      if (typeof iso !== "string") return undefined;
      const at = Date.parse(iso);
      if (!Number.isFinite(at)) return undefined;
      const read = zoned(at, this.world.zone);
      const day = zoned(this.start, this.world.zone);
      return moment(
        this.world.zone,
        day.year,
        day.month,
        day.day,
        read.hour,
        read.minute,
        read.second,
      );
    };
    const rising = timeOfDay(sun?.attributes.next_rising);
    const setting = timeOfDay(sun?.attributes.next_setting);
    return {
      ...(rising !== undefined ? { rising } : {}),
      ...(setting !== undefined ? { setting } : {}),
      upAtStart: rising !== undefined && setting !== undefined && setting < rising,
    };
  }

  /** Plays the whole day: the happenings, the calls by hand, the automations. */
  play(happenings: readonly Happening[], calls: readonly HandCall[] = []): DayPlayed {
    for (const automation of this.world.automations) this.arm(automation);
    for (const script of this.world.scripts) {
      if (script.config) this.owner("script", script.id, script.config);
    }
    for (const happening of happenings) {
      this.at(happening.at, () => {
        this.set(happening.entity, happening.state, happening.attributes, { kind: "day" });
      });
    }
    for (const call of calls) {
      this.at(call.at, () => {
        this.callByHand(call);
      });
    }
    // Templates using the time are read again each minute.
    for (let t = this.start + MINUTE; t < this.end; t += MINUTE) {
      this.at(t, () => {
        this.reread();
      });
    }
    this.runUntil(this.end);
    return {
      start: this.start,
      end: this.end,
      sun: this.sun,
      initial: this.initial,
      changes: this.changes,
      log: this.log,
      ...(this.cutShort !== undefined ? { cutShort: this.cutShort } : {}),
    };
  }

  // ------------------------------------------------------------------------------ the queue

  private at(at: number, fn: () => void): void {
    if (at > this.end) return;
    this.seq += 1;
    this.queue.push({ at: Math.max(at, this.now), seq: this.seq, fn });
  }

  private runUntil(until: number): void {
    for (;;) {
      const next = this.queue.peek();
      if (!next || next.at > until) break;
      this.queue.pop();
      this.events += 1;
      if (this.events > MAX_EVENTS) {
        this.cutShort = this.now;
        return;
      }
      this.now = next.at;
      try {
        next.fn();
      } catch (error) {
        // What the day could not play goes in the report; the day goes on.
        this.notPlayed("day", undefined, error);
      }
    }
    this.now = until;
  }

  // ----------------------------------------------------------------------------- the states

  private scope(variables: Record<string, unknown> = {}): TemplateScope {
    return {
      state: (id) => this.states[id],
      ids: () => Object.keys(this.states),
      areaOf: (id) => this.world.areaOf(id),
      areaName: (area) => this.world.areaName(area),
      now: this.now,
      zone: this.world.zone,
      variables,
    };
  }

  /** Sets an entity's state (its attributes too, if given), as Home Assistant does. */
  set(
    id: string,
    state: string,
    attributes: Record<string, unknown> | undefined,
    cause: Cause,
  ): void {
    const before = this.states[id];
    const iso = isoIn(this.now, this.world.zone);
    const after: HassEntity = before
      ? { ...before, state, attributes: attributes ?? before.attributes }
      : {
          entity_id: id,
          state,
          attributes: attributes ?? {},
          last_changed: iso,
          last_updated: iso,
        };
    const moved = before?.state !== state;
    const touched = moved || JSON.stringify(before.attributes) !== JSON.stringify(after.attributes);
    if (!touched) return;
    after.last_updated = iso;
    after.last_changed = moved ? iso : before.last_changed;
    this.states[id] = after;
    this.changes.push({
      at: this.now,
      entity: after,
      ...(before ? { before: before.state } : {}),
      cause,
    });
    for (const watcher of [...(this.watchers.get(id) ?? [])]) this.hear(watcher, before);
    this.recheck();
  }

  /** Gives a trigger what it listens for; one that cannot read it stops listening. */
  private hear<T>(watcher: Watcher<T>, value: T): void {
    try {
      watcher.fn(value);
    } catch (error) {
      this.notPlayed(watcher.who, undefined, error);
      watcher.fn = () => undefined;
    }
  }

  /** Templates and waiting runs read again once the change is done. */
  private recheck(): void {
    if (this.recheckQueued) return;
    this.recheckQueued = true;
    this.at(this.now, () => {
      this.recheckQueued = false;
      this.reread();
    });
  }

  /** Reads the templates and the waits again (after a change, and each minute for the time). */
  private reread(): void {
    for (const watcher of [...this.templateWatchers]) this.hear(watcher, undefined);
    for (const run of [...this.waiting]) {
      const wait = run.waiting;
      if (wait?.kind !== "check") continue;
      let ready: boolean;
      try {
        ready = wait.check();
      } catch (error) {
        this.failed(run, error);
        continue;
      }
      if (ready) this.wake(run, true);
    }
  }

  private watch(id: string, who: string, fn: (before: HassEntity | undefined) => void): () => void {
    const list = this.watchers.get(id) ?? [];
    const watcher = { who, fn };
    list.push(watcher);
    this.watchers.set(id, list);
    return () => {
      const at = list.indexOf(watcher);
      if (at >= 0) list.splice(at, 1);
    };
  }

  private fireEvent(type: string, data: Config): void {
    for (const watcher of [...(this.eventWatchers.get(type) ?? [])]) this.hear(watcher, data);
  }

  private notPlayed(owner: string, run: number | undefined, error: unknown): void {
    const reason = error instanceof Unplayable ? error.reason : "error";
    const detail = error instanceof Unplayable ? error.detail : String(error);
    const key = `${owner}|${reason}|${detail}`;
    if (this.said.has(key)) return;
    this.said.add(key);
    this.log.push({
      kind: "unplayable",
      at: this.now,
      owner,
      ...(run !== undefined ? { run } : {}),
      reason,
      detail,
    });
  }

  // ---------------------------------------------------------------------------- triggers

  private owner(kind: "automation" | "script", id: string, config: Config): Owner {
    let found = this.owners.get(id);
    if (!found) {
      found = {
        kind,
        id,
        config,
        mode: modeOf(config),
        active: [],
        queue: [],
        starts: [],
        looping: false,
      };
      this.owners.set(id, found);
    }
    return found;
  }

  /** Sets up an automation's triggers. */
  private arm(automation: PlayedAutomation): void {
    if (!automation.config) {
      this.notPlayed(automation.id, undefined, new Unplayable("config"));
      return;
    }
    const owner = this.owner("automation", automation.id, automation.config);
    triggersOf(automation.config).forEach((trigger, index) => {
      if (disabled(trigger)) return;
      const fire = (vars: Record<string, unknown>, entity?: string): void => {
        const id = typeof trigger.id === "string" ? trigger.id : String(index);
        this.at(this.now, () => {
          this.trigger(
            owner,
            { index, kind: triggerKind(trigger), ...(entity ? { entity } : {}), id },
            {
              trigger: { id, idx: String(index), platform: triggerKind(trigger), ...vars },
            },
          );
        });
      };
      try {
        this.armTrigger(trigger, automation.id, fire);
      } catch (error) {
        this.notPlayed(automation.id, undefined, error);
      }
    });
  }

  /**
   * Arms one trigger: `fire` is called each time it fires, with the trigger's variables. Returns
   * how to disarm it (a `wait_for_trigger`'s end).
   */
  private armTrigger(
    trigger: Config,
    who: string,
    fire: (vars: Record<string, unknown>, entity?: string) => void,
  ): () => void {
    const kind = triggerKind(trigger);
    const zone = this.world.zone;
    const offs: (() => void)[] = [];
    let live = true;
    const off = (): void => {
      live = false;
      for (const f of offs) f();
    };
    switch (kind) {
      case "state": {
        const wantedFrom = trigger.from;
        const wantedTo = trigger.to;
        const attribute = typeof trigger.attribute === "string" ? trigger.attribute : undefined;
        const notFrom = listOf(trigger.not_from).map(String);
        const notTo = listOf(trigger.not_to).map(String);
        // Naming none of them, it fires on any change, an attribute's too, as Home Assistant's.
        const matchAll = !["from", "to", "not_from", "not_to"].some((key) => key in trigger);
        // Waiting out `for` with only `from`: as long as it is not back to what it was.
        const fromOnly = "from" in trigger && !("to" in trigger);
        const valueOf = (entity: HassEntity): unknown =>
          attribute
            ? attribute in entity.attributes
              ? entity.attributes[attribute]
              : MISSING
            : entity.state;
        const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
        for (const entity of this.entityList(trigger.entity_id)) {
          let pending: { cancel: () => void; was: unknown; now: unknown } | undefined;
          offs.push(
            this.watch(entity, who, (before) => {
              const after = this.states[entity];
              // Waiting out `for`: it goes on while the value stays what fired it.
              if (pending) {
                const value = after ? valueOf(after) : MISSING;
                const holds = after
                  ? fromOnly
                    ? !same(value, pending.was)
                    : same(value, pending.now)
                  : false;
                if (!holds) {
                  pending.cancel();
                  pending = undefined;
                }
              }
              if (!before || !after) return;
              const was = valueOf(before);
              const now = valueOf(after);
              const unchanged = same(was, now);
              if (attribute && unchanged) return;
              if (!matches(wantedFrom, was) || !matches(wantedTo, now)) return;
              if (!matchAll && unchanged) return;
              if (notFrom.includes(String(was)) || notTo.includes(String(now))) return;
              const vars = {
                entity_id: entity,
                from_state: stateValue(before, zone),
                to_state: stateValue(after, zone),
                ...(attribute ? { attribute } : {}),
              };
              const duration = this.duration(trigger.for, vars);
              if (!duration) {
                fire(vars, entity);
                return;
              }
              pending?.cancel();
              let cancelled = false;
              pending = {
                cancel: () => {
                  cancelled = true;
                },
                was,
                now,
              };
              this.at(this.now + duration, () => {
                if (cancelled || !live) return;
                pending = undefined;
                fire({ ...vars, for: duration / 1000 }, entity);
              });
            }),
          );
        }
        break;
      }
      case "numeric_state": {
        for (const entity of this.entityList(trigger.entity_id)) {
          const inRange = (): boolean => this.numericMatch(trigger, entity);
          let armed = !this.safe(inRange);
          let pending: (() => void) | undefined;
          offs.push(
            this.watch(entity, who, (before) => {
              const now = this.safe(inRange);
              if (!now) {
                armed = true;
                pending?.();
                pending = undefined;
                return;
              }
              if (!armed) return;
              armed = false;
              const vars = {
                entity_id: entity,
                from_state: stateValue(before, zone),
                to_state: stateValue(this.states[entity], zone),
              };
              const duration = this.duration(trigger.for, vars);
              if (!duration) {
                fire(vars, entity);
                return;
              }
              let cancelled = false;
              pending = () => {
                cancelled = true;
              };
              this.at(this.now + duration, () => {
                if (cancelled || !live) return;
                pending = undefined;
                fire({ ...vars, for: duration / 1000 }, entity);
              });
            }),
          );
        }
        break;
      }
      case "time": {
        const weekdays = textsOf(trigger.weekday);
        if (weekdays.length > 0 && !weekdays.includes(this.weekday())) break;
        for (const at of listOf(trigger.at)) {
          const named = typeof at === "string" && this.states[at] !== undefined;
          let generation = 0;
          // An entity's time is followed as it changes, as Home Assistant does.
          const schedule = (): void => {
            generation += 1;
            const mine = generation;
            const when = this.timeOf(at, "trigger");
            if (when === undefined) {
              if (named) return;
              throw new Unplayable("time", String(at));
            }
            if (when >= this.now && when <= this.end) {
              this.at(when, () => {
                if (live && mine === generation) fire({ now: isoIn(this.now, zone) });
              });
            }
          };
          schedule();
          if (named) offs.push(this.watch(at, who, schedule));
        }
        break;
      }
      case "time_pattern": {
        const times = this.pattern(trigger);
        for (const when of times) {
          if (when < this.now) continue;
          this.at(when, () => {
            if (live) fire({ now: isoIn(this.now, zone) });
          });
        }
        break;
      }
      case "sun": {
        const event = trigger.event;
        const base =
          event === "sunrise" ? this.sun.rising : event === "sunset" ? this.sun.setting : undefined;
        if (event !== "sunrise" && event !== "sunset")
          throw new Unplayable("trigger", `sun ${String(event)}`);
        const offset = trigger.offset === undefined ? 0 : parseDuration(trigger.offset);
        if (offset === undefined) throw new Unplayable("time", String(trigger.offset));
        if (base !== undefined) {
          const when = base + offset;
          if (when >= this.now && when <= this.end) {
            this.at(when, () => {
              if (live) fire({ event, offset: offset / 1000 });
            });
          }
        }
        break;
      }
      case "zone": {
        const zoneId = typeof trigger.zone === "string" ? trigger.zone : "";
        const wanted = trigger.event === "leave" ? "leave" : "enter";
        for (const entity of this.entityList(trigger.entity_id)) {
          offs.push(
            this.watch(entity, who, (before) => {
              const was = this.inZone(before, zoneId);
              const now = this.inZone(this.states[entity], zoneId);
              if (was === now) return;
              if ((wanted === "enter") !== now) return;
              fire(
                {
                  entity_id: entity,
                  zone: stateValue(this.states[zoneId], zone),
                  event: wanted,
                  from_state: stateValue(before, zone),
                  to_state: stateValue(this.states[entity], zone),
                },
                entity,
              );
            }),
          );
        }
        break;
      }
      case "template": {
        const template = trigger.value_template;
        if (typeof template !== "string") throw new Unplayable("trigger", "template");
        const read = (): boolean => renderTruth(template, this.scope());
        let armed = !read();
        let pending: (() => void) | undefined;
        const watcher: Watcher<void> = { who, fn: () => undefined };
        watcher.fn = (): void => {
          if (!live) return;
          const now = read();
          if (!now) {
            armed = true;
            pending?.();
            pending = undefined;
            return;
          }
          if (!armed) return;
          armed = false;
          const duration = this.duration(trigger.for, {});
          if (!duration) {
            fire({});
            return;
          }
          let cancelled = false;
          pending = () => {
            cancelled = true;
          };
          this.at(this.now + duration, () => {
            if (cancelled || !live) return;
            pending = undefined;
            fire({ for: duration / 1000 });
          });
        };
        this.templateWatchers.push(watcher);
        offs.push(() => {
          const at = this.templateWatchers.indexOf(watcher);
          if (at >= 0) this.templateWatchers.splice(at, 1);
        });
        break;
      }
      case "event": {
        const types = textsOf(trigger.event_type);
        const data = isRecord(trigger.event_data) ? trigger.event_data : {};
        for (const type of types) {
          const watcher: Watcher<Config> = {
            who,
            fn: (event) => {
              if (!live) return;
              const fits = Object.entries(data).every(([key, value]) => matches(value, event[key]));
              if (fits) fire({ event: { event_type: type, data: event } });
            },
          };
          const list = this.eventWatchers.get(type) ?? [];
          list.push(watcher);
          this.eventWatchers.set(type, list);
          offs.push(() => {
            const at = list.indexOf(watcher);
            if (at >= 0) list.splice(at, 1);
          });
        }
        break;
      }
      case "device": {
        const mapped = this.deviceTrigger(trigger);
        if (!mapped) throw new Unplayable("trigger", "device");
        return this.armTrigger(mapped, who, fire);
      }
      default:
        throw new Unplayable("trigger", kind || "?");
    }
    return off;
  }

  /** A device's trigger as the state trigger it stands for, if it is a common one. */
  private deviceTrigger(trigger: Config): Config | undefined {
    const raw = typeof trigger.entity_id === "string" ? trigger.entity_id : undefined;
    const entity = raw && (this.states[raw] ? raw : this.world.entityFromRegistryId(raw));
    if (!entity) return undefined;
    const type = typeof trigger.type === "string" ? trigger.type : "";
    const base: Config = {
      trigger: "state",
      entity_id: entity,
      ...(trigger.for ? { for: trigger.for } : {}),
    };
    if (type === "changed_states") return base;
    if (type === "turned_on") return { ...base, to: "on" };
    if (type === "turned_off") return { ...base, to: "off" };
    const domain = entity.split(".")[0];
    if (domain === "binary_sensor") {
      // `motion`/`no_motion`, `opened`/`not_opened`…: a state of on or off.
      return { ...base, to: /^(no|not)_/.test(type) ? "off" : "on" };
    }
    if (domain === "sensor" && (trigger.above !== undefined || trigger.below !== undefined)) {
      return {
        trigger: "numeric_state",
        entity_id: entity,
        ...(trigger.above !== undefined ? { above: trigger.above } : {}),
        ...(trigger.below !== undefined ? { below: trigger.below } : {}),
        ...(trigger.for ? { for: trigger.for } : {}),
      };
    }
    return undefined;
  }

  private entityList(value: unknown): string[] {
    return idsOf(value).flatMap((id) => (this.states[id] ? [id] : []));
  }

  private safe(read: () => boolean): boolean {
    try {
      return read();
    } catch {
      return false;
    }
  }

  private inZone(entity: HassEntity | undefined, zoneId: string): boolean {
    if (!entity) return false;
    if (zoneId === "zone.home") return entity.state === "home";
    const name = this.states[zoneId]?.attributes.friendly_name;
    return typeof name === "string" && entity.state === name;
  }

  private weekday(): string {
    return (
      ["mon", "tue", "wed", "thu", "fri", "sat", "sun"][zoned(this.now, this.world.zone).weekday] ??
      ""
    );
  }

  /** A trigger's or condition's time (`HH:MM`, an input_datetime, a timestamp sensor) today. */
  /**
   * The moment a time names: a time of day, an input datetime's, a timestamp sensor's. A
   * condition reads only their time of day; a trigger, a date with it.
   */
  private timeOf(value: unknown, use: "trigger" | "condition"): number | undefined {
    if (typeof value !== "string") return undefined;
    const day = zoned(this.start, this.world.zone);
    const clock = parseClock(value);
    const ofDay = (seconds: number): number =>
      moment(
        this.world.zone,
        day.year,
        day.month,
        day.day,
        Math.floor(seconds / 3600),
        Math.floor(seconds / 60) % 60,
        seconds % 60,
      );
    if (clock !== undefined) return ofDay(clock);
    const entity = this.states[value];
    if (!entity) return undefined;
    if (value.startsWith("input_datetime.")) {
      const a = entity.attributes;
      if (a.has_time === false) return undefined;
      const time = /(\d{1,2}:\d{2}(:\d{2})?)$/.exec(entity.state)?.[1];
      const seconds = time ? parseClock(time) : undefined;
      if (seconds === undefined) return undefined;
      // With its date, a trigger fires on that day only.
      const date = /^\d{4}-\d{2}-\d{2}/.exec(entity.state)?.[0];
      if (use === "trigger" && a.has_date !== false && date) {
        return parseMoment(`${date} ${time ?? ""}`, this.world.zone);
      }
      return ofDay(seconds);
    }
    const at = parseMoment(entity.state, this.world.zone);
    if (at === undefined || use === "trigger") return at;
    const read = zoned(at, this.world.zone);
    return ofDay(read.hour * 3600 + read.minute * 60 + read.second);
  }

  /** The moments a time pattern fires in the day. */
  private pattern(trigger: Config): number[] {
    const field = (value: unknown, max: number): ((n: number) => boolean) | undefined => {
      if (value === undefined || value === null || value === "*") return () => true;
      const spec = text(value);
      const every = /^\/(\d+)$/.exec(spec);
      if (every) {
        const step = Number(every[1]);
        return step > 0 ? (n) => n % step === 0 : undefined;
      }
      if (/^\d+$/.test(spec) && Number(spec) <= max) return (n) => n === Number(spec);
      return undefined;
    };
    const { hours } = trigger;
    let { minutes, seconds } = trigger;
    if (hours === undefined && minutes === undefined && seconds === undefined) {
      throw new Unplayable("time", "time_pattern");
    }
    // Smaller units than those given are 0, as Home Assistant's time pattern takes them.
    if (minutes === undefined && hours !== undefined) minutes = 0;
    if (seconds === undefined && minutes !== undefined) seconds = 0;
    const h = field(hours, 23);
    const m = field(minutes, 59);
    const s = field(seconds, 59);
    if (!h || !m || !s) throw new Unplayable("time", "time_pattern");
    const day = zoned(this.start, this.world.zone);
    const found: number[] = [];
    for (let hh = 0; hh < 24; hh += 1) {
      if (!h(hh)) continue;
      for (let mm = 0; mm < 60; mm += 1) {
        if (!m(mm)) continue;
        for (let ss = 0; ss < 60; ss += 1) {
          if (!s(ss)) continue;
          const at = moment(this.world.zone, day.year, day.month, day.day, hh, mm, ss);
          // A time the clocks skip that day (spring forward) never comes.
          const read = zoned(at, this.world.zone);
          if (read.hour !== hh || read.minute !== mm || read.second !== ss) continue;
          found.push(at);
          if (found.length > 3000) throw new Unplayable("too_often", "time_pattern");
        }
      }
    }
    return found;
  }

  /** A duration given to a trigger, a condition or a step (a template too), in ms. */
  private duration(value: unknown, variables: Record<string, unknown>): number {
    if (value === undefined || value === null) return 0;
    const rendered = renderDeep(value, this.scope(variables));
    const ms = parseDuration(rendered);
    if (ms === undefined) throw new Unplayable("time", JSON.stringify(value));
    return Math.max(0, ms);
  }

  private numericMatch(
    item: Config,
    entity: string,
    variables: Record<string, unknown> = {},
  ): boolean {
    const state = this.states[entity];
    if (!state) return false;
    let raw: unknown;
    if (typeof item.value_template === "string") {
      raw = render(
        item.value_template,
        this.scope({ ...variables, state: stateValue(state, this.world.zone) }),
      );
    } else if (typeof item.attribute === "string") {
      raw = state.attributes[item.attribute];
    } else raw = state.state;
    const value = Number(raw);
    if (raw === null || raw === "" || !Number.isFinite(value)) return false;
    const limit = (limit: unknown): number | undefined => {
      if (limit === undefined || limit === null) return undefined;
      if (typeof limit === "number") return limit;
      if (typeof limit === "string" && this.states[limit]) {
        const n = Number(this.states[limit].state);
        return Number.isFinite(n) ? n : NaN;
      }
      const n = Number(limit);
      return Number.isFinite(n) ? n : NaN;
    };
    const above = limit(item.above);
    const below = limit(item.below);
    if (above !== undefined && !(value > above)) return false;
    if (below !== undefined && !(value < below)) return false;
    return true;
  }

  // -------------------------------------------------------------------------- conditions

  /** Whether `conditions` all hold. */
  private check(conditions: Config[], variables: Record<string, unknown>, depth = 0): boolean {
    return conditions.every((condition) => this.holds(condition, variables, depth));
  }

  private holds(condition: Config, variables: Record<string, unknown>, depth: number): boolean {
    if (disabled(condition)) return true;
    if (depth > MAX_DEPTH) throw new Unplayable("condition", "too deep");
    const { kind, inner } = conditionKind(condition);
    switch (kind) {
      case "and":
        return (inner ?? []).every((c) => this.holds(c, variables, depth + 1));
      case "or":
        return (inner ?? []).some((c) => this.holds(c, variables, depth + 1));
      case "not":
        return !(inner ?? []).some((c) => this.holds(c, variables, depth + 1));
      case "state": {
        const entities = this.entityList(condition.entity_id);
        if (entities.length === 0) return false;
        const one = (entity: string): boolean => {
          const state = this.states[entity];
          if (!state) return false;
          const attribute =
            typeof condition.attribute === "string" ? condition.attribute : undefined;
          const value = attribute ? state.attributes[attribute] : state.state;
          if (!matches(listOf(condition.state).map(String), String(value))) return false;
          const duration = this.duration(condition.for, variables);
          if (duration > 0) {
            const since = Date.parse(state.last_changed);
            if (Number.isFinite(since) && this.now - since < duration) return false;
          }
          return true;
        };
        return condition.match === "any" ? entities.some(one) : entities.every(one);
      }
      case "numeric_state": {
        const entities = this.entityList(condition.entity_id);
        return (
          entities.length > 0 && entities.every((e) => this.numericMatch(condition, e, variables))
        );
      }
      case "template": {
        const template = condition.value_template;
        if (typeof template !== "string") throw new Unplayable("condition", "template");
        return renderCondition(template, this.scope(variables));
      }
      case "time": {
        const weekdays = textsOf(condition.weekday);
        if (weekdays.length > 0 && !weekdays.includes(this.weekday())) return false;
        const after =
          condition.after === undefined ? undefined : this.timeOf(condition.after, "condition");
        const before =
          condition.before === undefined ? undefined : this.timeOf(condition.before, "condition");
        // An entity without a time (unknown, a date only) does not hold, as Home Assistant says.
        for (const [value, read] of [
          [condition.after, after],
          [condition.before, before],
        ] as const) {
          if (value === undefined || read !== undefined) continue;
          if (typeof value === "string" && this.states[value]) return false;
          throw new Unplayable("time", text(value));
        }
        const now = this.now;
        if (after !== undefined && before !== undefined && after > before) {
          return now >= after || now < before;
        }
        return (after === undefined || now >= after) && (before === undefined || now < before);
      }
      case "sun": {
        const edge = (value: unknown, offset: unknown): number | undefined => {
          const base =
            value === "sunrise"
              ? this.sun.rising
              : value === "sunset"
                ? this.sun.setting
                : undefined;
          const shift = offset === undefined ? 0 : parseDuration(offset);
          if (shift === undefined) throw new Unplayable("time", String(offset));
          return base === undefined ? undefined : base + shift;
        };
        // After sunset and before sunrise: the night, either side of midnight.
        if (condition.before === "sunrise" && condition.after === "sunset") {
          const before = edge(condition.before, condition.before_offset);
          const after = edge(condition.after, condition.after_offset);
          return (
            (before !== undefined && this.now < before) || (after !== undefined && this.now > after)
          );
        }
        if (condition.after !== undefined) {
          const after = edge(condition.after, condition.after_offset);
          if (after === undefined || this.now < after) return false;
        }
        if (condition.before !== undefined) {
          const before = edge(condition.before, condition.before_offset);
          if (before === undefined || this.now > before) return false;
        }
        return true;
      }
      case "trigger": {
        const trigger = variables.trigger as { id?: unknown } | undefined;
        return listOf(condition.id).map(String).includes(String(trigger?.id));
      }
      case "zone": {
        const zones = textsOf(condition.zone);
        return this.entityList(condition.entity_id).every((entity) =>
          zones.some((zone) => this.inZone(this.states[entity], zone)),
        );
      }
      case "device": {
        const raw = typeof condition.entity_id === "string" ? condition.entity_id : "";
        const entity = this.states[raw] ? raw : this.world.entityFromRegistryId(raw);
        const type = typeof condition.type === "string" ? condition.type : "";
        if (!entity) throw new Unplayable("condition", "device");
        if (type === "is_on" || type === "is_off")
          return this.states[entity]?.state === type.slice(3);
        if (entity.startsWith("binary_sensor.") && type.startsWith("is_")) {
          return this.states[entity]?.state === (/^is_(no|not)_/.test(type) ? "off" : "on");
        }
        throw new Unplayable("condition", `device ${type}`);
      }
      default:
        throw new Unplayable("condition", kind || "?");
    }
  }

  // ---------------------------------------------------------------------------------- runs

  /** An automation set off: its conditions, then its mode, then its actions. */
  private trigger(
    owner: Owner,
    by: FiredBy,
    variables: Record<string, unknown>,
    skipConditions = false,
  ): void {
    if (owner.looping) return;
    const automation = this.states[owner.id];
    // Turned off (by hand, or by another automation): its triggers do nothing.
    if (automation && automation.state === "off" && !skipConditions) return;
    const vars = { ...variables, this: stateValue(automation, this.world.zone) };
    try {
      if (!skipConditions && !this.check(automationConditions(owner.config), vars)) {
        this.log.push({ kind: "fired", at: this.now, owner: owner.id, by, outcome: "condition" });
        return;
      }
    } catch (error) {
      this.notPlayed(owner.id, undefined, error);
      this.log.push({ kind: "fired", at: this.now, owner: owner.id, by, outcome: "condition" });
      return;
    }
    this.launch(owner, by, vars, actionsOf(owner.config));
  }

  /** Starts a run of `owner` as its mode says; returns it, unless it was not started now. */
  private launch(
    owner: Owner,
    by: FiredBy,
    variables: Record<string, unknown>,
    steps: Config[],
    parent?: Run,
  ): Run | undefined {
    // A loop: the same automation started over and over within a minute.
    owner.starts = owner.starts.filter((t) => this.now - t < MINUTE);
    owner.starts.push(this.now);
    if (owner.starts.length > LOOP_RUNS) {
      owner.looping = true;
      this.log.push({ kind: "loop", at: this.now, owner: owner.id });
      owner.queue.length = 0;
      for (const run of [...owner.active]) this.cancel(run);
      return undefined;
    }
    const busy = owner.active.filter((r) => !r.done);
    const { mode, max } = owner.mode;
    if (busy.length > 0) {
      if (mode === "single") {
        this.log.push({ kind: "fired", at: this.now, owner: owner.id, by, outcome: "busy" });
        return undefined;
      }
      if (mode === "restart") for (const run of busy) this.cancel(run);
      if (mode === "queued") {
        if (busy.length + owner.queue.length >= max) {
          this.log.push({ kind: "fired", at: this.now, owner: owner.id, by, outcome: "busy" });
          return undefined;
        }
        this.log.push({ kind: "fired", at: this.now, owner: owner.id, by, outcome: "queued" });
        owner.queue.push(() => {
          this.begin(owner, by, variables, steps, parent);
        });
        return undefined;
      }
      if (mode === "parallel" && busy.length >= max) {
        this.log.push({ kind: "fired", at: this.now, owner: owner.id, by, outcome: "busy" });
        return undefined;
      }
    }
    return this.begin(owner, by, variables, steps, parent);
  }

  private begin(
    owner: Owner,
    by: FiredBy,
    variables: Record<string, unknown>,
    steps: Config[],
    parent?: Run,
  ): Run {
    this.runCount += 1;
    const id = this.runCount;
    this.log.push({ kind: "fired", at: this.now, owner: owner.id, by, outcome: "ran", run: id });
    // As Home Assistant says when an automation or a script last ran.
    const entity = this.states[owner.id];
    if (entity) {
      this.set(
        owner.id,
        owner.kind === "script" ? "on" : entity.state,
        {
          ...entity.attributes,
          last_triggered: isoIn(this.now, this.world.zone),
          current: owner.active.filter((r) => !r.done).length + 1,
        },
        { kind: owner.kind, id: owner.id, run: id },
      );
    }
    const vars = { ...variables };
    if (isRecord(owner.config.variables)) {
      try {
        Object.assign(vars, renderDeep(owner.config.variables, this.scope(vars)));
      } catch (error) {
        this.notPlayed(owner.id, id, error);
      }
    }
    const run: Run = {
      id,
      owner: owner.id,
      kind: owner.kind,
      gen: this.sequence(steps, vars, owner, id, 0),
      done: false,
      cancelled: false,
      children: new Set(),
      onDone: [],
      token: 0,
      ...(parent ? { parent } : {}),
    };
    owner.active.push(run);
    if (parent) parent.children.add(run);
    this.step(run, undefined);
    return run;
  }

  /** Lets a run go on until it waits or ends. */
  private step(run: Run, value: unknown): void {
    if (run.done || run.cancelled) return;
    run.waiting = undefined;
    this.waiting.delete(run);
    let result: IteratorResult<Wait, void>;
    try {
      result = run.gen.next(value);
    } catch (error) {
      this.failed(run, error);
      return;
    }
    if (ended(run)) {
      // Ended as it ran (it turned itself off): what it went on to is not done.
      try {
        run.gen.return(undefined);
      } catch {
        // Nothing more to end.
      }
      return;
    }
    if (result.done) {
      if (!run.branch) this.log.push({ kind: "done", at: this.now, owner: run.owner, run: run.id });
      this.finish(run);
      return;
    }
    this.await(run, result.value);
  }

  /** A run stopped by a `stop`, or where it could not be played. */
  private failed(run: Run, error: unknown): void {
    if (!(error instanceof Stop)) this.notPlayed(run.owner, run.id, error);
    if (!run.branch) {
      const why = error instanceof Stop ? error.why : "error";
      this.log.push({ kind: "stopped", at: this.now, owner: run.owner, run: run.id, why });
    }
    this.finish(run);
  }

  private await(run: Run, wait: Wait): void {
    run.waiting = wait;
    run.token += 1;
    const token = run.token;
    const timeout = (until: number | undefined): void => {
      if (until === undefined) return;
      this.at(until, () => {
        if (run.token === token && !run.done && !run.cancelled) this.wake(run, false);
      });
    };
    switch (wait.kind) {
      case "sleep":
        this.at(wait.until, () => {
          if (run.token === token) this.step(run, true);
        });
        break;
      case "check": {
        let ready: boolean;
        try {
          ready = wait.check();
        } catch (error) {
          this.failed(run, error);
          break;
        }
        if (ready) {
          this.at(this.now, () => {
            if (run.token === token) this.step(run, true);
          });
        } else {
          this.waiting.add(run);
          timeout(wait.until);
        }
        break;
      }
      case "trigger": {
        const offs: (() => void)[] = [];
        let fired = false;
        for (const trigger of wait.triggers) {
          try {
            offs.push(
              this.armTrigger(trigger, run.owner, (vars) => {
                if (fired || run.token !== token) return;
                fired = true;
                for (const off of offs) off();
                this.at(this.now, () => {
                  if (run.token === token) this.step(run, { trigger: vars });
                });
              }),
            );
          } catch (error) {
            this.notPlayed(run.owner, run.id, error);
          }
        }
        run.onDone.push(() => {
          for (const off of offs) off();
        });
        if (wait.until !== undefined) {
          this.at(wait.until, () => {
            if (fired || run.token !== token) return;
            fired = true;
            for (const off of offs) off();
            this.step(run, false);
          });
        }
        break;
      }
      case "join": {
        const left = new Set(wait.runs.filter((r) => !r.done));
        if (left.size === 0) {
          this.at(this.now, () => {
            if (run.token === token) this.step(run, true);
          });
          break;
        }
        for (const child of left) {
          child.onDone.push(() => {
            left.delete(child);
            if (left.size === 0 && run.token === token) {
              this.at(this.now, () => {
                if (run.token === token) this.step(run, true);
              });
            }
          });
        }
        break;
      }
    }
  }

  private wake(run: Run, value: unknown): void {
    this.waiting.delete(run);
    run.token += 1;
    const token = run.token;
    this.at(this.now, () => {
      if (run.token === token) this.step(run, value);
    });
  }

  /** Ends a run before its end (its automation restarted, its script turned off, a loop). */
  private cancel(run: Run, why: "restart" | "off" = "restart"): void {
    if (run.done) return;
    run.cancelled = true;
    for (const child of run.children) this.cancel(child, why);
    if (!run.branch) {
      this.log.push({ kind: "stopped", at: this.now, owner: run.owner, run: run.id, why });
    }
    this.finish(run);
  }

  /** An automation or a script turned off: what it is running stops. */
  private stopRuns(id: string): void {
    const owner = this.owners.get(id);
    if (!owner) return;
    // Those waiting their turn are dropped too.
    owner.queue.length = 0;
    for (const run of [...owner.active]) this.cancel(run, "off");
  }

  private finish(run: Run): void {
    if (run.done) return;
    run.done = true;
    if (!run.branch) this.ended.add(run.id);
    run.token += 1;
    this.waiting.delete(run);
    try {
      run.gen.return(undefined);
    } catch {
      // A run ended while it was being stepped: nothing more to end.
    }
    const owner = run.branch ? undefined : this.owners.get(run.owner);
    if (owner) {
      owner.active = owner.active.filter((r) => r !== run);
      // As Home Assistant says how many runs it has now, and a script ended is off.
      const entity = this.states[owner.id];
      const current = owner.active.filter((r) => !r.done).length;
      const state = owner.kind === "script" && current === 0 ? "off" : entity?.state;
      if (entity && state && (state !== entity.state || entity.attributes.current !== current)) {
        this.set(
          owner.id,
          state,
          { ...entity.attributes, current },
          { kind: owner.kind, id: owner.id, run: run.id },
        );
      }
      const next = owner.queue.shift();
      if (next) this.at(this.now, next);
    }
    for (const done of run.onDone.splice(0)) done();
  }

  // --------------------------------------------------------------------------------- steps

  private *sequence(
    steps: Config[],
    variables: Record<string, unknown>,
    owner: Owner,
    run: number,
    depth: number,
  ): Generator<Wait, void, unknown> {
    if (depth > MAX_DEPTH) throw new Unplayable("step", "too deep");
    for (const step of steps) {
      // Its run ended as an action ran (turned off, started again): nothing more of it is done.
      if (this.ended.has(run)) return;
      if (disabled(step)) continue;
      try {
        yield* this.action(step, variables, owner, run, depth);
      } catch (error) {
        if (error instanceof Stop) throw error;
        if (step.continue_on_error === true && !(error instanceof Unplayable)) continue;
        throw error;
      }
    }
  }

  private *action(
    step: Config,
    variables: Record<string, unknown>,
    owner: Owner,
    run: number,
    depth: number,
  ): Generator<Wait, void, unknown> {
    const scope = (): TemplateScope => this.scope(variables);
    if (serviceOf(step) !== undefined) {
      yield* this.call(step, variables, owner, run, depth);
      return;
    }
    if ("delay" in step) {
      const ms = this.duration(step.delay, variables);
      if (ms > 0) yield { kind: "sleep", until: this.now + ms };
      return;
    }
    if ("wait_template" in step) {
      const template = step.wait_template;
      if (typeof template !== "string") throw new Unplayable("step", "wait_template");
      const until =
        step.timeout === undefined ? undefined : this.now + this.duration(step.timeout, variables);
      const done = (yield {
        kind: "check",
        check: () => renderCondition(template, scope()),
        ...(until !== undefined ? { until } : {}),
      }) as boolean;
      variables.wait = {
        completed: done,
        remaining: until === undefined ? null : (until - this.now) / 1000,
      };
      if (!done && step.continue_on_timeout === false) throw new Stop("stop");
      return;
    }
    if ("wait_for_trigger" in step) {
      const triggers = listOf(step.wait_for_trigger).filter(isRecord);
      const until =
        step.timeout === undefined ? undefined : this.now + this.duration(step.timeout, variables);
      const got = yield { kind: "trigger", triggers, ...(until !== undefined ? { until } : {}) };
      variables.wait = {
        trigger: got && typeof got === "object" ? (got as { trigger: unknown }).trigger : null,
        remaining: until === undefined ? null : (until - this.now) / 1000,
      };
      if (!got && step.continue_on_timeout === false) throw new Stop("stop");
      return;
    }
    if ("choose" in step) {
      for (const option of listOf(step.choose).filter(isRecord)) {
        if (this.check(conditionsOf(option.conditions), variables, depth)) {
          yield* this.sequence(stepsOf(option.sequence), variables, owner, run, depth + 1);
          return;
        }
      }
      if (step.default !== undefined) {
        yield* this.sequence(stepsOf(step.default), variables, owner, run, depth + 1);
      }
      return;
    }
    if ("if" in step) {
      const yes = this.check(conditionsOf(step.if), variables, depth);
      const branch = yes ? step.then : step.else;
      if (branch !== undefined)
        yield* this.sequence(stepsOf(branch), variables, owner, run, depth + 1);
      return;
    }
    if ("repeat" in step) {
      yield* this.repeat(step.repeat, variables, owner, run, depth);
      return;
    }
    if ("parallel" in step) {
      const children = listOf(step.parallel)
        .filter(isRecord)
        .map((branch) =>
          this.branch(
            owner,
            run,
            Array.isArray(branch.sequence) ? stepsOf(branch.sequence) : [branch],
            { ...variables },
            depth,
          ),
        );
      if (children.length > 0) yield { kind: "join", runs: children };
      return;
    }
    if ("sequence" in step) {
      yield* this.sequence(stepsOf(step.sequence), variables, owner, run, depth + 1);
      return;
    }
    if ("stop" in step) {
      throw new Stop(step.error === true ? "error" : "stop");
    }
    if ("condition" in step || "and" in step || "or" in step || "not" in step) {
      if (!this.check([step], variables, depth)) throw new Stop("condition");
      return;
    }
    if ("variables" in step) {
      if (isRecord(step.variables)) Object.assign(variables, renderDeep(step.variables, scope()));
      return;
    }
    if ("event" in step) {
      const type = isTemplate(step.event)
        ? String(render(step.event, scope()))
        : String(step.event);
      const data = isRecord(step.event_data)
        ? (renderDeep(step.event_data, scope()) as Config)
        : {};
      this.fireEvent(type, data);
      return;
    }
    if ("scene" in step) {
      this.applyScene(String(step.scene), owner, run);
      return;
    }
    if ("set_conversation_response" in step) return;
    if ("device_id" in step && "domain" in step) {
      const raw = typeof step.entity_id === "string" ? step.entity_id : "";
      const entity = this.states[raw] ? raw : this.world.entityFromRegistryId(raw);
      const type = typeof step.type === "string" ? step.type : "";
      if (entity && ["turn_on", "turn_off", "toggle"].includes(type)) {
        yield* this.call(
          { action: `${entity.split(".")[0]}.${type}`, target: { entity_id: entity } },
          variables,
          owner,
          run,
          depth,
        );
        return;
      }
      throw new Unplayable("step", `device ${type}`);
    }
    throw new Unplayable("step", Object.keys(step).join(", "));
  }

  /** A branch of `parallel`, run beside the others: a run of the same owner's, not counted apart. */
  private branch(
    owner: Owner,
    run: number,
    steps: Config[],
    variables: Record<string, unknown>,
    depth: number,
  ): Run {
    const parent = owner.active.find((r) => r.id === run);
    const child: Run = {
      id: run,
      owner: owner.id,
      kind: owner.kind,
      gen: this.sequence(steps, variables, owner, run, depth + 1),
      done: false,
      cancelled: false,
      children: new Set(),
      onDone: [],
      token: 0,
      branch: true,
      ...(parent ? { parent } : {}),
    };
    parent?.children.add(child);
    this.step(child, undefined);
    return child;
  }

  private *repeat(
    repeat: unknown,
    variables: Record<string, unknown>,
    owner: Owner,
    run: number,
    depth: number,
  ): Generator<Wait, void, unknown> {
    if (!isRecord(repeat)) throw new Unplayable("step", "repeat");
    const steps = stepsOf(repeat.sequence);
    const outer = variables.repeat;
    const round = function* (this: Day, index: number, count: number | undefined, item?: unknown) {
      variables.repeat = {
        index,
        first: index === 1,
        ...(count !== undefined ? { last: index === count } : {}),
        ...(item !== undefined ? { item } : {}),
      };
      yield* this.sequence(steps, variables, owner, run, depth + 1);
    }.bind(this);
    if (repeat.count !== undefined) {
      const count = Number(
        isTemplate(repeat.count) ? render(repeat.count, this.scope(variables)) : repeat.count,
      );
      if (!Number.isFinite(count)) throw new Unplayable("step", "repeat count");
      if (count > MAX_REPEAT) throw new Unplayable("repeat", String(count));
      for (let k = 1; k <= count; k += 1) yield* round(k, count);
    } else if (repeat.for_each !== undefined) {
      const items = isTemplate(repeat.for_each)
        ? listOf(render(repeat.for_each, this.scope(variables)))
        : listOf(repeat.for_each);
      if (items.length > MAX_REPEAT) throw new Unplayable("repeat", String(items.length));
      for (let k = 0; k < items.length; k += 1) yield* round(k + 1, items.length, items[k]);
    } else if (repeat.while !== undefined) {
      const conditions = conditionsOf(repeat.while);
      for (let k = 1; ; k += 1) {
        variables.repeat = { index: k, first: k === 1 };
        if (!this.check(conditions, variables, depth)) break;
        if (k > MAX_REPEAT) throw new Unplayable("repeat", "while");
        yield* round(k, undefined);
      }
    } else if (repeat.until !== undefined) {
      const conditions = conditionsOf(repeat.until);
      for (let k = 1; ; k += 1) {
        if (k > MAX_REPEAT) throw new Unplayable("repeat", "until");
        yield* round(k, undefined);
        if (this.check(conditions, variables, depth)) break;
      }
    } else throw new Unplayable("step", "repeat");
    variables.repeat = outer;
  }

  // --------------------------------------------------------------------------------- calls

  /** The entities a call targets. */
  private targets(data: Config, target: Config): string[] {
    const ids = new Set<string>();
    const all = (value: unknown): boolean =>
      value === "all" || (Array.isArray(value) && value.includes("all"));
    for (const source of [target, data]) {
      if (all(source.entity_id)) for (const id of Object.keys(this.states)) ids.add(id);
      for (const id of idsOf(source.entity_id)) if (id !== "all") ids.add(id);
      for (const device of textsOf(source.device_id)) {
        for (const id of this.world.entitiesOfDevice(device)) ids.add(id);
      }
      const areas = textsOf(source.area_id);
      for (const floor of textsOf(source.floor_id)) areas.push(...this.world.areasOfFloor(floor));
      for (const area of areas) for (const id of this.world.entitiesOfArea(area)) ids.add(id);
      for (const label of textsOf(source.label_id)) {
        for (const id of this.world.entitiesOfLabel(label)) ids.add(id);
      }
    }
    return [...ids];
  }

  private *call(
    step: Config,
    variables: Record<string, unknown>,
    owner: Owner,
    run: number,
    depth: number,
  ): Generator<Wait, void, unknown> {
    const scope = this.scope(variables);
    const raw = serviceOf(step);
    const service = String(isTemplate(raw) ? render(raw, scope) : raw);
    const [domain = "", name = ""] = service.split(".");
    const data = renderDeep(
      {
        ...(isRecord(step.data_template) ? step.data_template : {}),
        ...(isRecord(step.data) ? step.data : {}),
      },
      scope,
    ) as Config;
    const target = renderDeep(
      {
        ...(isRecord(step.target) ? step.target : {}),
        ...(step.entity_id !== undefined ? { entity_id: step.entity_id } : {}),
      },
      scope,
    ) as Config;
    if (typeof step.response_variable === "string") variables[step.response_variable] = {};
    const cause: Cause = { kind: owner.kind, id: owner.id, run };
    const changed = yield* this.perform(domain, name, data, target, cause, owner, run, depth);
    if (changed !== undefined) {
      this.log.push({ kind: "call", at: this.now, owner: owner.id, run, service, changed });
    }
  }

  /**
   * Does `domain.name` in the copy: returns the entities it changed, or `undefined` when what it
   * does was said otherwise (said, run, not known).
   */
  private *perform(
    domain: string,
    name: string,
    data: Config,
    target: Config,
    cause: Cause,
    owner: Owner | undefined,
    run: number | undefined,
    depth: number,
  ): Generator<Wait, string[] | undefined, unknown> {
    const service = `${domain}.${name}`;
    const who = owner?.id ?? "you";
    if (QUIET_SERVICES.has(service)) return [];
    if (SAYING_DOMAINS.has(domain)) {
      if (owner && run !== undefined) {
        const message = typeof data.message === "string" ? data.message : undefined;
        this.log.push({
          kind: "said",
          at: this.now,
          owner: owner.id,
          run,
          service,
          ...(message !== undefined ? { message } : {}),
        });
      }
      return undefined;
    }
    const ids = this.targets(data, target);
    if (
      domain === "script" &&
      name !== "turn_on" &&
      name !== "turn_off" &&
      name !== "toggle" &&
      name !== "reload"
    ) {
      // A script called by name: the caller waits for it to end.
      const started = this.runScript(
        `script.${name}`,
        data,
        who,
        owner ? this.runOf(owner, run) : undefined,
      );
      if (started) yield { kind: "join", runs: [started] };
      return [];
    }
    if (domain === "script" && name === "turn_on") {
      const variables = isRecord(data.variables) ? data.variables : {};
      for (const id of ids) this.runScript(id, variables, who, undefined);
      return [];
    }
    if (domain === "script" && name === "turn_off") {
      for (const id of ids) this.stopRuns(id);
      return [];
    }
    if (domain === "script" && name === "toggle") {
      // Running: stopped; else started, as Home Assistant toggles a script.
      for (const id of ids) {
        if ((this.owners.get(id)?.active.length ?? 0) > 0) this.stopRuns(id);
        else this.runScript(id, {}, who, undefined);
      }
      return [];
    }
    if (domain === "automation" && name === "trigger") {
      for (const id of ids) {
        const automation = this.owners.get(id);
        if (!automation || automation.kind !== "automation") continue;
        this.trigger(
          automation,
          { kind: "called", by: who },
          { trigger: { platform: null } },
          data.skip_condition !== false,
        );
      }
      return [];
    }
    if (domain === "scene" && name === "turn_on") {
      // Each scene says what it changed, or that it could not be played.
      for (const id of ids) this.applyScene(id, owner, run, cause);
      return undefined;
    }
    if (domain === "scene" && name === "apply") {
      const entities = isRecord(data.entities) ? data.entities : {};
      for (const [id, value] of Object.entries(entities)) {
        const state = text(isRecord(value) ? (value.state ?? "") : value);
        const attributes = isRecord(value)
          ? Object.fromEntries(Object.entries(value).filter(([k]) => k !== "state"))
          : undefined;
        if (this.states[id])
          this.set(
            id,
            state,
            attributes ? { ...this.states[id].attributes, ...attributes } : undefined,
            cause,
          );
      }
      return Object.keys(entities);
    }
    if (domain === "homeassistant" && ["turn_on", "turn_off", "toggle"].includes(name)) {
      const changed: string[] = [];
      // Each entity by its own domain's service, its data without the targets already read.
      const rest = Object.fromEntries(
        Object.entries(data).filter(([key]) => !TARGET_KEYS.includes(key)),
      );
      for (const id of ids) {
        const own = id.split(".")[0] ?? "";
        if (!SWITCHED_DOMAINS.has(own)) continue;
        const inner = yield* this.perform(
          own,
          name,
          rest,
          { entity_id: id },
          cause,
          owner,
          run,
          depth,
        );
        if (inner) changed.push(...inner);
      }
      return changed;
    }
    if (domain === "timer") {
      const timers = ids.filter(
        (id) =>
          id.startsWith("timer.") && (this.states[id]?.state ?? "unavailable") !== "unavailable",
      );
      const was = new Map(timers.map((id) => [id, this.states[id]?.state]));
      const changed = this.applyEffect(timers, domain, name, data, cause, who, run);
      for (const id of timers) this.timerAfter(id, name, was.get(id));
      return changed;
    }
    if (domain === "automation" && name === "turn_off" && data.stop_actions !== false) {
      // Turned off, its runs stop too (Home Assistant's `stop_actions`, on unless said).
      for (const id of ids) if (id.startsWith("automation.")) this.stopRuns(id);
    }
    // An integration's own service (`zwave_js.…`) acts on entities of other domains: what it
    // does to them cannot be known.
    const own = ids.filter((id) => id.startsWith(`${domain}.`));
    if (own.length === 0) {
      this.notPlayed(who, run, new Unplayable("effect", service));
      return undefined;
    }
    return this.applyEffect(own, domain, name, data, cause, who, run);
  }

  private runOf(owner: Owner, run: number | undefined): Run | undefined {
    return owner.active.find((r) => r.id === run);
  }

  private applyEffect(
    ids: string[],
    domain: string,
    name: string,
    data: Config,
    cause: Cause,
    who: string,
    run: number | undefined,
  ): string[] {
    const changed: string[] = [];
    for (const id of ids) {
      const entity = this.states[id];
      if (!entity || entity.state === "unavailable") continue;
      const own = id.split(".")[0] ?? "";
      if (own !== domain && domain !== "homeassistant") continue;
      const effect = effectOn(entity, own, name, data, this.now, this.world.zone);
      if (!effect) {
        this.notPlayed(who, run, new Unplayable("effect", `${domain}.${name}`));
        continue;
      }
      const before = JSON.stringify([entity.state, entity.attributes]);
      this.set(id, effect.state, effect.attributes, cause);
      if (JSON.stringify([this.states[id]?.state, this.states[id]?.attributes]) !== before)
        changed.push(id);
    }
    return changed;
  }

  /** A timer started finishes after its duration, unless started again or ended before. */
  private timerAfter(id: string, service: string, was: string | undefined): void {
    // What else a timer's service does: its end waited for or no longer, its events.
    if (!["start", "pause", "cancel", "finish"].includes(service)) return;
    const generation = (this.timers.get(id) ?? 0) + 1;
    this.timers.set(id, generation);
    if (service !== "start") {
      if (service === "finish" && (was === "active" || was === "paused")) {
        this.fireEvent("timer.finished", { entity_id: id });
      }
      if (service === "cancel" && was !== "idle") {
        this.fireEvent("timer.cancelled", { entity_id: id });
      }
      return;
    }
    const finishes = Date.parse(text(this.states[id]?.attributes.finishes_at ?? ""));
    if (!Number.isFinite(finishes)) return;
    this.fireEvent("timer.started", { entity_id: id });
    this.at(finishes, () => {
      if (this.timers.get(id) !== generation) return;
      const timer = this.states[id];
      if (!timer || timer.state !== "active") return;
      const attributes = { ...timer.attributes };
      delete attributes.finishes_at;
      this.set(id, "idle", attributes, { kind: "day" });
      this.fireEvent("timer.finished", { entity_id: id });
    });
  }

  private runScript(
    id: string,
    variables: Config,
    by: string,
    parent: Run | undefined,
  ): Run | undefined {
    const script = this.owners.get(id);
    if (!script || script.kind !== "script") {
      this.notPlayed(by, parent?.id, new Unplayable("script", id));
      return undefined;
    }
    const fields = isRecord(variables) ? variables : {};
    return this.launch(
      script,
      { kind: "called", by },
      { ...fields },
      actionsOf(script.config),
      parent,
    );
  }

  private applyScene(
    id: string,
    owner: Owner | undefined,
    run: number | undefined,
    cause?: Cause,
  ): void {
    const scene = this.scenes.get(id);
    const who = owner?.id ?? "you";
    if (!scene?.entities) {
      this.notPlayed(who, run, new Unplayable("scene", id));
      return;
    }
    const by: Cause =
      cause ??
      (owner && run !== undefined ? { kind: owner.kind, id: owner.id, run } : { kind: "you" });
    const changed: string[] = [];
    for (const [entity, wanted] of Object.entries(scene.entities)) {
      const current = this.states[entity];
      if (!current) continue;
      this.set(entity, wanted.state, { ...current.attributes, ...wanted.attributes }, by);
      changed.push(entity);
    }
    if (owner && run !== undefined) {
      this.log.push({
        kind: "call",
        at: this.now,
        owner: owner.id,
        run,
        service: "scene.turn_on",
        changed,
      });
    }
  }

  /** Something done by hand: as a call, with its changes said to be yours. */
  private callByHand(call: HandCall): void {
    const gen = this.perform(
      call.domain,
      call.service,
      call.data ?? {},
      call.target ?? {},
      { kind: "you" },
      undefined,
      undefined,
      0,
    );
    // A call by hand does not wait: a script it starts runs on its own.
    try {
      for (let result = gen.next(); !result.done; result = gen.next(true)) {
        /* the waits of a call by hand are not waited for */
      }
    } catch (error) {
      this.notPlayed("you", undefined, error);
    }
  }
}

/** Plays `world`'s day from `start` to `end` (ms), with what happens and what is done by hand. */
export function playDay(
  world: World,
  start: number,
  end: number,
  happenings: readonly Happening[],
  calls: readonly HandCall[] = [],
): DayPlayed {
  return new Day(world, start, end).play(happenings, calls);
}
