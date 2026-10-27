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
import { readBindings } from "../live/bindings";
import { ENERGY_SENSORS } from "../live/energy";
import { peakNow, peakSources, type Peak } from "../live/peaks";
import { closedAreas, closedEntities, privateRooms } from "../live/privacy";
import type { Schedule } from "../live/schedules";
import { planRooms } from "../live/suggest";
import { playDay, type DayPlayed, type HandCall, type World } from "./engine";
import type { HomeCopy } from "./copy";
import { peakDay, peakOnDay } from "./peak-day";
import { peakReport, type PeakRoomReport } from "./peak-report";
import type { Config } from "./config";
import { reportOf, type DayReport } from "./report";
import { dayOf, firstScenario, prepare, type Scenario, type Weather } from "./scenario";
import { sunDay } from "./sun";
import { clockOf, clockOn, isoIn, zoned } from "./time";

/** How fast the day goes, in minutes of the day a second. */
export const SPEEDS = [1, 10, 60] as const;
export type Speed = (typeof SPEEDS)[number];
const TICK_MS = 100;

/** Who opens the sandbox: their own Home Assistant's user, language and look. */
export interface SandboxVisitor {
  language: string;
  user?: HomeAssistant["user"];
  darkMode?: boolean;
  /** Opens on the day of Hydro-Québec's announced peak, when there is one (D-063). */
  peakDay?: boolean;
  /** An automation written in plain words, played beside the home's before it is saved. */
  draft?: SandboxDraft;
}

/** A draft of an automation, played in the sandbox beside the home's (D-064). */
export interface SandboxDraft {
  /** The entity id it has in the copy (none of the home's). */
  entity: string;
  name: string;
  config: Config;
  /** Told what it did each time a day is played. */
  onDay?: (day: DraftDay) => void;
}

/** What a draft did on a day played (D-064). */
export interface DraftDay {
  /** The day played, told from another (its scenario, what was done by hand too). */
  key: string;
  date: string;
  weather: Weather;
  /** How many things were done by hand in it. */
  byHand: number;
  /** When it ran, by the day's clock ("08:30"). */
  runs: string[];
  /** Set off but stopped by its conditions, or while it ran already. */
  stopped: number;
  busy: number;
  /** The automations and scripts it worked against. */
  against: string[];
  /** It set something back and forth. */
  backAndForth: boolean;
  /** What could not be played of it. */
  notPlayed: number;
  /** It set itself off over and over, and was stopped. */
  looping: boolean;
}

/** The draft added to the copy: an automation of its own, on, that never ran. */
function withDraft(copy: HomeCopy, draft: SandboxDraft): HomeCopy {
  const iso = new Date(0).toISOString();
  const mode = typeof draft.config.mode === "string" ? draft.config.mode : "single";
  const state: HassEntity = {
    entity_id: draft.entity,
    state: "on",
    attributes: {
      friendly_name: draft.name,
      id: "domotwin_draft",
      mode,
      current: 0,
      last_triggered: null,
    },
    last_changed: iso,
    last_updated: iso,
  };
  return {
    ...copy,
    states: { ...copy.states, [draft.entity]: state },
    automations: [...copy.automations, { id: draft.entity, config: draft.config }],
  };
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
  private peakRooms?: PeakRoomReport[];
  /**
   * Hydro-Québec's peak announced when the home was copied (D-063), where an integration reads
   * it: its day plays it.
   */
  readonly announced?: Peak;
  /** Where the announced peak is said: its devices and its calendars. */
  private readonly peakFrom: ReadonlySet<string> = new Set<string>();
  /** When the home was copied. */
  private readonly copied: number;
  /** Another peak is announced on the day played, not played (its times unknown). */
  peakAnother = false;
  private readonly listeners = new Set<(hass: HomeAssistant) => void>();
  private readonly clockListeners = new Set<() => void>();
  private readonly areaOf: (id: string) => string | undefined;
  private readonly copy: HomeCopy;
  /** The automation written in plain words played beside the home's, if one is (D-064). */
  readonly draft?: { entity: string; name: string };
  private readonly onDraftDay?: (day: DraftDay) => void;

  constructor(home: HomeCopy, visitor: SandboxVisitor, now = Date.now()) {
    const copy = visitor.draft ? withDraft(home, visitor.draft) : home;
    this.copy = copy;
    if (visitor.draft) {
      this.draft = { entity: visitor.draft.entity, name: visitor.draft.name };
      this.onDraftDay = visitor.draft.onDay;
    }
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
    // The peak to come, or under way, as the integrations said it when the home was copied.
    this.copied = now;
    const copied = { ...this.hass, states: copy.states };
    const announced = peakNow(copied, now)?.peak;
    if (announced) {
      this.announced = announced;
      this.peakFrom = peakSources(copied, announced);
      const date = visitor.peakDay === true ? this.peakDate() : undefined;
      if (date) this.scenario = { ...this.scenario, date };
    }
    this.replay();
    // A morning, where most days start doing things; on the peak's day, its pre-heating.
    const peak = visitor.peakDay === true ? this.peakToday() : undefined;
    this.seek(peak ? peak.preheat : clockOn(this.day.start, copy.zone, 7 * 60));
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
    // The rooms, their links and privacy as the sandbox's plan says them now.
    this.peakRooms = undefined;
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

  /** What the draft did on the day played, when there is one (D-064). */
  draftDay(): DraftDay | undefined {
    const draft = this.draft;
    if (!draft) return undefined;
    const report = this.dayReport();
    const owner = report.owners.find((each) => each.id === draft.entity);
    const against = new Set<string>();
    for (const conflict of report.conflicts) {
      const { first, second } = conflict;
      if (first.owner === draft.entity && second.owner !== draft.entity) against.add(second.owner);
      if (second.owner === draft.entity && first.owner !== draft.entity) against.add(first.owner);
    }
    const flapping = report.flapping.filter((flap) => flap.owners.includes(draft.entity));
    for (const flap of flapping) {
      for (const other of flap.owners) if (other !== draft.entity) against.add(other);
    }
    const scenario = this.scenario;
    return {
      key: JSON.stringify([
        scenario.date,
        scenario.weather,
        scenario.low,
        scenario.high,
        scenario.people,
        scenario.calls,
      ]),
      date: scenario.date,
      weather: scenario.weather,
      byHand: scenario.calls.length,
      runs: (owner?.runs ?? []).map((run) => clockOf(run.at, this.copy.zone)),
      stopped: owner?.stoppedByConditions ?? 0,
      busy: owner?.busy ?? 0,
      against: [...against].sort(),
      backAndForth: flapping.length > 0,
      notPlayed: owner?.notPlayed.length ?? 0,
      looping: owner?.looping ?? false,
    };
  }

  /** The announced peak's date (`YYYY-MM-DD`, in Home Assistant's time zone). */
  peakDate(): string | undefined {
    const peak = this.announced;
    if (!peak) return undefined;
    const at = zoned(peak.start, this.copy.zone);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${at.year}-${pad(at.month)}-${pad(at.day)}`;
  }

  /** Plays the announced peak's day, shown from its pre-heating (D-063). */
  playPeak(): void {
    const peak = this.announced;
    const date = this.peakDate();
    if (!peak || !date) return;
    if (date !== this.scenario.date) this.setScenario({ ...this.scenario, date });
    this.seek(peak.preheat);
  }

  /** The announced peak's pre-heating said with its day when it starts on the day before. */
  peakPreheatText(clock: (at: number) => string): string {
    const peak = this.announced;
    if (!peak) return "";
    const at = zoned(peak.preheat, this.copy.zone);
    const pad = (n: number) => String(n).padStart(2, "0");
    const date = `${at.year}-${pad(at.month)}-${pad(at.day)}`;
    return date === this.peakDate() ? clock(peak.preheat) : `${date} ${clock(peak.preheat)}`;
  }

  /** The announced peak, when the day played is its day (D-063). */
  peakToday(): Peak | undefined {
    const peak = this.announced;
    return peakOnDay(peak, this.day.start, this.day.end) ? peak : undefined;
  }

  /**
   * What each room did through the announced peak, when the day played is its day: of the
   * sandbox's plan and links, nothing of a private room the visitor may not see (D-039), of its
   * area or of what its pieces link.
   */
  peakReport(): PeakRoomReport[] | undefined {
    const peak = this.peakToday();
    if (!peak) return undefined;
    if (!this.peakRooms) {
      const store = this.store;
      const rooms = store.storeys.flatMap((storey) => planRooms(storey.plan));
      const energy = store.settings.energy;
      const meters = new Set(ENERGY_SENSORS.flatMap((key) => energy?.[key] ?? []));
      const bindings = readBindings(store.bindings);
      const closed = privateRooms(store.settings.rooms, this.hass);
      const unseen = {
        areas: closedAreas(this.hass, bindings, rooms, closed),
        entities: closedEntities(bindings, store.storeys, closed),
      };
      this.peakRooms = peakReport(this.day, this.hass, bindings, rooms, peak, {
        exclude: meters,
        closed,
        unseen,
      });
    }
    return this.peakRooms;
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
    // The announced peak's day (D-063): the integrations say it as it goes.
    this.peakAnother = false;
    if (peakOnDay(this.announced, start, end)) {
      const peak = peakDay(prepared.states, copy.entities, this.announced, this.peakFrom, {
        start,
        end,
        zone: copy.zone,
        copied: this.copied,
      });
      this.peakAnother = peak.another;
      for (const [id, state] of peak.initial) {
        const entity = prepared.states[id];
        if (entity) prepared.states[id] = { ...entity, state };
      }
      prepared.happenings = [...prepared.happenings, ...peak.happenings].sort(
        (a, b) => a.at - b.at,
      );
    }
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
    this.peakRooms = undefined;
    const drafted = this.onDraftDay ? this.draftDay() : undefined;
    if (drafted) this.onDraftDay?.(drafted);
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
