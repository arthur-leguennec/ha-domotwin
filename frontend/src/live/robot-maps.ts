/**
 * Robot vacuum maps in Home Assistant (D-062): the *Map data* camera Valetudo's MQTT discovery
 * makes for each robot, whose picture holds the robot's map (`map-data-hass`). The import reads
 * it through Home Assistant, with the user's session: nothing reaches the robot.
 */
import type { HomeAssistant } from "../ha/types";

/** A robot's map Home Assistant has: its camera, the robot's name, and its vacuum. */
export interface RobotMapSource {
  camera: string;
  name: string;
  /** The vacuum of the same device, which its dock is linked to. */
  vacuum?: string;
}

/** Whether a camera is Valetudo's map data: of its MQTT discovery, named so. */
function isMapData(hass: HomeAssistant, entityId: string): boolean {
  if (!entityId.startsWith("camera.")) return false;
  const entry = hass.entities?.[entityId];
  if (entry?.platform !== undefined && entry.platform !== "mqtt") return false;
  const name = hass.states[entityId]?.attributes.friendly_name;
  return (
    entityId.endsWith("_map_data") || (typeof name === "string" && /\bmap data$/i.test(name.trim()))
  );
}

/** The robots' maps Home Assistant has, by name. */
export function robotMaps(hass: HomeAssistant | undefined): RobotMapSource[] {
  if (!hass) return [];
  const found: RobotMapSource[] = [];
  for (const camera of Object.keys(hass.states)) {
    if (!isMapData(hass, camera)) continue;
    const device = hass.entities?.[camera]?.device_id ?? undefined;
    const entry = device ? hass.devices?.[device] : undefined;
    const vacuum = device
      ? Object.values(hass.entities ?? {}).find(
          (e) => e?.device_id === device && e.entity_id.startsWith("vacuum."),
        )?.entity_id
      : undefined;
    const friendly = hass.states[camera]?.attributes.friendly_name;
    const vacuumName = vacuum ? hass.states[vacuum]?.attributes.friendly_name : undefined;
    const name =
      entry?.name_by_user ??
      entry?.name ??
      (typeof vacuumName === "string" ? vacuumName : undefined) ??
      (typeof friendly === "string" ? friendly.replace(/\s*map data$/i, "") : camera);
    found.push({ camera, name: name || camera, ...(vacuum ? { vacuum } : {}) });
  }
  return found.sort((a, b) => a.name.localeCompare(b.name) || a.camera.localeCompare(b.camera));
}

/** Where Home Assistant serves a camera's picture. */
export function mapPath(source: RobotMapSource): string {
  return `/api/camera_proxy/${encodeURIComponent(source.camera)}`;
}
