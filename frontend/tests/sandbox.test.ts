import { describe, expect, it } from "vitest";

import type { HassEntity } from "../src/ha/types";
import { playDay, type HandCall, type Happening, type World } from "../src/sandbox/engine";
import { reportOf } from "../src/sandbox/report";
import type { HomeCopy } from "../src/sandbox/copy";
import { SandboxHome } from "../src/sandbox/home";
import { dayOf, firstScenario, prepare, temperatureAt } from "../src/sandbox/scenario";
import { sunAt, sunDay } from "../src/sandbox/sun";
import { Unplayable, render, renderCondition, type TemplateScope } from "../src/sandbox/templates";
import { clockOf, clockOn, isoIn, moment, parseDuration, zoned } from "../src/sandbox/time";

const ZONE = "Europe/Paris";
const START = moment(ZONE, 2026, 6, 15);
const END = moment(ZONE, 2026, 6, 16);
const at = (hour: number, minute = 0, second = 0): number =>
  moment(ZONE, 2026, 6, 15, hour, minute, second);

function entity(id: string, state: string, attributes: Record<string, unknown> = {}): HassEntity {
  const iso = isoIn(START - 3_600_000, ZONE);
  return { entity_id: id, state, attributes, last_changed: iso, last_updated: iso };
}

/** A small fictional flat: a hall, a living room, a few things and the people living there. */
function world(
  automations: Record<string, unknown>[] = [],
  extra: Partial<World> = {},
  states: HassEntity[] = [],
): World {
  const all = [
    entity("light.hall", "off", { friendly_name: "Hall" }),
    entity("light.living", "off", { friendly_name: "Living room" }),
    entity("switch.kettle", "off"),
    entity("binary_sensor.hall_motion", "off"),
    entity("sensor.living_temperature", "21"),
    entity("person.alex", "home", { friendly_name: "Alex" }),
    entity("person.sam", "home", { friendly_name: "Sam" }),
    entity("input_boolean.guests", "off"),
    entity("input_number.target", "20", { min: 7, max: 30, step: 0.5 }),
    entity("cover.living", "closed", { current_position: 0 }),
    entity("lock.front", "locked"),
    entity("zone.home", "2", { friendly_name: "Home" }),
    entity("script.evening", "off"),
    entity("scene.film", "2026-06-01T20:00:00+02:00", {
      entity_id: ["light.living", "cover.living"],
    }),
    ...automations.map((_, k) => entity(`automation.a${k + 1}`, "on", { id: String(k + 1) })),
    ...states,
  ];
  const areas: Record<string, string> = {
    "light.hall": "hall",
    "binary_sensor.hall_motion": "hall",
    "light.living": "living",
    "cover.living": "living",
    "sensor.living_temperature": "living",
  };
  return {
    states: Object.fromEntries(all.map((e) => [e.entity_id, e])),
    areaOf: (id) => areas[id],
    areaName: (area) => ({ hall: "Hall", living: "Living room" })[area],
    deviceOf: () => undefined,
    entitiesOfDevice: () => [],
    entitiesOfArea: (area) => Object.keys(areas).filter((id) => areas[id] === area),
    areasOfFloor: (floor) => (floor === "ground" ? ["hall", "living"] : []),
    entitiesOfLabel: () => [],
    entityFromRegistryId: (id) => (id === "abc123" ? "binary_sensor.hall_motion" : undefined),
    automations: automations.map((config, k) => ({ id: `automation.a${k + 1}`, config })),
    scripts: [],
    scenes: [
      {
        id: "scene.film",
        entities: {
          "light.living": { state: "on", attributes: { brightness: 40 } },
          "cover.living": { state: "closed", attributes: { current_position: 0 } },
        },
      },
    ],
    zone: ZONE,
    latitude: 48.85,
    longitude: 2.35,
    ...extra,
  };
}

const play = (w: World, happenings: Happening[] = [], calls: HandCall[] = []) =>
  playDay(w, START, END, happenings, calls);

/** The state of `id` once the day is over. */
const finalState = (w: World, id: string): string | undefined => w.states[id]?.state;

const changesOf = (day: ReturnType<typeof play>, id: string): [string, string][] =>
  day.changes
    .filter((c) => c.entity.entity_id === id)
    .map((c) => [clockOf(c.at, ZONE), c.entity.state]);

describe("the sandbox's time", () => {
  it("reads and writes a wall clock in Home Assistant's time zone, across a change of time", () => {
    const before = moment(ZONE, 2026, 3, 29, 1, 30);
    const after = moment(ZONE, 2026, 3, 29, 3, 30);
    expect(after - before).toBe(3_600_000);
    expect(zoned(after, ZONE)).toMatchObject({ hour: 3, minute: 30, weekday: 6 });
    expect(isoIn(after, ZONE)).toBe("2026-03-29T03:30:00+02:00");
    expect(isoIn(moment("America/Toronto", 2026, 1, 5, 7), "America/Toronto")).toBe(
      "2026-01-05T07:00:00-05:00",
    );
  });

  it("reads durations as Home Assistant writes them", () => {
    expect(parseDuration("00:05:00")).toBe(300_000);
    expect(parseDuration("1:30")).toBe(5_400_000);
    expect(parseDuration("-00:30:00")).toBe(-1_800_000);
    expect(parseDuration(90)).toBe(90_000);
    expect(parseDuration({ minutes: 2, seconds: 5 })).toBe(125_000);
    expect(parseDuration({ weeks: 1 })).toBeUndefined();
    expect(parseDuration("soon")).toBeUndefined();
  });

  it("places the sun from the home's latitude and longitude", () => {
    const day = sunDay(START, END, 48.85, 2.35);
    expect(clockOf(day.rising ?? 0, ZONE)).toBe("05:46");
    expect(clockOf(day.setting ?? 0, ZONE)).toBe("21:55");
    expect(sunAt(at(14), 48.85, 2.35).elevation).toBeGreaterThan(60);
    // No sunset at midsummer in the far north.
    const north = sunDay(START, END, 69.65, 18.96);
    expect(north.setting).toBeUndefined();
    expect(north.upAtStart).toBe(true);
  });
});

describe("the sandbox's templates", () => {
  const scope = (variables: Record<string, unknown> = {}): TemplateScope => {
    const w = world();
    return {
      state: (id) => w.states[id],
      ids: () => Object.keys(w.states),
      areaOf: (id) => w.areaOf(id),
      areaName: (area) => w.areaName(area),
      now: at(22, 15),
      zone: ZONE,
      variables,
    };
  };

  it("read states, attributes, numbers and the time", () => {
    expect(render("{{ states('sensor.living_temperature') | float(0) + 1 }}", scope())).toBe(22);
    expect(render("{{ is_state('light.hall', 'off') and now().hour >= 22 }}", scope())).toBe(true);
    expect(render("{{ state_attr('input_number.target', 'max') }}", scope())).toBe(30);
    expect(render("{{ states.light.living.state }}", scope())).toBe("off");
    expect(render("{{ 'on' if is_state('lock.front', 'locked') else 'off' }}", scope())).toBe("on");
    expect(render("{{ now() > today_at('22:00') }}", scope())).toBe(true);
    expect(render("{{ (now() - today_at('22:00')).total_seconds() }}", scope())).toBe(900);
    expect(render("{{ area_entities('hall') | length }}", scope())).toBe(2);
    expect(render("It is {{ now().strftime('%H:%M') }}.", scope())).toBe("It is 22:15.");
    expect(render("{{ [1, 5, 3] | max }}", scope())).toBe(5);
    expect(render("{{ states('sensor.missing') }}", scope())).toBe("unknown");
  });

  it("read what set an automation off", () => {
    const vars = {
      trigger: { id: "night", to_state: { state: "x" }, entity_id: "binary_sensor.hall_motion" },
    };
    expect(render("{{ trigger.id }}", scope(vars))).toBe("night");
    expect(
      renderCondition("{{ trigger.entity_id == 'binary_sensor.hall_motion' }}", scope(vars)),
    ).toBe(true);
    // A condition holds only when it renders true, as Home Assistant's do.
    expect(renderCondition("{{ 1 }}", scope())).toBe(false);
  });

  it("refuse what they cannot read, saying why", () => {
    expect(() => render("{% if true %}on{% endif %}", scope())).toThrow(Unplayable);
    expect(() => render("{{ expand('group.all') }}", scope())).toThrow(Unplayable);
    expect(() => render("{{ states('sensor.missing') | float }}", scope())).toThrow(Unplayable);
    expect(() => render("{{ 'a' < 1 }}", scope())).toThrow(Unplayable);
  });
});

describe("the sandbox's day", () => {
  it("sets an automation off on a change, runs its actions and says what they changed", () => {
    const w = world([
      {
        triggers: [{ trigger: "state", entity_id: "binary_sensor.hall_motion", to: "on" }],
        actions: [{ action: "light.turn_on", target: { entity_id: "light.hall" } }],
      },
    ]);
    const day = play(w, [{ at: at(7, 10), entity: "binary_sensor.hall_motion", state: "on" }]);
    expect(changesOf(day, "light.hall")).toEqual([["07:10", "on"]]);
    const change = day.changes.find((c) => c.entity.entity_id === "light.hall");
    expect(change?.cause).toMatchObject({ kind: "automation", id: "automation.a1" });
    const report = reportOf(day, ["automation.a1"], []);
    expect(report.owners[0]?.runs).toHaveLength(1);
    expect(report.owners[0]?.runs[0]?.calls[0]).toMatchObject({
      service: "light.turn_on",
      changed: ["light.hall"],
    });
    expect(report.neverRan).toEqual([]);
    // Its run is when the automation last ran, as Home Assistant says.
    expect(w.states["automation.a1"]?.attributes.last_triggered).toBe("2026-06-15T07:10:00+02:00");
  });

  it("plays the old spellings too (platform, service, trigger and action in the singular)", () => {
    const w = world([
      {
        trigger: { platform: "state", entity_id: "binary_sensor.hall_motion", to: "on" },
        condition: "{{ is_state('input_boolean.guests', 'off') }}",
        action: { service: "light.turn_on", entity_id: "light.hall" },
      },
    ]);
    play(w, [{ at: at(7), entity: "binary_sensor.hall_motion", state: "on" }]);
    expect(finalState(w, "light.hall")).toBe("on");
  });

  it("waits out `for`, and forgets it when the state goes back before", () => {
    const w = world([
      {
        triggers: [
          { trigger: "state", entity_id: "binary_sensor.hall_motion", to: "off", for: "00:05:00" },
        ],
        actions: [{ action: "light.turn_off", target: { entity_id: "light.hall" } }],
      },
    ]);
    w.states["light.hall"] = entity("light.hall", "on");
    w.states["binary_sensor.hall_motion"] = entity("binary_sensor.hall_motion", "on");
    const day = play(w, [
      { at: at(8), entity: "binary_sensor.hall_motion", state: "off" },
      { at: at(8, 3), entity: "binary_sensor.hall_motion", state: "on" },
      { at: at(8, 4), entity: "binary_sensor.hall_motion", state: "off" },
    ]);
    expect(changesOf(day, "light.hall")).toEqual([["08:09", "off"]]);
  });

  it("fires at a time, on the days asked, and at sunset with an offset", () => {
    const w = world([
      {
        triggers: [{ trigger: "time", at: "06:45:00", weekday: ["mon", "tue"] }],
        actions: [{ action: "switch.turn_on", target: { entity_id: "switch.kettle" } }],
      },
      {
        triggers: [{ trigger: "time", at: "06:45:00", weekday: "sat" }],
        actions: [{ action: "lock.unlock", target: { entity_id: "lock.front" } }],
      },
      {
        triggers: [{ trigger: "sun", event: "sunset", offset: "-00:30:00" }],
        actions: [{ action: "cover.close_cover", target: { area_id: "living" } }],
      },
    ]);
    w.states["cover.living"] = entity("cover.living", "open", { current_position: 100 });
    const day = play(w);
    // 2026-06-15 is a Monday.
    expect(changesOf(day, "switch.kettle")).toEqual([["06:45", "on"]]);
    expect(changesOf(day, "lock.front")).toEqual([]);
    expect(changesOf(day, "cover.living")).toEqual([["21:25", "closed"]]);
  });

  it("goes through a time pattern each time it matches", () => {
    const w = world([
      {
        triggers: [{ trigger: "time_pattern", minutes: "/15" }],
        actions: [
          { action: "input_number.increment", target: { entity_id: "input_number.target" } },
        ],
      },
    ]);
    const day = play(w);
    const report = reportOf(day, ["automation.a1"], []);
    expect(report.owners[0]?.runs).toHaveLength(96);
    expect(finalState(w, "input_number.target")).toBe("30");
  });

  it("fires a numeric state once as it crosses the line, not while it stays over", () => {
    const w = world([
      {
        triggers: [{ trigger: "numeric_state", entity_id: "sensor.living_temperature", above: 25 }],
        actions: [{ action: "cover.close_cover", target: { entity_id: "cover.living" } }],
      },
    ]);
    const day = play(w, [
      { at: at(12), entity: "sensor.living_temperature", state: "26" },
      { at: at(13), entity: "sensor.living_temperature", state: "27" },
      { at: at(14), entity: "sensor.living_temperature", state: "24" },
      { at: at(15), entity: "sensor.living_temperature", state: "25.5" },
    ]);
    expect(
      reportOf(day, ["automation.a1"], []).owners[0]?.runs.map((r) => clockOf(r.at, ZONE)),
    ).toEqual(["12:00", "15:00"]);
  });

  it("sets one automation off by what another does", () => {
    const w = world([
      {
        triggers: [{ trigger: "time", at: "18:00" }],
        actions: [
          { action: "input_boolean.turn_on", target: { entity_id: "input_boolean.guests" } },
        ],
      },
      {
        triggers: [{ trigger: "state", entity_id: "input_boolean.guests", to: "on" }],
        actions: [{ action: "scene.turn_on", target: { entity_id: "scene.film" } }],
      },
    ]);
    const day = play(w);
    expect(changesOf(day, "light.living")).toEqual([["18:00", "on"]]);
    expect(w.states["light.living"]?.attributes.brightness).toBe(40);
  });

  it("keeps an automation's mode: single skips, restart starts again", () => {
    const actions = [
      { action: "light.turn_on", target: { entity_id: "light.hall" } },
      { delay: "00:10:00" },
      { action: "light.turn_off", target: { entity_id: "light.hall" } },
    ];
    const trigger = [{ trigger: "state", entity_id: "binary_sensor.hall_motion", to: "on" }];
    const motion: Happening[] = [
      { at: at(20), entity: "binary_sensor.hall_motion", state: "on" },
      { at: at(20, 1), entity: "binary_sensor.hall_motion", state: "off" },
      { at: at(20, 5), entity: "binary_sensor.hall_motion", state: "on" },
    ];
    const single = world([{ triggers: trigger, actions }]);
    const singleDay = play(single, motion);
    expect(changesOf(singleDay, "light.hall")).toEqual([
      ["20:00", "on"],
      ["20:10", "off"],
    ]);
    expect(reportOf(singleDay, ["automation.a1"], []).owners[0]?.busy).toBe(1);
    const restart = world([{ triggers: trigger, actions, mode: "restart" }]);
    expect(changesOf(play(restart, motion), "light.hall")).toEqual([
      ["20:00", "on"],
      ["20:15", "off"],
    ]);
  });

  it("chooses, repeats, and waits for a template or a trigger, with their time limits", () => {
    const w = world([
      {
        triggers: [{ trigger: "time", at: "07:00" }],
        actions: [
          {
            choose: [
              {
                conditions: [{ condition: "state", entity_id: "person.alex", state: "home" }],
                sequence: [{ action: "switch.turn_on", entity_id: "switch.kettle" }],
              },
            ],
            default: [{ action: "lock.lock", entity_id: "lock.front" }],
          },
          {
            repeat: {
              count: 3,
              sequence: [{ action: "input_number.increment", entity_id: "input_number.target" }],
            },
          },
          {
            wait_template: "{{ is_state('binary_sensor.hall_motion', 'on') }}",
            timeout: "00:30:00",
          },
          {
            if: "{{ wait.completed }}",
            then: [{ action: "light.turn_on", entity_id: "light.hall" }],
          },
          {
            wait_for_trigger: [{ trigger: "state", entity_id: "lock.front", to: "unlocked" }],
            timeout: "01:00:00",
            continue_on_timeout: false,
          },
          { action: "light.turn_on", entity_id: "light.living" },
        ],
      },
    ]);
    const day = play(w, [{ at: at(7, 20), entity: "binary_sensor.hall_motion", state: "on" }]);
    expect(changesOf(day, "switch.kettle")).toEqual([["07:00", "on"]]);
    expect(finalState(w, "input_number.target")).toBe("21.5");
    expect(changesOf(day, "light.hall")).toEqual([["07:20", "on"]]);
    // The door was never unlocked: the run stopped at its time limit.
    expect(changesOf(day, "light.living")).toEqual([]);
  });

  it("runs a script called by name before going on, and one turned on beside", () => {
    const w = world([
      {
        triggers: [{ trigger: "time", at: "21:00" }],
        actions: [{ action: "script.evening" }, { action: "lock.lock", entity_id: "lock.front" }],
      },
    ]);
    w.states["lock.front"] = entity("lock.front", "unlocked");
    w.scripts = [
      {
        id: "script.evening",
        config: {
          sequence: [
            { action: "light.turn_on", target: { area_id: "living" } },
            { delay: { minutes: 5 } },
            { action: "cover.close_cover", target: { entity_id: "cover.living" } },
          ],
        },
      },
    ];
    w.states["cover.living"] = entity("cover.living", "open", { current_position: 100 });
    const day = play(w);
    expect(changesOf(day, "light.living")).toEqual([["21:00", "on"]]);
    expect(changesOf(day, "lock.front")).toEqual([["21:05", "locked"]]);
    const report = reportOf(day, ["automation.a1"], ["script.evening"]);
    expect(report.owners.find((o) => o.id === "script.evening")?.runs[0]?.by).toMatchObject({
      kind: "called",
      by: "automation.a1",
    });
  });

  it("finds two automations working against each other, and one that loops", () => {
    const w = world([
      {
        triggers: [{ trigger: "state", entity_id: "person.alex", to: "not_home" }],
        actions: [{ action: "light.turn_off", target: { entity_id: "light.living" } }],
      },
      {
        triggers: [{ trigger: "state", entity_id: "light.living", to: "off" }],
        conditions: [{ condition: "state", entity_id: "person.sam", state: "home" }],
        actions: [{ action: "light.turn_on", target: { entity_id: "light.living" } }],
      },
      {
        triggers: [{ trigger: "state", entity_id: "switch.kettle" }],
        actions: [{ action: "switch.toggle", target: { entity_id: "switch.kettle" } }],
        mode: "queued",
      },
    ]);
    w.states["light.living"] = entity("light.living", "on");
    const day = play(
      w,
      [{ at: at(9), entity: "person.alex", state: "not_home" }],
      [
        {
          at: at(10),
          domain: "switch",
          service: "turn_on",
          target: { entity_id: "switch.kettle" },
        },
      ],
    );
    const report = reportOf(day, ["automation.a1", "automation.a2", "automation.a3"], []);
    expect(report.conflicts).toHaveLength(1);
    expect(report.conflicts[0]).toMatchObject({
      entity: "light.living",
      first: { owner: "automation.a1", state: "off" },
      second: { owner: "automation.a2", state: "on" },
    });
    expect(report.owners.find((o) => o.id === "automation.a3")?.looping).toBe(true);
    expect(report.flapping.map((f) => f.entity)).toEqual(["switch.kettle"]);
    // What you did yourself is yours.
    expect(day.changes.find((c) => c.entity.entity_id === "switch.kettle")?.cause).toEqual({
      kind: "you",
    });
  });

  it("names what it cannot play, and goes on with the rest", () => {
    const w = world([
      {
        triggers: [{ trigger: "mqtt", topic: "home/doorbell" }],
        actions: [{ action: "light.turn_on", entity_id: "light.hall" }],
      },
      {
        triggers: [{ trigger: "time", at: "12:00" }],
        actions: [
          { action: "zwave_js.set_config_parameter", target: { entity_id: "light.hall" } },
          { action: "notify.mobile_app_phone", data: { message: "Lunch" } },
          {
            action: "light.turn_on",
            data: { brightness: "{% if true %}10{% endif %}" },
            entity_id: "light.living",
          },
          { action: "switch.turn_on", entity_id: "switch.kettle" },
        ],
      },
      {
        triggers: [
          { trigger: "device", entity_id: "abc123", type: "motion", domain: "binary_sensor" },
        ],
        actions: [{ action: "input_boolean.turn_on", entity_id: "input_boolean.guests" }],
      },
    ]);
    w.automations.push({ id: "automation.yaml_only" });
    const day = play(w, [{ at: at(19), entity: "binary_sensor.hall_motion", state: "on" }]);
    const report = reportOf(day, ["automation.a1", "automation.a2", "automation.a3"], []);
    const notes = (id: string) => report.owners.find((o) => o.id === id)?.notPlayed ?? [];
    expect(notes("automation.a1")).toEqual([{ reason: "trigger", detail: "mqtt" }]);
    expect(notes("automation.a2").map((n) => n.reason)).toEqual(["effect", "template"]);
    expect(notes("automation.yaml_only")).toEqual([{ reason: "config", detail: "" }]);
    expect(report.neverRan).toEqual(["automation.a1"]);
    // The run stopped where it could not go on; what came before was done and said.
    const run = report.owners.find((o) => o.id === "automation.a2")?.runs[0];
    expect(run?.said).toEqual([
      expect.objectContaining({ service: "notify.mobile_app_phone", message: "Lunch" }),
    ]);
    expect(run?.end?.why).toBe("error");
    expect(finalState(w, "switch.kettle")).toBe("off");
    // A device's motion trigger is the state trigger it stands for.
    expect(finalState(w, "input_boolean.guests")).toBe("on");
  });

  it("leaves an automation turned off out, and runs one when asked to", () => {
    const w = world([
      {
        triggers: [{ trigger: "time", at: "08:00" }],
        actions: [{ action: "automation.turn_off", target: { entity_id: "automation.a2" } }],
      },
      {
        triggers: [{ trigger: "time", at: "09:00" }],
        actions: [{ action: "light.turn_on", entity_id: "light.hall" }],
      },
      {
        triggers: [{ trigger: "time", at: "10:00" }],
        actions: [{ action: "automation.trigger", target: { entity_id: "automation.a2" } }],
      },
    ]);
    const day = play(w);
    expect(changesOf(day, "light.hall")).toEqual([["10:00", "on"]]);
  });
});

describe("the sandbox's day, as Home Assistant plays it", () => {
  it("turns on, off or toggles each entity once, whatever names it", () => {
    const w = world([
      {
        triggers: [{ trigger: "time", at: "07:00" }],
        actions: [
          {
            action: "homeassistant.toggle",
            data: { entity_id: ["light.hall", "light.living"] },
          },
        ],
      },
    ]);
    play(w);
    expect(finalState(w, "light.hall")).toBe("on");
    expect(finalState(w, "light.living")).toBe("on");
  });

  it("holds the sun's night either side of midnight", () => {
    const w = world([
      {
        triggers: [{ trigger: "time", at: "23:30" }],
        conditions: [{ condition: "sun", after: "sunset", before: "sunrise" }],
        actions: [{ action: "light.turn_on", target: { entity_id: "light.hall" } }],
      },
      {
        triggers: [{ trigger: "time", at: "12:00" }],
        conditions: [{ condition: "sun", after: "sunset", before: "sunrise" }],
        actions: [{ action: "light.turn_on", target: { entity_id: "light.living" } }],
      },
    ]);
    play(w);
    expect(finalState(w, "light.hall")).toBe("on");
    expect(finalState(w, "light.living")).toBe("off");
  });

  it("fires a state trigger naming nothing on an attribute's change too", () => {
    const w = world([
      {
        triggers: [{ trigger: "state", entity_id: "sensor.living_temperature" }],
        actions: [{ action: "light.turn_on", target: { entity_id: "light.hall" } }],
      },
      {
        triggers: [{ trigger: "state", entity_id: "sensor.living_temperature", to: null }],
        actions: [{ action: "light.turn_on", target: { entity_id: "light.living" } }],
      },
    ]);
    const day = play(w, [
      {
        at: at(9),
        entity: "sensor.living_temperature",
        state: "21",
        attributes: { battery: 80 },
      },
    ]);
    expect(changesOf(day, "light.hall")).toEqual([["09:00", "on"]]);
    // `to: null` is any state, not an attribute alone.
    expect(finalState(w, "light.living")).toBe("off");
  });

  it("waits out `for` from a state while it is not back to it, and for the value that fired", () => {
    const w = world([
      {
        triggers: [
          { trigger: "state", entity_id: "input_boolean.guests", from: "off", for: "00:05:00" },
        ],
        actions: [{ action: "light.turn_on", target: { entity_id: "light.hall" } }],
      },
      {
        triggers: [
          {
            trigger: "state",
            entity_id: "cover.living",
            to: ["open", "opening"],
            for: "00:05:00",
          },
        ],
        actions: [{ action: "light.turn_on", target: { entity_id: "light.living" } }],
      },
    ]);
    const day = play(w, [
      { at: at(9), entity: "input_boolean.guests", state: "on" },
      { at: at(9, 1), entity: "input_boolean.guests", state: "unknown" },
      { at: at(9), entity: "cover.living", state: "opening" },
      { at: at(9, 1), entity: "cover.living", state: "open" },
    ]);
    expect(changesOf(day, "light.hall")).toEqual([["09:05", "on"]]);
    expect(changesOf(day, "light.living")).toEqual([["09:06", "on"]]);
  });

  it("stops an automation's runs as it is turned off, and toggles a script", () => {
    const w = world(
      [
        {
          triggers: [{ trigger: "time", at: "08:00" }],
          actions: [
            { delay: { minutes: 10 } },
            { action: "light.turn_on", target: { entity_id: "light.hall" } },
          ],
        },
        {
          triggers: [{ trigger: "time", at: "08:05" }],
          actions: [
            { action: "automation.turn_off", target: { entity_id: "automation.a1" } },
            { action: "script.toggle", target: { entity_id: "script.evening" } },
          ],
        },
      ],
      {
        scripts: [
          {
            id: "script.evening",
            config: {
              sequence: [{ action: "light.turn_on", target: { entity_id: "light.living" } }],
            },
          },
        ],
      },
    );
    const day = play(w);
    expect(finalState(w, "light.hall")).toBe("off");
    expect(changesOf(day, "light.living")).toEqual([["08:05", "on"]]);
    const report = reportOf(day, ["automation.a1", "automation.a2"], ["script.evening"]);
    expect(report.owners.find((o) => o.id === "automation.a1")?.runs[0]?.end?.why).toBe("off");
    // Nothing runs once it is all over: Home Assistant's count of runs says so.
    expect(w.states["automation.a1"]?.attributes.current).toBe(0);
    expect(w.states["script.evening"]).toMatchObject({ state: "off", attributes: { current: 0 } });
  });

  it("says a scene once, and leaves a timer's end alone when a service does nothing to it", () => {
    const w = world(
      [
        {
          triggers: [{ trigger: "time", at: "08:00" }],
          actions: [
            { action: "scene.turn_on", target: { entity_id: "scene.film" } },
            { action: "timer.start", target: { entity_id: "timer.tea" } },
            { action: "timer.change", target: { entity_id: "timer.tea" }, data: { duration: 60 } },
            { action: "timer.cancel", target: { area_id: "living" } },
          ],
        },
        {
          triggers: [{ trigger: "event", event_type: "timer.finished" }],
          actions: [{ action: "light.turn_on", target: { entity_id: "light.hall" } }],
        },
        {
          triggers: [{ trigger: "event", event_type: "timer.cancelled" }],
          actions: [{ action: "switch.turn_on", target: { entity_id: "switch.kettle" } }],
        },
      ],
      {},
      [entity("timer.tea", "idle", { duration: "0:05:00" })],
    );
    const day = play(w);
    const report = reportOf(day, ["automation.a1"], []);
    const calls = report.owners.find((o) => o.id === "automation.a1")?.runs[0]?.calls ?? [];
    expect(calls.filter((c) => c.service === "scene.turn_on")).toHaveLength(1);
    expect(changesOf(day, "light.hall")).toEqual([["08:05", "on"]]);
    expect(finalState(w, "switch.kettle")).toBe("off");
  });

  it("reads a moment written without its offset on Home Assistant's clock", () => {
    const scope: TemplateScope = {
      state: () => undefined,
      ids: () => [],
      areaOf: () => undefined,
      areaName: () => undefined,
      now: at(7),
      zone: ZONE,
      variables: {},
    };
    expect(render("{{ as_timestamp('2026-06-15 07:00:00') }}", scope)).toBe(at(7) / 1000);
    expect(render("{{ as_datetime('2026-06-15 07:30').hour }}", scope)).toBe(7);
    expect(render("{{ as_timestamp('2026-06-15T05:00:00Z') }}", scope)).toBe(at(7) / 1000);
  });
});

describe("the sandbox's scenario", () => {
  const copy = {
    "person.alex": entity("person.alex", "home", {
      device_trackers: ["device_tracker.alex_phone"],
    }),
    "device_tracker.alex_phone": entity("device_tracker.alex_phone", "home"),
    "sensor.domotwin_alex_room": entity("sensor.domotwin_alex_room", "Kitchen", {
      person: "person.alex",
    }),
    "weather.home": entity("weather.home", "rainy", { temperature: 12 }),
    "sun.sun": entity("sun.sun", "above_horizon"),
    "automation.ran_tonight": entity("automation.ran_tonight", "on", {
      last_triggered: "2026-06-15T20:00:00+00:00",
      current: 1,
    }),
    "automation.ran_last_week": entity("automation.ran_last_week", "on", {
      last_triggered: "2026-06-08T20:00:00+00:00",
    }),
    "script.running": entity("script.running", "on", { last_triggered: null, current: 1 }),
  };

  it("starts from today, the weather as it is, and a working day's comings and goings", () => {
    const scenario = firstScenario(copy, ZONE, at(15));
    expect(scenario).toMatchObject({ date: "2026-06-15", weather: "rainy", low: 7, high: 16 });
    // A Monday: out at half past eight, back at six.
    expect(scenario.people).toEqual([{ id: "person.alex", home: true, leaves: 510, back: 1080 }]);
    const sunday = firstScenario(copy, ZONE, moment(ZONE, 2026, 6, 14, 15));
    expect(sunday.people).toEqual([{ id: "person.alex", home: true }]);
  });

  it("makes people, their trackers and their room go and come, the weather and the sun change", () => {
    const scenario = { ...firstScenario(copy, ZONE, at(15)), weather: "sunny" as const };
    const { start, end } = dayOf(scenario, ZONE);
    const sun = sunDay(start, end, 48.85, 2.35);
    const { states, happenings } = prepare(copy, scenario, ZONE, sun, start, {
      latitude: 48.85,
      longitude: 2.35,
    });
    expect(states["weather.home"]?.state).toBe("clear-night");
    // At midnight nothing runs, and what the home ran later that day has not run yet.
    expect(states["automation.ran_tonight"]?.attributes).toMatchObject({
      last_triggered: null,
      current: 0,
    });
    expect(states["automation.ran_last_week"]?.attributes.last_triggered).toBe(
      "2026-06-08T20:00:00+00:00",
    );
    expect(states["script.running"]).toMatchObject({ state: "off", attributes: { current: 0 } });
    expect(states["sun.sun"]?.state).toBe("below_horizon");
    const of = (id: string) =>
      happenings.filter((h) => h.entity === id).map((h) => [clockOf(h.at, ZONE), h.state]);
    expect(of("person.alex")).toEqual([
      ["08:30", "not_home"],
      ["18:00", "home"],
    ]);
    expect(of("device_tracker.alex_phone")).toEqual(of("person.alex"));
    expect(of("sensor.domotwin_alex_room")).toEqual([
      ["08:30", "not_home"],
      ["18:00", "Kitchen"],
    ]);
    // A room sensor renamed: the one DomoTwin's people settings name.
    const renamed = {
      ...copy,
      "sensor.where_alex_is": entity("sensor.where_alex_is", "Office", { person: "person.alex" }),
    };
    const moved = prepare(renamed, scenario, ZONE, sun, start, undefined, {
      "person.alex": "sensor.where_alex_is",
    });
    expect(
      moved.happenings.filter((h) => h.entity === "sensor.where_alex_is").map((h) => h.state),
    ).toEqual(["not_home", "Office"]);
    // The weather says the night and the day, its temperature each hour; the sun every ten
    // minutes and as it rises and sets.
    expect(of("weather.home")).toContainEqual(["05:46", "sunny"]);
    expect(of("sun.sun")).toContainEqual(["21:55", "below_horizon"]);
    expect(temperatureAt(scenario, 6 * 60)).toBe(scenario.low);
    expect(temperatureAt(scenario, 15 * 60)).toBe(scenario.high);
  });
});

describe("the sandbox's day, as Home Assistant plays it (more)", () => {
  it("goes on when a wait cannot be read, and stops what turns itself off there and then", () => {
    const w = world([
      {
        triggers: [{ trigger: "time", at: "07:00" }],
        actions: [{ wait_template: "{{ relative_time(now()) }}" }],
      },
      {
        triggers: [{ trigger: "time", at: "08:00" }],
        actions: [
          { action: "automation.turn_off", target: { entity_id: "automation.a2" } },
          { action: "light.turn_on", target: { entity_id: "light.hall" } },
        ],
      },
      {
        mode: "queued",
        triggers: [{ trigger: "time", at: ["09:00", "09:01"] }],
        actions: [
          { delay: { minutes: 5 } },
          { action: "switch.toggle", target: { entity_id: "switch.kettle" } },
        ],
      },
      {
        triggers: [{ trigger: "time", at: "09:02" }],
        actions: [{ action: "automation.turn_off", target: { entity_id: "automation.a3" } }],
      },
    ]);
    const day = play(w);
    const report = reportOf(day, ["automation.a1", "automation.a2", "automation.a3"], []);
    expect(report.owners.find((o) => o.id === "automation.a1")?.notPlayed[0]?.reason).toBe(
      "template",
    );
    expect(finalState(w, "light.hall")).toBe("off");
    // The one waiting its turn is dropped with the one running.
    expect(finalState(w, "switch.kettle")).toBe("off");
  });

  it("sets a template trigger off on what Home Assistant reads as true", () => {
    const w = world([
      {
        triggers: [{ trigger: "template", value_template: "{{ states('input_boolean.guests') }}" }],
        actions: [{ action: "light.turn_on", target: { entity_id: "light.hall" } }],
      },
      {
        triggers: [
          {
            trigger: "template",
            value_template: "{{ states('input_number.target') | int - 20 }}",
          },
        ],
        actions: [{ action: "light.turn_on", target: { entity_id: "light.living" } }],
      },
    ]);
    const day = play(w, [
      { at: at(9), entity: "input_boolean.guests", state: "on" },
      { at: at(10), entity: "input_number.target", state: "22" },
    ]);
    expect(changesOf(day, "light.hall")).toEqual([["09:00", "on"]]);
    expect(changesOf(day, "light.living")).toEqual([["10:00", "on"]]);
  });

  it("keeps a thermostat within its range, and an input datetime's time where it is set", () => {
    const w = world(
      [
        {
          triggers: [{ trigger: "time", at: "06:00" }],
          actions: [
            {
              action: "input_datetime.set_datetime",
              target: { entity_id: "input_datetime.wake" },
              data: { time: "10:00:00" },
            },
            {
              action: "climate.set_temperature",
              target: { entity_id: "climate.living" },
              data: { temperature: 68 },
            },
          ],
        },
        {
          triggers: [{ trigger: "time", at: "07:00" }],
          actions: [
            {
              action: "climate.set_temperature",
              target: { entity_id: "climate.living" },
              data: { temperature: 22 },
            },
          ],
        },
        {
          triggers: [{ trigger: "time", at: "08:00" }],
          conditions: [{ condition: "time", after: "input_datetime.wake" }],
          actions: [{ action: "light.turn_on", target: { entity_id: "light.hall" } }],
        },
        {
          triggers: [{ trigger: "time", at: "input_datetime.wake" }],
          actions: [{ action: "light.turn_on", target: { entity_id: "light.living" } }],
        },
      ],
      {},
      [
        entity("input_datetime.wake", "07:00:00", {
          has_date: false,
          has_time: true,
          hour: 7,
          minute: 0,
          second: 0,
        }),
        entity("climate.living", "heat", { temperature: 19, min_temp: 7, max_temp: 35 }),
      ],
    );
    const day = play(w);
    expect(w.states["input_datetime.wake"]).toMatchObject({
      state: "10:00:00",
      attributes: { hour: 10, minute: 0, second: 0, timestamp: 36000 },
    });
    // Not after ten at eight; and the trigger follows the time set.
    expect(finalState(w, "light.hall")).toBe("off");
    expect(changesOf(day, "light.living")).toEqual([["10:00", "on"]]);
    expect(w.states["climate.living"]?.attributes.temperature).toBe(22);
    const report = reportOf(day, ["automation.a1"], []);
    expect(report.owners.find((o) => o.id === "automation.a1")?.notPlayed).toEqual([
      { reason: "refused", detail: "climate.living temperature 68 (7–35)" },
    ]);
  });

  it("reads a timestamp sensor's time of day in a condition, and entity ids with commas", () => {
    const w = world(
      [
        {
          triggers: [
            { trigger: "state", entity_id: "binary_sensor.hall_motion, input_boolean.guests" },
          ],
          conditions: [{ condition: "time", after: "sensor.next_alarm" }],
          actions: [
            { action: "homeassistant.turn_on", target: { area_id: "hall" } },
            { action: "light.turn_on", data: { entity_id: "light.living, light.hall" } },
          ],
        },
      ],
      {},
      [entity("sensor.next_alarm", "2026-06-16T06:30:00+02:00", { device_class: "timestamp" })],
    );
    const day = play(w, [
      { at: at(6), entity: "input_boolean.guests", state: "on" },
      { at: at(7), entity: "binary_sensor.hall_motion", state: "on" },
    ]);
    expect(changesOf(day, "light.hall")).toEqual([["07:00", "on"]]);
    expect(finalState(w, "light.living")).toBe("on");
    // The hall's motion sensor has no `turn_on`: passed over, as Home Assistant does.
    expect(reportOf(day, ["automation.a1"], []).owners[0]?.notPlayed).toEqual([]);
  });

  it("skips the times the clocks skip, and says the sun rises until noon", () => {
    const spring = moment(ZONE, 2026, 3, 29);
    const w = world([
      {
        triggers: [{ trigger: "time_pattern", minutes: "/30" }],
        actions: [{ action: "counter.increment", target: { entity_id: "counter.ticks" } }],
      },
    ]);
    w.states["counter.ticks"] = entity("counter.ticks", "0");
    playDay(w, spring, moment(ZONE, 2026, 3, 30), []);
    expect(finalState(w, "counter.ticks")).toBe("46");
    const copy = { "sun.sun": entity("sun.sun", "below_horizon", { next_rising: "old" }) };
    const scenario = { ...firstScenario(copy, ZONE, at(12)), people: [] };
    const sun = sunDay(START, END, 48.85, 2.35);
    const { happenings } = prepare(copy, scenario, ZONE, sun, START, {
      latitude: 48.85,
      longitude: 2.35,
    });
    const sunAtClock = (clock: string) =>
      happenings.find((h) => h.entity === "sun.sun" && clockOf(h.at, ZONE) === clock)?.attributes;
    expect(sunAtClock("09:00")?.rising).toBe(true);
    expect(sunAtClock("15:00")?.rising).toBe(false);
    // After sunset, the next setting is tomorrow's.
    const late = sunAtClock("23:00");
    expect(String(late?.next_setting)).toMatch(/^2026-06-16T21:5\d/);
    expect(String(late?.next_rising)).toMatch(/^2026-06-16T05:4\d/);
  });
});

describe("the sandbox's clock on the day the clocks change", () => {
  // 25 October 2026 in Paris: two in the morning comes twice, the day has 25 hours.
  const day = moment(ZONE, 2026, 10, 25);

  it("counts who is in the home zone as people go out and come back (D-066)", () => {
    const copy: Record<string, HassEntity> = {
      "person.alex": entity("person.alex", "home"),
      "person.sam": entity("person.sam", "home"),
      "person.kim": entity("person.kim", "not_home"),
      "zone.home": entity("zone.home", "2", { friendly_name: "Home", persons: ["x"] }),
    };
    const scenario = {
      date: "2026-10-25",
      weather: "sunny" as const,
      low: 5,
      high: 15,
      people: [
        { id: "person.alex", home: true, leaves: 510, back: 1080 },
        { id: "person.sam", home: true, leaves: 510 },
        { id: "person.kim", home: false, back: 600 },
      ],
      calls: [],
    };
    const { states, happenings } = prepare(copy, scenario, ZONE, { upAtStart: false }, day);
    expect(states["zone.home"]?.state).toBe("2");
    expect(states["zone.home"]?.attributes.persons).toEqual(["person.alex", "person.sam"]);
    const counts = happenings
      .filter((h) => h.entity === "zone.home")
      .map((h) => [clockOf(h.at, ZONE), h.state, h.attributes?.persons]);
    // Both go out at half past eight at once: nobody is left, then Kim comes, then Alex.
    expect(counts).toEqual([
      ["08:30", "0", []],
      ["10:00", "1", ["person.kim"]],
      ["18:00", "2", ["person.alex", "person.kim"]],
    ]);
    // After the people's own changes of that minute.
    const at830 = happenings.filter((h) => clockOf(h.at, ZONE) === "08:30").map((h) => h.entity);
    expect(at830.indexOf("zone.home")).toBeGreaterThan(at830.indexOf("person.sam"));
  });

  it("goes by the wall clock for people and by the hour gone for the weather", () => {
    expect(clockOf(clockOn(day, ZONE, 8 * 60 + 30), ZONE)).toBe("08:30");
    const copy: Record<string, HassEntity> = {
      "person.alex": entity("person.alex", "home"),
      "weather.home": entity("weather.home", "sunny", { temperature: 12 }),
    };
    const scenario = {
      date: "2026-10-25",
      weather: "sunny" as const,
      low: 5,
      high: 15,
      people: [{ id: "person.alex", home: true, leaves: 510, back: 1080 }],
      calls: [],
    };
    const { happenings } = prepare(copy, scenario, ZONE, { upAtStart: false }, day);
    expect(
      happenings.filter((h) => h.entity === "person.alex").map((h) => clockOf(h.at, ZONE)),
    ).toEqual(["08:30", "18:00"]);
    // Each of its 25 hours but midnight has the weather of its hour.
    expect(happenings.filter((h) => h.entity === "weather.home")).toHaveLength(24);
  });

  it("opens at seven, and carries what was done by hand to another day at its time", () => {
    const copy: HomeCopy = {
      states: { "light.hall": entity("light.hall", "off") },
      entities: {},
      devices: {},
      areas: {},
      floors: {},
      store: {
        revision: 1,
        storeys: [],
        people: { revision: 1, shown: "everyone", look: "figure", hidden: [], people: {} },
      } as unknown as HomeCopy["store"],
      automations: [],
      scripts: [],
      scenes: [],
      registry: {},
      zone: ZONE,
    };
    const home = new SandboxHome(copy, { language: "en" }, day + 12 * 3_600_000);
    expect(clockOf(home.cursor, ZONE)).toBe("07:00");
    home.seek(clockOn(day, ZONE, 10 * 60));
    home.byHand({
      at: home.cursor,
      domain: "light",
      service: "turn_on",
      target: { entity_id: "light.hall" },
    });
    home.setScenario({ ...home.scenario, date: "2026-10-26" });
    expect(home.scenario.calls.map((c) => [zoned(c.at, ZONE).day, clockOf(c.at, ZONE)])).toEqual([
      [26, "10:00"],
    ]);
    expect(clockOf(home.cursor, ZONE)).toBe("10:00");
    expect(home.hass.states["light.hall"]?.state).toBe("on");
    home.stop();
  });
});
