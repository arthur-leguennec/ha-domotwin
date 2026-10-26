import { describe, expect, it } from "vitest";

import { labelSize, NAME_MAX_PX, placeLabels, roomKind } from "../src/live/room-labels";

describe("room labels", () => {
  it("reads the kind of a room from its name, in English and in French", () => {
    expect(roomKind("Cuisine")).toBe("kitchen");
    expect(roomKind("Salle de bains")).toBe("bathroom");
    expect(roomKind("Salle d'eau")).toBe("bathroom");
    expect(roomKind("SDB")).toBe("bathroom");
    expect(roomKind("Salle à manger")).toBe("dining");
    expect(roomKind("WC")).toBe("toilet");
    expect(roomKind("Placard SDB")).toBe("closet");
    expect(roomKind("Couloir principal")).toBe("hall");
    expect(roomKind("Living room")).toBe("living");
    expect(roomKind("Pièce de vie")).toBe("living");
    expect(roomKind("Master bedroom")).toBe("bedroom");
    expect(roomKind("Buanderie")).toBe("laundry");
    expect(roomKind("Terrasse")).toBe("outdoor");
    expect(roomKind("Grenier")).toBe("room");
  });

  it("takes the first word that names a kind", () => {
    expect(roomKind("Salle de bain + WC")).toBe("bathroom");
    expect(roomKind("WC / salle d'eau")).toBe("toilet");
    expect(roomKind("Dégagement SDB / WC")).toBe("hall");
    expect(roomKind("Chambre avec dressing")).toBe("bedroom");
    expect(roomKind("Master bedroom with walk-in closet")).toBe("bedroom");
    expect(roomKind("Garage / rangement")).toBe("garage");
    expect(roomKind("Entrée / dressing")).toBe("hall");
    expect(roomKind("Bureau-dressing")).toBe("office");
    expect(roomKind("Dressing")).toBe("closet");
    // Words of a name, not parts of words.
    expect(roomKind("Local chauffe-eau")).toBe("room");
    expect(roomKind("Chambre2")).toBe("bedroom");
    expect(roomKind("Bedroom 2")).toBe("bedroom");
    expect(roomKind("W.C.")).toBe("toilet");
    expect(roomKind("En-suite")).toBe("bathroom");
    expect(roomKind("Family room")).toBe("living");
    expect(roomKind("Family bathroom")).toBe("bathroom");
  });

  it("sizes names as the bundled font draws them, no wider than a cap", () => {
    // Measured in Chromium (12 px semi-bold): 32 px of text, 224 px, 168 px; plus 39 px around.
    expect(labelSize("Salon", false)[0]).toBeGreaterThanOrEqual(32 + 39);
    expect(labelSize("SALLE DE BAINS PARENTALE", false)[0]).toBeGreaterThanOrEqual(168 + 39);
    expect(labelSize("Chambre parentale avec salle de bains", false)[0]).toBe(NAME_MAX_PX);
    expect(labelSize("Chambre parentale avec salle de bains", false, 120)[0]).toBe(120);
    expect(labelSize("Salon", true)).toEqual([26, 26]);
    // The view measures its own font.
    expect(labelSize("Salon", false, NAME_MAX_PX, () => 100)[0]).toBe(139);
  });

  const view = { width: 400, height: 300, small: false };

  it("leaves small rooms and closets out unless asked for", () => {
    const labels = [
      { id: "living", name: "Salon", x: 100, y: 100, area: 20 },
      { id: "closet", name: "Placard", x: 300, y: 200, area: 1 },
      { id: "dressing", name: "Dressing", x: 300, y: 260, area: 5 },
      { id: "wc", name: "Toilettes", x: 300, y: 100, area: 1.5 },
      // A big room with a closet: its name stays.
      { id: "bedroom", name: "Chambre avec dressing", x: 100, y: 200, area: 14 },
    ];
    expect(placeLabels(labels, view).map((l) => l.id)).toEqual(["living", "bedroom"]);
    expect(placeLabels(labels, { ...view, small: true }).map((l) => l.id)).toEqual([
      "living",
      "bedroom",
      "dressing",
      "wc",
      "closet",
    ]);
  });

  it("gives way to bigger rooms: icon alone, then nothing", () => {
    const labels = [
      { id: "hall", name: "Couloir principal", x: 200, y: 110, area: 4 },
      { id: "living", name: "Salon", x: 200, y: 100, area: 20 },
      { id: "kitchen", name: "Cuisine", x: 275, y: 100, area: 10 },
    ];
    const placed = placeLabels(labels, view);
    expect(placed.map((l) => [l.id, l.kind, l.compact])).toEqual([
      ["living", "living", false],
      ["kitchen", "kitchen", true],
    ]);
  });

  it("keeps a name as it was shown while it covers nothing, so that it does not flicker", () => {
    // 8 px below the living room's name: room enough to stay, not to come.
    const labels = [
      { id: "living", name: "Salon", x: 100, y: 100, area: 20 },
      { id: "kitchen", name: "Cuisine", x: 100, y: 132, area: 10 },
    ];
    const shown = (before?: Map<string, boolean>) =>
      placeLabels(labels, { ...view, before }).map((l) => [l.id, l.compact]);
    // Shown whole, it stays whole; as its icon, it stays an icon; not shown, it stays hidden.
    expect(shown(new Map([["kitchen", false]]))).toEqual([
      ["living", false],
      ["kitchen", false],
    ]);
    expect(shown(new Map([["kitchen", true]]))).toEqual([
      ["living", false],
      ["kitchen", true],
    ]);
    expect(shown()).toEqual([["living", false]]);
  });

  it("counts a long name no wider than 40 % of the view", () => {
    // Cut to 132 px in a view of 330: a name beside it fits; 240 px in a view of 1 000: it does
    // not, nor its icon.
    const long = {
      id: "a",
      name: "Chambre parentale avec salle de bains",
      x: 150,
      y: 50,
      area: 20,
    };
    const next = { id: "b", name: "Bureau", x: 270, y: 50, area: 10 };
    const place = (width: number) =>
      placeLabels([long, next], { width, height: 200, small: false }).map((l) => [l.id, l.compact]);
    expect(place(330)).toEqual([
      ["a", false],
      ["b", false],
    ]);
    expect(place(1000)).toEqual([["a", false]]);
  });

  it("leaves out names outside the view", () => {
    const labels = [{ id: "living", name: "Salon", x: -20, y: 100, area: 20 }];
    expect(placeLabels(labels, view)).toEqual([]);
  });
});
