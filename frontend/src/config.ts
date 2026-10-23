import type { MessageKey } from "./i18n";

export type ViewMode = "3d" | "2d";
export type QualityName = "auto" | "eco" | "balanced" | "high";
export type CutawayMode = "auto" | "always" | "off";

/** Options of `custom:domotwin-card`, after defaults. */
export interface CardConfig {
  type: string;
  title?: string;
  view: ViewMode;
  /** CSS length; absent: the card keeps a 4:3 ratio (or fills its grid cell). */
  height?: string;
  quality: QualityName;
  cutaway: CutawayMode;
  /** Room to focus on start (an element id of the plan). */
  room?: string;
  /** Font for the card's texts; absent: the bundled default. */
  font_family?: string;
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
const CSS_LENGTH = /^\d+(\.\d+)?(px|vh|svh|dvh|em|rem)$/;

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
  };
  const title = optionalString(input.title);
  if (title !== undefined) config.title = title;
  if (height !== undefined) config.height = height;
  const room = optionalString(input.room);
  if (room !== undefined) config.room = room;
  const font = optionalString(input.font_family);
  if (font !== undefined) config.font_family = font;
  return config;
}
