/**
 * The tap and long-press actions as the link editor shows them: a choice and its fields, read
 * from a stored action and written back. The plain actions of the linked devices (`presets`, D-047)
 * come first; the advanced mode adds any Home Assistant action with its data, and a page. An action
 * with fields the editor does not show (another kind of target) stays as written (`custom`).
 */
import type { Action } from "./bindings";
import { presetByKey, presetKey, presetOf } from "./presets";

export type ActionChoice =
  | "auto"
  | "preset"
  | "toggle"
  | "more-info"
  | "controls"
  | "perform-action"
  | "navigate"
  | "none"
  | "custom";

/** The choices only the advanced mode shows. */
export const ADVANCED_CHOICES: ReadonlySet<ActionChoice> = new Set([
  "toggle",
  "perform-action",
  "navigate",
  "custom",
]);

/** What the editor shows for one action. */
export interface ActionDraft {
  choice: ActionChoice;
  /** `preset`: which (`presetKey`). */
  preset: string;
  /** `perform-action`: `domain.action`. */
  service: string;
  /** `perform-action`: the entity it acts on (empty: none). */
  target: string;
  /** `perform-action`: its data, as JSON (empty: none). */
  data: string;
  /** `navigate`: the page. */
  path: string;
}

const SERVICE = /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/;
/** At most this much data, as typed (an action is not a document). */
const MAX_DATA = 2000;

export function validService(service: string): boolean {
  return SERVICE.test(service.trim());
}

export function validPath(path: string): boolean {
  return /^\/\S*$/.test(path.trim());
}

/** The data typed for an action: an object, `undefined` when empty, `null` when not valid. */
export function parseData(text: string): Record<string, unknown> | undefined | null {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  if (trimmed.length > MAX_DATA) return null;
  try {
    const value: unknown = JSON.parse(trimmed);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function plainTarget(target: Record<string, unknown> | undefined): string | undefined {
  if (target === undefined) return "";
  const keys = Object.keys(target);
  if (keys.length === 0) return "";
  const entity = target.entity_id;
  return keys.length === 1 && typeof entity === "string" ? entity : undefined;
}

/** The fields the editor shows, for each action. */
const KNOWN: Readonly<Record<string, readonly string[]>> = {
  toggle: ["action", "entity_id"],
  "more-info": ["action", "entity_id"],
  controls: ["action"],
  none: ["action"],
  "perform-action": ["action", "perform_action", "target", "data"],
  navigate: ["action", "navigation_path"],
};

const EMPTY: ActionDraft = {
  choice: "custom",
  preset: "",
  service: "",
  target: "",
  data: "",
  path: "",
};

/**
 * The draft of a stored action (`undefined`: the automatic one). One of the plain actions of
 * `entities` reads as that (a bare toggle acts on `primary`, the piece's main device).
 */
export function actionDraft(
  action: Action | undefined,
  entities: readonly string[] = [],
  primary?: string,
): ActionDraft {
  const draft: ActionDraft = { ...EMPTY };
  if (!action) return { ...draft, choice: "auto" };
  // Fields the editor does not show (a confirmation…): kept as written.
  const known = KNOWN[action.action];
  if (!known || Object.keys(action).some((key) => !known.includes(key))) return draft;
  const preset = presetOf(action, entities, primary);
  if (preset) return { ...draft, choice: "preset", preset: presetKey(preset) };
  const bare = action.entity_id === undefined;
  switch (action.action) {
    case "toggle":
    case "more-info":
      if (bare) draft.choice = action.action;
      break;
    case "controls":
    case "none":
      draft.choice = action.action;
      break;
    case "perform-action": {
      const target = plainTarget(action.target);
      const data = action.data && Object.keys(action.data).length > 0 ? action.data : undefined;
      // Data too long to type again stays as written.
      const long = data !== undefined && JSON.stringify(data).length > MAX_DATA;
      if (target !== undefined && action.perform_action && !long) {
        return {
          ...draft,
          choice: "perform-action",
          service: action.perform_action,
          target,
          data: data ? JSON.stringify(data) : "",
        };
      }
      break;
    }
    case "navigate":
      if (action.navigation_path) {
        return { ...draft, choice: "navigate", path: action.navigation_path };
      }
      break;
    case "call-service":
      break;
  }
  return draft;
}

function sameDraft(a: ActionDraft, b: ActionDraft): boolean {
  return (Object.keys(a) as (keyof ActionDraft)[]).every((key) => a[key] === b[key]);
}

/**
 * The action to store for a draft: `undefined` for the automatic one, `null` when a field is not
 * valid. `custom` keeps `original`, as does a plain action left as it was written.
 */
export function draftAction(
  draft: ActionDraft,
  original?: Action,
  entities: readonly string[] = [],
  primary?: string,
): Action | undefined | null {
  // Left as it was read: as it was written.
  if (original && sameDraft(actionDraft(original, entities, primary), draft)) return original;
  switch (draft.choice) {
    case "auto":
      return undefined;
    case "preset": {
      const preset = presetByKey(draft.preset);
      return preset ? structuredClone(preset.action) : null;
    }
    case "toggle":
    case "more-info":
    case "controls":
    case "none":
      return { action: draft.choice };
    case "perform-action": {
      const service = draft.service.trim();
      const data = parseData(draft.data);
      if (!validService(service) || data === null) return null;
      const action: Action = { action: "perform-action", perform_action: service };
      if (draft.target) action.target = { entity_id: draft.target };
      if (data) action.data = data;
      return action;
    }
    case "navigate":
      return validPath(draft.path)
        ? { action: "navigate", navigation_path: draft.path.trim() }
        : null;
    case "custom":
      return original;
  }
}
