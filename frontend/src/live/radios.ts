/**
 * The radios the radio coverage (D-066) can say something of in this home, worked out without
 * loading it: Bluetooth where Home Assistant has it, Zigbee with ZHA, Wi-Fi where access points
 * are placed or devices report their Wi-Fi signal. None: the coverage is not offered.
 */
import type { HomeAssistant } from "../ha/types";

export type RadioKind = "bluetooth" | "zigbee" | "wifi";
export const RADIO_KINDS: readonly RadioKind[] = ["bluetooth", "zigbee", "wifi"];

/** Integrations whose `signal_strength` sensors in dBm are a Wi-Fi signal, whatever their name. */
const WIFI_PLATFORMS = new Set(["shelly", "tasmota"]);
/** Integrations whose are not: another radio's, or a phone's (it moves). */
const NOT_WIFI = new Set([
  "zha",
  "zwave_js",
  "bluetooth",
  "bthome",
  "xiaomi_ble",
  "ibeacon",
  "private_ble_device",
  "bermuda",
  "mobile_app",
  "matter",
  "thread",
  "unifi",
]);
const WIFI_NAME = /wi-?fi|wlan/i;

/**
 * Whether an entity is a device's Wi-Fi signal: a sensor of the `signal_strength` class in dBm,
 * of a Wi-Fi integration (Shelly, Tasmota), or named after Wi-Fi (ESPHome's `wifi_signal`,
 * WLED's); never one of ZHA's, Z-Wave's, Bluetooth's or a phone's.
 */
export function wifiSignal(hass: HomeAssistant, entityId: string): boolean {
  if (!entityId.startsWith("sensor.")) return false;
  const state = hass.states[entityId];
  if (!state) return false;
  const { device_class: deviceClass, unit_of_measurement: unit } = state.attributes;
  if (deviceClass !== "signal_strength" || unit !== "dBm") return false;
  const platform = hass.entities?.[entityId]?.platform;
  if (platform !== undefined && NOT_WIFI.has(platform)) return false;
  if (platform !== undefined && WIFI_PLATFORMS.has(platform)) return true;
  const name = state.attributes.friendly_name;
  return WIFI_NAME.test(entityId) || (typeof name === "string" && WIFI_NAME.test(name));
}

/** The radios of this home the coverage can be shown for, in its order. */
export function radioKinds(hass: HomeAssistant | undefined, accessPoints: number): RadioKind[] {
  if (!hass) return [];
  const components = hass.config?.components ?? [];
  return RADIO_KINDS.filter((kind) => {
    if (kind === "bluetooth") return components.includes("bluetooth");
    if (kind === "zigbee") return components.includes("zha");
    return accessPoints > 0 || Object.keys(hass.states).some((id) => wifiSignal(hass, id));
  });
}
