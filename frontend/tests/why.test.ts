import { describe, expect, it, vi } from "vitest";

import { stepWords } from "../src/components/why-text";
import { DemoHome } from "../src/demo/home";
import { at } from "../src/demo/day";
import { DemoLogbook, type Recorded } from "../src/demo/logbook";
import type { HassContext, HassEntity, HassMessage, HomeAssistant } from "../src/ha/types";
import { Translator, en, fr } from "../src/i18n";
import { whyEn, whyFr } from "../src/i18n/why";
import {
  activityPath,
  chainEntities,
  explain,
  explainable,
  hopsOf,
  logbookReader,
  readEntry,
  readSource,
  traceLinks,
  userNames,
  type WhyChain,
  type WhyStep,
} from "../src/live/why";

/** An evening of a fictional home (seconds). */
const T = Date.parse("2026-03-01T19:00:00Z") / 1000;
const iso = (seconds: number): string => new Date(seconds * 1000).toISOString();

/** A context id as Home Assistant writes them (a ULID), the same for the same name. */
const ULIDS = new Map<string, string>();
function u(name: string): string {
  let id = ULIDS.get(name);
  if (!id) {
    id = `01K8C0${String(ULIDS.size + 1).padStart(20, "0")}`;
    ULIDS.set(name, id);
  }
  return id;
}

function ctx(id: string, parent?: string, user?: string): HassContext {
  return { id: u(id), parent_id: parent ? u(parent) : null, user_id: user ?? null };
}

function state(
  id: string,
  value: string,
  when: number,
  context?: HassContext,
  attributes: Record<string, unknown> = {},
  updated = when,
): HassEntity {
  return {
    entity_id: id,
    state: value,
    attributes,
    last_changed: iso(when),
    last_updated: iso(updated),
    ...(context ? { context } : {}),
  };
}

/** A home whose Home Assistant answers the logbook from `book`, as Home Assistant's does. */
function home(
  book: DemoLogbook,
  states: HassEntity[],
  extra: Partial<HomeAssistant> = {},
  answer: (message: HassMessage) => unknown = () => {
    throw new Error("unknown_command");
  },
): { hass: HomeAssistant; sent: HassMessage[] } {
  const sent: HassMessage[] = [];
  const hass: HomeAssistant = {
    states: Object.fromEntries(states.map((s) => [s.entity_id, s])),
    language: "en",
    user: { id: "user-viewer", name: "Viewer", is_admin: false },
    config: { components: ["logbook", "automation"] },
    connection: {
      sendMessagePromise: <T>(message: HassMessage): Promise<T> => {
        sent.push(message);
        if (message.type === "logbook/get_events") {
          const time = (v: unknown): number | undefined =>
            typeof v === "string" ? Date.parse(v) : undefined;
          return Promise.resolve(
            book.events({
              start: time(message.start_time) ?? 0,
              ...(message.end_time ? { end: time(message.end_time) } : {}),
              ...(message.entity_ids ? { entities: message.entity_ids as string[] } : {}),
              ...(message.context_id ? { context: message.context_id as string } : {}),
            }) as T,
          );
        }
        try {
          return Promise.resolve(answer(message) as T);
        } catch (error) {
          return Promise.reject(error instanceof Error ? error : new Error("failed"));
        }
      },
      sendMessage: vi.fn(),
      subscribeMessage: vi.fn(),
    },
    callService: vi.fn(),
    ...extra,
  };
  return { hass, sent };
}

function book(rows: Recorded[]): DemoLogbook {
  const kept = new DemoLogbook();
  for (const row of rows) kept.record(row);
  return kept;
}

/** The hall's motion sensor, then the automation it sets off, then the hall's lamp it lights. */
function motionEvening(): { rows: Recorded[]; states: HassEntity[] } {
  const motion = ctx("m1");
  const run = ctx("r1", "m1");
  return {
    rows: [
      { when: T, context: motion, entity: "binary_sensor.hall_motion", state: "on" },
      {
        when: T + 0.01,
        context: run,
        event: "automation_triggered",
        entity: "automation.hall_light",
        name: "Hall light on motion",
        source: "state of binary_sensor.hall_motion",
      },
      { when: T + 0.02, context: run, entity: "light.hall", state: "on" },
    ],
    states: [
      state("binary_sensor.hall_motion", "on", T, motion, { friendly_name: "Hall motion" }),
      state("light.hall", "on", T + 0.02, run, { friendly_name: "Hall lamp" }),
      state("automation.hall_light", "on", T - 3600, run, {
        friendly_name: "Hall light on motion",
        id: "1700000000001",
        last_triggered: iso(T + 0.01),
      }),
    ],
  };
}

const kinds = (chain: WhyChain): string[] => chain.steps.map((s) => s.kind);

describe("what Home Assistant's words for a trigger say", () => {
  it("reads the state triggers, times, the sun, starts and events of both versions", () => {
    expect(readSource("state of binary_sensor.hall_motion")).toEqual({
      kind: "state",
      entity: "binary_sensor.hall_motion",
    });
    expect(readSource("numeric state of sensor.bathroom_humidity")).toEqual({
      kind: "state",
      entity: "sensor.bathroom_humidity",
    });
    expect(readSource("time")).toEqual({ kind: "time" });
    expect(readSource("time pattern")).toEqual({ kind: "time" });
    expect(readSource("time set in input_datetime.wake_up")).toEqual({ kind: "time" });
    expect(readSource("sunset with offset")).toEqual({ kind: "sun", text: "sunset" });
    expect(readSource("sunrise")).toEqual({ kind: "sun", text: "sunrise" });
    expect(readSource("sun event sunset")).toEqual({ kind: "sun", text: "sunset" });
    expect(readSource("sun event golden_hour_started")).toEqual({
      kind: "sun",
      text: "golden_hour_started",
    });
    expect(readSource("Home Assistant starting")).toEqual({ kind: "start", text: "starting" });
    expect(readSource("Home Assistant stopping")).toEqual({ kind: "start", text: "stopping" });
    expect(readSource("event 'doorbell_pressed'")).toEqual({
      kind: "event",
      text: "doorbell_pressed",
    });
    expect(readSource("mqtt topic hall/button")).toEqual({
      kind: "other",
      text: "mqtt topic hall/button",
    });
    // Not an entity id after the words: told as Home Assistant words it.
    expect(readSource("state of a template")).toEqual({
      kind: "other",
      text: "state of a template",
    });
    expect(readSource(undefined)).toEqual({ kind: "other" });
  });

  it("reads a row of the logbook leniently", () => {
    expect(readEntry({ when: 12.5, state: "on", entity_id: "light.hall", icon: 3 })).toEqual({
      when: 12.5,
      state: "on",
      entity_id: "light.hall",
    });
    expect(readEntry({ when: "12" })).toBeUndefined();
    expect(readEntry(null)).toBeUndefined();
    expect(readEntry({ when: Infinity })).toBeUndefined();
  });
});

describe("why a device is as it is", () => {
  it("follows a lamp back to the automation and the motion that set it off", async () => {
    const { rows, states } = motionEvening();
    const { hass, sent } = home(book(rows), states);
    const chain = await explain(hass, "light.hall");
    expect(kinds(chain)).toEqual(["change", "automation", "change"]);
    expect(chain.steps[0]).toMatchObject({
      entity: "binary_sensor.hall_motion",
      state: "on",
      when: T * 1000,
    });
    expect(chain.steps[1]).toMatchObject({ entity: "automation.hall_light", context: u("r1") });
    expect(chain.steps[2]).toMatchObject({ entity: "light.hall", state: "on" });
    expect(chain.unread).toBeUndefined();
    // The lamp's context, then the motion's: two questions, both by context.
    expect(sent.map((m) => m.context_id)).toEqual([u("r1"), u("m1")]);
  });

  it("finds the run by its automation when the state was written again since", async () => {
    const { rows, states } = motionEvening();
    // The lamp's brightness changed since: its context is no longer the change's.
    const lamp = state("light.hall", "on", T + 0.02, ctx("later"), {}, T + 40);
    const { hass, sent } = home(book(rows), [
      ...states.filter((s) => s.entity_id !== "light.hall"),
      lamp,
    ]);
    const chain = await explain(hass, "light.hall");
    expect(kinds(chain)).toEqual(["change", "automation", "change"]);
    expect(chain.steps[0]?.entity).toBe("binary_sensor.hall_motion");
    expect(sent.some((m) => JSON.stringify(m.entity_ids) === '["automation.hall_light"]')).toBe(
      true,
    );
  });

  it("names the person who switched a lamp on, and the action", async () => {
    const asked = ctx("u1", undefined, "user-alex");
    const { hass } = home(
      book([
        { when: T, context: asked, event: "call_service", domain: "light", service: "turn_on" },
        { when: T + 0.01, context: asked, entity: "light.hall", state: "on" },
      ]),
      [state("light.hall", "on", T + 0.01, asked)],
    );
    const chain = await explain(hass, "light.hall");
    expect(chain.steps).toEqual([
      { kind: "person", user: "user-alex", service: "light.turn_on" },
      { kind: "change", entity: "light.hall", state: "on", when: (T + 0.01) * 1000 },
    ]);
  });

  it("says an action called with nobody signed in, and a script someone ran", async () => {
    const voice = ctx("v1");
    const movie = ctx("s1", undefined, "user-robin");
    const { hass } = home(
      book([
        { when: T, context: voice, event: "call_service", domain: "light", service: "turn_off" },
        { when: T + 0.01, context: voice, entity: "light.hall", state: "off" },
        { when: T + 5, context: movie, event: "call_service", domain: "script", service: "movie" },
        {
          when: T + 5.01,
          context: movie,
          event: "script_started",
          entity: "script.movie",
          name: "Movie night",
        },
        { when: T + 5.02, context: movie, entity: "cover.living", state: "closed" },
      ]),
      [
        state("light.hall", "off", T + 0.01, voice),
        state("cover.living", "closed", T + 5.02, movie),
      ],
    );
    expect((await explain(hass, "light.hall")).steps[0]).toEqual({
      kind: "action",
      service: "light.turn_off",
    });
    const movieChain = await explain(hass, "cover.living");
    expect(kinds(movieChain)).toEqual(["person", "script", "change"]);
    expect(movieChain.steps[0]).toEqual({ kind: "person", user: "user-robin" });
    expect(movieChain.steps[1]).toMatchObject({ entity: "script.movie", context: u("s1") });
  });

  it("names the guest pass whose guests switched a lamp on (D-067)", async () => {
    const pass = ctx("g1");
    // The logbook's rows of the lamp, the guest's action first in its context, as described by
    // the integration's logbook platform.
    const rows = [
      {
        when: T + 0.01,
        entity_id: "light.hall",
        state: "on",
        context_event_type: "domotwin_guest_action",
        context_domain: "domotwin",
        context_name: "Sam and Lee",
        context_message: "asked homeassistant.turn_on through a guest pass",
        context_entity_id: "light.hall",
      },
    ];
    const { hass } = home({ events: () => rows } as unknown as DemoLogbook, [
      state("light.hall", "on", T + 0.01, pass),
    ]);
    expect((await explain(hass, "light.hall")).steps).toEqual([
      { kind: "guest", text: "Sam and Lee" },
      expect.objectContaining({ kind: "change", entity: "light.hall", state: "on" }),
    ]);
  });

  it("says a change nobody asked for began on the device, or is not in the logbook", async () => {
    const own = ctx("d1");
    const { hass } = home(book([{ when: T, context: own, entity: "light.hall", state: "on" }]), [
      state("light.hall", "on", T, own),
      state("light.porch", "on", T, ctx("not-recorded")),
      state("light.desk", "on", T, ctx("child", "gone")),
    ]);
    expect(kinds(await explain(hass, "light.hall"))).toEqual(["unattributed", "change"]);
    expect(kinds(await explain(hass, "light.porch"))).toEqual(["lost", "change"]);
    // Set off by something the logbook does not have (any more).
    expect(kinds(await explain(hass, "light.desk"))).toEqual(["lost", "change"]);
    expect((await explain(hass, "light.nowhere")).steps).toEqual([]);
  });

  it("follows two automations back to the time that started the first", async () => {
    const morning = ctx("a1", "clock");
    const guests = ctx("b1", "a1");
    const { hass } = home(
      book([
        {
          when: T,
          context: morning,
          event: "automation_triggered",
          entity: "automation.guest_mode",
          name: "Guest mode at seven",
          source: "time",
        },
        { when: T + 0.01, context: morning, entity: "input_boolean.guests", state: "on" },
        {
          when: T + 0.02,
          context: guests,
          event: "automation_triggered",
          entity: "automation.guest_lights",
          name: "Guest lights",
          source: "state of input_boolean.guests",
        },
        { when: T + 0.03, context: guests, entity: "light.guest", state: "on" },
      ]),
      [
        state("input_boolean.guests", "on", T + 0.01, morning),
        state("light.guest", "on", T + 0.03, guests),
      ],
    );
    const chain = await explain(hass, "light.guest");
    expect(kinds(chain)).toEqual(["time", "automation", "change", "automation", "change"]);
    expect(chain.steps.map((s) => s.entity)).toEqual([
      undefined,
      "automation.guest_mode",
      "input_boolean.guests",
      "automation.guest_lights",
      "light.guest",
    ]);
  });

  it("names the person who ran an automation by hand (Home Assistant 2026)", async () => {
    const asked = ctx("u1", undefined, "user-alex");
    const run = ctx("r1", "u1");
    const { hass } = home(
      book([
        {
          when: T,
          context: asked,
          event: "call_service",
          domain: "automation",
          service: "trigger",
        },
        {
          when: T + 0.01,
          context: run,
          event: "automation_triggered",
          entity: "automation.night",
          name: "Night",
        },
        { when: T + 0.02, context: run, entity: "light.hall", state: "off" },
      ]),
      // Written again since: found through the logbook's rows, which carry the parent's user.
      [state("light.hall", "off", T + 0.02, ctx("later"), {}, T + 90)],
    );
    const chain = await explain(hass, "light.hall");
    expect(kinds(chain)).toEqual(["person", "automation", "change"]);
    expect(chain.steps[0]).toEqual({ kind: "person", user: "user-alex" });
  });

  it("tells the time, the sun and a trigger it does not know as they are", async () => {
    const make = (source: string): Recorded[] => [
      {
        when: T,
        context: ctx("r", "x"),
        event: "automation_triggered",
        entity: "automation.a",
        name: "A",
        source,
      },
      { when: T + 0.01, context: ctx("r", "x"), entity: "light.a", state: "on" },
    ];
    const lamp = [state("light.a", "on", T + 0.01, ctx("r", "x"))];
    const first = async (source: string) =>
      (await explain(home(book(make(source)), lamp).hass, "light.a")).steps[0];
    expect(await first("sun event sunset")).toEqual({ kind: "sun", text: "sunset" });
    expect(await first("Home Assistant starting")).toEqual({ kind: "start", text: "starting" });
    expect(await first("event 'doorbell'")).toEqual({ kind: "event", text: "doorbell" });
    expect(await first("mqtt topic hall/button")).toEqual({
      kind: "trigger",
      text: "mqtt topic hall/button",
    });
    // A sensor the logbook leaves out: named, not followed.
    expect(await first("numeric state of sensor.solar_power")).toEqual({
      kind: "change",
      entity: "sensor.solar_power",
    });
  });

  it("leaves out what ran after the change, though in the same context", async () => {
    const { rows, states } = motionEvening();
    rows.push({
      when: T + 5,
      context: ctx("r1", "m1"),
      event: "script_started",
      entity: "script.notify",
      name: "Notify",
    });
    const chain = await explain(home(book(rows), states).hass, "light.hall");
    expect(chain.steps.map((s) => s.entity)).toEqual([
      "binary_sensor.hall_motion",
      "automation.hall_light",
      "light.hall",
    ]);
  });

  it("names who ran an automation by hand, the lamp still the run's (Home Assistant 2026)", async () => {
    const asked = ctx("u1", undefined, "user-alex");
    const run = ctx("r1", "u1");
    const { hass } = home(
      book([
        {
          when: T,
          context: asked,
          event: "call_service",
          domain: "automation",
          service: "trigger",
        },
        {
          when: T + 0.01,
          context: run,
          event: "automation_triggered",
          entity: "automation.night",
          name: "Night",
        },
        { when: T + 0.02, context: run, entity: "light.hall", state: "off" },
      ]),
      [state("light.hall", "off", T + 0.02, run)],
    );
    const chain = await explain(hass, "light.hall");
    expect(kinds(chain)).toEqual(["person", "automation", "change"]);
    expect(chain.steps[0]).toEqual({ kind: "person", user: "user-alex" });
  });

  it("follows a change made in a context of another's doing (a thermostat's heater)", async () => {
    const asked = ctx("u1", undefined, "user-alex");
    const heater = ctx("h1", "u1");
    const { hass } = home(
      book([
        {
          when: T,
          context: asked,
          event: "call_service",
          domain: "climate",
          service: "set_temperature",
        },
        { when: T + 0.01, context: asked, entity: "climate.living", state: "heat" },
        {
          when: T + 0.02,
          context: heater,
          event: "call_service",
          domain: "switch",
          service: "turn_on",
        },
        { when: T + 0.03, context: heater, entity: "switch.heater", state: "on" },
      ]),
      [
        state("climate.living", "heat", T + 0.01, asked),
        state("switch.heater", "on", T + 0.03, heater),
      ],
    );
    const chain = await explain(hass, "switch.heater");
    expect(chain.steps).toEqual([
      { kind: "person", user: "user-alex", service: "climate.set_temperature" },
      { kind: "change", entity: "climate.living", state: "heat", when: (T + 0.01) * 1000 },
      { kind: "change", entity: "switch.heater", state: "on", when: (T + 0.03) * 1000 },
    ]);
  });

  it("follows an automation another one ran back to what set the first off", async () => {
    const first = ctx("a1", "clock");
    const second = ctx("b1", "a1");
    const { hass } = home(
      book([
        {
          when: T,
          context: first,
          event: "automation_triggered",
          entity: "automation.morning",
          name: "Morning",
          source: "time",
        },
        {
          when: T + 0.01,
          context: second,
          event: "automation_triggered",
          entity: "automation.lights",
          name: "Lights",
        },
        { when: T + 0.02, context: second, entity: "light.hall", state: "on" },
      ]),
      [state("light.hall", "on", T + 0.02, second)],
    );
    const chain = await explain(hass, "light.hall");
    expect(kinds(chain)).toEqual(["time", "automation", "automation", "change"]);
    expect(chain.steps.map((s) => s.entity)).toEqual([
      undefined,
      "automation.morning",
      "automation.lights",
      "light.hall",
    ]);
  });

  it("stops after six changes", async () => {
    const rows: Recorded[] = [];
    const states: HassEntity[] = [];
    let parent = "start";
    for (let k = 0; k < 8; k += 1) {
      const run = ctx(`r${String(k)}`, parent);
      const entity = k === 7 ? "light.end" : `input_boolean.step_${String(k)}`;
      rows.push(
        {
          when: T + k,
          context: run,
          event: "automation_triggered",
          entity: `automation.step_${String(k)}`,
          name: `Step ${String(k)}`,
          source: k === 0 ? "time" : `state of input_boolean.step_${String(k - 1)}`,
        },
        { when: T + k + 0.01, context: run, entity, state: "on" },
      );
      states.push(state(entity, "on", T + k + 0.01, run));
      parent = run.id;
    }
    const chain = await explain(home(book(rows), states).hass, "light.end");
    expect(chain.cut).toBe(true);
    // Six followed, the device's included; the one before them named, not followed.
    const changes = chain.steps.filter((s) => s.kind === "change");
    expect(changes).toHaveLength(7);
    expect(chain.steps[0]).toEqual({ kind: "change", entity: "input_boolean.step_1" });
    expect(chain.steps.at(-1)?.entity).toBe("light.end");
  });

  it("says what the state alone says without the logbook", async () => {
    const asked = ctx("u1", undefined, "user-alex");
    const lamp = state("light.hall", "on", T, asked);
    const failing = home(new DemoLogbook(), [lamp]);
    const chain = await explain(failing.hass, "light.hall", () => Promise.reject(new Error("x")));
    expect(chain.unread).toBe(true);
    expect(kinds(chain)).toEqual(["person", "change"]);
    const without = home(new DemoLogbook(), [state("light.hall", "on", T, ctx("d"))], {
      config: { components: ["automation"] },
    });
    const alone = await explain(without.hass, "light.hall");
    expect(alone).toEqual({
      steps: [{ kind: "change", entity: "light.hall", state: "on", when: T * 1000 }],
      unread: true,
    });
    expect(without.sent).toEqual([]);
  });

  it("asks the logbook as Home Assistant's frontend does", async () => {
    const send = vi.fn(() => Promise.resolve([{ when: 1 }, { nope: true }]));
    const read = logbookReader({
      connection: { sendMessagePromise: send },
    } as unknown as HomeAssistant);
    expect(await read({ start: 0, end: 1000, entities: ["light.a"] })).toEqual([{ when: 1 }]);
    expect(send).toHaveBeenCalledWith({
      type: "logbook/get_events",
      start_time: "1970-01-01T00:00:00.000Z",
      end_time: "1970-01-01T00:00:01.000Z",
      entity_ids: ["light.a"],
    });
    await read({ start: 0, context: u("c1") });
    expect(send).toHaveBeenLastCalledWith({
      type: "logbook/get_events",
      start_time: "1970-01-01T00:00:00.000Z",
      context_id: u("c1"),
    });
    // Not an id Home Assistant writes: it would read it as none, and answer every row.
    send.mockClear();
    expect(await read({ start: 0, context: "c1" })).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("what a chain links to", () => {
  it("links the runs to their traces, for administrators only and never in the demo", async () => {
    const contexts = {
      r1: { run_id: "abc", domain: "automation", item_id: "1700000000001" },
      s1: { run_id: "def", domain: "script", item_id: "movie" },
      x: { run_id: "1", domain: "other", item_id: "1" },
      y: null,
    };
    const answer = (message: HassMessage): unknown => {
      expect(message).toEqual({ type: "trace/contexts" });
      return contexts;
    };
    const admin = home(
      new DemoLogbook(),
      [],
      {
        user: { id: "u", name: "Admin", is_admin: true },
      },
      answer,
    );
    expect([...(await traceLinks(admin.hass))]).toEqual([
      ["r1", "/config/automation/trace/1700000000001?run_id=abc"],
      ["s1", "/config/script/trace/movie?run_id=def"],
    ]);
    const user = home(new DemoLogbook(), [], {}, answer);
    expect((await traceLinks(user.hass)).size).toBe(0);
    expect(user.sent).toEqual([]);
    const demo = home(
      new DemoLogbook(),
      [],
      {
        user: { id: "u", name: "Admin", is_admin: true },
        demo: true,
      },
      answer,
    );
    expect((await traceLinks(demo.hass)).size).toBe(0);
    const refused = home(new DemoLogbook(), [], {
      user: { id: "u", name: "Admin", is_admin: true },
    });
    expect((await traceLinks(refused.hass)).size).toBe(0);
  });

  it("opens Home Assistant's Activity on the chain's entities, around it", () => {
    const chain: WhyChain = {
      steps: [
        { kind: "change", entity: "binary_sensor.hall_motion", state: "on", when: 1_000_000 },
        { kind: "automation", entity: "automation.hall_light", when: 1_000_010, context: "r1" },
        { kind: "change", entity: "light.hall", state: "on", when: 1_000_020 },
      ],
    };
    expect(chainEntities(chain)).toEqual([
      "binary_sensor.hall_motion",
      "automation.hall_light",
      "light.hall",
    ]);
    const path = activityPath(chain) ?? "";
    expect(path.startsWith("/logbook?")).toBe(true);
    const query = new URLSearchParams(path.slice(path.indexOf("?") + 1));
    expect(query.get("entity_id")?.split(",")).toEqual(chainEntities(chain));
    expect(query.get("start_date")).toBe(new Date(1_000_000 - 60_000).toISOString());
    expect(query.get("end_date")).toBe(new Date(1_000_020 + 60_000).toISOString());
    expect(activityPath({ steps: [{ kind: "time" }] })).toBeUndefined();
  });

  it("names users from the people, the viewer, and Home Assistant's users for an admin", async () => {
    const people = [
      state("person.alex", "home", T, undefined, { friendly_name: "Alex", user_id: "user-alex" }),
      state("person.cat", "home", T, undefined, { friendly_name: "Cat" }),
    ];
    const plain = home(new DemoLogbook(), people);
    expect([...(await userNames(plain.hass, ["user-alex", "user-sam"]))]).toEqual([
      ["user-alex", "Alex"],
      ["user-viewer", "Viewer"],
    ]);
    expect(plain.sent).toEqual([]);
    const admin = home(
      new DemoLogbook(),
      people,
      { user: { id: "user-admin", name: "Admin", is_admin: true } },
      () => [
        { id: "user-sam", name: "Sam" },
        { id: "user-alex", name: "Alex's account" },
        { id: 3 },
      ],
    );
    const names = await userNames(admin.hass, ["user-alex", "user-sam"]);
    expect(names.get("user-sam")).toBe("Sam");
    expect(names.get("user-alex")).toBe("Alex");
    // Everyone known already: nothing asked.
    const known = home(new DemoLogbook(), people, {
      user: { id: "user-admin", name: "Admin", is_admin: true },
    });
    await userNames(known.hass, ["user-alex"]);
    expect(known.sent).toEqual([]);
  });

  it("draws a wire from each place to the next, through the runs between them", () => {
    const motion = { kind: "change" as const, entity: "binary_sensor.hall_motion" };
    const run = { kind: "automation" as const, entity: "automation.hall_light" };
    const lamp = { kind: "change" as const, entity: "light.hall" };
    expect(hopsOf({ steps: [motion, run, lamp] })).toEqual([
      { from: motion, to: lamp, through: [run] },
    ]);
    const person = { kind: "person" as const, user: "u" };
    expect(hopsOf({ steps: [person, lamp] })).toEqual([{ from: person, to: lamp, through: [] }]);
    // Nobody's doing: no wire. Something lost before a run: the run's wire starts from it.
    expect(hopsOf({ steps: [{ kind: "unattributed" }, lamp] })).toEqual([]);
    expect(hopsOf({ steps: [{ kind: "lost" }, lamp] })).toEqual([]);
    const lost = { kind: "lost" as const };
    expect(hopsOf({ steps: [lost, run, lamp] })).toEqual([
      { from: lost, to: lamp, through: [run] },
    ]);
  });
});

describe("the demo house's logbook", () => {
  it("answers why: the day, the visitor, and an automation set off by motion", async () => {
    const demo = new DemoHome({ language: "en", name: "Visitor" });
    // As it opens, and a thermostat whose temperature was written since: the demo's day.
    for (const id of ["light.living_floor_lamp", "climate.living_room", "lock.front_door"]) {
      expect((await explain(demo.hass, id)).steps[0], id).toMatchObject({
        kind: "integration",
        text: "The demo house’s day",
      });
    }
    // Gone to the evening: the house as the demo's day sets it.
    demo.jump(at(20, 0));
    const evening = await explain(demo.hass, "light.living_floor_lamp");
    expect(evening.steps[0]).toMatchObject({
      kind: "integration",
      text: "The demo house’s day",
      service: "domotwin",
    });
    // The visitor switches a lamp on.
    void demo.hass.callService("light", "turn_on", {}, { entity_id: "light.wc" });
    const visitor = await explain(demo.hass, "light.wc");
    expect(visitor.steps[0]).toEqual({
      kind: "person",
      user: "demo-visitor",
      service: "light.turn_on",
    });
    // The day goes on until someone comes into the hall after dark and its lamp lights.
    demo.jump(at(16, 0));
    let found: WhyChain | undefined;
    for (let minute = 0; minute < 8 * 60 && !found; minute += 1) {
      const before = demo.hass.states["automation.lights_follow_people"]?.attributes.last_triggered;
      demo.advance(1);
      const after = demo.hass.states["automation.lights_follow_people"]?.attributes.last_triggered;
      if (after === before) continue;
      for (const lamp of ["light.hall_spots", "light.landing", "light.living_pendant"]) {
        const lit = demo.hass.states[lamp];
        if (lit?.state === "on" && lit.last_changed === after) {
          found = await explain(demo.hass, lamp);
          break;
        }
      }
    }
    expect(found).toBeDefined();
    const steps = found?.steps ?? [];
    expect(steps.map((s) => s.kind)).toEqual(["change", "automation", "change"]);
    expect(steps[0]?.entity).toMatch(/^binary_sensor\..*_motion$/);
    expect(steps[0]?.state).toBe("on");
    expect(steps[1]?.entity).toBe("automation.lights_follow_people");
    demo.stop();
  });

  it("leaves the measuring sensors out, and is put back with the house", () => {
    const demo = new DemoHome({ language: "fr" });
    const kept = demo.snapshot();
    demo.advance(5);
    const rows = demo.recorded.events({ start: 0 });
    expect(rows.some((r) => r.entity_id === "sensor.solar_power")).toBe(false);
    const before = demo.recorded.events({ start: 0, entities: ["light.wc"] });
    // As it starts, set by the demo's day.
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ state: "off", context_event_type: "demo_day" });
    void demo.hass.callService("light", "turn_on", {}, { entity_id: "light.wc" });
    expect(demo.recorded.events({ start: 0, entities: ["light.wc"] })).toHaveLength(2);
    demo.restore(kept);
    expect(demo.recorded.events({ start: 0, entities: ["light.wc"] })).toEqual(before);
    demo.stop();
  });
});

describe("the words of a chain", () => {
  const people = new Map([["user-alex", "Alex"]]);
  const lamp = state("light.hall", "on", T, undefined, { friendly_name: "Hall lamp" });
  const hass = home(new DemoLogbook(), [
    lamp,
    state("binary_sensor.bedroom_motion", "on", T, undefined, { friendly_name: "Bedroom motion" }),
    state("automation.night", "on", T, undefined, { friendly_name: "Night" }),
  ]).hass;

  it("says each step in both languages", () => {
    const en = new Translator("en");
    const fr = new Translator("fr");
    const words = (t: Translator, step: WhyStep) => stepWords(t, hass, step, people);
    expect(words(en, { kind: "person", user: "user-alex", service: "light.turn_on" })).toEqual({
      main: "Alex",
      detail: "Asked in Home Assistant: light.turn_on",
    });
    expect(words(fr, { kind: "person", user: "user-sam" })).toEqual({
      main: "Un utilisateur de Home Assistant",
      detail: "Demandé dans Home Assistant",
    });
    expect(words(en, { kind: "change", entity: "light.hall", state: "on" }).main).toBe(
      "Hall lamp: on",
    );
    expect(words(fr, { kind: "change", entity: "light.hall", state: "on" }).main).toBe(
      "Hall lamp : on",
    );
    expect(words(en, { kind: "automation", entity: "automation.night" })).toEqual({
      main: "Night",
      detail: "Automation that ran",
    });
    expect(words(fr, { kind: "sun", text: "sunset" }).main).toBe("Coucher du soleil");
    expect(words(en, { kind: "sun", text: "golden_hour_started" }).main).toBe(
      "The sun: golden_hour_started",
    );
    expect(words(en, { kind: "start", text: "stopping" }).main).toBe("Home Assistant stopping");
    expect(words(en, { kind: "event", text: "doorbell" }).main).toBe("Event doorbell");
    expect(words(fr, { kind: "integration", text: "Day", service: "domotwin" }).detail).toBe(
      "Dit par l’intégration domotwin",
    );
    expect(words(en, { kind: "guest", text: "Sam and Lee" })).toEqual({
      main: "Sam and Lee, with a guest pass",
      detail: "Through a guest pass of DomoTwin's",
    });
    expect(words(fr, { kind: "guest", text: "Sam" }).main).toBe("Sam, avec un pass d’invité");
    expect(words(en, { kind: "unattributed" }).main).toBe("Nobody, as far as Home Assistant knows");
    expect(words(fr, { kind: "lost" }).main).toBe("Absent du journal");
  });

  it("keeps what a private room holds unnamed (D-039)", () => {
    const en = new Translator("en");
    const unseen = (entity: string): boolean => entity === "binary_sensor.bedroom_motion";
    const motion: WhyStep = { kind: "change", entity: "binary_sensor.bedroom_motion", state: "on" };
    expect(stepWords(en, hass, motion, people, unseen).main).toBe("In a private room");
    const chain: WhyChain = {
      steps: [
        { ...motion, when: 1_000 },
        { kind: "automation", entity: "automation.night", when: 1_000 },
        { kind: "change", entity: "light.hall", state: "on", when: 1_000 },
      ],
    };
    const path = activityPath(chain, unseen) ?? "";
    expect(new URLSearchParams(path.split("?")[1]).get("entity_id")).toBe(
      "automation.night,light.hall",
    );
  });

  it("has the same messages in both languages, none of them the dictionaries'", () => {
    const keys = (node: unknown, prefix = ""): string[] =>
      typeof node === "object" && node !== null
        ? Object.entries(node).flatMap(([k, v]) => keys(v, `${prefix}${k}.`))
        : [prefix.slice(0, -1)];
    expect(keys(whyFr).sort()).toEqual(keys(whyEn).sort());
    const main = new Set([...keys(en), ...keys(fr)]);
    expect(keys(whyEn).filter((key) => main.has(key))).toEqual([]);
    const lookup = (dict: unknown, key: string): unknown =>
      key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], dict);
    const placeholders = (text: unknown): string[] =>
      typeof text === "string"
        ? [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? "").sort()
        : [];
    for (const key of keys(whyEn)) {
      expect(placeholders(lookup(whyFr, key)), key).toEqual(placeholders(lookup(whyEn, key)));
    }
  });

  it("is asked only of what the logbook keeps", () => {
    const sensors = home(new DemoLogbook(), [
      state("sensor.power", "12", T, undefined, { unit_of_measurement: "W" }),
      state("sensor.total", "12", T, undefined, { state_class: "total" }),
      state("sensor.room", "Kitchen", T),
    ]).hass;
    expect(explainable(sensors, "sensor.power")).toBe(false);
    expect(explainable(sensors, "sensor.total")).toBe(false);
    expect(explainable(sensors, "counter.visits")).toBe(false);
    expect(explainable(sensors, "sensor.room")).toBe(true);
    const classes = home(new DemoLogbook(), [
      state("sensor.outside", "12", T, undefined, { device_class: "temperature" }),
      state("sensor.mode", "eco", T, undefined, { device_class: "enum" }),
    ]).hass;
    expect(explainable(classes, "sensor.outside")).toBe(false);
    expect(explainable(classes, "sensor.mode")).toBe(true);
    // No logbook (a home without it, the sandbox's copy): nothing to ask.
    const without = home(new DemoLogbook(), [], { config: { components: ["domotwin"] } }).hass;
    expect(explainable(without, "light.hall")).toBe(false);
    expect(explainable(sensors, "light.hall")).toBe(true);
  });
});

describe("the chain drawn in the home", () => {
  it("hands the engine a wire per step, none to what a private room holds (D-039)", async () => {
    await import("../src/components/why-wires");
    const drawn: string[] = [];
    const pulses: string[] = [];
    const engine = {
      setAutomations: (json: string) => {
        drawn.push(json);
        return "[]";
      },
      automationPoints: () => "[]",
      pickAutomation: vi.fn(),
      pulseAutomation: (id: string) => {
        pulses.push(id);
        return true;
      },
      automationAt: () => "",
    };
    const { rows, states } = motionEvening();
    const { hass } = home(book(rows), states);
    const chain = await explain(hass, "light.hall");
    const element = document.createElement("domotwin-why") as HTMLElement & {
      hass?: HomeAssistant;
      engine?: unknown;
      bindings?: unknown;
      names?: unknown;
      ask?: unknown;
      updateComplete: Promise<boolean>;
    };
    element.hass = hass;
    element.engine = engine;
    element.bindings = {
      version: 1,
      rooms: {},
      elements: {
        motion: { entities: [{ entity_id: "binary_sensor.hall_motion" }] },
        lamp: { entities: [{ entity_id: "light.hall" }] },
      },
    };
    element.names = {
      motion: { name: "Motion", type: "sensor" },
      lamp: { name: "Lamp", type: "lamp" },
    };
    element.ask = { entity: "light.hall", chain, users: new Map() };
    document.body.append(element);
    await element.updateComplete;
    const wires = (json: string | undefined) =>
      (JSON.parse(json ?? "{}") as { automations: { id: string; ends: unknown[] }[] }).automations;
    expect(wires(drawn.at(-1))).toEqual([
      {
        id: "why:0",
        color: expect.any(Array) as unknown,
        ends: [
          { role: "trigger", piece: "motion" },
          { role: "action", piece: "lamp" },
        ],
      },
    ]);
    expect(pulses).toEqual(["why:0"]);
    // The motion sensor in a private room the viewer may not see: the lamp alone.
    element.ask = {
      entity: "light.hall",
      chain,
      users: new Map(),
      unseen: (entity: string) => entity === "binary_sensor.hall_motion",
    };
    await element.updateComplete;
    expect(wires(drawn.at(-1))[0]?.ends).toEqual([{ role: "action", piece: "lamp" }]);
    element.remove();
    expect(drawn.at(-1)).toBe("{}");
  });
});
