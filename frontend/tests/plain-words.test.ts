import { describe, expect, it, vi } from "vitest";

import type { HassEntity, HomeAssistant } from "../src/ha/types";
import { Translator, addMessages } from "../src/i18n";
import { plainEn, plainFr } from "../src/i18n/plain";
import { aiTasks, plainWordsOffered } from "../src/live/ai-task";
import {
  STRUCTURE,
  askAiTask,
  checkWithHomeAssistant,
  draftEntityId,
  editorOf,
  hasUnknown,
  instructionsFor,
  normalized,
  preferredAiTask,
  readAnswer,
  saveAutomation,
  savedConfig,
  taskHome,
  unknownNames,
} from "../src/live/plain-request";
import { automationWords, wordsText, type WordsLine } from "../src/live/plain-words";

addMessages({ en: plainEn, fr: plainFr });

const NONE = { areas: new Set<string>(), entities: new Set<string>() };

function entity(id: string, state: string, attributes: Record<string, unknown> = {}): HassEntity {
  return {
    entity_id: id,
    state,
    attributes,
    last_changed: "2026-10-27T08:00:00+00:00",
    last_updated: "2026-10-27T08:00:00+00:00",
  };
}

/** A fictional flat: two areas, its lamps, a lock, its people, an AI task. */
function home(overrides: Partial<HomeAssistant> = {}): HomeAssistant {
  const states = [
    entity("light.living_lamp", "on", { friendly_name: "Living lamp" }),
    entity("light.kitchen_ceiling", "off", { friendly_name: "Kitchen ceiling" }),
    entity("lock.front_door", "locked", { friendly_name: "Front door" }),
    entity("person.alex", "home", { friendly_name: "Alex" }),
    entity("person.sam", "not_home", { friendly_name: "Sam" }),
    entity("zone.home", "1", { friendly_name: "Home" }),
    entity("binary_sensor.hall_door", "off", { friendly_name: "Hall door", device_class: "door" }),
    entity("sensor.living_temperature", "21", {
      friendly_name: "Living temperature",
      device_class: "temperature",
      unit_of_measurement: "°C",
    }),
    entity("input_select.mode", "Home", {
      friendly_name: "Mode",
      options: ["Home", "Away", "Night"],
    }),
    entity("climate.bedroom", "heat", {
      friendly_name: "Bedroom",
      hvac_modes: ["heat", "off"],
      preset_modes: ["eco", "comfort"],
    }),
    entity("sensor.router_firmware", "1.2", { friendly_name: "Router firmware" }),
    entity("light.hidden", "off", { friendly_name: "Hidden" }),
    entity("ai_task.fictional", "unknown", {
      friendly_name: "Fictional AI",
      supported_features: 1,
    }),
    entity("script.goodnight", "off", { friendly_name: "Goodnight" }),
    entity("cover.living_curtains", "closed", { friendly_name: "Living curtains" }),
    entity("notify.phone", "unknown"),
  ];
  return {
    states: Object.fromEntries(states.map((e) => [e.entity_id, e])),
    entities: {
      "light.living_lamp": { entity_id: "light.living_lamp", area_id: "living" },
      "light.kitchen_ceiling": { entity_id: "light.kitchen_ceiling", device_id: "dev_kitchen" },
      "sensor.living_temperature": { entity_id: "sensor.living_temperature", area_id: "living" },
      "cover.living_curtains": { entity_id: "cover.living_curtains", area_id: "living" },
      "sensor.router_firmware": {
        entity_id: "sensor.router_firmware",
        entity_category: "diagnostic",
      },
      "light.hidden": { entity_id: "light.hidden", hidden: true },
    },
    devices: { dev_kitchen: { id: "dev_kitchen", area_id: "kitchen", name: "Kitchen light" } },
    areas: {
      living: { area_id: "living", name: "Living room" },
      kitchen: { area_id: "kitchen", name: "Kitchen" },
    },
    floors: {},
    services: {
      light: { turn_on: {}, turn_off: {}, toggle: {} },
      lock: { lock: {}, unlock: {} },
      notify: { mobile_app_alex_phone: {}, notify: {} },
      persistent_notification: { create: {} },
      script: { goodnight: {}, turn_on: {} },
      cover: { open_cover: {}, close_cover: {} },
      climate: { set_temperature: {} },
    },
    user: { id: "u", name: "Admin", is_admin: true },
    language: "en",
    locale: { language: "en" },
    config: { components: ["ai_task", "domotwin"], time_zone: "Europe/Paris" },
    connection: {
      sendMessagePromise: () => Promise.resolve(undefined as never),
      sendMessage: () => undefined,
      subscribeMessage: () => Promise.resolve(() => Promise.resolve()),
    },
    callService: () => Promise.resolve(),
    ...overrides,
  };
}

/** Home Assistant's words for states, as its frontend gives them. */
function formatted(hass: HomeAssistant, words: Record<string, string>): HomeAssistant {
  return {
    ...hass,
    formatEntityState: (state: HassEntity, value = state.state) => words[value] ?? value,
  };
}

const texts = (lines: readonly WordsLine[]): string[] => lines.map((line) => line.text);

/** The roadmap's own example, as an AI task would write it. */
const LEAVING = {
  triggers: [{ trigger: "state", entity_id: "zone.home", to: "0", for: "00:02:00" }],
  conditions: [],
  actions: [
    {
      action: "light.turn_off",
      target: { entity_id: ["light.living_lamp", "light.kitchen_ceiling"] },
    },
    { action: "lock.lock", target: { entity_id: "lock.front_door" } },
  ],
  mode: "single",
};

describe("Home Assistant's AI tasks (D-066)", () => {
  it("offers the entities that generate data, for administrators only", () => {
    const hass = home({
      states: {
        ...home().states,
        "ai_task.images": entity("ai_task.images", "unknown", { supported_features: 4 }),
        "ai_task.gone": entity("ai_task.gone", "unavailable", { supported_features: 1 }),
      },
    });
    expect(aiTasks(hass)).toEqual(["ai_task.fictional"]);
    expect(plainWordsOffered(hass)).toBe(true);
    expect(plainWordsOffered({ ...hass, user: { id: "u", name: "U", is_admin: false } })).toBe(
      false,
    );
  });

  it("offers nothing without the integration, in the demo house or in the sandbox", () => {
    const hass = home();
    expect(aiTasks({ ...hass, config: { components: ["domotwin"] } })).toEqual([]);
    expect(aiTasks({ ...hass, demo: true })).toEqual([]);
    expect(aiTasks({ ...hass, sandbox: true })).toEqual([]);
    expect(aiTasks(undefined)).toEqual([]);
  });

  it("asks the AI task through Home Assistant's own service, its answer as data", async () => {
    const sent: Record<string, unknown>[] = [];
    const hass = home({
      connection: {
        ...home().connection,
        sendMessagePromise: <T>(message: Record<string, unknown>) => {
          sent.push(message);
          return Promise.resolve({
            context: { id: "c" },
            response: { conversation_id: "x", data: { name: "N", automation: "{}" } },
          } as T);
        },
      },
    });
    const data = await askAiTask(hass, "ai_task.fictional", "Do it");
    expect(data).toEqual({ name: "N", automation: "{}" });
    expect(sent[0]).toMatchObject({
      type: "call_service",
      domain: "ai_task",
      service: "generate_data",
      return_response: true,
      service_data: { entity_id: "ai_task.fictional", instructions: "Do it", structure: STRUCTURE },
    });
    // The structure's fields are text selectors, as `ai_task.generate_data` takes them.
    for (const field of Object.values(STRUCTURE))
      expect(Object.keys(field.selector)).toEqual(["text"]);
  });

  it("starts from the AI task Home Assistant prefers, when it is one there is", async () => {
    const answering = (answer: unknown): HomeAssistant =>
      home({
        connection: {
          ...home().connection,
          sendMessagePromise: <T>() =>
            answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer as T),
        },
      });
    const tasks = ["ai_task.a", "ai_task.b"];
    expect(await preferredAiTask(answering({ gen_data_entity_id: "ai_task.b" }), tasks)).toBe(
      "ai_task.b",
    );
    expect(await preferredAiTask(answering({ gen_data_entity_id: "ai_task.c" }), tasks)).toBe(
      undefined,
    );
    expect(await preferredAiTask(answering(new Error("unknown_command")), tasks)).toBe(undefined);
  });
});

describe("what the AI task is told of the home (D-066)", () => {
  it("names areas and entities, not their states, those in an area first", () => {
    const told = taskHome(home(), NONE);
    const lines = told.text.split("\n");
    expect(lines).toContain("living: Living room");
    expect(lines).toContain("kitchen: Kitchen");
    // The kitchen's ceiling is in the kitchen through its device.
    expect(lines).toContain("light.kitchen_ceiling: Kitchen ceiling [kitchen]");
    expect(lines).toContain(
      "sensor.living_temperature: Living temperature [living] (temperature; °C)",
    );
    expect(lines).toContain("input_select.mode: Mode (options: Home, Away, Night)");
    expect(lines).toContain("climate.bedroom: Bedroom (modes: heat, off; presets: eco, comfort)");
    const entities = lines.filter((line) => /^[a-z_]+\.[a-z_0-9]+: /.test(line));
    // In an area first (the kitchen, then the living room), then the others by id.
    expect(entities.slice(0, 4).map((line) => line.split(":")[0])).toEqual([
      "light.kitchen_ceiling",
      "cover.living_curtains",
      "light.living_lamp",
      "sensor.living_temperature",
    ]);
    // Never a state: whether someone is home, what is on.
    expect(told.text).not.toMatch(/not_home|locked|\bheat\b(?!,)/);
    expect(told.text).not.toContain("router_firmware");
    expect(told.text).not.toContain("light.hidden");
    expect(told.text).not.toContain("ai_task.fictional");
    expect(told.entities).toBe(told.total);
  });

  it("says the actions of the entities' domains, with what tells someone something", () => {
    const told = taskHome(home(), NONE);
    expect(told.text).toContain("light: toggle, turn_off, turn_on");
    expect(told.text).toContain("notify: mobile_app_alex_phone, notify");
    expect(told.text).toContain("persistent_notification: create");
    expect(taskHome(home({ services: undefined }), NONE).text).not.toContain("Actions");
  });

  it("leaves out what the viewer may not see, and keeps to the most it may name", () => {
    const unseen = { areas: new Set(["kitchen"]), entities: new Set(["lock.front_door"]) };
    const told = taskHome(home(), unseen);
    expect(told.text).not.toContain("kitchen");
    expect(told.text).not.toContain("lock.front_door");
    const few = taskHome(home(), NONE, 3);
    expect(few.entities).toBe(3);
    expect(few.total).toBeGreaterThan(3);
  });

  it("asks for the request with the rules and the home, and for a change with the draft", () => {
    const hass = home();
    const told = taskHome(hass, NONE);
    const first = instructionsFor(hass, told, "When the last person leaves, lock the door");
    expect(first).toContain('"""\nWhen the last person leaves, lock the door\n"""');
    expect(first).toContain("zone.home's state is the number of people at home");
    expect(first).toContain(told.text);
    expect(first).toContain('No "id", "alias" or "description"');
    const changed = instructionsFor(hass, told, "When the last person leaves, lock the door", {
      draft: { name: "Leaving", config: LEAVING },
      asked: "Wait five minutes",
    });
    expect(changed).toContain('"alias":"Leaving"');
    expect(changed).toContain('"""\nWait five minutes\n"""');
    expect(changed).toContain("Answer with the whole automation, changed.");
  });
});

describe("the AI task's answer read (D-066)", () => {
  it("reads the three fields, the automation as JSON", () => {
    const read = readAnswer({
      name: "Leaving home",
      automation: JSON.stringify({ id: "x", alias: "Other", description: "d", ...LEAVING }),
      notes: "  The door is the front door.  ",
    });
    expect(read).toEqual({
      draft: { name: "Leaving home", config: LEAVING, notes: "The door is the front door." },
    });
  });

  it("reads it in code fences, with words around, as an object, or wrapped once more", () => {
    const json = JSON.stringify(LEAVING);
    for (const automation of [
      `\`\`\`json\n${json}\n\`\`\``,
      `Here it is: ${json} Enjoy.`,
      LEAVING,
      [LEAVING],
      { automation: LEAVING },
    ]) {
      const read = readAnswer({ name: "N", automation });
      expect("draft" in read && read.draft.config).toEqual(LEAVING);
    }
    // An AI task that did not keep to the structure: the automation alone.
    expect("draft" in readAnswer(json) && readAnswer(json)).toBeTruthy();
    expect(readAnswer({ ...LEAVING, alias: "Alone" })).toMatchObject({ draft: { name: "Alone" } });
  });

  it("writes it as Home Assistant's editor does today, from any of its spellings", () => {
    expect(
      normalized({
        trigger: { platform: "sun", event: "sunset" },
        condition: "{{ true }}",
        action: { service: "light.turn_on", entity_id: "light.living_lamp" },
        max: 3,
        mode: "fast",
      }),
    ).toEqual({
      triggers: [{ platform: "sun", event: "sunset" }],
      conditions: [{ condition: "template", value_template: "{{ true }}" }],
      actions: [{ service: "light.turn_on", entity_id: "light.living_lamp" }],
      mode: "single",
      max: 3,
    });
  });

  it("says why an answer is not an automation", () => {
    expect(readAnswer(undefined)).toEqual({ problem: "empty" });
    expect(readAnswer({ name: "N", automation: "" })).toEqual({ problem: "empty" });
    expect(readAnswer({ name: "N", automation: "triggers: - state" })).toEqual({
      problem: "not_json",
    });
    expect(readAnswer({ name: "N", automation: { triggers: [{ trigger: "sun" }] } })).toEqual({
      problem: "not_automation",
    });
    expect(readAnswer({ name: "N", automation: "[1, 2]" })).toEqual({ problem: "not_automation" });
  });
});

describe("what Home Assistant's check leaves out: the names (D-066)", () => {
  it("finds entities, areas, devices and actions Home Assistant does not have", () => {
    const names = unknownNames(home(), {
      triggers: [
        { trigger: "state", entity_id: ["person.alex", "person.kim"] },
        { trigger: "zone", entity_id: "person.alex", zone: "zone.work" },
        { trigger: "time", at: ["07:00:00", "input_datetime.wake"] },
        // A device's trigger names its entity by its registry id.
        { trigger: "device", device_id: "dev_kitchen", entity_id: "abc123", type: "turned_on" },
      ],
      actions: [
        { action: "light.turn_on", target: { area_id: ["living", "attic"], device_id: "dev_x" } },
        { action: "light.blink", target: { entity_id: "light.living_lamp" } },
        { action: "{{ 'light.turn_off' }}" },
        { action: "light.turn_off", target: { entity_id: "{{ states.light | list }}" } },
        { scene: "scene.film" },
        { action: "light.turn_off", target: { entity_id: "all" } },
      ],
    });
    expect(names).toEqual({
      entities: ["person.kim", "zone.work", "input_datetime.wake", "scene.film"],
      areas: ["attic"],
      devices: ["dev_x"],
      floors: [],
      actions: ["light.blink"],
    });
    expect(hasUnknown(names)).toBe(true);
    expect(hasUnknown(unknownNames(home(), LEAVING))).toBe(false);
    // Without Home Assistant's actions, they are not checked.
    expect(
      unknownNames(home({ services: undefined }), {
        actions: [{ action: "light.blink" }],
      }).actions,
    ).toEqual([]);
  });

  it("asks Home Assistant to check the triggers, conditions and actions", async () => {
    const sent: Record<string, unknown>[] = [];
    const hass = home({
      connection: {
        ...home().connection,
        sendMessagePromise: <T>(message: Record<string, unknown>) => {
          sent.push(message);
          return Promise.resolve({
            triggers: { valid: true, error: null },
            conditions: { valid: true, error: null },
            actions: { valid: false, error: "Unknown action 'x'" },
          } as T);
        },
      },
    });
    expect(await checkWithHomeAssistant(hass, LEAVING)).toEqual([
      { part: "actions", error: "Unknown action 'x'" },
    ]);
    expect(sent[0]).toEqual({
      type: "validate_config",
      triggers: LEAVING.triggers,
      conditions: [],
      actions: LEAVING.actions,
    });
  });
});

describe("the automation saved (D-066)", () => {
  it("is saved as Home Assistant's editor saves: a new id from the time, its configuration API", async () => {
    const callApi = vi.fn(() => Promise.resolve({ result: "ok" }));
    const hass = home({ callApi: callApi as unknown as HomeAssistant["callApi"] });
    const config = savedConfig({ name: "Leaving", config: LEAVING }, "When the last one leaves");
    expect(Object.keys(config)).toEqual(["alias", "description", ...Object.keys(LEAVING)]);
    expect(await saveAutomation(hass, config, 1_761_552_000_000)).toBe("1761552000000");
    expect(callApi).toHaveBeenCalledWith("POST", "config/automation/config/1761552000000", config);
    await expect(saveAutomation(home(), config)).rejects.toThrow("callApi");
    expect(editorOf("1761552000000")).toBe("/config/automation/edit/1761552000000");
    expect(editorOf()).toBe("/config/automation/edit/new");
  });

  it("gets an entity id in the sandbox as Home Assistant would name it, none of the home's", () => {
    const taken = new Set(["automation.leaving_home", "automation.leaving_home_2"]);
    expect(draftEntityId("Leaving home", (id) => taken.has(id))).toBe("automation.leaving_home_3");
    expect(draftEntityId("Lumières éteintes à l’heure !", () => false)).toBe(
      "automation.lumieres_eteintes_a_l_heure",
    );
    expect(draftEntityId("夜", () => false)).toBe("automation.draft");
  });
});

describe("an automation said back in plain words (D-066)", () => {
  it("says the roadmap's example in English", () => {
    const hass = formatted(home(), {});
    const words = automationWords(new Translator("en"), hass, LEAVING);
    expect(texts(words.when)).toEqual(["When nobody is left in Home, for 2 minutes"]);
    expect(words.onlyIf).toEqual([]);
    expect(texts(words.then)).toEqual([
      "Switch off Living lamp and Kitchen ceiling",
      "Lock Front door",
    ]);
    expect(words.mode).toBeUndefined();
  });

  it("says it in French, with Home Assistant's own words for states", () => {
    const hass = formatted(
      { ...home(), language: "fr", locale: { language: "fr" } },
      { not_home: "Absent", home: "Maison" },
    );
    const words = automationWords(new Translator("fr"), hass, {
      triggers: [{ trigger: "state", entity_id: ["person.alex", "person.sam"], to: "not_home" }],
      conditions: [
        { condition: "state", entity_id: ["person.alex", "person.sam"], state: "not_home" },
        { condition: "time", after: "08:00:00", before: "22:30:00", weekday: ["mon", "fri"] },
      ],
      actions: [
        { action: "light.turn_off", target: { area_id: "living" } },
        { delay: { minutes: 5 } },
        { action: "lock.lock", target: { entity_id: "lock.front_door" } },
      ],
      mode: "restart",
    });
    expect(texts(words.when)).toEqual(["Quand Alex ou Sam passe à absent"]);
    expect(texts(words.onlyIf)).toEqual([
      "Chacun parmi Alex et Sam est absent",
      "Il est entre 08:00 et 22:30 et on est lundi ou vendredi",
    ]);
    expect(texts(words.then)).toEqual([
      "Éteindre tout dans Living room",
      "Attendre 5 minutes",
      "Verrouiller Front door",
    ]);
    expect(words.mode).toBe("elle recommence");
  });

  it("says times, the sun, numbers, patterns and durations", () => {
    const t = new Translator("en");
    const words = automationWords(t, home(), {
      triggers: [
        { trigger: "sun", event: "sunset", offset: "-00:30:00" },
        { trigger: "sun", event: "sunrise" },
        { trigger: "time", at: "07:15:00", weekday: ["sat", "sun"] },
        {
          trigger: "numeric_state",
          entity_id: "sensor.living_temperature",
          above: 24,
          for: { hours: 1, minutes: 30 },
        },
        { trigger: "time_pattern", minutes: "/10" },
        { trigger: "time_pattern", minutes: "15" },
        { trigger: "homeassistant", event: "start" },
        { platform: "state", entity_id: "binary_sensor.hall_door", from: "off", to: "on" },
        { trigger: "zone", entity_id: "person.alex", zone: "zone.home", event: "leave" },
        {
          trigger: "template",
          value_template: "{{ states('sensor.living_temperature') | float > 25 }}",
        },
        { trigger: "mqtt", topic: "home/doorbell" },
      ],
      actions: [{ action: "script.goodnight" }],
    });
    expect(texts(words.when)).toEqual([
      "30 minutes before sunset",
      "At sunrise",
      "At 7:15 AM, on Saturday or Sunday",
      "When Living temperature goes above 24 °C, for 1 hour and 30 minutes",
      "Every 10 minutes",
      "Every hour, at minute 15",
      "When Home Assistant starts",
      "When Hall door changes from off to on",
      "When Alex leaves Home",
      "When this becomes true: {{ states('sensor.living_temperature') | float > 25 }}",
      "When a message comes on “home/doorbell”",
    ]);
    expect(texts(words.then)).toEqual(["Run Goodnight"]);
  });

  it("nests choices, ifs, repeats and what runs at once", () => {
    const words = automationWords(new Translator("en"), home(), {
      triggers: [{ trigger: "state", entity_id: "input_select.mode" }],
      actions: [
        {
          choose: [
            {
              conditions: [{ condition: "state", entity_id: "input_select.mode", state: "Night" }],
              sequence: [{ action: "light.turn_off", target: { entity_id: "light.living_lamp" } }],
            },
          ],
          default: [
            {
              action: "light.turn_on",
              target: { entity_id: "light.living_lamp" },
              data: { brightness_pct: 40, transition: 2 },
            },
          ],
        },
        {
          if: [{ condition: "numeric_state", entity_id: "sensor.living_temperature", below: 18 }],
          then: [
            {
              action: "climate.set_temperature",
              target: { entity_id: "climate.bedroom" },
              data: { temperature: 20 },
            },
          ],
          else: [{ stop: "Warm enough" }],
        },
        {
          repeat: {
            count: 3,
            sequence: [
              { action: "light.toggle", target: { entity_id: "light.kitchen_ceiling" } },
              { delay: 1 },
            ],
          },
        },
        {
          parallel: [
            { action: "cover.open_cover", target: { entity_id: "cover.living_curtains" } },
            {
              sequence: [
                {
                  wait_template: "{{ is_state('lock.front_door', 'unlocked') }}",
                  timeout: "00:01:00",
                },
              ],
            },
          ],
        },
        { action: "notify.mobile_app_alex_phone", data: { message: "Good night" } },
        { action: "persistent_notification.create", data: { message: "Done" }, enabled: false },
      ],
    });
    expect(texts(words.when)).toEqual(["When Mode changes"]);
    const [choose, ifThen, repeat, parallel, notify, persistent] = words.then;
    expect(choose?.text).toBe("The first of these that holds");
    expect(choose?.lines?.map((line) => [line.text, texts(line.lines ?? [])])).toEqual([
      ["If Mode is Night", ["Switch off Living lamp"]],
      ["Otherwise", ["Switch on Living lamp, at 40 % and over 2 seconds"]],
    ]);
    expect(ifThen?.text).toBe("If Living temperature is below 18 °C");
    expect(ifThen?.lines?.map((line) => [line.text, texts(line.lines ?? [])])).toEqual([
      ["Then", ["Set Bedroom to 20 °C"]],
      ["Otherwise", ["Stop here: “Warm enough”"]],
    ]);
    expect(repeat?.text).toBe("Repeat 3 times");
    expect(texts(repeat?.lines ?? [])).toEqual(["Toggle Kitchen ceiling", "Wait 1 second"]);
    expect(parallel?.text).toBe("All at once");
    expect(parallel?.lines?.map((line) => [line.text, texts(line.lines ?? [])])).toEqual([
      ["Open Living curtains", []],
      [
        "In order",
        [
          "Wait until this is true: {{ is_state('lock.front_door', 'unlocked') }}, at most 1 minute",
        ],
      ],
    ]);
    expect(notify?.text).toBe("Send a notification (mobile app alex phone): “Good night”");
    expect(persistent).toMatchObject({ text: "Show in Home Assistant: “Done”", off: true });
    expect(wordsText(words.then)).toContain("  • Switch off Living lamp");
  });

  it("marks what Home Assistant does not have, and says the rest by its kind", () => {
    const words = automationWords(new Translator("en"), home(), {
      triggers: [
        { trigger: "state", entity_id: "person.kim", to: "home" },
        { trigger: "calendar", event: "start", entity_id: "calendar.work", offset: "-00:15:00" },
        { trigger: "geo_location", source: "quakes", zone: "zone.home", event: "enter" },
      ],
      actions: [
        { action: "light.blink", target: { entity_id: "light.living_lamp" } },
        { action: "vacuum.start", target: { area_id: "attic" } },
        { event: "domotwin_test", event_data: { a: 1 } },
      ],
    });
    expect(words.when[0]).toMatchObject({ text: "When person.kim changes to home", unknown: true });
    expect(words.when[1]).toMatchObject({
      text: "15 minutes before an event of calendar.work starts",
      unknown: true,
    });
    expect(words.when[2]?.text).toBe(
      "When “geo_location” fires (source “quakes”, zone Home, event “enter”)",
    );
    expect(words.then[0]).toMatchObject({ text: "Do light.blink on Living lamp", unknown: true });
    expect(words.then[1]).toMatchObject({ text: "Start everything in attic", unknown: true });
    expect(words.then[2]).toMatchObject({ text: "Fire the event “domotwin_test”" });
    expect(words.then[2]?.unknown).toBeUndefined();
  });

  it("has the same messages, with the same placeholders, in both languages", () => {
    const keys = (value: unknown, prefix = ""): string[] =>
      typeof value !== "object" || value === null
        ? [prefix]
        : Object.entries(value).flatMap(([key, child]) =>
            keys(child, prefix ? `${prefix}.${key}` : key),
          );
    expect(keys(plainFr).sort()).toEqual(keys(plainEn).sort());
    const lookup = (dict: unknown, key: string): unknown =>
      key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], dict);
    const placeholders = (text: unknown): string[] =>
      typeof text === "string"
        ? [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? "").sort()
        : [];
    for (const key of keys(plainEn)) {
      expect(placeholders(lookup(plainFr, key)), key).toEqual(placeholders(lookup(plainEn, key)));
    }
  });
});
