import { describe, expect, it, vi } from "vitest";

import { EngineError } from "../src/engine/engine";
import type { HomeAssistant } from "../src/ha/types";
import {
  formatOf,
  fromDataUrl,
  guessUnit,
  modelMesh,
  modelSize,
  newModelId,
  toDataUrl,
  uploadModel,
  validSize,
  type ModelInfo,
} from "../src/models/models";
import { matchingModels } from "../src/components/edit-bar";
import { Translator } from "../src/i18n";

const info = (size: [number, number, number], unit: string | null = null): ModelInfo => ({
  triangles: 12,
  size,
  unit,
  up: "y",
  images: 0,
  colors: false,
});

function hassWith(fetchWithAuth: HomeAssistant["fetchWithAuth"]): HomeAssistant {
  return { fetchWithAuth } as HomeAssistant;
}

describe("3D files", () => {
  it("knows the formats by extension", () => {
    expect(formatOf("Stool.GLB")).toBe("glb");
    expect(formatOf("chair.3mf")).toBe("3mf");
    expect(formatOf("plan.json")).toBeUndefined();
    expect(formatOf("noextension")).toBeUndefined();
  });

  it("guesses the unit and turns the box", () => {
    expect(guessUnit(info([0.38, 0.71, 0.38], "m"), "glb")).toBe("m");
    expect(guessUnit(info([380, 380, 710]), "stl")).toBe("mm");
    expect(guessUnit(info([0.4, 1.6, 0.4]), "obj")).toBe("m");
    expect(guessUnit(info([38, 71, 38]), "obj")).toBe("cm");
    expect(guessUnit(info([380, 710, 380]), "obj")).toBe("mm");
    // Y up: the file's y is the height; Z up: its z.
    expect(modelSize(info([0.38, 0.71, 0.4]), "m", "y")).toEqual([38, 40, 71]);
    expect(modelSize(info([380, 400, 710]), "mm", "z")).toEqual([38, 40, 71]);
    expect(modelSize(info([1000, 2000, 3000]), "um", "z")).toEqual([0.1, 0.2, 0.3]);
    expect(validSize([38, 40, 71])).toBe(true);
    expect(validSize([38, 40, 301])).toBe(false);
    expect(validSize([0.5, 40, 71])).toBe(false);
    expect(validSize([Number.NaN, 40, 71])).toBe(false);
  });

  it("round-trips data URLs", () => {
    const bytes = new Uint8Array(70_000).map((_, i) => i % 251);
    const url = toDataUrl(bytes, "stl");
    expect(url.startsWith("data:model/stl;base64,")).toBe(true);
    expect(fromDataUrl(url)).toEqual(bytes);
    expect(fromDataUrl("data:text/plain,hello")).toBeUndefined();
    expect(fromDataUrl("data:model/stl;base64,!!!")).toBeUndefined();
  });

  it("makes model ids the format accepts", () => {
    const id = newModelId();
    expect(id).toMatch(/^m-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(id.length).toBeLessThanOrEqual(64);
    expect(newModelId()).not.toBe(id);
  });

  it("uploads with the user's session and reports refusals", async () => {
    const fetch = vi.fn(() => Promise.resolve(Response.json({ hash: "a".repeat(64), bytes: 3 })));
    const result = await uploadModel(hassWith(fetch), new Uint8Array([1, 2, 3]), "glb");
    expect(result).toEqual({ hash: "a".repeat(64), bytes: 3 });
    expect(fetch).toHaveBeenCalledWith(
      "/api/domotwin/models?format=glb",
      expect.objectContaining({ method: "POST" }),
    );
    const refused = hassWith(() =>
      Promise.resolve(Response.json({ code: "unauthorized" }, { status: 403 })),
    );
    await expect(uploadModel(refused, new Uint8Array([1]), "glb")).rejects.toEqual(
      new EngineError("unauthorized"),
    );
    await expect(uploadModel({} as HomeAssistant, new Uint8Array([1]), "glb")).rejects.toThrow();
  });

  it("asks again for a file that could not be fetched", async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response("", { status: 404 })));
    const hass = hassWith(fetch);
    const hash = "b".repeat(64);
    await expect(modelMesh(hass, hash, "glb")).rejects.toEqual(new EngineError("model_missing"));
    await expect(modelMesh(hass, hash, "glb")).rejects.toEqual(new EngineError("model_missing"));
    expect(fetch).toHaveBeenCalledTimes(2);
    await expect(modelMesh(hass, "c".repeat(64), "fbx")).rejects.toEqual(
      new EngineError("not_model"),
    );
  });

  it("finds models by name in the catalogue", () => {
    const t = new Translator("fr");
    const models = [
      {
        id: "a",
        name: "Tabouret de bar",
        w: 1,
        d: 1,
        h: 1,
        color: null,
        format: "glb",
        bytes: 100,
        pieces: 0,
        removable: true,
      },
      {
        id: "b",
        name: "Lampe",
        w: 1,
        d: 1,
        h: 1,
        color: null,
        format: "stl",
        bytes: 100,
        pieces: 1,
        removable: false,
      },
    ];
    expect(matchingModels(models, t, "").map((m) => m.id)).toEqual(["a", "b"]);
    expect(matchingModels(models, t, "TABOURÉT").map((m) => m.id)).toEqual(["a"]);
  });
});
