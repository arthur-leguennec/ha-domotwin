import type { DomoTwinClient, StoreyInfo } from "../ha/client";
import type { Translator } from "../i18n";
import { ALL_STOREYS, storeyLevels, storeyName } from "./storeys";
import { nameWords } from "./text";

/** A `domotwin.show` request (D-029), as the integration sends it to every screen. */
export interface ShowRequest {
  room?: string;
  element?: string;
  storey?: string;
  view?: string;
  screen?: string;
}

/** What a screen does with a request: the storey to show (`all`: every storey), the element to
 * frame, the view (`overview`, `3d`, `2d`, `walk` or a saved viewpoint's name). */
export interface ShowTarget {
  storey?: string;
  element?: string;
  view?: string;
}

/** Whether a request is for this screen: for every screen, or for the one named so. */
export function forScreen(request: ShowRequest, screen: string | undefined): boolean {
  return !request.screen || request.screen.toLowerCase() === (screen ?? "").toLowerCase();
}

/** Words that mean the whole home, as said in English or French. */
const WHOLE_HOME = new Set([
  "all",
  "everything",
  "every storey",
  "every floor",
  "all storeys",
  "all floors",
  "whole home",
  "whole house",
  "house",
  "home",
  "tout",
  "tous les etages",
  "toute la maison",
  "maison",
  "logement",
]);

/** A name as it is said: lower case, without accents, punctuation or a leading article. */
export function spoken(text: string): string {
  return nameWords(text).replace(/^(the|my|le|la|les|l|mon|ma|mes) /, "");
}

/** The storey a request names: its id, its name (or its place: Floor 1…), its number (0 for the
 * ground floor), or the whole home (`all`). */
export function findStorey(
  t: Translator,
  storeys: readonly StoreyInfo[],
  wanted: string,
): string | undefined {
  const said = spoken(wanted);
  if (WHOLE_HOME.has(said) || wanted === ALL_STOREYS)
    return storeys.length > 1 ? ALL_STOREYS : undefined;
  const levels = storeyLevels(storeys);
  const number = /^-?\d+$/.test(wanted.trim()) ? Number(wanted.trim()) : undefined;
  const found = levels.find(
    ({ storey, level }) =>
      storey.id === wanted.trim() ||
      level === number ||
      spoken(storeyName(t, storey, level)) === said ||
      (storey.name !== "" && spoken(storey.name) === said),
  );
  return found?.storey.id;
}

interface Named {
  id: string;
  name: string;
  type: string;
}

/** The elements of a plan with their names (the id when unnamed). */
function named(plan: unknown): Named[] {
  const elements = (plan as { elements?: unknown } | null | undefined)?.elements;
  if (!Array.isArray(elements)) return [];
  return (elements as unknown[]).flatMap((raw) => {
    const e = raw as Record<string, unknown> | null;
    if (typeof e?.id !== "string") return [];
    const name = typeof e.name === "string" && e.name ? e.name : e.id;
    return [{ id: e.id, name, type: typeof e.type === "string" ? e.type : "" }];
  });
}

/** The element `wanted` names in `plans`: by id, else by its name as said (a room first when
 * `room`), else the one whose name holds those words. */
export function findElement(
  plans: readonly { storey?: string; plan: unknown }[],
  wanted: string,
  room: boolean,
): { id: string; storey?: string } | undefined {
  const all = plans.flatMap(({ storey, plan }) => named(plan).map((e) => ({ ...e, storey })));
  const byId = all.find((e) => e.id === wanted.trim());
  if (byId) return { id: byId.id, storey: byId.storey };
  const said = spoken(wanted);
  if (!said) return undefined;
  const rank = (e: Named): number => (room && e.type !== "room" ? 1 : 0);
  const sorted = [...all].sort((a, b) => rank(a) - rank(b));
  const found =
    sorted.find((e) => spoken(e.name) === said) ??
    sorted.find((e) => ` ${spoken(e.name)} `.includes(` ${said} `));
  return found && { id: found.id, storey: found.storey };
}

/**
 * What a screen showing `shown` does with a request; `undefined` when it names nothing known. The
 * storeys' plans the client has are not fetched again.
 */
export async function resolveShow(
  client: Pick<DomoTwinClient, "getPlan">,
  t: Translator,
  storeys: readonly StoreyInfo[],
  shown: { plan: unknown; storey?: string },
  request: ShowRequest,
): Promise<ShowTarget | undefined> {
  const target: ShowTarget = {};
  if (request.view) target.view = request.view;
  if (request.storey) {
    const storey = findStorey(t, storeys, request.storey);
    if (storey === undefined) return undefined;
    target.storey = storey;
  }
  const wanted = request.element ?? request.room;
  if (wanted && request.element === undefined && WHOLE_HOME.has(spoken(wanted))) {
    // "Show the home": every storey, else the whole storey, not a room named "home office".
    if (storeys.length > 1) target.storey = ALL_STOREYS;
    target.view ??= "overview";
    return target;
  }
  if (wanted) {
    // Within the storey asked for, else on any.
    const within = target.storey !== undefined && target.storey !== ALL_STOREYS;
    const plans =
      storeys.length > 1
        ? await Promise.all(
            storeys
              .filter((s) => !within || s.id === target.storey)
              // A storey that does not answer (removed meanwhile) is left out.
              .map(async (s) => ({
                storey: s.id,
                plan: (await client.getPlan(s.id).catch(() => undefined))?.plan,
              })),
          )
        : [{ storey: shown.storey, plan: shown.plan }];
    const found = findElement(plans, wanted, request.element === undefined);
    if (found) {
      target.element = found.id;
      // Its storey, unless every storey is shown (or asked for): it is framed there; walking
      // is on its storey alone.
      const whole =
        (target.storey ?? shown.storey) === ALL_STOREYS && spoken(target.view ?? "") !== "walk";
      if (storeys.length > 1 && !whole && found.storey) target.storey = found.storey;
    } else if (request.element === undefined && request.storey === undefined) {
      // "Show upstairs": a storey said as a room.
      const storey = findStorey(t, storeys, wanted);
      if (storey === undefined) return undefined;
      target.storey = storey;
    } else {
      return undefined;
    }
  }
  return target;
}
