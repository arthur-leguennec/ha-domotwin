import { describe, expect, it } from "vitest";

import { PlainSession } from "../src/components/plain-dialog";
import type { HassEntity } from "../src/ha/types";
import type { HomeCopy } from "../src/sandbox/copy";
import { SandboxHome, type DraftDay } from "../src/sandbox/home";
import { isoIn, moment } from "../src/sandbox/time";

const ZONE = "Europe/Paris";
// A Tuesday, at noon: its people go out at half past eight and come back at six.
const NOW = moment(ZONE, 2026, 10, 27, 12);

function entity(id: string, state: string, attributes: Record<string, unknown> = {}): HassEntity {
  const iso = isoIn(NOW - 86_400_000, ZONE);
  return { entity_id: id, state, attributes, last_changed: iso, last_updated: iso };
}

/** A fictional flat whose automation switches the lamp back on whenever it goes off. */
function copy(): HomeCopy {
  const states = [
    entity("light.living", "on", { friendly_name: "Living lamp" }),
    entity("person.alex", "home", { friendly_name: "Alex" }),
    entity("zone.home", "1", { friendly_name: "Home", persons: ["person.alex"] }),
    entity("automation.lamp_back_on", "on", { friendly_name: "Lamp back on", id: "1" }),
  ];
  return {
    states: Object.fromEntries(states.map((e) => [e.entity_id, e])),
    entities: {},
    devices: {},
    areas: {},
    floors: {},
    store: {
      revision: 1,
      storeys: [],
      people: { revision: 1, shown: "everyone", look: "figure", hidden: [], people: {} },
    } as unknown as HomeCopy["store"],
    automations: [
      {
        id: "automation.lamp_back_on",
        config: {
          triggers: [{ trigger: "state", entity_id: "light.living", to: "off" }],
          actions: [{ action: "light.turn_on", target: { entity_id: "light.living" } }],
        },
      },
    ],
    scripts: [],
    scenes: [],
    registry: {},
    zone: ZONE,
  };
}

/** The draft: the lamp off when the last person goes out (the home zone back to nobody). */
const DRAFT = {
  triggers: [{ trigger: "state", entity_id: "zone.home", to: "0" }],
  conditions: [],
  actions: [{ action: "light.turn_off", target: { entity_id: "light.living" } }],
  mode: "single",
};

describe("a draft played in the sandbox (D-069)", () => {
  it("plays beside the home's automations, on the copy alone, and says what it did", () => {
    const home = copy();
    const days: DraftDay[] = [];
    const sandbox = new SandboxHome(
      home,
      {
        language: "en",
        draft: {
          entity: "automation.lamp_off_when_nobody_is_home",
          name: "Lamp off when nobody is home",
          config: DRAFT,
          onDay: (day) => days.push(day),
        },
      },
      NOW,
    );
    expect(sandbox.draft).toEqual({
      entity: "automation.lamp_off_when_nobody_is_home",
      name: "Lamp off when nobody is home",
    });
    expect(sandbox.automationIds()).toEqual([
      "automation.lamp_back_on",
      "automation.lamp_off_when_nobody_is_home",
    ]);
    expect(sandbox.automationConfig("automation.lamp_off_when_nobody_is_home")).toBe(DRAFT);
    expect(sandbox.name("automation.lamp_off_when_nobody_is_home")).toBe(
      "Lamp off when nobody is home",
    );
    // The copy read from the home is left as it was.
    expect(home.automations).toHaveLength(1);
    expect(home.states["automation.lamp_off_when_nobody_is_home"]).toBeUndefined();
    // Played as soon as it opens: Alex, the last one, goes out at half past eight, and the
    // home's automation switches the lamp straight back on.
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({
      date: "2026-10-27",
      runs: ["08:30"],
      stopped: 0,
      busy: 0,
      against: ["automation.lamp_back_on"],
      backAndForth: false,
      notPlayed: 0,
      looping: false,
      byHand: 0,
    });
    expect(
      sandbox.dayReport().owners.find((o) => o.id === sandbox.draft?.entity)?.runs,
    ).toHaveLength(1);
    // Another day, and something done by hand: each a day of its own.
    sandbox.setScenario({ ...sandbox.scenario, date: "2026-10-31", people: [] });
    expect(days[1]).toMatchObject({ date: "2026-10-31", runs: [] });
    expect(days[1]?.key).not.toBe(days[0]?.key);
    sandbox.byHand({
      at: sandbox.cursor,
      domain: "light",
      service: "turn_off",
      target: { entity_id: "light.living" },
    });
    // What is done by hand is that day's, played again: the same day for the dialog.
    expect(days[2]).toMatchObject({ date: "2026-10-31", byHand: 1 });
    expect(days[2]?.key).toBe(days[1]?.key);
    sandbox.stop();
  });

  it("is not there without a draft", () => {
    const sandbox = new SandboxHome(copy(), { language: "en" }, NOW);
    expect(sandbox.draft).toBeUndefined();
    expect(sandbox.draftDay()).toBeUndefined();
    expect(sandbox.automationIds()).toEqual(["automation.lamp_back_on"]);
    sandbox.stop();
  });
});

const day = (key: string, runs: string[] = []): DraftDay => ({
  key,
  date: "2026-10-27",
  weather: "sunny",
  byHand: 0,
  runs,
  stopped: 0,
  busy: 0,
  against: [],
  backAndForth: false,
  notPlayed: 0,
  looping: false,
});

describe("the draft being written (D-069)", () => {
  it("keeps the request and each change as its description", () => {
    const session = new PlainSession();
    session.request = " When the last person leaves, lock the door ";
    session.changes = ["Wait five minutes", " "];
    expect(session.description).toBe(
      "When the last person leaves, lock the door\nWait five minutes",
    );
  });

  it("is saved only once checked with nothing wrong and played as it is now", () => {
    const session = new PlainSession();
    session.setDraft({ name: "Leaving", config: DRAFT });
    expect(session.revision).toBe(1);
    expect(session.checked).toBe(false);
    const none = { entities: [], areas: [], devices: [], floors: [], actions: [] };
    session.check = { problems: [], unknown: none };
    expect(session.checked).toBe(true);
    expect(session.played).toBe(false);
    session.addDay(day("a", ["08:30"]), 1);
    expect(session.played).toBe(true);
    // A day of the draft before is not this one's.
    session.addDay(day("b"), 0);
    expect(session.days.map((d) => d.key)).toEqual(["a"]);
    // The same day played again replaces it; ten at most, the latest.
    session.addDay(day("a", ["09:00"]), 1);
    expect(session.days).toEqual([day("a", ["09:00"])]);
    for (let k = 0; k < 12; k += 1) session.addDay(day(`d${k}`), 1);
    expect(session.days).toHaveLength(10);
    expect(session.days[9]?.key).toBe("d11");
    // What Home Assistant refused, or does not have, keeps it from being saved.
    session.check = { problems: [{ part: "actions", error: "bad" }], unknown: none };
    expect(session.checked).toBe(false);
    session.check = { problems: [], unknown: { ...none, entities: ["light.gone"] } };
    expect(session.checked).toBe(false);
    session.check = { failed: "offline", unknown: none };
    expect(session.checked).toBe(false);
    // A new draft is checked and played again.
    session.setDraft({ name: "Leaving", config: DRAFT });
    expect(session.revision).toBe(2);
    expect(session.check).toBeUndefined();
    expect(session.days).toEqual([]);
    session.saved = { id: "1", name: "Leaving" };
    session.clear();
    expect(session.draft).toBeUndefined();
    expect(session.saved).toBeUndefined();
    expect(session.request).toBe("");
  });
});
