/**
 * The storeys of the home as people call them (`docs/DECISIONS.md`, D-026): the ground floor is
 * the storey whose floor is nearest the ground (elevation 0), the others are numbered up and down
 * from it. A storey's own name wins.
 */
import type { HomeStorey } from "../engine/engine";
import type { DomoTwinClient, StoredPlan, StoreyInfo } from "../ha/client";
import { isHassError, type HomeAssistant } from "../ha/types";
import type { Translator } from "../i18n";
import type { BindingsJson } from "./bindings";
import { roomLayers, type LayerChoice, type PlanRoom, type RoomAlert } from "./layers";
import { planRooms } from "./suggest";
import { planElements } from "./plan";

/** What a storey switcher or a card's `storey` says to show every storey at once (D-028). */
export const ALL_STOREYS = "all";

/** The storeys lowest first, each with its level (0: the ground floor, 1 above it, −1 below). */
export function storeyLevels<T extends Pick<StoreyInfo, "elevation">>(
  storeys: readonly T[],
): { storey: T; level: number }[] {
  const sorted = [...storeys].sort((a, b) => a.elevation - b.elevation);
  let ground = 0;
  sorted.forEach((storey, i) => {
    const best = sorted[ground];
    if (best && Math.abs(storey.elevation) < Math.abs(best.elevation)) ground = i;
  });
  return sorted.map((storey, i) => ({ storey, level: i - ground }));
}

/** What a storey is called: its name, else its place. */
export function storeyName(t: Translator, storey: Pick<StoreyInfo, "name">, level: number): string {
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
  const ids = planElements(plan).map((e) => e.id);
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

/** The rooms of a storey not shown, for its alerts, and its plan and overlay. */
export interface StoreyRooms {
  storey: string;
  rooms: PlanRoom[];
  plan?: unknown;
  layout?: Record<string, unknown>;
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
          (stored) => ({
            storey: storey.id,
            rooms: planRooms(stored.plan),
            plan: stored.plan,
            layout: stored.layout,
          }),
          () => undefined,
        ),
      ),
  );
  return read.filter((entry) => entry !== undefined);
}

/**
 * The alerts of the rooms of the storey shown, then those of the other storeys (`elsewhere`),
 * dangers first: a smoke alarm upstairs shows on the ground floor too. Of a private room the
 * viewer may not see (`closed`, D-039), only the dangers, as on the storey shown.
 */
export function withAlertsElsewhere(
  hass: HomeAssistant,
  bindings: BindingsJson,
  here: readonly RoomAlert[],
  elsewhere: readonly StoreyRooms[],
  shown: string | undefined,
  closed?: Set<string>,
): StoreyAlert[] {
  const alerts: StoreyAlert[] = [...here];
  // One alert per sensor: rooms of the same name on two storeys find the same area.
  const raised = new Set(here.map((alert) => alert.entity));
  for (const { storey, rooms } of elsewhere) {
    if (storey === shown) continue;
    const choice: LayerChoice = { layer: "off", alerts: true, presence: false };
    if (closed) choice.closed = closed;
    for (const alert of roomLayers(hass, bindings, rooms, choice).alerts) {
      if (raised.has(alert.entity)) continue;
      raised.add(alert.entity);
      alerts.push({ ...alert, storey });
    }
  }
  // A stable sort: the storey shown first within each level.
  return alerts.sort((a, b) => (a.level === b.level ? 0 : a.level === "danger" ? -1 : 1));
}

/** What a room's alert says; on another storey, which one. */
export function alertText(
  t: Translator,
  alert: StoreyAlert,
  storeys: readonly Pick<StoreyInfo, "id" | "name" | "elevation">[],
): string {
  const text = t.t(`layers.alert_${alert.reason}`, { room: alert.name });
  if (!alert.storey) return text;
  const level = storeyLevels(storeys).find(({ storey }) => storey.id === alert.storey);
  if (!level) return text;
  return t.t("storey.alert_on", {
    alert: text,
    storey: storeyName(t, level.storey, level.level),
  });
}

/**
 * Every storey's plan and overlay, lowest first, to show the home whole (D-028); the plans the
 * client has are not fetched again. A storey without a plan yet (added, not drawn) is left out; a
 * plan that could not be fetched fails it all, as one storey's would.
 */
export async function loadHome(
  client: Pick<DomoTwinClient, "getPlan">,
  storeys: readonly StoreyInfo[],
): Promise<HomeStorey[]> {
  const sorted = [...storeys].sort((a, b) => a.elevation - b.elevation);
  const plans = await Promise.all(sorted.map((storey) => client.getPlan(storey.id)));
  return sorted.flatMap((storey, i) => {
    const stored = plans[i];
    if (stored?.plan === undefined || stored.plan === null) return [];
    return [
      {
        id: storey.id,
        name: storey.name,
        elevation: storey.elevation,
        plan: stored.plan,
        layout: stored.layout,
      },
    ];
  });
}

/**
 * How many rooms a storey's plan has, and how many of the lights linked to its elements (and to
 * the pieces its overlay adds) are on.
 */
export function storeyCounts(
  hass: HomeAssistant | undefined,
  bindings: BindingsJson | undefined,
  plan: unknown,
  layout?: unknown,
  hidden?: (id: string) => boolean,
): { rooms: number; lights: number } {
  const ids = storeyIds(plan, layout as Record<string, unknown> | undefined);
  const on = new Set<string>();
  for (const id of ids) {
    if (hidden?.(id)) continue;
    for (const entity of bindings?.elements[id]?.entities ?? []) {
      const entityId = entity.entity_id;
      if (entityId.startsWith("light.") && hass?.states[entityId]?.state === "on") on.add(entityId);
    }
  }
  return { rooms: planRooms(plan).length, lights: on.size };
}

/**
 * Every storey of the home, lowest first, as the radio coverage reads them (D-066): a storey with
 * no plan (none drawn yet, or not fetched) is still there, so that the floors between the others
 * are counted as the integration counts them. `plans` gives each storey's plan and overlay.
 */
export function homeStoreys(
  storeys: readonly StoreyInfo[],
  plans: (id: string) => { plan?: unknown; layout?: Record<string, unknown> } | undefined,
): HomeStorey[] {
  return [...storeys]
    .sort((a, b) => a.elevation - b.elevation)
    .map((info) => {
      const found = plans(info.id);
      const storey: HomeStorey = {
        id: info.id,
        name: info.name,
        elevation: info.elevation,
        plan: found?.plan ?? null,
      };
      if (found?.layout) storey.layout = found.layout;
      return storey;
    });
}
