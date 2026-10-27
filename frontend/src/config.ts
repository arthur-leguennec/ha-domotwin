import type { MessageKey } from "./i18n";
import { LAYER_NAMES, type LayerName } from "./live/layers";

export type ViewMode = "3d" | "2d";
export type QualityName = "auto" | "eco" | "balanced" | "high";
export type CutawayMode = "auto" | "always" | "off";
/** The light of the scene: following the time of day (`auto`), or fixed. */
export type LightingMode = "auto" | "morning" | "day" | "evening" | "night";
/** Where the sun lights from: high in the south-east (`fixed`), or where it is (`real`). */
export type SunMode = "fixed" | "real";
/** The look (D-027, D-036): following Home Assistant's dark mode (`auto`: neon when dark), or
 * fixed. */
export type ThemeMode = "auto" | "day" | "neon" | "blueprint" | "cartoon" | "clay";
/** A look drawn. */
export type LookName = Exclude<ThemeMode, "auto">;

export const THEME_MODES: readonly ThemeMode[] = [
  "auto",
  "day",
  "neon",
  "blueprint",
  "cartoon",
  "clay",
];
/** The accent of the looks by default. */
export const DEFAULT_ACCENT = "#00d4ff";
/** The neon look's own: the warm light of its walls' tops against its dusk violet (D-048). */
export const NEON_ACCENT = "#ffae45";

/** The accent of `look` when none was chosen (the engine's `ThemeName::default_accent` too). */
export function defaultAccent(look: LookName): string {
  return look === "neon" ? NEON_ACCENT : DEFAULT_ACCENT;
}
const ACCENT = /^#[0-9a-f]{6}$/i;

/** The look drawn for `mode` (absent: `auto`): `auto` is neon in Home Assistant's dark mode. */
export function resolveLook(
  mode: ThemeMode | undefined,
  hass: { themes?: { darkMode?: boolean } } | undefined,
): LookName {
  const chosen = mode ?? "auto";
  if (chosen !== "auto") return chosen;
  return hass?.themes?.darkMode ? "neon" : "day";
}

/** An accent colour as stored (`#rrggbb`, lower case), or undefined. */
export function readAccent(value: unknown): string | undefined {
  return typeof value === "string" && ACCENT.test(value.trim())
    ? value.trim().toLowerCase()
    : undefined;
}

/** Options of `custom:domotwin-card`, after defaults. */
export interface CardConfig {
  type: string;
  title?: string;
  view: ViewMode;
  /** CSS length; absent: the card keeps a 4:3 ratio (or fills its grid cell). */
  height?: string;
  quality: QualityName;
  cutaway: CutawayMode;
  lighting: LightingMode;
  /** Room to focus on start (an element id of the plan). */
  room?: string;
  /** Storey shown first (a storey id, or `all` for every storey at once); the ground floor by
   * default. */
  storey?: string;
  /** Font for the card's texts; absent: the bundled default. */
  font_family?: string;
  /** The layer shown first (heatmap, power or none). */
  layer: LayerName;
  /** Room alerts (smoke, water, an alarm…), on unless turned off. */
  alerts: boolean;
  /** Rooms someone is in glow softly. */
  presence: boolean;
  /** The people in their rooms (D-034), as figures. */
  people: boolean;
  sun: SunMode;
  /** The weather around the home (D-072): rain, snow, fog and storms, on unless turned off. */
  weather: boolean;
  /** Badges over the devices (locks, cameras, what plays, low batteries, appliances running). */
  badges: boolean;
  /** What the cameras see, on the floor. */
  cameras: boolean;
  /** The rooms' names over their floor. */
  names: boolean;
  /** The names of small rooms too (closets, rooms under 2.5 m²). */
  small_rooms: boolean;
  /** Every storey at once (D-028): spread apart (else stacked), the roof over the top one. */
  spread: boolean;
  roof: boolean;
  /** The look; absent: the home's (the panel's settings). */
  theme?: ThemeMode;
  /** The accent of the look (`#rrggbb`); absent: the home's. */
  accent?: string;
  /**
   * The kiosk (D-029): back to the view it opened on after this many seconds untouched (0:
   * never), turning slowly around the home meanwhile (`orbit`), dimmed at night (`night_dim`).
   */
  idle: number;
  orbit: boolean;
  night_dim: boolean;
  /** The view's buttons, on unless turned off. */
  tools: boolean;
  /** The microphone among the buttons, when Assist runs (D-041). */
  voice: boolean;
  /** The name of this screen, for `domotwin.show` (D-029). */
  screen?: string;
  /** The demo house instead of this home (D-050): its day, nothing of the home touched. */
  demo: boolean;
}

/** A configuration problem; `key` is translated by the card. */
export class ConfigError extends Error {
  constructor(readonly key: MessageKey) {
    super(key);
    this.name = "ConfigError";
  }
}

const VIEWS: readonly ViewMode[] = ["3d", "2d"];
const QUALITIES: readonly QualityName[] = ["auto", "eco", "balanced", "high"];
const CUTAWAYS: readonly CutawayMode[] = ["auto", "always", "off"];
const LIGHTINGS: readonly LightingMode[] = ["auto", "morning", "day", "evening", "night"];
const SUNS: readonly SunMode[] = ["fixed", "real"];
const CSS_LENGTH = /^\d+(\.\d+)?(px|vh|svh|dvh|em|rem)$/;
/** The longest wait before the kiosk goes back (seconds: a day). */
export const MAX_IDLE = 86_400;
/** A screen's name: letters, digits, `_` and `-`, whatever their case. */
export const SCREEN_NAME = /^[a-z0-9_-]{1,64}$/i;

function pick<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
  error: MessageKey,
): T {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "string" && (allowed as readonly string[]).includes(value))
    return value as T;
  throw new ConfigError(error);
}

function flag(value: unknown, fallback: boolean, error: MessageKey): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  throw new ConfigError(error);
}

/** The kiosk's wait (seconds, 0 to 1 day; absent: 0, never). */
function seconds(value: unknown): number {
  if (value === undefined || value === null || value === "") return 0;
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= MAX_IDLE) return n;
  throw new ConfigError("config.bad_idle");
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/** Validates a card configuration and fills in the defaults. */
export function normalizeConfig(raw: unknown): CardConfig {
  const input = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  let height: string | undefined;
  if (typeof input.height === "number" && input.height > 0) height = `${input.height}px`;
  else if (typeof input.height === "string" && input.height.trim() !== "") {
    height = input.height.trim();
    if (!CSS_LENGTH.test(height)) throw new ConfigError("config.bad_height");
  } else if (input.height !== undefined && input.height !== null && input.height !== "") {
    throw new ConfigError("config.bad_height");
  }
  const config: CardConfig = {
    type: typeof input.type === "string" ? input.type : "custom:domotwin-card",
    view: pick(input.view, VIEWS, "3d", "config.bad_view"),
    quality: pick(input.quality, QUALITIES, "auto", "config.bad_quality"),
    cutaway: pick(input.cutaway, CUTAWAYS, "auto", "config.bad_cutaway"),
    lighting: pick(input.lighting, LIGHTINGS, "auto", "config.bad_lighting"),
    layer: pick(input.layer, LAYER_NAMES, "off", "config.bad_layer"),
    alerts: flag(input.alerts, true, "config.bad_alerts"),
    presence: flag(input.presence, true, "config.bad_presence"),
    people: flag(input.people, true, "config.bad_people"),
    sun: pick(input.sun, SUNS, "fixed", "config.bad_sun"),
    weather: flag(input.weather, true, "config.bad_weather"),
    badges: flag(input.badges, true, "config.bad_badges"),
    cameras: flag(input.cameras, true, "config.bad_cameras"),
    names: flag(input.names, true, "config.bad_names"),
    small_rooms: flag(input.small_rooms, false, "config.bad_small_rooms"),
    spread: flag(input.spread, true, "config.bad_spread"),
    roof: flag(input.roof, true, "config.bad_roof"),
    idle: seconds(input.idle),
    orbit: flag(input.orbit, false, "config.bad_orbit"),
    night_dim: flag(input.night_dim, false, "config.bad_night_dim"),
    tools: flag(input.tools, true, "config.bad_tools"),
    voice: flag(input.voice, true, "config.bad_voice"),
    demo: flag(input.demo, false, "config.bad_demo"),
  };
  const title = optionalString(input.title);
  if (title !== undefined) config.title = title;
  if (height !== undefined) config.height = height;
  const room = optionalString(input.room);
  if (room !== undefined) config.room = room;
  const storey = optionalString(input.storey);
  if (storey !== undefined) config.storey = storey;
  const font = optionalString(input.font_family);
  if (font !== undefined) config.font_family = font;
  if (input.theme !== undefined && input.theme !== null && input.theme !== "") {
    config.theme = pick(input.theme, THEME_MODES, "auto", "config.bad_theme");
  }
  if (input.screen !== undefined && input.screen !== null && input.screen !== "") {
    const screen = typeof input.screen === "string" ? input.screen.trim() : "";
    if (!SCREEN_NAME.test(screen)) throw new ConfigError("config.bad_screen");
    config.screen = screen;
  }
  if (input.accent !== undefined && input.accent !== null && input.accent !== "") {
    const accent = readAccent(input.accent);
    if (accent === undefined) throw new ConfigError("config.bad_accent");
    config.accent = accent;
  }
  return config;
}
