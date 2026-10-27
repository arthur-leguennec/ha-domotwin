import { describe, expect, it } from "vitest";

import type { HassEntity, HomeAssistant } from "../src/ha/types";
import { Translator, en } from "../src/i18n";
import { safetyEn, safetyFr } from "../src/i18n/safety";
import type { BindingsJson } from "../src/live/bindings";
import { NO_CHOICES, pathOf, readChoices, routeOf, startTab } from "../src/live/choices";
import { DoorbellWatch, RING_FRESH_MS } from "../src/live/doorbell";
import { roomLayers, type PlanRoom } from "../src/live/layers";
import type { Unseen } from "../src/live/privacy";
import { doorbellOf, safetyOf } from "../src/live/safety";
import {
  readSecurityAlerts,
  securityAlerts,
  securityAlertsKept,
  securityPage,
  shownAlerts,
} from "../src/live/security";
import { alertText, withAlertsElsewhere, type StoreyAlert } from "../src/live/storeys";

const state = (entity_id: string, value: string, attributes = {}): HassEntity => ({
  entity_id,
  state: value,
  attributes,
  last_changed: "",
  last_updated: "",
});

/** An entity of the fictional home: its state, area, device and how Home Assistant shows it. */
interface Entity {
  state: string;
  attributes?: Record<string, unknown>;
  area?: string;
  device?: string;
  hidden?: boolean;
  category?: string;
}

/** A fictional home on Home Assistant 2026.10, with its Security page. */
function home(entities: Record<string, Entity>, extra: Partial<HomeAssistant> = {}): HomeAssistant {
  const states: HomeAssistant["states"] = {};
  const registry: NonNullable<HomeAssistant["entities"]> = {};
  for (const [id, entity] of Object.entries(entities)) {
    states[id] = state(id, entity.state, entity.attributes);
    registry[id] = {
      entity_id: id,
      ...(entity.area ? { area_id: entity.area } : {}),
      ...(entity.device ? { device_id: entity.device } : {}),
      ...(entity.hidden ? { hidden: true } : {}),
      ...(entity.category ? { entity_category: entity.category } : {}),
    };
  }
  return {
    states,
    entities: registry,
    devices: { bell: { id: "bell", area_id: "hall" } },
    areas: {
      hall: { area_id: "hall", name: "Hall" },
      bedroom: { area_id: "bedroom", name: "Bedroom" },
    },
    panels: { security: { url_path: "security" } },
    config: { version: "2026.10.0" },
    user: { id: "viewer", name: "Viewer", is_admin: false },
    language: "en",
    connection: {} as HomeAssistant["connection"],
    callService: () => Promise.resolve(),
    ...extra,
  };
}

const NOTHING: Unseen = { areas: new Set(), entities: new Set() };
const BEDROOM_CLOSED: Unseen = { areas: new Set(["bedroom"]), entities: new Set() };

describe("Home Assistant's Security page (D-064)", () => {
  it("is opened where Home Assistant has it, from 2025.12, never for the demo house", () => {
    expect(securityPage(home({}))).toBe("/security?historyBack=1");
    expect(securityPage(home({}, { config: { version: "2025.12.0" } }))).toBe(
      "/security?historyBack=1",
    );
    // An experiment before, and not there at all before that.
    expect(securityPage(home({}, { config: { version: "2025.11.3" } }))).toBeUndefined();
    expect(securityPage(home({}, { panels: {} }))).toBeUndefined();
    expect(securityPage(home({}, { demo: true }))).toBeUndefined();
    expect(securityPage(home({}, { demo: true, sandbox: true }))).toBeUndefined();
    expect(securityPage(undefined)).toBeUndefined();
  });

  it("keeps alerts an administrator chose from 2026.9", () => {
    expect(securityAlertsKept(home({}))).toBe(true);
    expect(securityAlertsKept(home({}, { config: { version: "2026.9.0" } }))).toBe(true);
    expect(securityAlertsKept(home({}, { config: { version: "2026.8.4" } }))).toBe(false);
    expect(securityAlertsKept(home({}, { panels: {} }))).toBe(false);
  });

  it("reads the alerts chosen, what is not understood left out", () => {
    expect(readSecurityAlerts(null)).toEqual([]);
    expect(readSecurityAlerts({ favorite_entities: ["lock.front"] })).toEqual([]);
    expect(
      readSecurityAlerts({
        alert_entities: [
          { entity: "lock.front", severity: "alert" },
          { entity: "binary_sensor.smoke" },
          { entity: "cover.garage", severity: "loud" },
          { entity: "lock.front", severity: "warning" },
          "binary_sensor.bare",
          { severity: "alert" },
        ],
      }),
    ).toEqual([
      { entity: "lock.front", severity: "alert" },
      { entity: "binary_sensor.smoke" },
      { entity: "cover.garage" },
    ]);
  });

  it("says the alerts on now as Home Assistant shows them, dangers first", () => {
    const hass = home({
      "lock.front": { state: "unlocked", attributes: { friendly_name: "Front door" } },
      "lock.back": { state: "locked" },
      "lock.cellar": { state: "jammed" },
      "cover.garage": { state: "open", attributes: { device_class: "garage" } },
      "cover.shed": { state: "closed" },
      "alarm_control_panel.home": { state: "triggered", attributes: { friendly_name: "Alarm" } },
      "binary_sensor.smoke": { state: "on", attributes: { device_class: "smoke" } },
      "binary_sensor.glass": { state: "on", attributes: { device_class: "glass_break" } },
      "binary_sensor.door": { state: "on", attributes: { device_class: "door" } },
      "binary_sensor.leak": { state: "unavailable", attributes: { device_class: "moisture" } },
    });
    const choices = readSecurityAlerts({
      alert_entities: [
        { entity: "lock.front" },
        { entity: "lock.back" },
        { entity: "lock.cellar", severity: "alert" },
        { entity: "cover.garage" },
        { entity: "cover.shed" },
        { entity: "alarm_control_panel.home" },
        { entity: "binary_sensor.smoke", severity: "warning" },
        { entity: "binary_sensor.glass" },
        { entity: "binary_sensor.door" },
        { entity: "binary_sensor.leak" },
        { entity: "binary_sensor.gone" },
      ],
    });
    expect(securityAlerts(hass, choices).map((a) => [a.entity, a.level])).toEqual([
      ["lock.cellar", "danger"],
      ["alarm_control_panel.home", "danger"],
      ["binary_sensor.glass", "danger"],
      ["lock.front", "warning"],
      ["cover.garage", "warning"],
      ["binary_sensor.smoke", "warning"],
      ["binary_sensor.door", "warning"],
    ]);
    // In Home Assistant's words where it gives them.
    const said = securityAlerts(
      { ...hass, formatEntityState: (entity) => entity.state.toUpperCase() },
      choices,
    );
    expect(said[3]).toEqual({
      entity: "lock.front",
      name: "Front door",
      state: "UNLOCKED",
      level: "warning",
    });
  });

  it("says only the dangers of a private room the viewer may not see (D-039)", () => {
    const hass = home({
      "lock.bedroom": { state: "unlocked", area: "bedroom" },
      "binary_sensor.bedroom_smoke": {
        state: "on",
        area: "bedroom",
        attributes: { device_class: "smoke" },
      },
    });
    const choices = [{ entity: "lock.bedroom" }, { entity: "binary_sensor.bedroom_smoke" }];
    expect(securityAlerts(hass, choices).length).toBe(2);
    expect(securityAlerts(hass, choices, BEDROOM_CLOSED).map((a) => a.entity)).toEqual([
      "binary_sensor.bedroom_smoke",
    ]);
  });

  it("is said after the rooms' alerts of its level, and not twice for the same sensor", () => {
    const room = (entity: string, level: "danger" | "warning"): StoreyAlert => ({
      room: "hall",
      name: "Hall",
      level,
      reason: level === "danger" ? "smoke" : "co2",
      entity,
    });
    const own = (entity: string, level: "danger" | "warning") => ({
      entity,
      name: entity,
      state: "on",
      level,
    });
    const shown = shownAlerts(
      [room("binary_sensor.hall_smoke", "danger"), room("sensor.hall_co2", "warning")],
      [
        own("lock.front", "warning"),
        own("binary_sensor.hall_smoke", "danger"),
        own("alarm_control_panel.home", "danger"),
      ],
    );
    expect(shown.map(({ kind, alert }) => `${kind}:${alert.entity}`)).toEqual([
      "room:binary_sensor.hall_smoke",
      "security:alarm_control_panel.home",
      "room:sensor.hall_co2",
      "security:lock.front",
    ]);
  });
});

describe("the alerts of every storey (D-064)", () => {
  const BINDINGS: BindingsJson = {
    version: 1,
    rooms: { hall: { area: "hall" }, bedroom: { area: "bedroom" } },
    elements: {},
  };
  const choice = { layer: "off", alerts: true, presence: false } as const;

  it("leaves out the warnings of a private room on another storey, not its dangers", () => {
    const hass = home({
      "weather.home": { state: "rainy" },
      "binary_sensor.bedroom_window": {
        state: "on",
        area: "bedroom",
        attributes: { device_class: "window" },
      },
      "binary_sensor.hall_smoke": {
        state: "on",
        area: "hall",
        attributes: { device_class: "smoke" },
      },
    });
    const here = roomLayers(hass, BINDINGS, [{ id: "hall", name: "Hall" }], choice).alerts;
    const upstairs = [{ storey: "up", rooms: [{ id: "bedroom", name: "Bedroom" }] as PlanRoom[] }];
    expect(withAlertsElsewhere(hass, BINDINGS, here, upstairs, undefined).length).toBe(2);
    const closed = new Set(["bedroom"]);
    expect(
      withAlertsElsewhere(hass, BINDINGS, here, upstairs, undefined, closed).map((a) => a.room),
    ).toEqual(["hall"]);
    hass.states["binary_sensor.bedroom_smoke"] = state("binary_sensor.bedroom_smoke", "on", {
      device_class: "smoke",
    });
    hass.entities = {
      ...hass.entities,
      "binary_sensor.bedroom_smoke": {
        entity_id: "binary_sensor.bedroom_smoke",
        area_id: "bedroom",
      },
    };
    const alerts = withAlertsElsewhere(hass, BINDINGS, here, upstairs, undefined, closed);
    expect(alerts.map((a) => [a.room, a.reason, a.storey])).toEqual([
      ["hall", "smoke", undefined],
      ["bedroom", "smoke", "up"],
    ]);
    // Said with its storey.
    const t = new Translator("en");
    const storeys = [
      { id: "ground", name: "", elevation: 0 },
      { id: "up", name: "", elevation: 280 },
    ];
    expect(alertText(t, alerts[1] as StoreyAlert, storeys)).toBe("Smoke in Bedroom (Floor 1)");
    expect(alertText(new Translator("fr"), alerts[0] as StoreyAlert, storeys)).toBe("Fumée : Hall");
  });
});

describe("the doorbell (D-064)", () => {
  const ago = (ms: number): string => new Date(Date.now() - ms).toISOString();
  const bell = (rang: string, extra: Partial<Entity> = {}): Entity => ({
    state: rang,
    attributes: { device_class: "doorbell", event_type: "ring" },
    device: "bell",
    ...extra,
  });
  /** The home with its states changed, as Home Assistant gives a new object for them. */
  const changed = (hass: HomeAssistant, id: string, value: string): HomeAssistant => ({
    ...hass,
    states: {
      ...hass.states,
      [id]: { ...(hass.states[id] as HassEntity), state: value },
    },
  });

  it("finds the doorbells: events of the doorbell class, not hidden", () => {
    const hass = home({
      "event.front": bell(ago(60_000)),
      "event.back": bell(ago(60_000), { hidden: true }),
      "event.remote_button": { state: "unknown", attributes: { device_class: "button" } },
      "binary_sensor.visitor": { state: "off", attributes: { device_class: "doorbell" } },
    });
    expect(safetyOf(hass).doorbells.map((doorbell) => doorbell.entity)).toEqual(["event.front"]);
  });

  it("rings for a newer time seen while it shows, not for the one it opens with", () => {
    let hass = home({ "event.front": bell(ago(10_000)) });
    const watch = new DoorbellWatch();
    // Rung ten seconds before DomoTwin opened: not known to be new.
    expect(watch.check(hass)).toBeUndefined();
    // The same states again: nothing looked at.
    expect(watch.check(hass)).toBeUndefined();
    const now = new Date().toISOString();
    hass = changed(hass, "event.front", now);
    expect(watch.check(hass)).toEqual({ entity: "event.front", at: Date.parse(now) });
    // Another state of the home changed: no ring again.
    hass = changed(hass, "event.front", now);
    expect(watch.check(hass)).toBeUndefined();
  });

  it("does not ring for a time Home Assistant gives back as it starts, nor an old one", () => {
    const before = ago(30_000);
    let hass = home({ "event.front": bell(before) });
    const watch = new DoorbellWatch();
    watch.check(hass);
    // Home Assistant restarting: unavailable, then the time it had.
    hass = changed(hass, "event.front", "unavailable");
    expect(watch.check(hass)).toBeUndefined();
    hass = changed(hass, "event.front", before);
    expect(watch.check(hass)).toBeUndefined();
    // Heard while the page was asleep: three minutes ago.
    hass = changed(hass, "event.front", ago(RING_FRESH_MS + 60_000));
    expect(watch.check(hass)).toBeUndefined();
    // Never rung when it opened, then rung.
    const fresh = home({ "event.front": bell("unknown") });
    const other = new DoorbellWatch();
    expect(other.check(fresh)).toBeUndefined();
    expect(other.check(changed(fresh, "event.front", ago(1_000)))?.entity).toBe("event.front");
  });

  it("rings for the doorbell rung last when two ring at once; a new one is first seen", () => {
    let hass = home({ "event.front": bell(ago(600_000)), "event.back": bell(ago(600_000)) });
    const watch = new DoorbellWatch();
    watch.check(hass);
    hass = changed(hass, "event.front", ago(5_000));
    hass = changed(hass, "event.back", ago(1_000));
    expect(watch.check(hass)?.entity).toBe("event.back");
    // A doorbell added (a new registry): its time is where it starts from.
    hass = {
      ...hass,
      states: {
        ...hass.states,
        "event.side": state("event.side", ago(1_000), bell("").attributes),
      },
      entities: { ...hass.entities, "event.side": { entity_id: "event.side" } },
    };
    expect(watch.check(hass)).toBeUndefined();
  });

  it("watches a doorbell whose state comes after the registry, as Home Assistant starts", () => {
    const registered = home({ "event.front": bell(ago(600_000)) });
    let hass: HomeAssistant = { ...registered, states: {} };
    const watch = new DoorbellWatch();
    expect(watch.check(hass)).toBeUndefined();
    // Its state comes, the registry the same object: the time it starts from.
    hass = { ...hass, states: { ...registered.states } };
    expect(watch.check(hass)).toBeUndefined();
    hass = changed(hass, "event.front", ago(1_000));
    expect(watch.check(hass)?.entity).toBe("event.front");
  });
});

describe("the Safety tab (D-064)", () => {
  const entities = (): Record<string, Entity> => ({
    "event.front_bell": {
      state: "2026-10-24T07:30:00.000+00:00",
      attributes: { device_class: "doorbell", friendly_name: "Front door" },
      device: "bell",
    },
    "camera.front_door": { state: "idle", device: "bell", attributes: { friendly_name: "Front" } },
    "camera.attic": { state: "idle", attributes: { friendly_name: "Attic" } },
    "camera.bedroom": { state: "idle", area: "bedroom", attributes: { friendly_name: "Bed" } },
    "camera.garden_low": { state: "idle", hidden: true },
    "camera.garden_snapshot": { state: "idle", category: "diagnostic" },
    "lock.front": { state: "locked", area: "hall" },
    "lock.bedroom": { state: "locked", area: "bedroom" },
    "alarm_control_panel.home": { state: "disarmed" },
  });

  it("puts the doorbells' cameras first, the others by name; nothing hidden or a setting", () => {
    const safety = safetyOf(home(entities()), NOTHING);
    expect(safety.cameras).toEqual(["camera.front_door", "camera.attic", "camera.bedroom"]);
    expect(safety.alarms).toEqual(["alarm_control_panel.home"]);
    expect(safety.locks).toEqual(["lock.bedroom", "lock.front"]);
    expect(safety.doorbells).toEqual([
      {
        entity: "event.front_bell",
        rang: Date.parse("2026-10-24T07:30:00Z"),
        camera: "camera.front_door",
        lock: "lock.front",
      },
    ]);
  });

  it("leaves out what a private room holds (D-039)", () => {
    const safety = safetyOf(home(entities()), BEDROOM_CLOSED);
    expect(safety.cameras).not.toContain("camera.bedroom");
    expect(safety.locks).toEqual(["lock.front"]);
    const hidden = safetyOf(home(entities()), {
      areas: new Set(),
      entities: new Set(["camera.front_door"]),
    });
    expect(hidden.doorbells[0]?.camera).toBeUndefined();
  });

  it("finds a doorbell's camera and lock on its device, else alone in its area", () => {
    const own = entities();
    // The lock of the doorbell's own device wins over the hall's.
    own["lock.bell"] = { state: "locked", device: "bell" };
    expect(doorbellOf(home(own), "event.front_bell").lock).toBe("lock.bell");
    // Two locks in its area: neither.
    const two = entities();
    two["lock.hall_side"] = { state: "locked", area: "hall" };
    expect(doorbellOf(home(two), "event.front_bell").lock).toBeUndefined();
    // No camera of its own: the only one in its area.
    const alone = entities();
    delete alone["camera.front_door"];
    alone["camera.hall"] = { state: "idle", area: "hall" };
    expect(doorbellOf(home(alone), "event.front_bell").camera).toBe("camera.hall");
    // Never rung: no time.
    const never = entities();
    (never["event.front_bell"] as Entity).state = "unknown";
    expect(doorbellOf(home(never), "event.front_bell").rang).toBeUndefined();
  });

  it("is a tab of its own, in the address and among the tabs to open on", () => {
    expect(routeOf("/safety")).toEqual({ tab: "safety" });
    expect(pathOf("safety")).toBe("/safety");
    expect(readChoices({ start: "safety" }).start).toBe("safety");
    expect(startTab(NO_CHOICES, "safety", false)).toBe("safety");
  });
});

describe("the safety messages", () => {
  const keys = (value: unknown, prefix = ""): string[] =>
    typeof value !== "object" || value === null
      ? [prefix]
      : Object.entries(value).flatMap(([key, child]) =>
          keys(child, prefix ? `${prefix}.${key}` : key),
        );

  it("has the same keys in both languages, none of the first load's", () => {
    expect(keys(safetyFr).sort()).toEqual(keys(safetyEn).sort());
    const main = new Set(keys(en));
    expect(keys(safetyEn).filter((key) => main.has(key))).toEqual([]);
  });

  it("has the same placeholders in both languages", () => {
    const placeholders = (text: unknown): string[] =>
      typeof text === "string"
        ? [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? "").sort()
        : [];
    const lookup = (dict: unknown, key: string): unknown =>
      key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], dict);
    for (const key of keys(safetyEn)) {
      expect(placeholders(lookup(safetyFr, key)), key).toEqual(placeholders(lookup(safetyEn, key)));
    }
  });
});
