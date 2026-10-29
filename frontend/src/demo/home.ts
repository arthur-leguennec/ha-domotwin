/**
 * The demo house's Home Assistant (D-050): a `hass` of its own, its states living a day on a
 * clock of their own, its connection answering DomoTwin's commands from memory. The panel and
 * the card run on it unchanged; nothing it does reaches the visitor's home.
 */
import type {
  Bindings,
  NewSchedule,
  PlanJson,
  SaveKind,
  Settings,
  StoreyInfo,
  UpdateEvent,
} from "../ha/client";
import type {
  HassAreaEntry,
  HassContext,
  HassEntity,
  HassEntityEntry,
  HassFloorEntry,
  HomeAssistant,
} from "../ha/types";
import type { PeopleSettings } from "../live/people";
import type { Choices } from "../live/choices";
import type { ConfigKind } from "../live/config-history";
import { MAX_SCHEDULE_ENTITIES, schedulable, type Schedule } from "../live/schedules";
import { heatingNow } from "../live/back";
import type { Garden } from "../live/lawn";
import type { Upkeep } from "../live/upkeep";
import type { StoredWifi } from "../live/wifi";
import { DemoConfigHistory } from "./config-history";
import { DemoReport } from "./report";
import { demoConnection, type MemoryHome } from "./connection";
import { demoHistory, demoLogbook } from "./history";
import { DemoLogbook, type Recorded } from "./logbook";
import {
  DAY,
  at,
  batteryAt,
  chargeAfter,
  flowsAt,
  homePower,
  ofDay,
  robotBatteryAfter,
  robotBatteryAt,
  sensorsAt,
  solarAt,
  tvPower,
  vacuumAt,
  wantedAt,
  whereAt,
  type Change,
} from "./day";
import {
  AREAS,
  AUTOMATIONS,
  PEOPLE,
  STOREYS,
  THINGS,
  demoBindings,
  demoPeople,
  demoSettings,
  demoShortcuts,
  demoUpkeep,
  localPlan,
  roomSensorOf,
  say,
  SCHEDULED,
  type Words,
} from "./house";
import { callService } from "./services";

/** When the demo starts: a morning, the robot about to clean, the washing machine running. */
export const DEMO_START = at(8, 56);
/** How fast the demo's day goes: demo minutes a second. */
const MINUTES_A_SECOND = 1;
/** An action starts within a year, and lasts a week at most (the integration's limits). */
const DAY_MS = 86_400_000;
const MAX_SCHEDULE_DAYS = 366;
const MAX_SCHEDULE_SPAN_DAYS = 7;
/** What set the house as it is when the demo goes to another moment (D-059). */
const THE_DAY: Words = ["The demo house’s day", "La journée de la maison de démo"];

/** A storey of the demo house, as kept. */
interface StoreyKept {
  info: StoreyInfo;
  plan: PlanJson;
  layout: Record<string, unknown>;
}

/** What the demo house keeps, as the integration would. */
export interface DemoStore {
  revision: number;
  storeys: StoreyKept[];
  bindings: Bindings;
  settings: Settings;
  upkeep: Upkeep;
  people: PeopleSettings;
  schedules: Schedule[];
  /** The visitor's own choices (D-055), until they leave. */
  choices: Choices;
  /** The home's Wi-Fi for guests (D-060): the demo house's is fictional. */
  wifi?: StoredWifi;
  /** When each lawn was last mown and each robot mower last mowed (D-077). */
  garden?: Garden;
}

/** Who opens the demo: their language, name and look, from their own Home Assistant. */
export interface DemoVisitor {
  language: string;
  name?: string;
  darkMode?: boolean;
}

/** A websocket error, as Home Assistant gives one: a code, and words. */
/** The house at a moment, to put back as it was (after a measure, D-053). */
export interface DemoSnapshot {
  minute: number;
  day: number;
  playing: boolean;
  battery: number;
  robotBattery: number;
  states: Record<string, HassEntity>;
  said: [string, string][];
  since: [string, number][];
  recorded: Recorded[];
}

export class DemoError extends Error {
  constructor(
    readonly code: string,
    message = code,
  ) {
    super(message);
  }
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** `days` after the day `day` (its midnight), at `hour` o'clock. */
function dayAt(day: Date, days: number, hour: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + days, hour);
}

/** A local date as `YYYY-MM-DD`. */
function dateOf(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Home Assistant's energy settings in the demo house, naming its power sensors. */
const ENERGY_PREFS = {
  energy_sources: [
    {
      type: "solar",
      stat_energy_from: "sensor.solar_energy",
      stat_rate: "sensor.solar_power",
    },
    {
      type: "grid",
      flow_from: [],
      flow_to: [],
      power: [{ stat_rate: "sensor.grid_power" }],
    },
    {
      type: "battery",
      stat_energy_from: "sensor.battery_out",
      stat_energy_to: "sensor.battery_in",
      stat_rate: "sensor.battery_power",
    },
  ],
  device_consumption: [],
};

/** The demo house, its day and its Home Assistant. */
export class DemoHome implements MemoryHome {
  readonly kind = "demo";
  /** The `hass` to give the panel or the card: a new object at each change. */
  hass: HomeAssistant;
  /** The minute of the demo's day, and how many days it has gone round. */
  minute = DEMO_START;
  private day = 0;
  /** Whether the day goes on by itself (the visitor's choice). */
  playing = false;
  /** Held while its panel or card is away, as the visitor left it otherwise. */
  private held = false;
  readonly store: DemoStore;
  /** Its configuration history (D-062), put back in the page. */
  readonly configHistory: DemoConfigHistory;
  /** Its weekly reports (D-081), made up for its rooms. */
  readonly weekly: DemoReport;
  private readonly language: string;
  private readonly states: Record<string, HassEntity> = {};
  private readonly areaOf = new Map<string, string>();
  /** The day's last say on each entity, to change it only when the day does. */
  private readonly said = new Map<string, string>();
  /** The home battery's charge, and the robot vacuum's (%). */
  private battery = 30;
  private robotBattery = 100;
  /** When each entity last changed state (demo minutes since the start). */
  private readonly since = new Map<string, number>();
  private readonly listeners = new Set<(hass: HomeAssistant) => void>();
  private readonly clockListeners = new Set<() => void>();
  readonly updateListeners = new Set<(event: UpdateEvent) => void>();
  readonly scheduleListeners = new Set<(schedules: Schedule[]) => void>();
  private timer?: ReturnType<typeof setInterval>;
  private scheduleCount = 0;
  /** What its Home Assistant recorded (D-059), and the contexts it wrote states in. */
  readonly recorded = new DemoLogbook();
  private contexts = 0;
  /** The context the states are written in now (the demo going to another moment), else each
   * write its own: a device's. */
  private writing?: HassContext;
  /** When it opened (ms): what its logbook recorded starts then. */
  private readonly opened: number;
  /** The automations that ran this minute, and the context of each run. */
  private readonly runs = new Map<string, HassContext>();
  /** The first day, in this device's time zone (the demo's clock is a wall clock there). */
  private readonly first: Date;

  constructor(visitor: DemoVisitor) {
    this.language = visitor.language;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    this.first = today;
    const language = visitor.language;
    this.store = {
      revision: 1,
      storeys: STOREYS.map((s) => ({
        info: { ...s.info, name: say(s.names, language) },
        plan: localPlan(s.plan, language),
        layout: {},
      })),
      bindings: demoBindings(),
      settings: demoSettings(),
      upkeep: demoUpkeep(dateOf(today), language),
      // The front lawn mown three days ago; the robot mower out on the back one yesterday.
      garden: {
        lawns: { "front-garden": dayAt(today, -3, 17).toISOString() },
        mowers: { "lawn_mower.mowy": dayAt(today, -1, 12).toISOString() },
      },
      people: demoPeople(),
      schedules: [],
      // A fictional network: its code joins nothing.
      wifi: {
        name: "Demo house guests",
        password: "fictional-demo-network",
        security: "WPA",
        hidden: false,
        screens: [],
      },
      choices: {
        favourites: [
          "light.living_floor_lamp",
          "climate.living_room",
          "cover.living_curtains",
          "lock.front_door",
        ],
        cards: [],
        shortcuts: demoShortcuts(language),
      },
    };
    const entities: Record<string, HassEntityEntry> = {};
    const now = this.time();
    this.opened = Date.parse(now);
    // The house as it starts: set by the demo's day, which its logbook says (D-059).
    const start = this.dayContext(now);
    for (const thing of THINGS) {
      this.states[thing.id] = {
        entity_id: thing.id,
        state: thing.state,
        attributes: { friendly_name: say(thing.names, language), ...thing.attributes },
        last_changed: now,
        last_updated: now,
        context: start,
      };
      this.recordChange(thing.id, thing.state, start, now);
      entities[thing.id] = { entity_id: thing.id, area_id: thing.area ?? null };
      if (thing.area) this.areaOf.set(thing.id, thing.area);
    }
    for (const person of PEOPLE) {
      this.states[person.id] = {
        entity_id: person.id,
        state: "home",
        attributes: { friendly_name: person.name },
        last_changed: now,
        last_updated: now,
        context: start,
      };
      this.recordChange(person.id, "home", start, now);
      entities[person.id] = { entity_id: person.id };
    }
    for (const automation of AUTOMATIONS) {
      this.states[automation.id] = {
        entity_id: automation.id,
        state: "on",
        attributes: {
          friendly_name: say(automation.names, language),
          id: automation.id.slice(11),
          last_triggered: null,
        },
        last_changed: now,
        last_updated: now,
        context: start,
      };
      this.recordChange(automation.id, "on", start, now);
      entities[automation.id] = { entity_id: automation.id };
    }
    const areas: Record<string, HassAreaEntry> = {};
    for (const area of AREAS) {
      areas[area.id] = {
        area_id: area.id,
        name: say(area.names, language),
        floor_id: `${area.storey}_floor`,
      };
    }
    const floors: Record<string, HassFloorEntry> = {};
    for (const [level, storey] of STOREYS.entries()) {
      const id = `${storey.info.id}_floor`;
      // Ordered by level, not by name: the upper floor is not first in Spanish (D-082).
      floors[id] = { floor_id: id, name: say(storey.names, language), level };
    }
    this.weekly = new DemoReport(Date.parse(this.time()), language, () => Date.parse(this.time()));
    this.configHistory = new DemoConfigHistory(Date.parse(this.time()), language, () =>
      Date.parse(this.time()),
    );
    const connection = demoConnection(this);
    this.hass = {
      states: {},
      entities,
      devices: {},
      areas,
      floors,
      user: { id: "demo-visitor", name: visitor.name ?? "", is_admin: true },
      language,
      locale: { language },
      themes: { darkMode: visitor.darkMode === true },
      config: {
        unit_system: { temperature: "°C" },
        components: ["domotwin", "energy", "logbook"],
        // Its times are written as its clock reads them: this device's time zone.
        time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      connection,
      demo: true,
      now: () => Date.parse(this.time()),
      callService: (domain, service, data, target) => {
        this.callService(domain, service, data ?? {}, target ?? {});
        return Promise.resolve();
      },
      // Home Assistant's configuration API, for what the configuration history puts back (D-062).
      callApi: <T>(method: string, path: string, parameters?: Record<string, unknown>) => {
        const found = /^config\/(automation|script|scene)\/config\/(.+)$/.exec(path);
        if (method !== "POST" || !found) {
          return Promise.reject(
            new DemoError("not_found", `${method} /api/${path} is not in the demo house`),
          );
        }
        this.configHistory.putBack(
          found[1] as ConfigKind,
          decodeURIComponent(found[2] ?? ""),
          parameters,
        );
        return Promise.resolve({ result: "ok" } as T);
      },
    };
    this.jump(DEMO_START);
  }

  /** The demo's time now, or at another minute of a demo day, as ISO: its wall clock's. */
  time(minute = this.minute, day = this.day): string {
    const first = this.first;
    return new Date(
      first.getFullYear(),
      first.getMonth(),
      first.getDate() + day,
      0,
      minute,
    ).toISOString();
  }

  /** The demo's date (`YYYY-MM-DD`). */
  today(): string {
    const first = this.first;
    return dateOf(new Date(first.getFullYear(), first.getMonth(), first.getDate() + this.day));
  }

  /** Demo minutes since the demo began. */
  private elapsed(): number {
    return this.day * DAY + this.minute;
  }

  /** The area an entity is in. */
  area(id: string): string | undefined {
    return this.areaOf.get(id);
  }

  automationIds(): string[] {
    return AUTOMATIONS.map((a) => a.id);
  }

  automationConfig(id: string): Record<string, unknown> | undefined {
    return AUTOMATIONS.find((a) => a.id === id)?.config;
  }

  energyPrefs(): unknown {
    return ENERGY_PREFS;
  }

  /** Its day as Home Assistant's history (D-058), up to the demo's clock. */
  history(entities: readonly string[], start: number, end: number): unknown {
    return demoHistory(entities, start, end, Date.parse(this.time()), (id) => {
      return this.hass.states[id]?.state;
    });
  }

  /**
   * Its day's changes as Home Assistant's logbook, with the automations that made them: the same
   * day every day back before it opened (D-058), what it recorded since, with whoever made them
   * (D-059).
   */
  logbook(entities: readonly string[], start: number, end: number): unknown {
    const before = demoLogbook(
      entities,
      start,
      Math.min(end, this.opened),
      Date.parse(this.time()),
      (id) => {
        const name = this.hass.states[id]?.attributes.friendly_name;
        return typeof name === "string" ? name : id;
      },
    );
    const since = this.recorded.events({ start: Math.max(start, this.opened), end, entities });
    return [...before, ...since];
  }

  /** Follows the `hass` objects to come. */
  subscribe(listener: (hass: HomeAssistant) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Follows the clock (the time, playing or not). */
  watchClock(listener: () => void): () => void {
    this.clockListeners.add(listener);
    return () => this.clockListeners.delete(listener);
  }

  /** Lets the day go on by itself, or holds it. */
  play(playing: boolean): void {
    if (playing === this.playing) return;
    this.playing = playing;
    this.tick();
    for (const listener of this.clockListeners) listener();
  }

  /** Holds the day while its panel or card is away, and lets it go on again as it was. */
  away(away: boolean): void {
    this.held = away;
    this.tick();
  }

  /** The clock going while the day plays and nobody is away. */
  private tick(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    if (this.playing && !this.held) {
      this.timer = setInterval(() => {
        this.advance(MINUTES_A_SECOND);
      }, 1000);
    }
  }

  /** Stops the clock for good (the demo is left). */
  stop(): void {
    this.play(false);
    this.listeners.clear();
    this.clockListeners.clear();
  }

  /** The house now: its moment, its clock and everything in it as it is. */
  snapshot(): DemoSnapshot {
    return {
      minute: this.minute,
      day: this.day,
      playing: this.playing,
      battery: this.battery,
      robotBattery: this.robotBattery,
      states: structuredClone(this.states),
      said: [...this.said],
      since: [...this.since],
      recorded: this.recorded.kept(),
    };
  }

  /** Puts the house back as `snapshot` had it: what the visitor changed with it. */
  restore(snapshot: DemoSnapshot): void {
    this.minute = snapshot.minute;
    this.day = snapshot.day;
    this.battery = snapshot.battery;
    this.robotBattery = snapshot.robotBattery;
    // The house's entities never change: their states are put back.
    Object.assign(this.states, structuredClone(snapshot.states));
    this.said.clear();
    for (const [id, said] of snapshot.said) this.said.set(id, said);
    this.since.clear();
    for (const [id, since] of snapshot.since) this.since.set(id, since);
    this.recorded.restore(snapshot.recorded);
    this.publish();
    this.play(snapshot.playing);
  }

  /** Goes to `minute` of the day (the next day when it is earlier): the house as it is then. */
  jump(minute: number): void {
    const target = ofDay(minute);
    if (target < this.minute) this.day += 1;
    this.minute = target;
    this.battery = batteryAt(target);
    this.robotBattery = robotBatteryAt(target);
    this.said.clear();
    // The house as it is then: set by the demo's day, which its logbook says (D-059).
    this.writing = this.dayContext(this.time());
    this.applyDay(true);
    this.writing = undefined;
    this.publish();
  }

  /** The day goes on by `minutes`. */
  advance(minutes: number): void {
    for (let k = 0; k < minutes; k += 1) {
      this.minute += 1;
      if (this.minute >= DAY) {
        this.minute -= DAY;
        this.day += 1;
      }
      this.applyDay(false, 1);
    }
    this.publish();
  }

  /** Sets what the day says now: the sensors always, the rest when the day changes it. */
  private applyDay(all: boolean, minutes = 0): void {
    const m = this.minute;
    const now = this.time();
    this.runs.clear();
    for (const [id, change] of sensorsAt(m)) this.set(id, change, now);
    for (const [id, change] of wantedAt(m)) {
      const said = JSON.stringify([change.state, change.attributes ?? {}]);
      if (!all && this.said.get(id) === said) continue;
      this.said.set(id, said);
      const before = this.states[id]?.state;
      // Sent home by hand and docked already: not on its way home again.
      if (change.state === "returning" && before === "docked") continue;
      // A change an automation makes is written in its run (D-059).
      const run =
        !all && change.automation && before !== change.state
          ? this.run(change.automation, now)
          : undefined;
      this.set(id, change, now, false, run);
    }
    // A robot sent out by hand comes home after a while, as a real one does (the day's own run
    // goes on to its end).
    const robot = this.states["vacuum.robot"];
    const out = this.elapsed() - (this.since.get("vacuum.robot") ?? 0);
    if (robot?.state === "cleaning" && out >= 45 && vacuumAt(m) !== "cleaning")
      this.set("vacuum.robot", { state: "returning" }, now);
    if (robot?.state === "returning" && out >= 6)
      this.set("vacuum.robot", { state: "docked" }, now);
    if (minutes > 0) {
      this.robotBattery = robotBatteryAfter(
        this.robotBattery,
        this.states["vacuum.robot"]?.state,
        minutes,
      );
    }
    this.set("sensor.robot_battery", { state: String(Math.round(this.robotBattery)) }, now);
    // The TV draws as it plays.
    const tv = tvPower(this.states["media_player.living_tv"]?.state);
    this.set("sensor.tv_power", { state: String(tv) }, now);
    // The thermostats read their rooms.
    for (const [climate, sensor] of [
      ["climate.living_room", "sensor.living_temperature"],
      ["climate.office", "sensor.office_temperature"],
      ["climate.bedroom", "sensor.bedroom_temperature"],
    ] as const) {
      const temperature = Number(this.states[sensor]?.state);
      if (Number.isFinite(temperature)) {
        this.set(
          climate,
          {
            state: this.states[climate]?.state ?? "heat",
            attributes: { current_temperature: temperature },
          },
          now,
        );
      }
    }
    this.placePeople(now);
    this.runSchedules(now);
    // The energy: the sun, what the home draws now, the battery and the grid.
    const solar = solarAt(m);
    const home = homePower(this.states, m);
    const flows = flowsAt(solar, home, this.battery);
    if (minutes > 0) this.battery = chargeAfter(this.battery, flows.battery, minutes);
    this.set("sensor.solar_power", { state: String(solar) }, now);
    this.set("sensor.grid_power", { state: String(flows.grid) }, now);
    this.set("sensor.battery_power", { state: String(flows.battery) }, now);
    this.set("sensor.battery_level", { state: String(Math.round(this.battery)) }, now);
  }

  /** Where each person is: their person entity, their room sensor and their phone's area. */
  private placePeople(now: string): void {
    for (const person of PEOPLE) {
      const { room, since } = whereAt(person.id, this.minute);
      const area = AREAS.find((a) => a.room === room);
      const storey = this.store.storeys.find((s) => s.info.id === area?.storey);
      const name = area ? say(area.names, this.language) : "not_home";
      this.set(person.id, { state: room ? "home" : "not_home" }, now);
      const source = `sensor.${person.id.slice(7)}_phone_area`;
      this.set(
        roomSensorOf(person.id),
        {
          state: name,
          attributes: area
            ? {
                person: person.id,
                room_id: area.room,
                area_id: area.id,
                storey_id: area.storey,
                storey: storey?.info.name ?? "",
                since: this.time(since),
                source,
              }
            : { person: person.id },
        },
        now,
        true,
      );
      this.set(
        source,
        { state: name, attributes: { friendly_name: `${person.name} · phone` } },
        now,
      );
    }
  }

  /** A context of the demo's day (D-059): the house set as it is at a moment, so recorded. */
  private dayContext(now: string): HassContext {
    const context = this.context();
    this.recorded.record({
      when: Date.parse(now) / 1000,
      context,
      event: "demo_day",
      name: say(THE_DAY, this.language),
    });
    return context;
  }

  /** A new context (D-059): of `parent`'s doing, or of a user's. */
  private context(parent?: string, user?: string): HassContext {
    this.contexts += 1;
    return { id: `demo-${this.contexts}`, parent_id: parent ?? null, user_id: user ?? null };
  }

  /** Records a change of state in the logbook, as Home Assistant's would show it: the sensors
   * that measure (a number) are left out, as its logbook leaves them. */
  private recordChange(id: string, state: string, context: HassContext, now: string): void {
    if (id.startsWith("sensor.") && state.trim() !== "" && Number.isFinite(Number(state))) return;
    this.recorded.record({ when: Date.parse(now) / 1000, context, entity: id, state });
  }

  /**
   * Sets an entity as `change` says, written in `context` (else the demo's own of the moment, or
   * a device's); a new state object only when something changed.
   */
  private set(
    id: string,
    change: Change,
    now: string,
    replace = false,
    context?: HassContext,
  ): void {
    const before = this.states[id];
    const attributes = replace
      ? {
          ...(before?.attributes.friendly_name
            ? { friendly_name: before.attributes.friendly_name }
            : {}),
          ...change.attributes,
        }
      : { ...before?.attributes, ...change.attributes };
    if (
      before &&
      before.state === change.state &&
      JSON.stringify(before.attributes) === JSON.stringify(attributes)
    ) {
      return;
    }
    const moved = before?.state !== change.state;
    if (moved) {
      this.since.set(id, this.elapsed());
      this.noteMower(id, before?.state, change.state, now);
    }
    const written = context ?? this.writing ?? this.context();
    this.states[id] = {
      entity_id: id,
      state: change.state,
      attributes,
      last_changed: before && !moved ? before.last_changed : now,
      last_updated: now,
      context: written,
    };
    if (moved) this.recordChange(id, change.state, written, now);
  }

  /**
   * An automation runs now (once a minute at most): its run's context, set off by the change of
   * the trigger that fired (its parent), and its row in the logbook, as Home Assistant's.
   */
  private run(id: string, now: string): HassContext {
    const known = this.runs.get(id);
    if (known) return known;
    const { source, parent } = this.triggerOf(id);
    const context = this.context(parent);
    this.runs.set(id, context);
    const automation = this.states[id];
    const name = automation?.attributes.friendly_name;
    this.recorded.record({
      when: Date.parse(now) / 1000,
      context,
      event: "automation_triggered",
      entity: id,
      name: typeof name === "string" ? name : id,
      ...(source ? { source } : {}),
    });
    if (automation) {
      this.states[id] = {
        ...automation,
        attributes: { ...automation.attributes, last_triggered: now },
        last_updated: now,
        context,
      };
    }
    return context;
  }

  /**
   * What set an automation off now, in Home Assistant's words, and the context of the change that
   * did: the state trigger whose entity is as it asks and changed last, else its first time or
   * sun trigger.
   */
  private triggerOf(id: string): { source?: string; parent?: string } {
    const config = AUTOMATIONS.find((a) => a.id === id)?.config;
    const triggers = Array.isArray(config?.triggers)
      ? (config.triggers as Record<string, unknown>[])
      : [];
    let best: { source: string; parent?: string; at: string } | undefined;
    for (const trigger of triggers) {
      const entity = trigger.entity_id;
      if (trigger.trigger !== "state" && trigger.trigger !== "numeric_state") continue;
      const state = typeof entity === "string" ? this.states[entity] : undefined;
      if (!state || (trigger.to !== undefined && state.state !== trigger.to)) continue;
      if (!best || state.last_changed > best.at) {
        const words = trigger.trigger === "state" ? "state of" : "numeric state of";
        best = { source: `${words} ${state.entity_id}`, at: state.last_changed };
        if (state.context) best.parent = state.context.id;
      }
    }
    if (best) return best.parent ? { source: best.source, parent: best.parent } : best;
    for (const trigger of triggers) {
      if (trigger.trigger === "time") return { source: "time" };
      if (trigger.trigger === "sun") return { source: `sun event ${String(trigger.event)}` };
    }
    return {};
  }

  /** A service called by the panel or the card: on the demo's states only. */
  callService(
    domain: string,
    service: string,
    data: Record<string, unknown>,
    target: Record<string, unknown>,
  ): void {
    // The visitor's own (D-059): as Home Assistant writes what a user asks.
    const context = this.context(undefined, this.hass.user?.id);
    const changed = this.callWith(context, domain, service, data, target);
    if (changed.length > 0) this.publish();
  }

  /** Calls a service in `context`, recorded as Home Assistant records it: the action called,
   * then each change of state it made. Returns the entities changed. */
  private callWith(
    context: HassContext,
    domain: string,
    service: string,
    data: Record<string, unknown>,
    target: Record<string, unknown>,
  ): string[] {
    const now = this.time();
    this.recorded.record({
      when: Date.parse(now) / 1000,
      context,
      event: "call_service",
      domain,
      service,
    });
    const before = new Map(Object.entries(this.states).map(([id, s]) => [id, s.state]));
    const changed = callService(
      this.states,
      domain,
      service,
      data,
      target,
      (id) => this.areaOf.get(id),
      now,
      context,
    );
    for (const id of changed) {
      this.since.set(id, this.elapsed());
      const state = this.states[id]?.state;
      if (state !== undefined) this.noteMower(id, before.get(id), state, now);
      if (state !== undefined && state !== before.get(id))
        this.recordChange(id, state, context, now);
    }
    return changed;
  }

  /** Gives the panel or the card a new `hass`. */
  private publish(): void {
    this.hass = { ...this.hass, states: { ...this.states } };
    for (const listener of this.listeners) listener(this.hass);
    for (const listener of this.clockListeners) listener();
  }

  /** A robot mower that stops mowing (D-077): noted in the garden, as the integration notes it. */
  private noteMower(id: string, before: string | undefined, after: string, now: string): void {
    if (!id.startsWith("lawn_mower.") || before !== "mowing" || after === "mowing") return;
    const garden = (this.store.garden ??= { lawns: {}, mowers: {} });
    garden.mowers = { ...garden.mowers, [id]: now };
    this.saved("garden");
  }

  /** A save: its kind and the new revision, told to who follows them. */
  saved(kind: SaveKind): number {
    this.store.revision += 1;
    for (const listener of this.updateListeners) listener({ kind, revision: this.store.revision });
    return this.store.revision;
  }

  /** The actions waiting, told to who follows them. */
  private publishSchedules(): void {
    const schedules = structuredClone(this.store.schedules);
    for (const listener of this.scheduleListeners) listener(schedules);
  }

  /** The first time of day `when` names (`HH:MM[:SS]`) after `after` (ms), on the demo's wall
   * clock, or the date it is. */
  private moment(when: string, after: number): Date | undefined {
    const time = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(when);
    if (time) {
      const next = new Date(after);
      next.setHours(Number(time[1]), Number(time[2]), Number(time[3] ?? 0), 0);
      if (next.getTime() <= after) next.setDate(next.getDate() + 1);
      return next;
    }
    const date = new Date(when);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  /** Adds an action to do later (D-046), on the demo's clock, as the integration checks it. */
  addSchedule(request: NewSchedule): { schedule: Schedule; text: string } {
    const entities = request.entities;
    if (entities.length === 0) throw new DemoError("no_entities");
    if (entities.length > MAX_SCHEDULE_ENTITIES) throw new DemoError("too_many_entities");
    for (const id of entities) {
      if (!(id in this.states)) throw new DemoError("unknown_entity");
      if (!schedulable(id)) throw new DemoError("not_schedulable");
    }
    const now = Date.parse(this.time());
    const at = this.moment(request.at, now);
    if (!at || at.getTime() <= now) throw new DemoError("in_the_past");
    if (at.getTime() > now + MAX_SCHEDULE_DAYS * DAY_MS) throw new DemoError("too_far");
    const ends = request.duration !== undefined || request.until !== undefined;
    if (request.action === "off" && (ends || request.brightness !== undefined)) {
      throw new DemoError("off_with_end");
    }
    // The heating put back as it was (D-091): the heating only, to one setting, once.
    const climate = request.climate;
    const heatingOnly = entities.every((id) => id.startsWith("climate."));
    if (
      (request.action === "climate") !== (climate !== undefined) ||
      (climate !== undefined &&
        (!heatingOnly ||
          ends ||
          request.brightness !== undefined ||
          Object.keys(climate).length !== 1))
    ) {
      throw new DemoError("not_climate");
    }
    // A time of day it ends at is the first after it starts.
    const until = request.duration
      ? new Date(at.getTime() + request.duration * 1000)
      : request.until
        ? this.moment(request.until, at.getTime())
        : undefined;
    if (until && until.getTime() <= at.getTime()) throw new DemoError("end_before_start");
    if (until && until.getTime() - at.getTime() > MAX_SCHEDULE_SPAN_DAYS * DAY_MS) {
      throw new DemoError("too_long");
    }
    this.scheduleCount += 1;
    const schedule: Schedule = {
      id: `demo-${this.scheduleCount}`,
      entities: request.entities,
      action: request.action ?? "on",
      at: at.toISOString(),
      until: until?.toISOString() ?? null,
      brightness: request.brightness ?? null,
      started: false,
      ...(climate ? { climate } : {}),
    };
    this.store.schedules.push(schedule);
    this.publishSchedules();
    const names = request.entities
      .map((id) => {
        const name = this.states[id]?.attributes.friendly_name;
        return typeof name === "string" ? name : id;
      })
      .join(", ");
    // The demo's wall clock: this device's time.
    const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
    const text = say(SCHEDULED[schedule.action], this.language)
      .replace("{names}", names)
      .replace("{time}", time);
    return { schedule, text };
  }

  /** Cancels an action waiting. */
  cancelSchedule(id: string): number {
    const before = this.store.schedules.length;
    this.store.schedules = this.store.schedules.filter((s) => s.id !== id);
    this.publishSchedules();
    return before - this.store.schedules.length;
  }

  /** The actions whose time has come on the demo's clock. */
  private runSchedules(now: string): void {
    const time = new Date(now).getTime();
    let changed = false;
    for (const schedule of [...this.store.schedules]) {
      const start = new Date(schedule.at).getTime();
      const end = schedule.until ? new Date(schedule.until).getTime() : undefined;
      if (!schedule.started && time >= start && schedule.action === "climate") {
        this.heatingBack(schedule);
        this.store.schedules.splice(this.store.schedules.indexOf(schedule), 1);
        changed = true;
        continue;
      }
      if (!schedule.started && time >= start) {
        this.switchAll(schedule.entities, schedule.action === "on", schedule.brightness);
        schedule.started = true;
        changed = true;
        if (end === undefined)
          this.store.schedules.splice(this.store.schedules.indexOf(schedule), 1);
      }
      if (schedule.started && end !== undefined && time >= end) {
        this.switchAll(schedule.entities, schedule.action !== "on", null);
        this.store.schedules.splice(this.store.schedules.indexOf(schedule), 1);
        changed = true;
      }
    }
    if (changed) this.publishSchedules();
  }

  /** Puts the heating back as it was (D-091), in the visitor's name. */
  private heatingBack(schedule: Schedule): void {
    const call = heatingNow(schedule);
    if (!call) return;
    const [domain, service, data, ids] = call;
    this.callWith(this.context(undefined, this.hass.user?.id), domain, service, data, {
      entity_id: ids,
    });
  }

  /** Switches entities on or off as the integration does: covers opened or closed, lamps on at a
   * brightness, the rest through `homeassistant`. */
  private switchAll(entities: string[], on: boolean, brightness: number | null): void {
    const covers = entities.filter((id) => id.startsWith("cover."));
    const lights =
      on && brightness !== null ? entities.filter((id) => id.startsWith("light.")) : [];
    const others = entities.filter((id) => !covers.includes(id) && !lights.includes(id));
    // In the name of who set them, as the integration calls them (D-046): the visitor.
    const call = (domain: string, service: string, ids: string[], data = {}): void => {
      if (ids.length === 0) return;
      this.callWith(this.context(undefined, this.hass.user?.id), domain, service, data, {
        entity_id: ids,
      });
    };
    call("cover", on ? "open_cover" : "close_cover", covers);
    call("light", "turn_on", lights, { brightness_pct: brightness });
    call("homeassistant", on ? "turn_on" : "turn_off", others);
  }
}
