import { describe, expect, it } from "vitest";

import {
  CUT,
  LONGEST,
  freshness,
  grassLength,
  growth,
  lawnsShown,
  type Garden,
} from "../src/live/lawn";

const at = (iso: string) => new Date(iso);

describe("the lawns' grass (D-077)", () => {
  it("grows with the season where the home is", () => {
    // May in the north, the most; January, none; the south the other way round.
    expect(growth(at("2026-05-10T12:00:00Z"), 48)).toBeCloseTo(0.4);
    expect(growth(at("2026-01-10T12:00:00Z"), 48)).toBe(0);
    expect(growth(at("2026-11-10T12:00:00Z"), -34)).toBeCloseTo(0.4);
    expect(growth(at("2026-07-10T12:00:00Z"), -34)).toBe(0);
    // All year round in the tropics; a home whose latitude is not known, as in the north.
    expect(growth(at("2026-01-10T12:00:00Z"), 10)).toBeCloseTo(0.3);
    expect(growth(at("2026-05-10T12:00:00Z"))).toBeCloseTo(0.4);
  });

  it("is cut short, grows day by day, and is never drawn past its longest", () => {
    const mown = at("2026-05-01T10:00:00Z");
    expect(grassLength(mown, mown, 48)).toBe(CUT);
    // Ten days of May: 4 cm more.
    expect(grassLength(mown, at("2026-05-11T10:00:00Z"), 48)).toBeCloseTo(CUT + 4);
    expect(grassLength(mown, at("2027-05-01T10:00:00Z"), 48)).toBe(LONGEST);
    // Mown in December, still short in January.
    expect(grassLength(at("2026-12-20T10:00:00Z"), at("2027-01-20T10:00:00Z"), 48)).toBe(CUT);
  });

  it("shows its stripes four days after a mowing", () => {
    const mown = at("2026-05-01T10:00:00Z");
    expect(freshness(mown, mown)).toBe(1);
    expect(freshness(mown, at("2026-05-03T10:00:00Z"))).toBeCloseTo(0.5);
    expect(freshness(mown, at("2026-05-08T10:00:00Z"))).toBe(0);
  });

  it("is last mown by someone or by a robot mower of its storey, the later", () => {
    const garden: Garden = {
      lawns: { back: "2026-05-01T10:00:00+00:00", front: "2026-05-09T10:00:00+00:00" },
      mowers: { "lawn_mower.mowy": "2026-05-08T10:00:00+00:00", "lawn_mower.far": "soon" },
    };
    const now = at("2026-05-10T10:00:00Z");
    const mowers = { "lawn_mower.mowy": ["back", "front"], "lawn_mower.far": ["side"] };
    const shown = lawnsShown(["back", "front", "side", "terrace"], garden, mowers, now, 48);
    // The back lawn by the mower two days ago; the front one said mown yesterday, later.
    expect(shown).toEqual({
      back: { length: 4.8, fresh: 0.5 },
      front: { length: 4.4, fresh: 0.75 },
    });
    // A time ahead of the clock is left out; none known, nothing drawn.
    const ahead = { lawns: { back: "2026-06-01T10:00:00+00:00" }, mowers: {} };
    expect(lawnsShown(["back"], ahead, {}, now)).toEqual({});
    expect(lawnsShown(["back"], undefined, mowers, now)).toEqual({});
  });
});
