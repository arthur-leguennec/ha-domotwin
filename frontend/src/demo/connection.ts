/**
 * The websocket of a home kept in the page, the demo house's (D-050) or the sandbox's (D-057):
 * DomoTwin's commands answered from what it keeps, as the integration would; Home Assistant's
 * few others the frontend asks (automations, the energy settings, what an area relates to, the
 * history and the logbook where it keeps them, D-058). Nothing goes out of the page.
 */
import type { NewSchedule, PlanJson, StoredPlan, UpdateEvent } from "../ha/client";
import type { HassConnection, HassMessage, HomeAssistant } from "../ha/types";
import type { PeopleSettings } from "../live/people";
import { readChoices } from "../live/choices";
import { storeyIds } from "../live/storeys";
import type { Schedule } from "../live/schedules";
import type { Upkeep } from "../live/upkeep";
import { DemoError, type DemoStore } from "./home";

/** A home kept in the page: what its connection asks of it. */
export interface MemoryHome {
  readonly store: DemoStore;
  readonly hass: HomeAssistant;
  readonly updateListeners: Set<(event: UpdateEvent) => void>;
  readonly scheduleListeners: Set<(schedules: Schedule[]) => void>;
  today(): string;
  area(id: string): string | undefined;
  saved(kind: "plan" | "bindings" | "settings" | "upkeep" | "people" | "locating"): number;
  addSchedule(request: NewSchedule): { schedule: Schedule; text: string };
  cancelSchedule(id: string): number;
  /** Its automations (their entity ids), and the configuration of each. */
  automationIds(): string[];
  automationConfig(id: string): Record<string, unknown> | undefined;
  /** Home Assistant's energy settings, as `energy/get_prefs` gives them, if it has some. */
  energyPrefs(): unknown;
  /**
   * Its history and its logbook (D-058), where it keeps them (the demo house's day), as
   * `history/history_during_period` and `logbook/get_events` answer, for a period (ms).
   */
  history?(entities: readonly string[], start: number, end: number): unknown;
  logbook?(entities: readonly string[], start: number, end: number): unknown;
}

/** A websocket error, as Home Assistant gives one. */
function failure(code: string, message = code): DemoError {
  return new DemoError(code, message);
}

/** The demo's answers to the frontend's commands. */
export function demoConnection(home: MemoryHome): HassConnection {
  const store = home.store;
  // Storey `id` (`unknown_storey` when no storey has it), else the ground floor: the one nearest
  // elevation 0, as the integration's.
  const storeyOf = (id: unknown): DemoStore["storeys"][number] | undefined => {
    if (typeof id === "string") {
      const found = store.storeys.find((s) => s.info.id === id);
      if (!found) throw failure("unknown_storey", "no storey has this id");
      return found;
    }
    return [...store.storeys].sort(
      (a, b) => Math.abs(a.info.elevation) - Math.abs(b.info.elevation),
    )[0];
  };
  const storeyList = () =>
    [...store.storeys]
      .sort((a, b) => a.info.elevation - b.info.elevation)
      .map((s) => ({ ...s.info }));
  // Ids are the home's (D-026): a storey's, its plan's and the pieces its overlay adds, may not
  // be another's.
  const checkIds = (plan: unknown, layout: unknown, storey: string | undefined): void => {
    const ids = storeyIds(plan, layout as Record<string, unknown> | undefined);
    const others = new Set(
      store.storeys.filter((s) => s.info.id !== storey).flatMap((s) => storeyIds(s.plan, s.layout)),
    );
    if (new Set(ids).size !== ids.length || ids.some((id) => others.has(id))) {
      throw failure("duplicate_id", "an id is used twice");
    }
  };
  let storeyCount = store.storeys.length;
  const newStorey = (plan: PlanJson, name = "", elevation = 0) => {
    storeyCount += 1;
    const kept = { info: { id: `storey-${storeyCount}`, name, elevation }, plan, layout: {} };
    store.storeys.push(kept);
    return kept;
  };

  // A period asked of the history or the logbook (ms): its end now when not given.
  const span = (message: HassMessage): { start: number; end: number } => {
    const now = home.hass.now?.() ?? Date.now();
    const start = Date.parse(String(message.start_time));
    const end = typeof message.end_time === "string" ? Date.parse(message.end_time) : now;
    if (Number.isNaN(start)) throw failure("invalid_start_time", "Invalid start_time");
    if (Number.isNaN(end)) throw failure("invalid_end_time", "Invalid end_time");
    return { start, end };
  };
  const entityIds = (message: HassMessage): string[] =>
    Array.isArray(message.entity_ids) ? message.entity_ids.map(String) : [];

  const answer = (message: HassMessage): unknown => {
    switch (message.type) {
      case "domotwin/plan/get": {
        const storey = storeyOf(message.storey);
        const plan: StoredPlan = {
          plan: storey?.plan ?? null,
          layout: storey?.layout ?? {},
          storey: storey?.info.id ?? null,
          storeys: storeyList(),
          revision: store.revision,
        };
        return structuredClone(plan);
      }
      case "domotwin/plan/save": {
        const id = typeof message.storey === "string" ? message.storey : undefined;
        const target = storeyOf(id);
        if (message.plan !== null) {
          checkIds(
            message.plan ?? target?.plan,
            "layout" in message ? message.layout : target?.layout,
            target?.info.id,
          );
        }
        if (!target && message.plan) newStorey(message.plan as PlanJson);
        else if (target && message.plan === null)
          store.storeys.splice(store.storeys.indexOf(target), 1);
        else if (target) {
          if (message.plan) target.plan = message.plan as PlanJson;
          if ("layout" in message)
            target.layout = (message.layout ?? {}) as Record<string, unknown>;
        }
        return { revision: home.saved("plan") };
      }
      case "domotwin/storey/save": {
        let target = typeof message.storey === "string" ? storeyOf(message.storey) : undefined;
        checkIds(message.plan ?? target?.plan, message.layout ?? target?.layout, target?.info.id);
        if (!target) {
          if (!message.plan) throw failure("invalid_storey", "a new storey needs a plan");
          target = newStorey(message.plan as PlanJson);
        }
        if (typeof message.name === "string") target.info.name = message.name;
        if (typeof message.elevation === "number") target.info.elevation = message.elevation;
        if (message.plan) target.plan = message.plan as PlanJson;
        if (message.layout) target.layout = message.layout as Record<string, unknown>;
        return { revision: home.saved("plan"), storey: target.info.id };
      }
      case "domotwin/storeys/replace": {
        const storeys = Array.isArray(message.storeys)
          ? (message.storeys as { plan: PlanJson; name?: string; elevation?: number }[])
          : [];
        const ids = storeys.flatMap((s) => storeyIds(s.plan));
        if (new Set(ids).size !== ids.length) throw failure("duplicate_id", "ids used twice");
        store.storeys.splice(0, store.storeys.length);
        for (const s of storeys) newStorey(s.plan, s.name ?? "", s.elevation ?? 0);
        return { revision: home.saved("plan"), storeys: store.storeys.map((s) => s.info.id) };
      }
      case "domotwin/storey/remove": {
        const target = storeyOf(String(message.storey));
        if (target) store.storeys.splice(store.storeys.indexOf(target), 1);
        return { revision: home.saved("plan") };
      }
      case "domotwin/bindings/get":
        return structuredClone({ bindings: store.bindings, revision: store.revision });
      case "domotwin/bindings/save":
        store.bindings = structuredClone(message.bindings) as typeof store.bindings;
        return { revision: home.saved("bindings") };
      case "domotwin/settings/get":
        return structuredClone({ settings: store.settings, revision: store.revision });
      case "domotwin/settings/save":
        store.settings = structuredClone(message.settings) as typeof store.settings;
        return { revision: home.saved("settings") };
      case "domotwin/upkeep/get":
        return structuredClone({
          upkeep: store.upkeep,
          revision: store.revision,
          today: home.today(),
        });
      case "domotwin/upkeep/save": {
        const pieces = { ...store.upkeep.pieces, ...(message.pieces as Upkeep["pieces"]) };
        store.upkeep.pieces = Object.fromEntries(
          Object.entries(pieces).filter(([, card]) => (card as unknown) !== null),
        );
        if (typeof message.lead_days === "number") store.upkeep.lead_days = message.lead_days;
        return { revision: home.saved("upkeep") };
      }
      case "domotwin/upkeep/done": {
        const task = store.upkeep.pieces[String(message.piece)]?.tasks?.find(
          (t) => t.id === message.task,
        );
        if (!task) throw failure("unknown_task", "no such task");
        task.last_done = home.today();
        return { revision: home.saved("upkeep"), last_done: task.last_done };
      }
      case "domotwin/people/get":
        return structuredClone(store.people);
      case "domotwin/people/save": {
        store.people.people = structuredClone(message.people) as PeopleSettings["people"];
        if (message.shown === "everyone" || message.shown === "admins") {
          store.people.shown = message.shown;
        }
        if (message.look === "figure" || message.look === "pin") store.people.look = message.look;
        store.people.revision += 1;
        home.saved("people");
        return { revision: store.people.revision };
      }
      case "domotwin/people/hide": {
        const person = String(message.person);
        store.people.hidden = store.people.hidden.filter((p) => p !== person);
        if (message.hidden === true) store.people.hidden.push(person);
        store.people.revision += 1;
        home.saved("people");
        return { revision: store.people.revision };
      }
      case "domotwin/locating/get":
        // No Bluetooth in the demo: the dialog says so.
        return {
          revision: 1,
          status: "no_bluetooth",
          learn: false,
          receivers: [],
          devices: {},
          learned: {},
          rooms: [],
        };
      case "domotwin/locating/candidates":
        return { candidates: [] };
      case "domotwin/choices/get":
        return structuredClone(store.choices);
      case "domotwin/choices/favourite": {
        const entity = String(message.entity_id);
        const others = store.choices.favourites.filter((id) => id !== entity);
        store.choices.favourites = message.favourite === true ? [...others, entity] : others;
        return { favourites: [...store.choices.favourites] };
      }
      case "domotwin/choices/save": {
        // "" for the start: none chosen.
        store.choices = readChoices({ ...store.choices, ...message });
        return structuredClone(store.choices);
      }
      case "domotwin/schedules/add":
        return home.addSchedule(message as unknown as NewSchedule & HassMessage);
      case "domotwin/schedules/cancel":
        return { cancelled: home.cancelSchedule(String(message.schedule_id)) };
      case "automation/config": {
        const id = String(message.entity_id);
        const config = home.automationConfig(id);
        if (!config) throw failure("not_found", "Entity not found");
        const alias = home.hass.states[id]?.attributes.friendly_name;
        return { config: { id: id.slice(11), alias, ...structuredClone(config) } };
      }
      case "search/related": {
        // The automations that name the entity, or an entity of the area.
        const inArea = (id: string): boolean =>
          message.item_type === "area" && home.area(id) === message.item_id;
        const automation = home.automationIds().filter((id) => {
          const text = JSON.stringify(home.automationConfig(id) ?? {});
          if (text.includes(`"${String(message.item_id)}"`)) return true;
          return Object.keys(home.hass.states).some((e) => inArea(e) && text.includes(`"${e}"`));
        });
        return automation.length > 0 ? { automation } : {};
      }
      case "energy/get_prefs": {
        const prefs = home.energyPrefs();
        if (prefs === undefined) throw failure("not_found", "No energy settings");
        return structuredClone(prefs);
      }
      case "history/history_during_period": {
        if (!home.history) throw failure("unknown_command", message.type);
        const { start, end } = span(message);
        return home.history(entityIds(message), start, end);
      }
      case "recorder/statistics_during_period":
        // No statistics: the report works its hours out from the history.
        if (!home.history) throw failure("unknown_command", message.type);
        return {};
      case "logbook/get_events": {
        if (!home.logbook) throw failure("unknown_command", message.type);
        const { start, end } = span(message);
        return home.logbook(entityIds(message), start, end);
      }
      default:
        // What the demo has not: ZHA, Assist, voice, Bluetooth learning…
        throw failure("unknown_command", message.type);
    }
  };

  return {
    sendMessage(): void {
      // Nothing to send anywhere.
    },
    sendMessagePromise<T>(message: HassMessage): Promise<T> {
      try {
        return Promise.resolve(answer(message) as T);
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new DemoError("unknown_error"));
      }
    },
    // Mirrors home-assistant-js-websocket: the caller states the event type.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
    subscribeMessage<T>(callback: (message: T) => void, message: HassMessage) {
      if (message.type === "domotwin/schedules/subscribe") {
        const listener = (schedules: Schedule[]): void => {
          callback({ schedules } as T);
        };
        home.scheduleListeners.add(listener);
        queueMicrotask(() => {
          listener(structuredClone(home.store.schedules));
        });
        return Promise.resolve(() => {
          home.scheduleListeners.delete(listener);
          return Promise.resolve();
        });
      }
      const listener = (event: UpdateEvent): void => {
        callback(event as T);
      };
      home.updateListeners.add(listener);
      return Promise.resolve(() => {
        home.updateListeners.delete(listener);
        return Promise.resolve();
      });
    },
  };
}
