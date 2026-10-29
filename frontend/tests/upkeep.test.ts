import { describe, expect, it } from "vitest";

import { mergeBadges, type Badge } from "../src/live/devices";
import {
  mergeCards,
  newTaskId,
  readStandings,
  renamedPieces,
  todayIn,
  upkeepBadges,
  upkeepLines,
  upkeepShades,
  type Standings,
  type Upkeep,
} from "../src/live/upkeep";

/** Fictional cards: a washing machine with a task overdue and a warranty ending, a fridge due. */
const upkeep: Upkeep = {
  version: 1,
  lead_days: 14,
  pieces: {
    washer: {
      warranty_end: "2026-11-10",
      tasks: [
        { id: "filter", name: "Clean the filter", every: 3, unit: "months" },
        { id: "descale", name: "Descale", every: 6, unit: "months" },
      ],
    },
    fridge: { tasks: [{ id: "coils", name: "Clean the coils", every: 6, unit: "months" }] },
    sofa: { make: "Fictional Sofas" },
  },
};
const standings: Standings = {
  washer: {
    state: "overdue",
    warranty: 17,
    tasks: [
      { id: "filter", due: "2026-10-20", state: "overdue", days: -4 },
      { id: "descale", due: "2026-12-01", state: "fine", days: 38 },
    ],
  },
  fridge: {
    state: "due",
    warranty: null,
    tasks: [{ id: "coils", due: "2026-11-01", state: "due", days: 8 }],
  },
  sofa: { state: null, warranty: null, tasks: [] },
};

describe("upkeep (D-033)", () => {
  it("reads today where the home is", () => {
    // 23:30 in UTC is the next day in Paris, and the day before in New York.
    const now = new Date("2026-10-24T23:30:00Z");
    expect(todayIn("UTC", now)).toBe("2026-10-24");
    expect(todayIn("Europe/Paris", now)).toBe("2026-10-25");
    expect(todayIn("America/New_York", now)).toBe("2026-10-24");
    // An unknown zone: the device's.
    expect(todayIn("Not/AZone", now)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("badges the pieces with something due, tints those with tasks", () => {
    const badges = upkeepBadges(standings);
    expect(badges.get("washer")?.map((b) => [b.kind, b.tone])).toEqual([
      ["upkeep_overdue", "danger"],
      ["warranty_ending", "warning"],
    ]);
    expect(badges.get("fridge")?.map((b) => b.kind)).toEqual(["upkeep_due"]);
    // How many tasks wait, when more than one; one alone says none.
    expect(badges.get("washer")?.[0]?.text).toBeUndefined();
    const both = upkeepBadges({
      washer: {
        state: "overdue",
        warranty: null,
        tasks: [
          { id: "filter", due: "2026-10-20", state: "overdue", days: -4 },
          { id: "descale", due: "2026-10-30", state: "due", days: 6 },
        ],
      },
    });
    expect(both.get("washer")?.map((b) => [b.kind, b.text])).toEqual([["upkeep_overdue", "2"]]);
    expect(badges.has("sofa")).toBe(false);
    expect(upkeepShades(standings)).toEqual({ washer: "overdue", fridge: "due" });
    expect(readStandings("not json")).toEqual({});
    expect(readStandings(undefined)).toEqual({});
  });

  it("joins the devices' badges, the most urgent first, two at most", () => {
    const device = (kind: Badge["kind"], tone: Badge["tone"]): Badge => ({
      element: "washer",
      kind,
      tone,
      entity: "sensor.washing_machine_power",
    });
    const devices = new Map([["washer", [device("running", "info")]]]);
    const merged = mergeBadges(devices, upkeepBadges(standings));
    expect(merged.get("washer")?.map((b) => b.kind)).toEqual(["upkeep_overdue", "warranty_ending"]);
    expect(merged.get("fridge")?.map((b) => b.kind)).toEqual(["upkeep_due"]);
    expect(mergeBadges(devices, new Map())).toEqual(devices);
  });

  it("lists the tasks by date, with the warranties ending", () => {
    const names: Record<string, string> = { washer: "Washing machine", fridge: "Fridge" };
    const lines = upkeepLines(upkeep, standings, (piece) => names[piece] ?? piece);
    expect(lines.map((l) => [l.piece, l.task?.id ?? "warranty", l.state, l.days])).toEqual([
      ["washer", "filter", "overdue", -4],
      ["fridge", "coils", "due", 8],
      ["washer", "warranty", "warranty", 17],
      ["washer", "descale", "fine", 38],
    ]);
  });

  it("names new tasks, follows renamed pieces, fills cards without overwriting them", () => {
    expect(newTaskId([])).toBe("task-1");
    expect(
      newTaskId([
        { id: "task-1", name: "A", every: 1, unit: "days" },
        { id: "task-3", name: "B", every: 1, unit: "days" },
      ]),
    ).toBe("task-2");
    const before = { items: [{ id: "a" }, { id: "b" }, { id: "c" }] };
    const after = { items: [{ id: "a" }, { id: "b-2" }, { id: "c" }] };
    expect([...renamedPieces(before, after)]).toEqual([["b", "b-2"]]);
    // Pieces not kept in order (or not the same plan): nothing assumed.
    expect(renamedPieces(before, { items: [] }).size).toBe(0);
    const kept = {
      washer: { make: "Mine", tasks: [{ id: "x", name: "X", every: 1, unit: "days" as const }] },
    };
    const found = {
      washer: { make: "From the file", model: "W-100", serial: "FA-0001" },
      fridge: { model: "FR-7" },
      sofa: {},
    };
    expect(mergeCards(kept, found)).toEqual({
      // What the card said stays (its make, its tasks); what it lacked comes from the file.
      washer: {
        make: "Mine",
        model: "W-100",
        serial: "FA-0001",
        tasks: [{ id: "x", name: "X", every: 1, unit: "days" }],
      },
      fridge: { model: "FR-7" },
    });
    // The same file again (its keys in another order): nothing to save.
    expect(
      mergeCards(
        { fridge: { model: "FR-7", make: "Cold" } },
        { fridge: { make: "Cold", model: "FR-7" } },
      ),
    ).toEqual({});
  });
});
