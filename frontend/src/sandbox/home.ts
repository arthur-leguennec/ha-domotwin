/**
 * The sandbox's Home Assistant (D-057): a `hass` of its own over the copy of the home, the day
 * played at once and shown at a moment of it, the panel running on it unchanged. A tap in the
 * sandbox is something done by hand at that moment: the day is played again with it. Nothing it
 * does reaches the home.
 */
import { demoConnection, type MemoryHome } from "../demo/connection";
import { DemoError, type DemoStore } from "../demo/home";
import type { NewSchedule, SaveKind, UpdateEvent } from "../ha/client";
import type { HassEntity, HomeAssistant } from "../ha/types";
import type { Schedule } from "../live/schedules";
import { playDay, type DayPlayed, type HandCall, type World } from "./engine";
import type { HomeCopy } from "./copy";
import { reportOf, type DayReport } from "./report";
import { dayOf, firstScenario, prepare, type Scenario } from "./scenario";
import { sunDay } from "./sun";
import { clockOn, isoIn, zoned } from "./time";

/** How fast the day goes, in minutes of the day a second. */
export const SPEEDS = [1, 10, 60] as const;
export type Speed = (typeof SPEEDS)[number];
const TICK_MS = 100;

/** Who opens the sandbox: their own Home Assistant's user, language and look. */
export interface SandboxVisitor {
  language: string;
  user?: HomeAssistant["user"];
  darkMode?: boolean;
}

export class SandboxHome implements MemoryHome {
  readonly kind = "sandbox";
  hass: HomeAssistant;
  readonly store: DemoStore;
  readonly updateListeners = new Set<(event: UpdateEvent) => void>();
  readonly scheduleListeners = new Set<(schedules: Schedule[]) => void>();
  scenario: Scenario;
  day!: DayPlayed;
  /** The moment of the day shown (ms). */
  cursor = 0;
  playing = false;
  speed: Speed = 10;
  private held = false;
  private timer?: ReturnType<typeof setInterval>;
  private states: Record<string, HassEntity> = {};
  /** How many of the day's changes `states` has. */
  private applied = 0;
  private report?: DayReport;
  private readonly listeners = new Set<(hass: HomeAssistant) => void>();
  private readonly clockListeners = new Set<() => void>();
  private readonly areaOf: (id: string) => string | undefined;

  constructor(
    private readonly copy: HomeCopy,
    visitor: SandboxVisitor,
    now = Date.now(),
  ) {
    this.store = structuredClone(copy.store);
    const entities = copy.entities;
    const devices = copy.devices;
    this.areaOf = (id) => {
      const entry = entities[id];
      if (entry?.area_id) return entry.area_id;
      return entry?.device_id ? (devices[entry.device_id]?.area_id ?? undefined) : undefined;
    };
    this.scenario = firstScenario(copy.states, copy.zone, now);
    this.hass = {
      states: {},
      entities: copy.entities,
      devices: copy.devices,
      areas: copy.areas,
      floors: copy.floors,
      ...(visitor.user ? { user: visitor.user } : {}),
      language: visitor.language,
      locale: { language: visitor.language },
      themes: { darkMode: visitor.darkMode === true },
      config: {
        unit_system: { temperature: copy.units?.temperature ?? "°C" },
        components: ["domotwin", ...(copy.energy !== undefined ? ["energy"] : [])],
        time_zone: copy.zone,
        ...(copy.latitude !== undefined ? { latitude: copy.latitude } : {}),
        ...(copy.longitude !== undefined ? { longitude: copy.longitude } : {}),
      },
      connection: demoConnection(this),
      demo: true,
      sandbox: true,
      now: () => this.cursor,
      callService: (domain, service, data, target) => {
        this.byHand({
          at: this.cursor,
          domain,
          service,
          ...(data ? { data } : {}),
          ...(target ? { target } : {}),
        });
        return Promise.resolve();
      },
    };
    this.replay();
    // A morning, where most days start doing things.
    this.seek(clockOn(this.day.start, copy.zone, 7 * 60));
  }

  /** The home's automations and scripts (their entity ids). */
  automationIds(): string[] {
    return this.copy.automations.map((a) => a.id);
  }

  scriptIds(): string[] {
    return this.copy.scripts.map((s) => s.id);
  }

  automationConfig(id: string): Record<string, unknown> | undefined {
    return this.copy.automations.find((a) => a.id === id)?.config;
  }

  energyPrefs(): unknown {
    return this.copy.energy;
  }

  area(id: string): string | undefined {
    return this.areaOf(id);
  }

  /** A name to show for an entity: its friendly name, else its id. */
  name(id: string): string {
    const name = this.copy.states[id]?.attributes.friendly_name;
    return typeof name === "string" && name.trim() ? name : id;
  }

  today(): string {
    return this.scenario.date;
  }

  /** The day's time zone. */
  get zone(): string {
    return this.copy.zone;
  }

  saved(kind: SaveKind): number {
    this.store.revision += 1;
    for (const listener of this.updateListeners) listener({ kind, revision: this.store.revision });
    return this.store.revision;
  }

  /** An action for later is the home's, not the sandbox's day. */
  addSchedule(request: NewSchedule): { schedule: Schedule; text: string } {
    throw new DemoError("not_in_sandbox", `not in the sandbox (${request.entities.length})`);
  }

  /** Nothing waits in the sandbox: nothing to cancel. */
  cancelSchedule(): number {
    return 0;
  }

  /** What the day says: what ran, never ran, worked against each other, could not be played. */
  dayReport(): DayReport {
    this.report ??= reportOf(this.day, this.automationIds(), this.scriptIds());
    return this.report;
  }

  /** The world the day is played on: the copy as the scenario starts it. */
  private world(): { world: World; happenings: ReturnType<typeof prepare>["happenings"] } {
    const copy = this.copy;
    const { start, end } = dayOf(this.scenario, copy.zone);
    const place =
      copy.latitude !== undefined && copy.longitude !== undefined
        ? { latitude: copy.latitude, longitude: copy.longitude }
        : undefined;
    const sun = place ? sunDay(start, end, place.latitude, place.longitude) : { upAtStart: false };
    const rooms = Object.fromEntries(
      Object.entries(copy.store.people.people).map(([id, person]) => [id, person.sensor]),
    );
    const prepared = prepare(copy.states, this.scenario, copy.zone, sun, start, place, rooms);
    const entities = copy.entities;
    const ids = Object.keys(prepared.states);
    const world: World = {
      states: prepared.states,
      areaOf: this.areaOf,
      areaName: (area) => copy.areas[area]?.name,
      deviceOf: (id) => entities[id]?.device_id ?? undefined,
      entitiesOfDevice: (device) => ids.filter((id) => entities[id]?.device_id === device),
      entitiesOfArea: (area) => ids.filter((id) => this.areaOf(id) === area),
      areasOfFloor: (floor) =>
        Object.values(copy.areas)
          .filter((a) => a.floor_id === floor)
          .map((a) => a.area_id),
      entitiesOfLabel: (label) => ids.filter((id) => entities[id]?.labels?.includes(label)),
      entityFromRegistryId: (id) => copy.registry[id],
      automations: copy.automations,
      scripts: copy.scripts,
      scenes: copy.scenes,
      zone: copy.zone,
      ...place,
    };
    return { world, happenings: prepared.happenings };
  }

  /** Plays the day again (another scenario, something done by hand), and shows the same moment. */
  private replay(): void {
    const { world, happenings } = this.world();
    const { start, end } = dayOf(this.scenario, this.copy.zone);
    this.day = playDay(world, start, end, happenings, this.scenario.calls);
    this.report = undefined;
    this.cursor = Math.min(Math.max(this.cursor, start), end);
    this.seek(this.cursor, true);
  }

  /** Changes the scenario: the day is played again. */
  setScenario(scenario: Scenario): void {
    const zone = this.copy.zone;
    // Another day: the same time of day on it, for the moment shown and what was done by hand.
    if (scenario.date !== this.scenario.date) {
      const { start } = dayOf(scenario, zone);
      const carried = (at: number): number => {
        const read = zoned(at, zone);
        return clockOn(start, zone, read.hour * 60 + read.minute, read.second);
      };
      this.cursor = carried(this.cursor);
      scenario = {
        ...scenario,
        calls: scenario.calls
          .map((call) => ({ ...call, at: carried(call.at) }))
          .sort((a, b) => a.at - b.at),
      };
    }
    this.scenario = scenario;
    this.replay();
    this.tellClock();
  }

  /** Something done by hand at the moment shown: the day goes on with it. */
  byHand(call: HandCall): void {
    this.scenario = {
      ...this.scenario,
      calls: [...this.scenario.calls, call].sort((a, b) => a.at - b.at),
    };
    this.replay();
    this.tellClock();
  }

  /** Forgets something done by hand. */
  forget(index: number): void {
    this.scenario = {
      ...this.scenario,
      calls: this.scenario.calls.filter((_, k) => k !== index),
    };
    this.replay();
    this.tellClock();
  }

  /** Shows the home at `at` (ms) of the day. */
  seek(at: number, force = false): void {
    const target = Math.min(Math.max(at, this.day.start), this.day.end);
    if (target < this.cursor || force) {
      // The day never changes an entity in place: a new object each time, so a copy of the
      // list is enough.
      this.states = { ...this.day.initial };
      this.applied = 0;
    }
    const changes = this.day.changes;
    while (this.applied < changes.length && (changes[this.applied]?.at ?? Infinity) <= target) {
      const change = changes[this.applied];
      if (change) this.states[change.entity.entity_id] = change.entity;
      this.applied += 1;
    }
    this.cursor = target;
    this.publish();
    this.tellClock();
  }

  /** The moment shown, as Home Assistant writes it. */
  time(): string {
    return isoIn(this.cursor, this.copy.zone);
  }

  setSpeed(speed: Speed): void {
    this.speed = speed;
    this.tellClock();
  }

  subscribe(listener: (hass: HomeAssistant) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  watchClock(listener: () => void): () => void {
    this.clockListeners.add(listener);
    return () => this.clockListeners.delete(listener);
  }

  play(playing: boolean): void {
    if (playing && this.cursor >= this.day.end) this.seek(this.day.start);
    this.playing = playing;
    this.tick();
    this.tellClock();
  }

  away(away: boolean): void {
    this.held = away;
    this.tick();
  }

  stop(): void {
    this.play(false);
    this.listeners.clear();
    this.clockListeners.clear();
  }

  private tick(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    if (!this.playing || this.held) return;
    this.timer = setInterval(() => {
      const next = this.cursor + this.speed * 60_000 * (TICK_MS / 1000);
      this.seek(next);
      if (this.cursor >= this.day.end) this.play(false);
    }, TICK_MS);
  }

  private tellClock(): void {
    for (const listener of this.clockListeners) listener();
  }

  private publish(): void {
    this.hass = { ...this.hass, states: { ...this.states } };
    for (const listener of this.listeners) listener(this.hass);
  }
}
