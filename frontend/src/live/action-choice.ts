/**
 * The tap and long-press actions as the link editor shows them: a choice and its fields, read
 * from a stored action and written back. An action with fields the editor does not show (data,
 * another target) stays as written (`custom`).
 */
import type { Action } from "./bindings";

export type ActionChoice =
  "auto" | "toggle" | "more-info" | "controls" | "perform-action" | "navigate" | "none" | "custom";

/** What the editor shows for one action. */
export interface ActionDraft {
  choice: ActionChoice;
  /** `perform-action`: `domain.action`. */
  service: string;
  /** `perform-action`: the entity it acts on (empty: none). */
  target: string;
  /** `navigate`: the page. */
  path: string;
}

const SERVICE = /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/;

export function validService(service: string): boolean {
  return SERVICE.test(service.trim());
}

export function validPath(path: string): boolean {
  return /^\/\S*$/.test(path.trim());
}

function plainTarget(target: Record<string, unknown> | undefined): string | undefined {
  if (target === undefined) return "";
  const keys = Object.keys(target);
  if (keys.length === 0) return "";
  const entity = target.entity_id;
  return keys.length === 1 && typeof entity === "string" ? entity : undefined;
}

/** The draft of a stored action (`undefined`: the automatic one). */
export function actionDraft(action: Action | undefined): ActionDraft {
  const draft: ActionDraft = { choice: "custom", service: "", target: "", path: "" };
  if (!action) return { ...draft, choice: "auto" };
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
      const noData = !action.data || Object.keys(action.data).length === 0;
      if (target !== undefined && noData && action.perform_action) {
        return { ...draft, choice: "perform-action", service: action.perform_action, target };
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

/**
 * The action to store for a draft: `undefined` for the automatic one, `null` when a field is not
 * valid. `custom` keeps `original`.
 */
export function draftAction(draft: ActionDraft, original?: Action): Action | undefined | null {
  switch (draft.choice) {
    case "auto":
      return undefined;
    case "toggle":
    case "more-info":
    case "controls":
    case "none":
      return { action: draft.choice };
    case "perform-action": {
      const service = draft.service.trim();
      if (!validService(service)) return null;
      const action: Action = { action: "perform-action", perform_action: service };
      if (draft.target) action.target = { entity_id: draft.target };
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
