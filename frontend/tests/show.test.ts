import { describe, expect, it } from "vitest";

import type { StoreyInfo } from "../src/ha/client";
import { translatorFor } from "../src/i18n";
import { findElement, findStorey, forScreen, resolveShow, spoken } from "../src/live/show";

const t = translatorFor({ language: "en" });
const storeys: StoreyInfo[] = [
  { id: "storey-1", name: "", elevation: 0 },
  { id: "storey-2", name: "Attic", elevation: 560 },
  { id: "storey-3", name: "", elevation: 280 },
  { id: "storey-4", name: "", elevation: -260 },
];
const plans: Record<string, unknown> = {
  "storey-1": {
    rooms: [
      { id: "kitchen", name: "Kitchen" },
      { id: "living", name: "Séjour et salle à manger" },
      { id: "bedroom-down", name: "Bedroom" },
    ],
    items: [
      { id: "kitchen-lamp", name: "Kitchen lamp" },
      { id: "desk", name: "Desk", room: "bedroom-down" },
    ],
  },
  "storey-3": {
    rooms: [
      { id: "office", name: "Office" },
      { id: "bedroom-up", name: "Bedroom" },
      { id: "studio", name: "Home studio" },
    ],
  },
  "storey-2": { rooms: [] },
  "storey-4": { rooms: [{ id: "cellar", name: "" }] },
};
const client = {
  getPlan: (id?: string) =>
    Promise.resolve({
      plan: plans[id ?? "storey-1"] as never,
      layout: {},
      revision: 1,
      storey: id ?? null,
      storeys,
    }),
};

describe("domotwin.show", () => {
  it("says names the way people do", () => {
    expect(spoken("  L'Entrée ")).toBe("entree");
    expect(spoken("The Kitchen!")).toBe("kitchen");
    expect(spoken("la salle à manger")).toBe("salle a manger");
  });

  it("is for every screen, or for the one named", () => {
    expect(forScreen({ room: "x" }, undefined)).toBe(true);
    expect(forScreen({ room: "x", screen: "Hallway" }, "hallway")).toBe(true);
    expect(forScreen({ room: "x", screen: "hallway" }, "kitchen")).toBe(false);
    expect(forScreen({ room: "x", screen: "hallway" }, undefined)).toBe(false);
  });

  it("finds a storey by its id, name, place or number, or the whole home", () => {
    expect(findStorey(t, storeys, "storey-3")).toBe("storey-3");
    expect(findStorey(t, storeys, "attic")).toBe("storey-2");
    expect(findStorey(t, storeys, "Floor 1")).toBe("storey-3");
    expect(findStorey(t, storeys, "ground floor")).toBe("storey-1");
    expect(findStorey(t, storeys, "-1")).toBe("storey-4");
    expect(findStorey(t, storeys, "the whole house")).toBe("all");
    expect(findStorey(t, storeys, "tous les étages")).toBe("all");
    expect(findStorey(t, storeys, "garage")).toBeUndefined();
    // One storey: no whole home to show.
    expect(findStorey(t, storeys.slice(0, 1), "all")).toBeUndefined();
  });

  it("finds an element by id, by name, then by the words of its name; rooms first", () => {
    const all = Object.entries(plans).map(([storey, plan]) => ({ storey, plan }));
    expect(findElement(all, "office", true)).toEqual({ id: "office", storey: "storey-3" });
    expect(findElement(all, "the kitchen", true)).toEqual({ id: "kitchen", storey: "storey-1" });
    expect(findElement(all, "salle a manger", true)).toEqual({ id: "living", storey: "storey-1" });
    expect(findElement(all, "kitchen lamp", false)?.id).toBe("kitchen-lamp");
    expect(findElement(all, "cellar", true)).toEqual({ id: "cellar", storey: "storey-4" });
    expect(findElement(all, "bathroom", true)).toBeUndefined();
  });

  it("turns a request into what a screen shows", async () => {
    const shown = { plan: plans["storey-1"], storey: "storey-1" };
    // A room upstairs: that storey, the room framed.
    expect(await resolveShow(client, t, storeys, shown, { room: "Office", view: "walk" })).toEqual({
      storey: "storey-3",
      element: "office",
      view: "walk",
    });
    // Every storey shown: the room framed there; walking there, on its storey.
    const whole = { plan: undefined, storey: "all" };
    expect(await resolveShow(client, t, storeys, whole, { room: "office" })).toEqual({
      element: "office",
    });
    expect(await resolveShow(client, t, storeys, whole, { room: "office", view: "walk" })).toEqual({
      storey: "storey-3",
      element: "office",
      view: "walk",
    });
    // A storey that does not answer is left out.
    const failing = {
      getPlan: (id?: string) =>
        id === "storey-2" ? Promise.reject(new Error("gone")) : client.getPlan(id),
    };
    expect(await resolveShow(failing, t, storeys, shown, { room: "office" })).toEqual({
      storey: "storey-3",
      element: "office",
    });
    // A storey said as a room.
    expect(await resolveShow(client, t, storeys, shown, { room: "upstairs" })).toBeUndefined();
    expect(await resolveShow(client, t, storeys, shown, { room: "attic" })).toEqual({
      storey: "storey-2",
    });
    expect(await resolveShow(client, t, storeys, shown, { view: "2d" })).toEqual({ view: "2d" });
    expect(await resolveShow(client, t, storeys, shown, { storey: "garage" })).toBeUndefined();
    // A room on the storey asked for, not one of the same name on another.
    expect(await resolveShow(client, t, storeys, shown, { storey: "1", room: "bedroom" })).toEqual({
      storey: "storey-3",
      element: "bedroom-up",
    });
    // The whole home said as a room: every storey, not the room whose name holds the word.
    expect(await resolveShow(client, t, storeys, shown, { room: "the home" })).toEqual({
      storey: "all",
      view: "overview",
    });
    expect(
      await resolveShow(client, t, [], { plan: plans["storey-1"] }, { room: "maison" }),
    ).toEqual({ view: "overview" });
    // A home of one storey: its plan as shown.
    const alone = await resolveShow(
      client,
      t,
      [],
      { plan: plans["storey-1"] },
      { room: "kitchen" },
    );
    expect(alone).toEqual({ element: "kitchen" });
  });

  it("does nothing on a screen whose viewer may not see the room (D-039)", async () => {
    const shown = { plan: plans["storey-1"], storey: "storey-1" };
    const closed = new Set(["office", "bedroom-down"]);
    // Not even the storey it is on.
    expect(
      await resolveShow(client, t, storeys, shown, { room: "office" }, closed),
    ).toBeUndefined();
    expect(
      await resolveShow(client, t, storeys, shown, { element: "desk" }, closed),
    ).toBeUndefined();
    expect(await resolveShow(client, t, storeys, shown, { room: "kitchen" }, closed)).toEqual({
      storey: "storey-1",
      element: "kitchen",
    });
  });
});
