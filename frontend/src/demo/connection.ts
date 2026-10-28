/**
 * The websocket of a home kept in the page, the demo house's (D-050) or the sandbox's (D-057):
 * DomoTwin's commands answered from what it keeps, as the integration would; Home Assistant's
 * few others the frontend asks (automations, the energy settings, what an area relates to, the
 * history and the logbook where it keeps them, D-058). Nothing goes out of the page.
 */
import type { NewSchedule, PlanJson, SaveKind, StoredPlan, UpdateEvent } from "../ha/client";
import type { HassConnection, HassMessage, HomeAssistant } from "../ha/types";
import type { PeopleSettings } from "../live/people";
import { readChoices } from "../live/choices";
import {
  MAX_SHORTCUTS,
  changeShortcuts,
  readShortcut,
  readShortcuts,
  type ShortcutChange,
} from "../live/shortcut-model";
import { storeyIds } from "../live/storeys";
import type { Schedule } from "../live/schedules";
import type { Upkeep } from "../live/upkeep";
import {
  MAX_WIFI_SCREENS,
  SCREEN_NAME,
  WIFI_SECURITIES,
  nameProblem,
  passwordProblem,
  screensOf,
  wifiAnswer,
  type StoredWifi,
} from "../live/wifi";
import type { DemoConfigHistory } from "./config-history";
import type { DemoReport } from "./report";
import { DemoError, type DemoStore } from "./home";
import type { DemoLogbook } from "./logbook";

/** A home kept in the page: what its connection asks of it. */
export interface MemoryHome {
  readonly store: DemoStore;
  readonly hass: HomeAssistant;
  readonly updateListeners: Set<(event: UpdateEvent) => void>;
  readonly scheduleListeners: Set<(schedules: Schedule[]) => void>;
  today(): string;
  area(id: string): string | undefined;
  saved(kind: SaveKind): number;
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
  /** What its Home Assistant recorded, by context, as its logbook answers (D-059); none:
   * nothing recorded. */
  readonly recorded?: DemoLogbook;
  /** Its configuration history (D-062), where it keeps one (the demo house's). */
  readonly configHistory?: DemoConfigHistory;
  /** Its weekly reports (D-081), where it keeps some (the demo house's). */
  readonly weekly?: DemoReport;
}

/** A websocket error, as Home Assistant gives one. */
function failure(code: string, message = code): DemoError {
  return new DemoError(code, message);
}

/** A Wi-Fi to keep, read as the integration reads it (`Wifi.async_save`); refused as it is. */
function storedWifi(raw: unknown, kept: StoredWifi | undefined): StoredWifi {
  const value = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const security = WIFI_SECURITIES.find((s) => s === value.security);
  if (!security) throw failure("invalid", "security");
  const screens = Array.isArray(value.screens)
    ? screensOf(value.screens.filter((s) => typeof s === "string").join(" "))
    : [];
  if (screens.length > MAX_WIFI_SCREENS || screens.some((screen) => !SCREEN_NAME.test(screen))) {
    throw failure("invalid", "screens");
  }
  const wifi: StoredWifi = { security, hidden: value.hidden === true, screens };
  if (value.image !== undefined) {
    if (typeof value.image !== "string" || !value.image.startsWith("image.")) {
      throw failure("invalid", "image");
    }
    wifi.image = value.image;
    return wifi;
  }
  const name = typeof value.name === "string" ? value.name : "";
  const wrong = nameProblem(name);
  if (wrong) throw failure(wrong);
  wifi.name = name;
  if (security === "nopass") return wifi;
  // Left out, the same network's password is kept.
  const same = kept?.name === wifi.name && kept.security === security;
  const password =
    typeof value.password === "string" ? value.password : same ? (kept.password ?? "") : "";
  const problem = passwordProblem(security, password);
  if (problem) throw failure(problem);
  wifi.password = password;
  return wifi;
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

  // The configuration history, where the home keeps one (not the sandbox's copy).
  const report = (): DemoReport => {
    if (!home.weekly) throw failure("unknown_command", "no weekly report here");
    return home.weekly;
  };
  const configHistory = (): DemoConfigHistory => {
    if (!home.configHistory) throw failure("unknown_command", "no configuration history here");
    return home.configHistory;
  };

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
      case "domotwin/settings/save": {
        const workplace = store.settings.workplace !== undefined;
        store.settings = structuredClone(message.settings) as typeof store.settings;
        const revision = home.saved("settings");
        // A workplace now, or no longer (D-086): the people are read again, as the integration says.
        if ((store.settings.workplace !== undefined) !== workplace) home.saved("people");
        return { revision };
      }
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
      // The garden (D-077): when each lawn was last mown, said by anyone.
      case "domotwin/garden/get":
        return structuredClone(store.garden ?? { lawns: {}, mowers: {} });
      case "domotwin/garden/mowed": {
        const room = message.room;
        if (typeof room !== "string" || room.length === 0 || room.length > 100) {
          throw failure("invalid_format", "room");
        }
        // A lawn of the plan (a place outside on a lawn), as the integration checks.
        type Room = { id?: unknown; outside?: unknown; floor?: { material?: unknown } };
        const lawn = store.storeys.some((s) =>
          ((s.plan as { rooms?: Room[] }).rooms ?? []).some(
            (r) => r.id === room && r.outside === true && (r.floor?.material ?? "lawn") === "lawn",
          ),
        );
        if (!lawn) throw failure("unknown_lawn", "no lawn has this id");
        const garden = (store.garden ??= { lawns: {}, mowers: {} });
        const now = new Date(home.hass.now?.() ?? Date.now()).toISOString();
        garden.lawns = { ...garden.lawns, [room]: now };
        home.saved("garden");
        return structuredClone(garden);
      }
      case "domotwin/people/get":
        // A workplace (D-086): its people counted, named nowhere.
        return structuredClone(
          store.settings.workplace ? { ...store.people, counted: true } : store.people,
        );
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
      case "domotwin/locating/add_key":
        throw failure("no_bluetooth", "the identity key was not taken");
      case "domotwin/screens/get":
        // The demo house is shown on a device that may be a wall screen: it has none of its own.
        return { screens: {} };
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
        store.choices = readChoices({
          ...store.choices,
          ...(message.start !== undefined ? { start: message.start } : {}),
          ...(message.cards !== undefined ? { cards: message.cards } : {}),
        });
        return structuredClone(store.choices);
      }
      case "domotwin/choices/shortcut": {
        // One change, made as the integration makes it.
        const kept = readShortcuts(store.choices.shortcuts);
        let change: ShortcutChange | undefined;
        if (message.set !== undefined) {
          const shortcut = readShortcut(message.set);
          if (!shortcut) throw failure("invalid_format", "the shortcut is not understood");
          if (!kept.some((s) => s.id === shortcut.id) && kept.length >= MAX_SHORTCUTS) {
            throw failure("too_many_shortcuts");
          }
          change = { set: shortcut };
        } else if (typeof message.remove === "string") {
          change = { remove: message.remove };
        } else if (typeof message.move === "string" && (message.by === 1 || message.by === -1)) {
          change = { move: message.move, by: message.by };
        }
        if (!change) throw failure("invalid_format", "set, remove, or move by -1 or 1");
        store.choices = { ...store.choices, shortcuts: changeShortcuts(kept, change) };
        return structuredClone(store.choices);
      }
      case "domotwin/wifi/get":
        return wifiAnswer(
          store.wifi,
          home.hass.user?.is_admin === true,
          typeof message.screen === "string" ? message.screen : "",
          message.password === true,
        );
      case "domotwin/wifi/save": {
        if (home.hass.user?.is_admin !== true) throw failure("unauthorized");
        const wifi = storedWifi(message.wifi, store.wifi);
        store.wifi = wifi;
        home.saved("wifi");
        return wifiAnswer(wifi, true, "", true);
      }
      case "domotwin/wifi/clear":
        if (home.hass.user?.is_admin !== true) throw failure("unauthorized");
        delete store.wifi;
        home.saved("wifi");
        return wifiAnswer(undefined, true);
      case "domotwin/schedules/add":
        return home.addSchedule(message as unknown as NewSchedule & HassMessage);
      case "domotwin/schedules/cancel":
        return { cancelled: home.cancelSchedule(String(message.schedule_id)) };
      case "domotwin/config_history/list":
        return configHistory().list();
      case "domotwin/config_history/item":
        return configHistory().item(message.item);
      case "domotwin/config_history/version":
        return { config: configHistory().version(message.item, message.version) };
      case "domotwin/config_history/refresh":
        configHistory();
        // Put back already, as Home Assistant's editors would have saved it.
        return { changed: 0 };
      case "domotwin/report/get":
        return report().get(typeof message.report === "number" ? message.report : undefined);
      case "domotwin/report/write":
        return report().write();
      case "domotwin/report/settings":
        return report().save(message.settings);
      case "lovelace/config/save":
        configHistory().putBack(
          "dashboard",
          typeof message.url_path === "string" ? message.url_path : "",
          message.config,
        );
        return null;
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
        const { start, end } = span(message);
        // The rows of a context: what its Home Assistant recorded (D-059, "Why?").
        if (typeof message.context_id === "string") {
          return home.recorded?.events({ start, end, context: message.context_id }) ?? [];
        }
        if (!home.logbook) throw failure("unknown_command", message.type);
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
