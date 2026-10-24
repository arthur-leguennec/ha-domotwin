/**
 * The storeys of the home as people call them (`docs/DECISIONS.md`, D-026): the ground floor is
 * the storey whose floor is nearest the ground (elevation 0), the others are numbered up and down
 * from it. A storey's own name wins.
 */
import type { DomoTwinClient, StoredPlan, StoreyInfo } from "../ha/client";
import { isHassError, type HomeAssistant } from "../ha/types";
import type { Translator } from "../i18n";
import type { BindingsJson } from "./bindings";
import { roomLayers, type PlanRoom, type RoomAlert } from "./layers";
import { planRooms } from "./suggest";

/** The storeys lowest first, each with its level (0: the ground floor, 1 above it, −1 below). */
export function storeyLevels(
  storeys: readonly StoreyInfo[],
): { storey: StoreyInfo; level: number }[] {
  const sorted = [...storeys].sort((a, b) => a.elevation - b.elevation);
  let ground = 0;
  sorted.forEach((storey, i) => {
    const best = sorted[ground];
    if (best && Math.abs(storey.elevation) < Math.abs(best.elevation)) ground = i;
  });
  return sorted.map((storey, i) => ({ storey, level: i - ground }));
}

/** What a storey is called: its name, else its place. */
export function storeyName(t: Translator, storey: StoreyInfo, level: number): string {
  if (storey.name) return storey.name;
  if (level === 0) return t.t("storey.ground");
  return level > 0 ? t.t("storey.above", { n: level }) : t.t("storey.below", { n: -level });
}

/** A storey's level as written on its button (a minus sign below the ground floor). */
export function storeyShort(level: number): string {
  return level < 0 ? `−${-level}` : String(level);
}

/** Storey `wanted`'s plan (the ground floor's without), or the ground floor's when it is gone. */
export async function loadStorey(
  client: Pick<DomoTwinClient, "getPlan">,
  wanted: string | undefined,
): Promise<StoredPlan> {
  try {
    return await client.getPlan(wanted);
  } catch (error) {
    if (wanted === undefined || !isHassError(error) || error.code !== "unknown_storey") throw error;
    return client.getPlan();
  }
}

/** The ids a storey uses: its plan's elements and the pieces its overlay adds. */
export function storeyIds(plan: unknown, layout?: Record<string, unknown>): string[] {
  const elements = (plan as { elements?: unknown } | null)?.elements;
  const ids = Array.isArray(elements)
    ? elements
        .map((element) => (element as { id?: unknown } | null)?.id)
        .filter((id): id is string => typeof id === "string")
    : [];
  for (const [id, entry] of Object.entries(layout ?? {})) {
    if (entry && typeof entry === "object" && "add" in entry) ids.push(id);
  }
  return ids;
}

/** The ids every storey but `except` uses (D-026: an id is the home's). */
export async function idsElsewhere(
  client: Pick<DomoTwinClient, "getPlan">,
  storeys: readonly StoreyInfo[],
  except: string | undefined,
): Promise<string[]> {
  const plans = await Promise.all(
    storeys.filter((storey) => storey.id !== except).map((storey) => client.getPlan(storey.id)),
  );
  return plans.flatMap((stored) => storeyIds(stored.plan, stored.layout));
}

/** The rooms of a storey not shown, for its alerts. */
export interface StoreyRooms {
  storey: string;
  rooms: PlanRoom[];
}

/** An alert of a room, with the storey it is on when that is not the one shown. */
export type StoreyAlert = RoomAlert & { storey?: string };

/** The rooms of every storey but the one shown (a plan that cannot be fetched is left out). */
export async function roomsElsewhere(
  client: Pick<DomoTwinClient, "getPlan">,
  storeys: readonly StoreyInfo[],
  shown: string | null | undefined,
): Promise<StoreyRooms[]> {
  const read = await Promise.all(
    storeys
      .filter((storey) => storey.id !== shown)
      .map((storey) =>
        client.getPlan(storey.id).then(
          (stored) => ({ storey: storey.id, rooms: planRooms(stored.plan) }),
          () => undefined,
        ),
      ),
  );
  return read.filter((entry) => entry !== undefined);
}

/**
 * The alerts of the rooms of the storey shown, then those of the other storeys (`elsewhere`),
 * dangers first: a smoke alarm upstairs shows on the ground floor too.
 */
export function withAlertsElsewhere(
  hass: HomeAssistant,
  bindings: BindingsJson,
  here: readonly RoomAlert[],
  elsewhere: readonly StoreyRooms[],
  shown: string | undefined,
): StoreyAlert[] {
  const alerts: StoreyAlert[] = [...here];
  // One alert per sensor: rooms of the same name on two storeys find the same area.
  const raised = new Set(here.map((alert) => alert.entity));
  for (const { storey, rooms } of elsewhere) {
    if (storey === shown) continue;
    const choice = { layer: "off", alerts: true, presence: false } as const;
    for (const alert of roomLayers(hass, bindings, rooms, choice).alerts) {
      if (raised.has(alert.entity)) continue;
      raised.add(alert.entity);
      alerts.push({ ...alert, storey });
    }
  }
  // A stable sort: the storey shown first within each level.
  return alerts.sort((a, b) => (a.level === b.level ? 0 : a.level === "danger" ? -1 : 1));
}
