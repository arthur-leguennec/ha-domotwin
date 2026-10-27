import { describe, expect, it, vi } from "vitest";

import type { HomeAssistant } from "../src/ha/types";
import { IMPORTED_FILES, PLAN_FILES, isOtherAppJson } from "../src/import/files";
import { mapPath, robotMaps } from "../src/live/robot-maps";

function entity(state: string, attributes: Record<string, unknown> = {}) {
  return { entity_id: "", state, attributes, last_changed: "", last_updated: "" };
}

/** Two robots running Valetudo, one renamed in Home Assistant, and cameras that are not maps. */
function hass(): HomeAssistant {
  return {
    states: {
      "camera.rockrobo_map_data": entity("idle", { friendly_name: "Rockrobo Map data" }),
      "vacuum.rockrobo": entity("docked", { friendly_name: "Rockrobo" }),
      "camera.upstairs_robot_map": entity("idle", { friendly_name: "Dreamy Map data" }),
      "camera.front_door": entity("idle", { friendly_name: "Front door" }),
      "camera.other_map_data": entity("idle", { friendly_name: "Map data" }),
    },
    entities: {
      "camera.rockrobo_map_data": {
        entity_id: "camera.rockrobo_map_data",
        device_id: "dev-rock",
        platform: "mqtt",
      },
      "vacuum.rockrobo": { entity_id: "vacuum.rockrobo", device_id: "dev-rock", platform: "mqtt" },
      "camera.upstairs_robot_map": {
        entity_id: "camera.upstairs_robot_map",
        device_id: "dev-dream",
        platform: "mqtt",
      },
      "camera.front_door": { entity_id: "camera.front_door", platform: "mqtt" },
      // A map of another integration's: not Valetudo's.
      "camera.other_map_data": { entity_id: "camera.other_map_data", platform: "xiaomi" },
    },
    devices: {
      "dev-rock": { id: "dev-rock", name: "Rockrobo" },
      "dev-dream": { id: "dev-dream", name: "Valetudo Dreame", name_by_user: "Upstairs robot" },
    },
    areas: {},
    language: "en",
    connection: {} as HomeAssistant["connection"],
    callService: vi.fn(() => Promise.resolve()),
  };
}

describe("robot vacuum maps in Home Assistant (D-062)", () => {
  it("are the map data cameras of Valetudo's discovery, with their robot's vacuum", () => {
    expect(robotMaps(hass())).toEqual([
      { camera: "camera.rockrobo_map_data", name: "Rockrobo", vacuum: "vacuum.rockrobo" },
      { camera: "camera.upstairs_robot_map", name: "Upstairs robot" },
    ]);
    expect(robotMaps(undefined)).toEqual([]);
  });

  it("are named by their camera without a device, by its id without a name", () => {
    const home = hass();
    home.entities = {};
    home.devices = {};
    expect(robotMaps(home).map((m) => m.name)).toEqual([
      "camera.other_map_data",
      "Dreamy",
      "Rockrobo",
    ]);
  });

  it("are read where Home Assistant serves the camera's picture", () => {
    expect(mapPath({ camera: "camera.rockrobo_map_data", name: "Rockrobo" })).toBe(
      "/api/camera_proxy/camera.rockrobo_map_data",
    );
  });
});

describe("the files the import reads (D-040, D-062)", () => {
  it("by their names", () => {
    for (const name of [
      "home.ifc",
      "home.SH3D",
      "plan.dxf",
      "room.usdz",
      "flat.fml",
      "scan.obj",
      "scan.ply",
      "scan.glb",
      "scan.gltf",
      "scan.stl",
      "scan.fbx",
      "map.gz",
      "map.png",
    ]) {
      expect(IMPORTED_FILES.test(name), name).toBe(true);
    }
    expect(IMPORTED_FILES.test("plan.domotwin.json")).toBe(false);
    for (const accepted of [
      ".fml",
      ".obj",
      ".ply",
      ".glb",
      ".gltf",
      ".stl",
      ".fbx",
      ".gz",
      ".png",
    ]) {
      expect(PLAN_FILES.split(",")).toContain(accepted);
    }
  });

  it("by what their JSON holds", () => {
    expect(isOtherAppJson({ walls: [] })).toBe(true);
    expect(isOtherAppJson({ rooms: [] })).toBe(true);
    expect(isOtherAppJson({ __class: "ValetudoMap", layers: [] })).toBe(true);
    expect(isOtherAppJson({ layers: [], pixelSize: 5 })).toBe(true);
    expect(isOtherAppJson({ name: "Flat", floors: [{ designs: [] }] })).toBe(true);
    expect(isOtherAppJson({ project: { floors: [] } })).toBe(true);
    expect(isOtherAppJson({ asset: { version: "2.0" }, meshes: [] })).toBe(true);
    // A DomoTwin plan, even one with rooms; what is not an object.
    expect(isOtherAppJson({ format: "domotwin-plan", rooms: [] })).toBe(false);
    expect(isOtherAppJson({ name: "x" })).toBe(false);
    expect(isOtherAppJson([1])).toBe(false);
    expect(isOtherAppJson(null)).toBe(false);
  });
});
